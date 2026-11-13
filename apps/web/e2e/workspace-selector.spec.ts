import { test, expect } from "@playwright/test";

const workspaces = [
  { id: "11111111-1111-4111-8111-111111111111", slug: "pos-demo", name: "POS Demo", type: "POS", status: "ACTIVE", isOwner: true, provisioningProfileId: "pos-standard", provisioningProfileVersion: "1.0.0" },
  { id: "22222222-2222-4222-8222-222222222222", slug: "online-demo", name: "Online Demo", type: "ONLINE", status: "ACTIVE", isOwner: false, provisioningProfileId: "online-standard", provisioningProfileVersion: "1.0.0" },
  { id: "33333333-3333-4333-8333-333333333333", slug: "legacy-demo", name: "Legacy Demo", type: null, status: "ACTIVE", isOwner: true, provisioningProfileId: null, provisioningProfileVersion: null },
  { id: "44444444-4444-4444-8444-444444444444", slug: "pending-demo", name: "Pending Demo", type: "POS", status: "PROVISIONING", isOwner: true, provisioningProfileId: "pos-standard", provisioningProfileVersion: "1.0.0" }
];

test.describe("Workspace selector and type-aware landing", () => {
  test.beforeEach(async ({ context, page }) => {
    await context.addCookies([{
      name: process.env.AUTH_COOKIE_NAME ?? "syncup_session",
      value: "workspace-selector-preview",
      url: process.env.WEB_ORIGIN ?? "http://localhost:3000",
      httpOnly: true,
      sameSite: "Lax"
    }]);
    await page.route("**/api/auth/me", (route) => route.fulfill({ json: { user: { email: "selector@example.test" } } }));
    await page.route("**/api/workspaces", (route) => route.fulfill({ json: workspaces }));
    await page.route("**/api/workspaces/*/navigation", (route) => route.fulfill({ json: { workspace: { id: "22222222-2222-4222-8222-222222222222", slug: "online-demo", type: "ONLINE" }, items: [{ id: "workspace-home", label: "ภาพรวม", href: "/workspace/online-demo/online", icon: "home" }] } }));
  });

  test("shows workspace type, persisted profile and legacy unclassified state", async ({ page }) => {
    await page.goto("/workspaces");
    await expect(page.getByRole("heading", { name: "เลือก Workspace" })).toBeVisible();
    await expect(page.getByRole("button", { name: /POS Demo/ })).toContainText("SyncUp POS");
    await expect(page.getByRole("button", { name: /POS Demo/ })).toContainText("pos-standard");
    await expect(page.getByRole("button", { name: /Online Demo/ })).toContainText("online-standard");
    const legacy = page.getByRole("button", { name: /Legacy Demo/ });
    await expect(legacy).toContainText("ยังไม่จำแนกประเภท");
    await expect(legacy).toContainText("ยังไม่มี Provisioning Profile");
    await expect(legacy).toBeDisabled();
    await expect(page.getByRole("button", { name: /Pending Demo/ })).toBeDisabled();
  });

  test("opens the POS route from the POS workspace card", async ({ page }) => {
    await page.goto("/workspaces");
    await page.getByRole("button", { name: /POS Demo/ }).click();
    await expect(page).toHaveURL(/\/workspace\/pos-demo\/pos$/);
  });

  test("ONLINE navigation contains only type-compatible items", async ({ page }) => {
    await page.goto("/workspace/online-demo/online");
    await expect(page.getByRole("link", { name: "ภาพรวม" })).toBeVisible();
    await expect(page.getByRole("link", { name: /ขายหน้าร้าน|คำสั่งขาย|สินค้า|คลังสินค้า|Store/ })).toHaveCount(0);
  });

  test("opens a separate ONLINE landing and can switch workspace", async ({ page }) => {
    await page.goto("/workspaces");
    await page.getByRole("button", { name: /Online Demo/ }).click();
    await expect(page).toHaveURL(/\/workspace\/online-demo\/online$/);
    await expect(page.getByRole("heading", { name: "Online Demo" })).toBeVisible();
    await expect(page.getByText("Workspace พร้อมสำหรับ Online Modules")).toBeVisible();
    await expect(page.getByRole("button", { name: "เปลี่ยน Workspace" })).toBeVisible();
    await expect(page.getByRole("button", { name: "ออกจากระบบ" })).toBeVisible();
    await expect(page.getByRole("button", { name: "ขายหน้าร้าน" })).toHaveCount(0);
    await page.getByRole("button", { name: "เปลี่ยน Workspace" }).click();
    await expect(page).toHaveURL(/\/workspaces$/);
  });
});
