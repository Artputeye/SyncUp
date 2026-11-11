const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { Client } = require("pg");
const { decryptWorkspaceCredential } = require("../dist/database/workspace-credential.crypto");

const prisma = new PrismaClient();
const base = "http://127.0.0.1:" + (process.env.API_PORT || "4000") + "/api";
const suffix = Date.now().toString();
const productId = randomUUID();
const variantId = randomUUID();
const uomId = randomUUID();
let tenant;
let openingStockId;
let warehouseId;
let apiProcess;
let viewerRoleSwap;

async function ensureApi() {
  try { const response = await fetch(base + "/health"); if (response.ok) return; } catch {}
  apiProcess = spawn(process.execPath, ["dist/main.js"], { cwd: process.cwd(), env: process.env, stdio: "ignore", windowsHide: true });
  for (let attempt = 0; attempt < 40; attempt++) {
    if (apiProcess.exitCode !== null) throw new Error("API process exited before becoming healthy");
    try { const response = await fetch(base + "/health"); if (response.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  apiProcess.kill();
  throw new Error("API did not become healthy within 20 seconds");
}

async function request(path, { method = "GET", cookie, body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { "content-type": "application/json", origin: process.env.WEB_ORIGIN } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function switchCashierMembershipToViewer(workspaceId) {
  const membership = await prisma.membership.findFirst({
    where: { workspaceId, user: { email: process.env.E2E_CASHIER_EMAIL } },
    include: { roles: true },
  });
  assert.ok(membership, "E2E Cashier membership missing");
  const cashierRole = await prisma.role.findFirst({ where: { workspaceId, key: "cashier" } });
  const viewerRole = await prisma.role.findFirst({ where: { workspaceId, key: "viewer" } });
  assert.ok(cashierRole && viewerRole, "Cashier and Viewer roles must exist in the E2E workspace");
  assert.ok(membership.roles.some(entry => entry.roleId === cashierRole.id), "Cashier role assignment missing");
  assert.ok(!membership.roles.some(entry => entry.roleId === viewerRole.id), "Cashier already has Viewer role");
  viewerRoleSwap = { membershipId: membership.id, cashierRoleId: cashierRole.id, viewerRoleId: viewerRole.id };
  await prisma.membershipRole.delete({ where: { membershipId_roleId: { membershipId: membership.id, roleId: cashierRole.id } } });
  await prisma.membershipRole.create({ data: { membershipId: membership.id, roleId: viewerRole.id } });
}

async function restoreCashierMembership() {
  if (!viewerRoleSwap) return;
  const swap = viewerRoleSwap;
  viewerRoleSwap = undefined;
  await prisma.membershipRole.deleteMany({ where: { membershipId: swap.membershipId, roleId: swap.viewerRoleId } });
  await prisma.membershipRole.create({ data: { membershipId: swap.membershipId, roleId: swap.cashierRoleId } });
}

async function cleanup() {
  if (!tenant) return;
  await tenant.query("BEGIN");
  try {
    await tenant.query("DELETE FROM audit_events WHERE (resource_type='OpeningStockSession' AND resource_id=$1) OR (resource_type='StockMovement' AND resource_id IN (SELECT id::text FROM stock_movements WHERE variant_id=$2))", [openingStockId || "", variantId]);
    if (openingStockId) {
      await tenant.query("DELETE FROM opening_stock_items WHERE session_id=$1", [openingStockId]);
      await tenant.query("DELETE FROM opening_stock_sessions WHERE id=$1", [openingStockId]);
    }
    await tenant.query("DELETE FROM stock_movements WHERE variant_id=$1", [variantId]);
    await tenant.query("DELETE FROM inventory_costs WHERE variant_id=$1", [variantId]);
    await tenant.query("DELETE FROM stock_balances WHERE variant_id=$1", [variantId]);
    await tenant.query("DELETE FROM product_variants WHERE id=$1", [variantId]);
    await tenant.query("DELETE FROM products WHERE id=$1", [productId]);
    await tenant.query("DELETE FROM unit_of_measures WHERE id=$1", [uomId]);
    await tenant.query("COMMIT");
  } catch (error) {
    await tenant.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  try {
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { slug: process.env.E2E_WORKSPACE_SLUG },
      include: { database: true },
    });
    assert.equal(workspace.id, "e65ca36b-8068-4506-a90f-59820a2ede6d", "E2E workspace identity mismatch");
    assert.equal(workspace.status, "ACTIVE");
    const database = workspace.database;
    assert.ok(database?.secretCipher, "E2E tenant credential missing");
    assert.ok(["127.0.0.1", "localhost", "::1"].includes(database.host), "Safety stop: E2E tenant DB is not local");
    tenant = new Client({
      host: database.host, port: database.port, database: database.databaseName,
      user: database.username, password: decryptWorkspaceCredential(database.secretCipher),
    });
    await tenant.connect();
    const warehouse = await tenant.query("SELECT id::text,branch_id::text FROM warehouses WHERE status='ACTIVE' ORDER BY created_at LIMIT 1");
    assert.equal(warehouse.rowCount, 1, "No active E2E warehouse");
    warehouseId = warehouse.rows[0].id;

    const uomCode = "O" + suffix.slice(-9);
    await tenant.query(
      "INSERT INTO unit_of_measures (id,code,normalized_code,name,symbol,dimension,updated_at) VALUES ($1,$2,$3,$4,$5,'COUNT',NOW())",
      [uomId, uomCode, uomCode.toLowerCase(), "Opening E2E Each " + suffix, "o" + suffix.slice(-4)],
    );
    await tenant.query("INSERT INTO products (id,name,normalized_name,updated_at) VALUES ($1,$2,$3,NOW())",
      [productId, "Opening E2E Product " + suffix, ("opening e2e product " + suffix).toLowerCase()]);
    await tenant.query(
      "INSERT INTO product_variants (id,product_id,base_uom_id,sku,normalized_sku,title,status,updated_at) VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',NOW())",
      [variantId, productId, uomId, "OPEN-" + suffix, ("open-" + suffix).toLowerCase(), "Opening E2E Variant " + suffix],
    );

    const login = await fetch(base + "/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: process.env.E2E_INVENTORY_EMAIL, password: process.env.E2E_INVENTORY_PASSWORD }),
    });
    assert.equal(login.status, 201, "E2E Inventory Staff login failed: " + login.status);
    const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
    assert.ok(cookie, "Inventory Staff session cookie missing");

    const cashierLogin = await fetch(base + "/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: process.env.E2E_CASHIER_EMAIL, password: process.env.E2E_CASHIER_PASSWORD }),
    });
    assert.equal(cashierLogin.status, 201, "E2E Cashier login failed: " + cashierLogin.status);
    const cashierCookie = (cashierLogin.headers.get("set-cookie") || "").split(";")[0];
    assert.ok(cashierCookie, "Cashier session cookie missing");
    const cashierDenied = await request("/tenant/" + workspace.id + "/inventory/opening-stocks", { method: "POST", cookie: cashierCookie, body: { warehouseId, idempotencyKey: "cashier-opening-" + suffix, items: [{ variantId, quantity: "1", unitCost: "1" }] } });
    assert.equal(cashierDenied.status, 403, "Cashier must not create Opening Stock");

    const payload = {
      warehouseId, reference: "OPEN-E2E-" + suffix, notes: "Opening stock API E2E",
      idempotencyKey: "opening-e2e-" + suffix,
      items: [{ variantId, quantity: "11.500", unitCost: "7.123456" }],
    };
    const created = await request("/tenant/" + workspace.id + "/inventory/opening-stocks", { method: "POST", cookie, body: payload });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    openingStockId = created.data.openingStockId;
    assert.ok(openingStockId);

    const draftPath = "/tenant/" + workspace.id + "/inventory/opening-stocks/" + openingStockId;
    const deniedDraftBody = { reference: payload.reference, notes: "Unauthorized edit attempt", items: [{ variantId, quantity: "99.000", unitCost: "1.000000" }] };
    for (const [label, result] of [
      ["Cashier create", cashierDenied],
      ["Cashier edit", await request(draftPath, { method: "PATCH", cookie: cashierCookie, body: deniedDraftBody })],
      ["Cashier post", await request(draftPath + "/post", { method: "POST", cookie: cashierCookie, body: {} })],
    ]) assert.equal(result.status, 403, label + " must be forbidden");

    await switchCashierMembershipToViewer(workspace.id);
    const viewerList = await request("/tenant/" + workspace.id + "/inventory/opening-stocks", { cookie: cashierCookie });
    assert.equal(viewerList.status, 403, "Viewer must not access Opening Stock list without inventory.view");
    const viewerDetail = await request(draftPath, { cookie: cashierCookie });
    assert.equal(viewerDetail.status, 403, "Viewer must not access Opening Stock detail without inventory.view");
    const viewerCreate = await request("/tenant/" + workspace.id + "/inventory/opening-stocks", {
      method: "POST", cookie: cashierCookie,
      body: { ...payload, idempotencyKey: "viewer-opening-" + suffix },
    });
    const viewerEdit = await request(draftPath, { method: "PATCH", cookie: cashierCookie, body: deniedDraftBody });
    const viewerPost = await request(draftPath + "/post", { method: "POST", cookie: cashierCookie, body: {} });
    for (const [label, result] of [["Viewer create", viewerCreate], ["Viewer edit", viewerEdit], ["Viewer post", viewerPost]]) {
      assert.equal(result.status, 403, label + " must be forbidden");
    }
    await restoreCashierMembership();
    const replay = await request("/tenant/" + workspace.id + "/inventory/opening-stocks", { method: "POST", cookie, body: payload });
    assert.equal(replay.status, 201);
    assert.equal(replay.data.idempotentReplay, true);
    const mismatch = await request("/tenant/" + workspace.id + "/inventory/opening-stocks", {
      method: "POST", cookie, body: { ...payload, items: [{ variantId, quantity: "12.000", unitCost: "7.123456" }] },
    });
    assert.equal(mismatch.status, 409, "Changed payload must conflict on idempotency key");

    const detail = await request("/tenant/" + workspace.id + "/inventory/opening-stocks/" + openingStockId, { cookie });
    assert.equal(detail.status, 200);
    assert.equal(detail.data.items.length, 1);
    assert.equal(detail.data.items[0].quantity, "11.500");

    const updated = await request("/tenant/" + workspace.id + "/inventory/opening-stocks/" + openingStockId, {
      method: "PATCH", cookie, body: { reference: payload.reference, notes: "Edited draft", items: [{ variantId, quantity: "12.000", unitCost: "7.123456" }] },
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.data));
    assert.equal(updated.data.status, "DRAFT");
    const editedDetail = await request("/tenant/" + workspace.id + "/inventory/opening-stocks/" + openingStockId, { cookie });
    assert.equal(editedDetail.data.items[0].quantity, "12.000");
    assert.equal(editedDetail.data.notes, "Edited draft");
    const replayAfterEdit = await request("/tenant/" + workspace.id + "/inventory/opening-stocks", { method: "POST", cookie, body: payload });
    assert.equal(replayAfterEdit.status, 201);
    assert.equal(replayAfterEdit.data.idempotentReplay, true, "Create replay must remain stable after draft edits");
    const postResults = await Promise.all([1, 2].map(() => request("/tenant/" + workspace.id + "/inventory/opening-stocks/" + openingStockId + "/post", { method: "POST", cookie, body: {} })));
    assert.ok(postResults.every(result => result.status === 201), JSON.stringify(postResults.map(result => result.data)));
    assert.ok(postResults.some(result => result.data.idempotentReplay === false));
    assert.ok(postResults.some(result => result.data.idempotentReplay === true));
    assert.equal(postResults.reduce((sum, result) => sum + result.data.movementCount, 0), 1, "Concurrent posting must create exactly one movement");
    const postReplay = await request("/tenant/" + workspace.id + "/inventory/opening-stocks/" + openingStockId + "/post", { method: "POST", cookie, body: {} });
    assert.equal(postReplay.status, 201);
    assert.equal(postReplay.data.idempotentReplay, true);
    const editPosted = await request("/tenant/" + workspace.id + "/inventory/opening-stocks/" + openingStockId, { method: "PATCH", cookie, body: { reference: payload.reference, notes: "Late edit", items: [{ variantId, quantity: "13.000", unitCost: "7.123456" }] } });
    assert.equal(editPosted.status, 409, "Posted Opening Stock must not be editable");

    const state = await tenant.query(
      "SELECT b.on_hand::text,b.reserved::text,b.available::text,c.quantity::text,c.average_unit_cost::text,c.inventory_value::text FROM stock_balances b JOIN inventory_costs c ON c.warehouse_id=b.warehouse_id AND c.variant_id=b.variant_id WHERE b.warehouse_id=$1 AND b.variant_id=$2",
      [warehouseId, variantId],
    );
    assert.equal(state.rowCount, 1);
    assert.equal(state.rows[0].on_hand, "12.000");
    assert.equal(state.rows[0].available, "12.000");
    assert.equal(state.rows[0].quantity, "12.000");
    assert.equal(state.rows[0].average_unit_cost, "7.123456");
    assert.equal(state.rows[0].inventory_value, "85.481472");
    const movement = await tenant.query("SELECT movement_type::text,reference_type::text,reference_id::text,quantity_delta::text,unit_cost::text,total_cost::text FROM stock_movements WHERE reference_id=$1", [openingStockId]);
    assert.equal(movement.rowCount, 1);
    assert.equal(movement.rows[0].movement_type, "OPENING");
    assert.equal(movement.rows[0].reference_type, "OPENING_STOCK");
    assert.equal(movement.rows[0].quantity_delta, "12.000");
    assert.equal(movement.rows[0].total_cost, "85.481472");
    const history = await request("/tenant/" + workspace.id + "/inventory/movements?warehouseId=" + warehouseId + "&variantId=" + variantId + "&movementType=OPENING", { cookie });
    assert.equal(history.status, 200, JSON.stringify(history.data));
    assert.equal(history.data.items.length, 1);
    assert.equal(history.data.items[0].movementType, "OPENING");

    const duplicateWarehouse = await request("/tenant/" + workspace.id + "/inventory/opening-stocks", {
      method: "POST", cookie, body: { ...payload, idempotencyKey: "opening-second-" + suffix },
    });
    assert.equal(duplicateWarehouse.status, 409, "A warehouse must not accept a second posted opening stock");
    const list = await request("/tenant/" + workspace.id + "/inventory/opening-stocks?page=1&pageSize=10", { cookie });
    assert.equal(list.status, 200);
    assert.ok(list.data.items.some(item => item.id === openingStockId && item.status === "POSTED"));
    console.log("OPENING_STOCK_HTTP_E2E=PASS");
  } finally {
    try { await restoreCashierMembership(); await cleanup(); } finally { await tenant?.end(); await prisma.$disconnect(); if (apiProcess && apiProcess.exitCode === null) apiProcess.kill(); }
  }
}

main().catch(error => {
  console.error("OPENING_STOCK_HTTP_E2E=FAIL", error.message);
  process.exitCode = 1;
});
