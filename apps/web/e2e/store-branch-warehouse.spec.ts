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
  await expect(page).toHaveURL(new RegExp("/workspace/" + workspaceSlug + "/pos$"));
}

async function getJson<T>(page: Page, path: string): Promise<T> {
  return await page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error(`GET ${url} failed with HTTP ${response.status}`);
    return response.json();
  }, path) as T;
}

async function openCommerceHierarchy(page: Page) {
  const workspaces = await getJson<Array<{ id: string; slug: string }>>(page, "/api/workspaces");
  const workspace = workspaces.find((row) => row.slug === workspaceSlug);
  expect(workspace, "E2E workspace should be available to the signed-in user").toBeTruthy();

  await page.goto(`/workspace/${workspaceSlug}/stores`);
  await expect(page.getByRole("heading", { name: "จัดการ Store" })).toBeVisible();
  const stores = await getJson<Array<{ id: string; name: string }>>(page, `/api/tenant/${workspace!.id}/stores`);
  expect(stores.length, "E2E workspace should contain a Store").toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: /E2E Main Store/ })).toBeVisible();
  await page.locator(".store-card-button").first().click();

  await page.goto(`/workspace/${workspaceSlug}/stores/${stores[0].id}/branches`);
  await expect(page.getByRole("heading", { name: "จัดการสาขา" })).toBeVisible();
  const branches = await getJson<Array<{ id: string; name: string }>>(page, `/api/tenant/${workspace!.id}/stores/${stores[0].id}/branches`);
  expect(branches.length, "E2E Store should contain a Branch").toBeGreaterThan(0);

  await page.goto(`/workspace/${workspaceSlug}/stores/${stores[0].id}/branches/${branches[0].id}/warehouses`);
  await expect(page.getByRole("heading", { name: "คลังสินค้า" })).toBeVisible();
  const warehouses = await getJson<Array<{ id: string; name: string }>>(page, `/api/tenant/${workspace!.id}/stores/${stores[0].id}/branches/${branches[0].id}/warehouses`);
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
