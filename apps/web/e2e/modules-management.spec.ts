import { expect, test, type Page } from "@playwright/test";

const workspaceSlug = process.env.E2E_WORKSPACE_SLUG ?? "e2e-commerce-20261106";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("อีเมล").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page).toHaveURL(/\/workspaces\/?(?:\?.*)?$/, { timeout: 20_000 });
  await expect(page.getByRole("button", { name: /E2E Commerce Workspace/ })).toBeVisible();
  await page.getByRole("button", { name: /E2E Commerce Workspace/ }).click();
  await expect(page).toHaveURL(new RegExp("/workspace/" + workspaceSlug + "$"));
}

test("Manager can inspect and operate the Workspace Module screen @e2e-modules", async ({ page }) => {
  const email = process.env.E2E_MANAGER_EMAIL;
  const password = process.env.E2E_MANAGER_PASSWORD;
  test.skip(!email || !password, "Dedicated E2E Manager credentials are not configured.");
  await signIn(page, email!, password!);

  const modulesResponse = page.waitForResponse((response) =>
    response.url().includes("/api/workspaces/") &&
    response.url().endsWith("/modules") &&
    response.request().method() === "GET",
  );
  await page.goto(`/workspace/${workspaceSlug}/modules`);
  await expect(page.getByRole("heading", { name: "จัดการ Modules" })).toBeVisible();
  expect((await modulesResponse).ok()).toBeTruthy();
  const commerce = page.locator(".module-card").filter({ hasText: "commerce" });
  await expect(commerce).toContainText("Commerce");
  await expect(commerce).toContainText("ผ่าน Compatibility Check");
  await expect(commerce).toContainText("ปิดใช้งาน");

  page.on("dialog", (dialog) => dialog.accept());
  await commerce.getByRole("button", { name: "เปิดใช้งาน" }).click();
  await expect(page.getByRole("status").filter({ hasText: "เปิดใช้งานโมดูลเรียบร้อยแล้ว" })).toBeVisible();
  await expect(commerce).toContainText("เปิดใช้งาน");

  await commerce.getByRole("button", { name: "ปิดใช้งาน" }).click();
  await expect(page.getByRole("status").filter({ hasText: "ปิดใช้งานโมดูลเรียบร้อยแล้ว" })).toBeVisible();
  await expect(commerce).toContainText("ปิดใช้งาน");
  await expect(page.getByRole("heading", { name: "ประวัติ Module Lifecycle" })).toBeVisible();
});
