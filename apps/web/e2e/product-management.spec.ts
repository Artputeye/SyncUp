import { expect, test, type Browser, type Page } from "@playwright/test";

const workspaceSlug = process.env.E2E_WORKSPACE_SLUG ?? "e2e-commerce-20261106";
const workspaceName = "E2E Commerce Workspace";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("อีเมล").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page).toHaveURL(/\/workspaces\/?(?:\?.*)?$/, { timeout: 20_000 });
  const workspace = page.getByRole("button", { name: new RegExp(workspaceName) });
  await expect(workspace).toBeVisible();
  await workspace.click();
  await expect(page).toHaveURL(new RegExp("/workspace/" + workspaceSlug + "$"));
}

async function apiRequest(page: Page, workspaceId: string, path: string, method: string, body?: unknown) {
  return page.evaluate(async ({ workspaceId, path, method, body }) => {
    const response = await fetch("/api/tenant/" + workspaceId + path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { workspaceId, path, method, body });
}

test("Product Management E2E: Manager CRUD lifecycle, lookup and Cashier RBAC @e2e-products", async ({ browser }) => {
  const managerEmail = process.env.E2E_MANAGER_EMAIL;
  const managerPassword = process.env.E2E_MANAGER_PASSWORD;
  const cashierEmail = process.env.E2E_CASHIER_EMAIL;
  const cashierPassword = process.env.E2E_CASHIER_PASSWORD;
  test.skip(!managerEmail || !managerPassword || !cashierEmail || !cashierPassword,
    "Dedicated E2E Manager and Cashier credentials are required.");

  const manager = await browser.newPage();
  const cashier = await browser.newPage();
  const suffix = Date.now().toString(36).toUpperCase();
  const initialName = "E2E Product " + suffix;
  const editedName = "E2E Product Edited " + suffix;
  const initialSku = "E2E-SKU-" + suffix;
  const editedSku = "E2E-EDIT-" + suffix;
  const initialBarcode = "E2EBC" + suffix;
  const editedBarcode = "E2EEDITBC" + suffix;
  let workspaceId = "";
  let productId = "";
  let variantId = "";

  try {
    // Manager: Create -> Detail -> Edit -> exact SKU/Barcode lookup -> Archive.
    await signIn(manager, managerEmail!, managerPassword!);
    const workspaceResponse = await manager.evaluate(async () => {
      const response = await fetch("/api/workspaces", { credentials: "same-origin" });
      return { status: response.status, rows: await response.json() };
    });
    expect(workspaceResponse.status).toBe(200);
    const workspace = (workspaceResponse.rows as Array<{ id: string; slug: string }>).find(row => row.slug === workspaceSlug);
    expect(workspace, "Dedicated E2E workspace must be visible to Manager").toBeTruthy();
    workspaceId = workspace!.id;

    await manager.goto(`/workspace/${workspaceSlug}/products`);
    await expect(manager.getByRole("heading", { name: "สินค้า" })).toBeVisible();
    await manager.getByRole("button", { name: "＋ เพิ่มสินค้า" }).click();
    await expect(manager.getByRole("heading", { name: "เพิ่มสินค้า" })).toBeVisible();
    await manager.getByLabel("ชื่อสินค้า").fill(initialName);
    await manager.getByLabel("สถานะ").selectOption("ACTIVE");
    await manager.getByLabel("รายละเอียด").fill("Created by isolated Product Management E2E.");
    await manager.getByLabel("SKU").fill(initialSku);
    await manager.getByLabel("ชื่อ Variant").fill("E2E Base Variant");
    await manager.getByLabel("บาร์โค้ด").fill(initialBarcode);
    await manager.getByLabel("หน่วยฐาน").selectOption("EA");
    await manager.getByRole("button", { name: "สร้างสินค้า" }).click();

    await expect(manager).toHaveURL(/\/products\/[0-9a-f-]+$/i);
    await expect(manager.getByRole("heading", { name: initialName })).toBeVisible();
    await expect(manager.getByLabel("SKU")).toHaveValue(initialSku);
    await expect(manager.getByLabel("บาร์โค้ด")).toHaveValue(initialBarcode);

    const detail = await manager.evaluate(async () => {
      const match = location.pathname.match(/\/products\/([0-9a-f-]+)$/i);
      if (!match) throw new Error("Product detail route missing product id");
      const response = await fetch("/api/tenant/" + (await (await fetch("/api/workspaces")).json()).find((w: {slug:string}) => w.slug === location.pathname.split("/")[2]).id + "/products/" + match[1]);
      return { status: response.status, data: await response.json() };
    });
    expect(detail.status).toBe(200);
    productId = detail.data.id;
    variantId = detail.data.variants[0].id;
    expect(detail.data.name).toBe(initialName);
    expect(detail.data.variants[0].sku).toBe(initialSku);
    expect(detail.data.variants[0].barcodes.map((item: { barcode: string }) => item.barcode)).toContain(initialBarcode);

    await manager.getByLabel("ชื่อสินค้า").fill(editedName);
    await manager.getByLabel("SKU").fill(editedSku);
    await manager.getByLabel("บาร์โค้ด").fill(editedBarcode);
    await manager.getByRole("button", { name: "บันทึกการเปลี่ยนแปลง" }).click();
    await expect(manager.getByRole("status")).toContainText("บันทึกสินค้าเรียบร้อยแล้ว");
    await expect(manager.getByRole("heading", { name: editedName })).toBeVisible();

    for (const code of [editedSku, editedBarcode]) {
      const lookup = await apiRequest(manager, workspaceId, "/products/lookup?code=" + encodeURIComponent(code), "GET");
      expect(lookup.status, "Exact lookup should resolve " + code).toBe(200);
      expect(lookup.body.variant.sku).toBe(editedSku);
      expect(lookup.body.product.id).toBe(productId);
    }
    const oldCode = await apiRequest(manager, workspaceId, "/products/lookup?code=" + encodeURIComponent(initialSku), "GET");
    expect(oldCode.status, "Old SKU should no longer resolve after edit").toBe(404);

    await manager.getByLabel("เหตุผลในการเก็บถาวร").fill("E2E lifecycle complete");
    await manager.getByRole("button", { name: "เก็บสินค้าเข้าคลัง" }).click();
    await expect(manager.getByRole("status")).toContainText("เก็บสินค้าเข้าคลังเรียบร้อยแล้ว");
    await expect(manager.getByRole("heading", { name: editedName })).toBeVisible();
    await expect(manager.getByLabel("ชื่อสินค้า")).toBeDisabled();
    const archived = await apiRequest(manager, workspaceId, "/products/" + productId, "GET");
    expect(archived.status).toBe(200);
    expect(archived.body.status).toBe("ARCHIVED");
    expect(archived.body.variants[0].status).toBe("ARCHIVED");

    // Cashier: can read, but cannot create, update or archive products.
    await signIn(cashier, cashierEmail!, cashierPassword!);
    const cashierWorkspace = await cashier.evaluate(async () => {
      const rows = await (await fetch("/api/workspaces")).json();
      return rows.find((row: { slug: string }) => row.slug === location.pathname.split("/")[2]);
    });
    expect(cashierWorkspace.id).toBe(workspaceId);

    const readList = await apiRequest(cashier, workspaceId, "/products", "GET");
    expect(readList.status).toBe(200);
    const readDetail = await apiRequest(cashier, workspaceId, "/products/" + productId, "GET");
    expect(readDetail.status).toBe(200);
    const readLookup = await apiRequest(cashier, workspaceId, "/products/lookup?code=" + encodeURIComponent(editedSku), "GET");
    expect(readLookup.status).toBe(200);

    const deniedCreate = await apiRequest(cashier, workspaceId, "/products", "POST", {
      name: "Must Not Be Created " + suffix,
      status: "ACTIVE",
      variant: { sku: "DENIED-" + suffix, title: "Denied", barcode: null, uomCode: "EA" },
    });
    expect(deniedCreate.status).toBe(403);
    const deniedUpdate = await apiRequest(cashier, workspaceId, "/products/" + productId, "PATCH", {
      name: "Must Not Be Updated " + suffix,
      status: "ACTIVE",
      variant: { id: variantId, sku: "DENIED-" + suffix, title: "Denied", barcode: null },
    });
    expect(deniedUpdate.status).toBe(403);
    const deniedArchive = await apiRequest(cashier, workspaceId, "/products/" + productId + "/archive", "POST", {
      reason: "Must not archive",
    });
    expect(deniedArchive.status).toBe(403);

    await cashier.goto(`/workspace/${workspaceSlug}/products/${productId}`);
    await expect(cashier.getByRole("heading", { name: editedName })).toBeVisible();
    await expect(cashier.getByLabel("ชื่อสินค้า")).toBeDisabled();

    // Verify denied writes did not alter the archived record.
    const finalDetail = await apiRequest(manager, workspaceId, "/products/" + productId, "GET");
    expect(finalDetail.status).toBe(200);
    expect(finalDetail.body.name).toBe(editedName);
    expect(finalDetail.body.status).toBe("ARCHIVED");
    expect(finalDetail.body.variants[0].sku).toBe(editedSku);
    console.log("PASS Product Management E2E: Manager lifecycle + Cashier read-only RBAC; product archived in isolated E2E tenant.");
  } finally {
    await manager.close();
    await cashier.close();
  }
});
