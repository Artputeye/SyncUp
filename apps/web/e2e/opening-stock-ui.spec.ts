import { expect, test, type Page } from "@playwright/test";

const workspaceSlug = process.env.LOCAL_TEST_WORKSPACE_SLUG ?? "pos-local";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("อีเมล").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page).toHaveURL(/\/workspaces\/?(?:\?.*)?$/, { timeout: 20_000 });
}

test("Manager can create and post an Opening Stock draft", async ({ page }) => {
  const email = process.env.LOCAL_TEST_MANAGER_EMAIL;
  const password = process.env.LOCAL_TEST_MANAGER_PASSWORD;
  test.skip(!email || !password, "Dedicated pos-local Manager credentials are required.");

  const workspaceId = "c0130bf3-c1c0-4dfa-a915-7ca5155cacfd";
  const storeId = "33333333-3333-4333-8333-333333333333";
  const branchId = "44444444-4444-4444-8444-444444444444";
  const warehouseId = "55555555-5555-4555-8555-555555555555";
  const variantId = "22222222-2222-4222-8222-222222222222";
  const openingStockId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let status: "DRAFT" | "POSTED" | "CANCELLED" = "DRAFT";
  const captured: { current: { warehouseId: string; reference?: string; notes?: string; items: Array<{ variantId: string; quantity: string; unitCost: string }> } | null } = { current: null };

  await signIn(page, email!, password!);
  await page.route(/\/api\/workspaces$/, route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify([{ id: workspaceId, slug: workspaceSlug, name: "E2E Commerce Workspace" }]),
  }));
  await page.route(/\/api\/tenant\/[^/]+\/products(?:\?.*)?$/, route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ items: [{
      id: "11111111-1111-4111-8111-111111111111", name: "สินค้า E2E", status: "ACTIVE",
      variants: [{ id: variantId, sku: "OPEN-UI-001", title: "ตัวเลือกทดสอบ", status: "ACTIVE", baseUom: { code: "EA" } }],
    }] }),
  }));
  await page.route(/\/api\/tenant\/[^/]+\/stores$/, route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify([{ id: storeId, status: "ACTIVE" }]),
  }));
  await page.route(/\/api\/tenant\/[^/]+\/stores\/[^/]+\/branches$/, route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify([{ id: branchId, status: "ACTIVE" }]),
  }));
  await page.route(/\/api\/tenant\/[^/]+\/stores\/[^/]+\/branches\/[^/]+\/warehouses$/, route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify([{ id: warehouseId, code: "E2E", name: "คลัง E2E", status: "ACTIVE", isDefault: true }]),
  }));

  await page.route(/\/api\/tenant\/[^/]+\/inventory\/opening-stocks(?:\/.*)?(?:\?.*)?$/, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (method === "POST" && path.endsWith("/post")) {
      status = "POSTED";
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ openingStockId, status, idempotentReplay: false, movementCount: captured.current?.items.length ?? 0 }) });
    }
    if (method === "POST" && path.endsWith("/cancel")) {
      status = "CANCELLED";
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ openingStockId, status, idempotentReplay: false }) });
    }
    if (method === "PATCH" && path.endsWith("/" + openingStockId)) {
      captured.current = { ...captured.current!, ...request.postDataJSON() };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ openingStockId, status: "DRAFT", itemCount: captured.current?.items.length ?? 0 }) });
    }
    if (method === "POST" && path.endsWith("/opening-stocks")) {
      captured.current = request.postDataJSON();
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ openingStockId, status: "DRAFT", idempotentReplay: false }) });
    }
    if (method === "GET" && path.endsWith("/opening-stocks/" + openingStockId)) {
      const current = captured.current;
      const lines = (current?.items ?? []).map(item => ({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", variantId: item.variantId,
        sku: "OPEN-UI-001", variantTitle: "ตัวเลือกทดสอบ", productName: "สินค้า E2E", uomCode: "EA",
        quantity: item.quantity, unitCost: item.unitCost,
        totalCost: (Number(item.quantity) * Number(item.unitCost)).toFixed(6),
      }));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        id: openingStockId, status, reference: current?.reference ?? "OPEN-UI-E2E", notes: current?.notes ?? null,
        createdAt: new Date().toISOString(), postedAt: status === "POSTED" ? new Date().toISOString() : null,
        warehouse: { id: current?.warehouseId ?? warehouseId, name: "คลัง E2E", code: "E2E" }, items: lines,
      }) });
    }
    if (method === "GET" && path.endsWith("/opening-stocks")) {
      const current = captured.current;
      const items = current ? [{
        id: openingStockId, status, reference: current.reference ?? "OPEN-UI-E2E",
        createdAt: new Date().toISOString(), postedAt: status === "POSTED" ? new Date().toISOString() : null,
        warehouse: { id: current.warehouseId, name: "คลัง E2E", code: "E2E" },
        itemCount: current.items.length,
        totalQuantity: current.items.reduce((sum, item) => sum + Number(item.quantity), 0).toFixed(3),
        totalCost: current.items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitCost), 0).toFixed(6),
      }] : [];
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items, pagination: { page: 1, pageSize: 50, total: items.length, totalPages: items.length ? 1 : 0 } }) });
    }
    return route.continue();
  });

  await page.goto("/workspace/" + workspaceSlug + "/inventory/opening-stock");
  await expect(page.getByRole("heading", { name: "กำหนดยอดตั้งต้นสินค้า" })).toBeVisible();
  await expect(page.locator("#opening-warehouse")).toBeVisible();
  expect(await page.locator("#opening-warehouse option").count()).toBeGreaterThan(1);
  await expect(page.getByLabel("สินค้า / SKU").first()).toBeVisible();
  await page.getByLabel("สินค้า / SKU").first().selectOption({ index: 1 });
  await page.getByLabel("จำนวนตั้งต้น").first().fill("3.250");
  await page.getByLabel("ต้นทุนต่อหน่วย").first().fill("4.5");
  await page.getByLabel("เลขที่ / อ้างอิง").fill("OPEN-UI-E2E");
  await page.getByRole("button", { name: "สร้างฉบับร่าง" }).click();
  await expect(page.getByRole("heading", { name: "OPEN-UI-E2E" })).toBeVisible();
  await expect(page.getByText("ฉบับร่าง").first()).toBeVisible();
  expect(captured.current?.items).toHaveLength(1);
  expect(captured.current?.items[0].quantity).toBe("3.250");
  await page.getByRole("button", { name: "แก้ไขฉบับร่าง" }).click();
  await page.getByLabel("นำเข้าไฟล์ CSV").setInputFiles({ name: "invalid.csv", mimeType: "text/csv", buffer: Buffer.from(['sku,quantity,unitCost','UNKNOWN-SKU,8.500,5.25'].join(String.fromCharCode(10))) });
  await expect(page.getByText("ไม่พบ SKU")).toBeVisible();
  await expect(page.getByRole("button", { name: "ยืนยันนำเข้า" })).toBeDisabled();
  await page.getByLabel("นำเข้าไฟล์ CSV").setInputFiles({ name: "opening.csv", mimeType: "text/csv", buffer: Buffer.from(['sku,quantity,unitCost','OPEN-UI-001,8.500,5.25'].join(String.fromCharCode(10))) });
  await expect(page.getByText("ตรวจสอบข้อมูลก่อนนำเข้า")).toBeVisible();
  await expect(page.getByText("ผ่าน 1 / 1 รายการ")).toBeVisible();
  await page.getByRole("button", { name: "ยืนยันนำเข้า" }).click();
  await expect(page.getByText("นำเข้าสำเร็จ 1 รายการ")).toBeVisible();
  await page.getByRole("button", { name: "บันทึกการแก้ไข" }).click();
  await expect(page.getByRole("heading", { name: "OPEN-UI-E2E" })).toBeVisible();
  expect(captured.current?.items[0].quantity).toBe("8.500");
  expect(captured.current?.items[0].unitCost).toBe("5.25");

  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "บันทึกเข้าสต็อก" }).click();
  await expect(page.getByText("บันทึกแล้ว").first()).toBeVisible();
  await expect(page.getByText("บันทึกยอดตั้งต้นเข้าสต็อกเรียบร้อยแล้ว")).toBeVisible();
  expect(status).toBe("POSTED");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "ส่งออก CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("opening-stock-OPEN-UI-E2E");
});
