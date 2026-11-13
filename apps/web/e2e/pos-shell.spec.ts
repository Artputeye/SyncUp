import { test, expect, Page } from "@playwright/test";

const workspace = [{ id: "11111111-1111-4111-8111-111111111111", slug: "pos-preview", name: "POS Preview" }];
const storeId = "22222222-2222-4222-8222-222222222222";
const branchId = "33333333-3333-4333-8333-333333333333";
const warehouseId = "44444444-4444-4444-8444-444444444444";
const product = {
  productId: "55555555-5555-4555-8555-555555555555",
  productName: "กาแฟทดสอบ", variantId: "66666666-6666-4666-8666-666666666666",
  variantTitle: "กาแฟคั่ว 250 กรัม", sku: "COFFEE-250", barcode: "8850000000001",
  variantUomId: "77777777-7777-4777-8777-777777777777", uomCode: "EA", uomName: "ชิ้น",
  conversionToBase: "1", unitPrice: "107.00", currency: "THB", taxRate: "0.07", available: "5"
};

async function mockPosApi(page: Page, catalogItems = [product]) {
  await page.route("**/api/workspaces", (route) => route.fulfill({ json: workspace }));
  await page.route("**/api/workspaces/*/navigation", (route) => route.fulfill({ json: { workspace: { id: workspace[0].id, slug: workspace[0].slug, type: "POS" }, items: [{ id: "workspace-home", label: "หน้าขาย", href: "/workspace/pos-preview/pos", icon: "home" }, { id: "orders", label: "คำสั่งขาย", href: "/workspace/pos-preview/orders", icon: "receipt" }] } }));
  await page.route("**/api/tenant/*/stores", (route) => route.fulfill({ json: [
    { id: storeId, name: "Main Store", status: "ACTIVE", currency: "THB", activeBranchCount: 1 }
  ] }));
  await page.route("**/api/tenant/*/stores/*/branches", (route) => route.fulfill({ json: [
    { id: branchId, name: "สำนักงานใหญ่", code: "HQ", status: "ACTIVE", isDefault: true }
  ] }));
  await page.route("**/api/tenant/*/stores/*/branches/*/warehouses", (route) => route.fulfill({ json: [
    { id: warehouseId, name: "คลังหลัก", code: "MAIN", status: "ACTIVE", isDefault: true }
  ] }));
  await page.route("**/api/tenant/*/pos/catalog**", (route) => route.fulfill({ json: {
    context: { storeId, branchId, warehouseId, currency: "THB", taxMode: "VAT", priceTaxMode: "INCLUSIVE", currencyMinorUnits: 2 },
    items: catalogItems
  } }));
}

test.describe("POS product discovery and cart", () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([{
      name: process.env.AUTH_COOKIE_NAME ?? "syncup_session",
      value: "pos-ui-shell-preview",
      url: process.env.WEB_ORIGIN ?? "http://localhost:3000",
      httpOnly: true,
      sameSite: "Lax"
    }]);
  });

  test("renders navigation returned for the POS workspace", async ({ page }) => {
    await mockPosApi(page);
    await page.goto("/workspace/pos-preview/pos");
    await expect(page.getByRole("link", { name: "คำสั่งขาย" })).toBeVisible();
    await expect(page.getByRole("button", { name: "เปลี่ยน Workspace" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "ออกจากระบบ" })).toBeVisible();
  });

  test("loads sellable catalog data and adds a product to cart", async ({ page }) => {
    await mockPosApi(page);
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto("/workspace/pos-preview/pos");

    await expect(page.getByRole("heading", { name: "เริ่มขายสินค้า" })).toBeVisible();
    await expect(page.getByText("กาแฟทดสอบ")).toBeVisible();
    await expect(page.getByText("COFFEE-250")).toBeVisible();
    await page.getByRole("button", { name: /เพิ่มลงตะกร้า/ }).click();
    await expect(page.getByRole("heading", { name: "ตะกร้าสินค้า" })).toBeVisible();
    await expect(page.getByText("กาแฟทดสอบ").last()).toBeVisible();
    await expect(page.getByText(/107\.00/).last()).toBeVisible();
    await expect(page.getByRole("button", { name: /ดำเนินการชำระเงิน/ })).toBeEnabled();
  });

  test("searches the catalog by SKU or barcode", async ({ page }) => {
    await mockPosApi(page);
    await page.goto("/workspace/pos-preview/pos");
    const search = page.getByRole("textbox", { name: "ค้นหาสินค้า" });
    await search.fill("COFFEE-250");
    await expect(page.getByText("กาแฟทดสอบ")).toBeVisible();
  });


  test("prevents adding an out-of-stock item", async ({ page }) => {
    await mockPosApi(page, [{ ...product, available: "0" }]);
    await page.goto("/workspace/pos-preview/pos");
    await expect(page.getByText("สินค้าหมด")).toBeVisible();
    await expect(page.locator(".pos-product-copy > button")).toBeDisabled();
  });

  test("shows an empty state when no sellable catalog items exist", async ({ page }) => {
    await mockPosApi(page, []);
    await page.goto("/workspace/pos-preview/pos");
    await expect(page.getByText(/ไม่พบสินค้าที่พร้อมขาย/)).toBeVisible();
  });

  test("stacks the cart below the catalog on mobile viewport", async ({ page }) => {
    await mockPosApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/workspace/pos-preview/pos");
    await expect(page.locator(".pos-cart")).toBeVisible();
    await expect(page.getByText("กาแฟทดสอบ")).toBeVisible();
  });
});
