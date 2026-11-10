import { expect, test, type Page } from "@playwright/test";

const workspaceSlug = process.env.LOCAL_TEST_WORKSPACE_SLUG ?? "pos-local";
const workspaceName = "pos-local";

async function signInToWorkspace(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("อีเมล").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page).toHaveURL(/\/workspaces\/?(?:\?.*)?$/, { timeout: 20_000 });
  await page.goto("/workspace/" + workspaceSlug);
  await expect(page).toHaveURL(new RegExp("/workspace/" + workspaceSlug + "$"));
}

async function expectInventoryPage(page: Page) {
  await page.getByRole("button", { name: "คลังสินค้า" }).click();
  await expect(page).toHaveURL(new RegExp("/workspace/" + workspaceSlug + "/inventory$"));
  await expect(page.getByRole("heading", { name: "คลังสินค้า" })).toBeVisible();
  await expect(page.getByText(/รับเข้า จ่ายออก ปรับยอด และโอนระหว่างคลัง/)).toBeVisible();
  const ready = await page.locator("#inventory-variant").count();
  if (ready) {
    await expect(page.locator("#inventory-warehouse")).toBeVisible();
    await expect(page.getByRole("tab", { name: "รับสินค้าเข้า" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "จ่ายสินค้าออก" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "ปรับยอดสต็อก" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "โอนระหว่างคลัง" })).toBeVisible();
    await page.getByRole("tab", { name: "โอนระหว่างคลัง" }).click();
    await expect(page.getByLabel("คลังปลายทาง")).toBeVisible();
  } else {
    await expect(page.getByRole("heading", { name: "ยังไม่พร้อมทำรายการ" })).toBeVisible();
  }
  await page.getByRole("button", { name: "ประวัติ Movement" }).click();
  await expect(page).toHaveURL(new RegExp("/workspace/" + workspaceSlug + "/inventory/history$"));
  await expect(page.getByRole("heading", { name: "ประวัติการเคลื่อนไหวสินค้า" })).toBeVisible();
  await expect(page.getByLabel("ค้นหาสินค้า / SKU / เหตุผล")).toBeVisible();
  await expect(page.getByLabel("คลังสินค้า")).toBeVisible();
  await expect(page.getByLabel("ประเภท")).toBeVisible();
}

test("Inventory UI loads transaction modes and movement history for Manager", async ({ page }) => {
  const email = process.env.LOCAL_TEST_MANAGER_EMAIL;
  const password = process.env.LOCAL_TEST_MANAGER_PASSWORD;
  test.skip(!email || !password, "Dedicated E2E Manager credentials are required.");
  await signInToWorkspace(page, email!, password!);
  await expectInventoryPage(page);
});

test("Inventory Staff can open inventory and movement history with workspace permissions", async ({ page }) => {
  const email = process.env.E2E_INVENTORY_EMAIL;
  const password = process.env.E2E_INVENTORY_PASSWORD;
  test.skip(!email || !password, "Dedicated E2E Inventory Staff credentials are required.");
  await signInToWorkspace(page, email!, password!);
  await expectInventoryPage(page);
});

