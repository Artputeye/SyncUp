import { test, expect, Page } from "@playwright/test";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const storeId = "22222222-2222-4222-8222-222222222222";
const branchId = "33333333-3333-4333-8333-333333333333";
const warehouseId = "44444444-4444-4444-8444-444444444444";
const product = {
  productId: "55555555-5555-4555-8555-555555555555", productName: "กาแฟทดสอบ",
  variantId: "66666666-6666-4666-8666-666666666666", variantTitle: "กาแฟคั่ว 250 กรัม",
  sku: "COFFEE-250", barcode: "8850000000001",
  variantUomId: "77777777-7777-4777-8777-777777777777", uomCode: "EA", uomName: "ชิ้น",
  conversionToBase: "1", unitPrice: "107.00", currency: "THB", taxRate: "0.07", available: "5"
};

async function mockCatalog(page: Page) {
  await page.route("**/api/workspaces", route => route.fulfill({ json: [
    { id: workspaceId, slug: "pos-checkout", name: "POS Checkout" }
  ] }));
  await page.route("**/api/tenant/*/stores", route => route.fulfill({ json: [
    { id: storeId, name: "Main Store", status: "ACTIVE", currency: "THB", activeBranchCount: 1 }
  ] }));
  await page.route("**/api/tenant/*/stores/*/branches", route => route.fulfill({ json: [
    { id: branchId, name: "สำนักงานใหญ่", code: "HQ", status: "ACTIVE", isDefault: true }
  ] }));
  await page.route("**/api/tenant/*/stores/*/branches/*/warehouses", route => route.fulfill({ json: [
    { id: warehouseId, name: "คลังหลัก", code: "MAIN", status: "ACTIVE", isDefault: true }
  ] }));
  await page.route("**/api/tenant/*/pos/catalog**", route => route.fulfill({ json: {
    context: { storeId, branchId, warehouseId, currency: "THB", taxMode: "VAT", priceTaxMode: "INCLUSIVE", currencyMinorUnits: 2 },
    items: [product]
  } }));
}

