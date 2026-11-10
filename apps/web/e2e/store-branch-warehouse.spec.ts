import { expect, test, type Page } from "@playwright/test";

const workspaceSlug = process.env.E2E_WORKSPACE_SLUG ?? "e2e-commerce-20261106";
const workspaceName = "E2E Commerce Workspace";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("อีเมล").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page).toHaveURL(/\/workspaces\/?(?:\?.*)?$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "เลือก Workspace" })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(workspaceName) })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(workspaceName) }).click();
  await expect(page).toHaveURL(new RegExp("/workspace/" + workspaceSlug + "$"));
}

async function openCommerceHierarchy(page: Page) {
  const storeResponsePromise = page.waitForResponse(response =>
    response.url().includes("/api/tenant/") &&
    response.url().endsWith("/stores") &&
    response.request().method() === "GET"
  );
  await page.goto(`/workspace/${workspaceSlug}/stores`);
  await expect(page.getByRole("heading", { name: "จัดการ Store" })).toBeVisible();
  const storeResponse = await storeResponsePromise;
  expect(storeResponse.ok(), "Store list API should return HTTP 2xx").toBeTruthy();
  const stores = await storeResponse.json() as Array<{ id: string; name: string }>;
  expect(stores.length, "E2E workspace should contain a Store").toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: /E2E Main Store/ })).toBeVisible();
  await page.locator(".store-card-button").first().click();

  const branchResponsePromise = page.waitForResponse(response =>
    response.url().includes("/api/tenant/") && response.url().includes(`/stores/${stores[0].id}/branches`) &&
    response.request().method() === "GET"
  );
  await page.goto(`/workspace/${workspaceSlug}/stores/${stores[0].id}/branches`);
  const branchResponse = await branchResponsePromise;
  expect(branchResponse.ok(), "Branch list API should return HTTP 2xx").toBeTruthy();
  await expect(page.getByRole("heading", { name: "จัดการสาขา" })).toBeVisible();
  const branches = await branchResponse.json() as Array<{ id: string; name: string }>;
  expect(branches.length, "E2E Store should contain a Branch").toBeGreaterThan(0);

  const warehouseResponsePromise = page.waitForResponse(response =>
    response.url().includes("/api/tenant/") && response.url().includes(`/branches/${branches[0].id}/warehouses`) &&
    response.request().method() === "GET"
  );
  await page.goto(`/workspace/${workspaceSlug}/stores/${stores[0].id}/branches/${branches[0].id}/warehouses`);
  const warehouseResponse = await warehouseResponsePromise;
  expect(warehouseResponse.ok(), "Warehouse list API should return HTTP 2xx").toBeTruthy();
  await expect(page.getByRole("heading", { name: "คลังสินค้า" })).toBeVisible();
  const warehouses = await warehouseResponse.json() as Array<{ id: string; name: string }>;
  expect(warehouses.length, "E2E Branch should contain a Warehouse").toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: /คลังหลัก/ })).toBeVisible();
  await page.locator(".store-card-button").first().click();
  await expect(page).toHaveURL(new RegExp(`/warehouses/${warehouses[0].id}$`));
  await expect(page.getByRole("heading", { name: "ข้อมูลคลังสินค้า" })).toBeVisible();
  await expect(page.getByLabel("ชื่อคลัง")).toHaveValue(warehouses[0].name);
}

test.describe("E2E Commerce authentication and hierarchy", () => {
  test("Owner can sign in and navigate Store → Branch → Warehouse @e2e-commerce", async ({ page }) => {
    const email = process.env.E2E_OWNER_EMAIL;
    const password = process.env.E2E_OWNER_PASSWORD;
    test.skip(!email || !password, "Dedicated E2E Owner credentials are not configured.");
    await signIn(page, email!, password!);
    await openCommerceHierarchy(page);
  });

  test("Manager can sign in and navigate Store → Branch → Warehouse @e2e-commerce", async ({ page }) => {
    const email = process.env.E2E_MANAGER_EMAIL;
    const password = process.env.E2E_MANAGER_PASSWORD;
    test.skip(!email || !password, "Dedicated E2E Manager credentials are not configured.");
    await signIn(page, email!, password!);
    await openCommerceHierarchy(page);
  });
});