test("Manager can complete the Stocktake UI flow with Stocktake API responses stubbed", async ({ page }) => {
  const email = process.env.LOCAL_TEST_MANAGER_EMAIL;
  const password = process.env.LOCAL_TEST_MANAGER_PASSWORD;
  test.skip(!email || !password, "Dedicated E2E Manager credentials are required.");

  const stocktakeId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const lineId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  let status: "DRAFT" | "IN_PROGRESS" | "FINALIZED" | "CANCELLED" = "DRAFT";
  let countedQuantity: string | null = null;
  let unitCost: string | null = null;
  let note: string | null = null;

  page.on("dialog", dialog => dialog.accept());
  await page.route(/\/api\/tenant\/[^/]+\/inventory\/stocktakes(?:\/.*)?(?:\?.*)?$/, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const session = {
      id: stocktakeId, status, reference: "ST-E2E-001", notes: "UI mocked stocktake",
      snapshotAt: "2026-11-07T08:00:00.000Z", createdAt: "2026-11-07T08:00:00.000Z",
      finalizedAt: status === "FINALIZED" ? "2026-11-07T08:10:00.000Z" : null,
      warehouse: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "คลังทดสอบ", code: "TEST" },
      lines: [{
        id: lineId, variantId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", sku: "STOCK-001",
        variantTitle: "สินค้า E2E", productName: "สินค้า E2E", systemQuantity: "8.000",
        countedQuantity, variance: countedQuantity === null ? null : (Number(countedQuantity) - 8).toFixed(3),
        unitCost, note,
      }],
    };
    if (method === "POST" && path.endsWith("/inventory/stocktakes")) {
      status = "DRAFT";
      countedQuantity = null; unitCost = null; note = null;
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ stocktakeId, status, idempotentReplay: false }) });
    }
    if (method === "GET" && path.endsWith("/inventory/stocktakes")) {
      const items = status === "DRAFT" && countedQuantity === null && !url.searchParams.has("created")
        ? [] : [{
          id: stocktakeId, status, reference: "ST-E2E-001", notes: "UI mocked stocktake",
          snapshotAt: session.snapshotAt, createdAt: session.createdAt, finalizedAt: session.finalizedAt,
          warehouse: session.warehouse, lineCount: 1, countedCount: countedQuantity === null ? 0 : 1,
        }];
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items, pagination: { page: 1, pageSize: 50, total: items.length, totalPages: items.length ? 1 : 0 } }) });
    }
    if (method === "GET" && path.endsWith("/" + stocktakeId)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) });
    }
    if (method === "PATCH" && path.endsWith("/lines/" + lineId)) {
      const body = request.postDataJSON() as { countedQuantity: string; unitCost?: string; note?: string };
      countedQuantity = body.countedQuantity; unitCost = body.unitCost ?? null; note = body.note ?? null; status = "IN_PROGRESS";
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ lineId, countedQuantity, unitCost }) });
    }
    if (method === "POST" && path.endsWith("/finalize")) {
      status = "FINALIZED";
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ stocktakeId, status, idempotentReplay: false, movements: [{ movementId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }] }) });
    }
    if (method === "POST" && path.endsWith("/cancel")) {
      status = "CANCELLED";
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ stocktakeId, status, idempotentReplay: false }) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: "Unexpected mocked stocktake request" }) });
  });

  await signInToWorkspace(page, email!, password!);
  await page.getByRole("button", { name: "คลังสินค้า" }).click();
  await page.getByRole("button", { name: "ตรวจนับสต็อก", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("/workspace/" + workspaceSlug + "/inventory/stocktakes$"));
  await expect(page.getByRole("heading", { name: "ตรวจนับสต็อก" })).toBeVisible();
  await page.getByLabel("เลขที่ / อ้างอิง (ไม่บังคับ)").fill("ST-E2E-001");
  await page.getByRole("button", { name: "สร้างรอบตรวจนับ" }).click();
  await expect(page.getByText("สร้างรอบตรวจนับแล้ว")).toBeVisible();
  await expect(page.getByText("สินค้า E2E", { exact: true })).toBeVisible();
  await page.getByLabel("ยอดตรวจนับจริง").fill("9");
  await page.getByLabel("ต้นทุนต่อหน่วย (เมื่อยอดเพิ่ม)").fill("5.25");
  await page.getByLabel("หมายเหตุ", { exact: true }).fill("นับจริงจากชั้นวาง");
  await page.getByRole("button", { name: "บันทึกยอด" }).click();
  await expect(page.getByText("บันทึกยอดตรวจนับ STOCK-001 แล้ว")).toBeVisible();
  await expect(page.getByText("+1.000")).toBeVisible();
  await page.getByRole("button", { name: "ปิดรอบและปรับสต็อก" }).click();
  await expect(page.getByText("ปิดรอบตรวจนับสำเร็จ")).toBeVisible();
  await expect(page.getByText("ปิดรอบแล้ว").first()).toBeVisible();
});