async function mockReceipt(page: Page, orderId: string, paymentNumber: string) {
  await page.route("**/api/tenant/*/orders/*/payments", async route => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ json: { items: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", payment_number: paymentNumber, method: "CASH", status: "CAPTURED", currency: "THB", amount: "107.0000", refunded_amount: "0.0000", received_at: new Date().toISOString() }] } });
  });
  await page.route("**/api/tenant/*/orders/*", async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET" || !pathname.endsWith("/orders/" + orderId)) return route.fallback();
    return route.fulfill({ json: { id: orderId, order_number: "SO-RECEIPT-E2E", status: "POSTED", store_name: "Main Store", branch_code: "HQ", branch_name: "สำนักงานใหญ่", warehouse_code: "MAIN", warehouse_name: "คลังหลัก", currency: "THB", tax_mode: "VAT", price_tax_mode: "INCLUSIVE", subtotal: "100.0000", tax_amount: "7.0000", total_amount: "107.0000", created_at: new Date().toISOString(), posted_at: new Date().toISOString(), items: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", product_name: "กาแฟทดสอบ", variant_title: "กาแฟคั่ว 250 กรัม", sku: "COFFEE-250", uom_code: "EA", quantity: "1.000", unit_price: "107.0000", tax_amount: "7.0000", total_amount: "107.0000" }] } });
  });
}

test.describe("POS checkout idempotency and recovery", () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([{
      name: process.env.AUTH_COOKIE_NAME ?? "syncup_session",
      value: "pos-checkout-preview",
      url: process.env.WEB_ORIGIN ?? "http://localhost:3000",
      httpOnly: true,
      sameSite: "Lax"
    }]);
  });

  test("resumes a failed payment after reload using the same keys without duplicating Order or stock posting", async ({ page }) => {
    await mockCatalog(page);
    const calls: Array<{ stage: string; key: string }> = [];
    let paymentAttempts = 0;

    await page.route("**/api/tenant/*/orders", async route => {
      if (route.request().method() !== "POST") return route.continue();
      const body = route.request().postDataJSON();
      calls.push({ stage: "CREATE", key: body.idempotencyKey });
      await route.fulfill({ json: {
        id: "88888888-8888-4888-8888-888888888888", order_number: "SO-HQ-2026-000001",
        status: "RESERVED", currency: "THB", total_amount: "107.0000", idempotentReplay: false
      } });
    });
    await page.route("**/api/tenant/*/orders/*/post", async route => {
      const body = route.request().postDataJSON();
      calls.push({ stage: "POST", key: body.idempotencyKey });
      await route.fulfill({ json: { id: "88888888-8888-4888-8888-888888888888", status: "POSTED" } });
    });
    await page.route("**/api/tenant/*/orders/*/payments", async route => {
      const body = route.request().postDataJSON();
      calls.push({ stage: "PAYMENT", key: body.idempotencyKey });
      paymentAttempts += 1;
      if (paymentAttempts === 1) {
        await route.fulfill({ status: 503, json: { message: "จำลอง Payment service unavailable" } });
      } else {
        await route.fulfill({ json: {
          payment_number: "PAY-88888888-0001", amount: body.amount, currency: "THB",
          method: body.method, idempotentReplay: false
        } });
      }
    });

    await mockReceipt(page, "88888888-8888-4888-8888-888888888888", "PAY-88888888-0001");
    await page.goto("/workspace/pos-checkout/pos");
    await page.getByRole("button", { name: /เพิ่มลงตะกร้า/ }).click();
    await page.getByRole("button", { name: /ดำเนินการชำระเงิน/ }).click();
    await page.getByLabel("วิธีรับชำระ").selectOption("BANK_TRANSFER");
    await page.getByLabel("เลขอ้างอิง (ถ้ามี)").fill("BANK-REF-001");
    await page.getByRole("button", { name: "ยืนยันขายและบันทึกรับชำระ" }).click();

    await expect(page.getByRole("alert").filter({ hasText: "จำลอง Payment service unavailable" })).toBeVisible();
    expect(calls.map(call => call.stage)).toEqual(["CREATE", "POST", "PAYMENT"]);
    const firstPaymentKey = calls[2].key;

    await page.reload();
    await expect(page.getByRole("heading", { name: "ดำเนินการขายต่อ" })).toBeVisible();
    const retry = page.getByRole("button", { name: "ลองอีกครั้ง / ดำเนินการต่อ" });
    await expect(retry).toBeEnabled();
    await retry.click();

    await expect(page.getByRole("status").getByText(/ขายสำเร็จ/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "ใบรับเงิน / SALES RECEIPT" })).toBeVisible();
    expect(calls.map(call => call.stage)).toEqual(["CREATE", "POST", "PAYMENT", "PAYMENT"]);
    expect(calls[0].key).not.toBe(calls[1].key);
    expect(calls[1].key).not.toBe(firstPaymentKey);
    expect(calls[2].key).toBe(firstPaymentKey);
    expect(calls[3].key).toBe(firstPaymentKey);
    expect(paymentAttempts).toBe(2);
  });

  test("does not call payment before the Order has been posted", async ({ page }) => {
    await mockCatalog(page);
    const stages: string[] = [];
    await page.route("**/api/tenant/*/orders", async route => {
      if (route.request().method() !== "POST") return route.continue();
      stages.push("CREATE");
      await route.fulfill({ json: {
        id: "88888888-8888-4888-8888-888888888888", order_number: "SO-HQ-2026-000002",
        status: "RESERVED", currency: "THB", total_amount: "107.0000"
      } });
    });
    await page.route("**/api/tenant/*/orders/*/post", async route => {
      stages.push("POST");
      await route.fulfill({ json: { id: "88888888-8888-4888-8888-888888888888", status: "POSTED" } });
    });
    await page.route("**/api/tenant/*/orders/*/payments", async route => {
      stages.push("PAYMENT");
      await route.fulfill({ json: { payment_number: "PAY-88888888-0002", amount: "107.0000", currency: "THB", method: "CASH" } });
    });

    await mockReceipt(page, "88888888-8888-4888-8888-888888888888", "PAY-88888888-0002");
    await page.goto("/workspace/pos-checkout/pos");
    await page.getByRole("button", { name: /เพิ่มลงตะกร้า/ }).click();
    await page.getByRole("button", { name: /ดำเนินการชำระเงิน/ }).click();
    await page.getByRole("button", { name: "ยืนยันขายและบันทึกรับชำระ" }).click();
    await expect(page.getByRole("status").getByText(/ขายสำเร็จ/)).toBeVisible();
    expect(stages).toEqual(["CREATE", "POST", "PAYMENT"]);
  });

  test("retries a reserved Order posting with the same key and records payment only after posting succeeds", async ({ page }) => {
    await mockCatalog(page);
    const calls: Array<{ stage: string; key: string }> = [];
    let postAttempts = 0;
    await page.route("**/api/tenant/*/orders", async route => {
      if (route.request().method() !== "POST") return route.continue();
      const body = route.request().postDataJSON();
      calls.push({ stage: "CREATE", key: body.idempotencyKey });
      await route.fulfill({ json: {
        id: "99999999-9999-4999-8999-999999999999", order_number: "SO-HQ-2026-000003",
        status: "RESERVED", currency: "THB", total_amount: "107.0000"
      } });
    });
    await page.route("**/api/tenant/*/orders/*/post", async route => {
      const body = route.request().postDataJSON();
      calls.push({ stage: "POST", key: body.idempotencyKey });
      postAttempts += 1;
      if (postAttempts === 1) {
        await route.fulfill({ status: 503, json: { message: "จำลอง Inventory posting unavailable" } });
      } else {
        await route.fulfill({ json: { id: "99999999-9999-4999-8999-999999999999", status: "POSTED" } });
      }
    });
    await page.route("**/api/tenant/*/orders/*/payments", async route => {
      const body = route.request().postDataJSON();
      calls.push({ stage: "PAYMENT", key: body.idempotencyKey });
      await route.fulfill({ json: { payment_number: "PAY-99999999-0001", amount: body.amount, currency: "THB", method: body.method } });
    });

    await mockReceipt(page, "99999999-9999-4999-8999-999999999999", "PAY-99999999-0001");
    await page.goto("/workspace/pos-checkout/pos");
    await page.getByRole("button", { name: /เพิ่มลงตะกร้า/ }).click();
    await page.getByRole("button", { name: /ดำเนินการชำระเงิน/ }).click();
    await page.getByRole("button", { name: "ยืนยันขายและบันทึกรับชำระ" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "จำลอง Inventory posting unavailable" })).toBeVisible();
    expect(calls.map(call => call.stage)).toEqual(["CREATE", "POST"]);

    await page.getByRole("button", { name: "ลองอีกครั้ง / ดำเนินการต่อ" }).click();
    await expect(page.getByRole("status").getByText(/ขายสำเร็จ/)).toBeVisible();
    expect(calls.map(call => call.stage)).toEqual(["CREATE", "POST", "POST", "PAYMENT"]);
    expect(calls[1].key).toBe(calls[2].key);
    expect(calls[0].key).not.toBe(calls[1].key);
    expect(postAttempts).toBe(2);
  });
});
