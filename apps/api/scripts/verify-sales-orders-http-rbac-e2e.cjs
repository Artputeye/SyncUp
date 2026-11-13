"use strict";
require("reflect-metadata");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
const { Client } = require("pg");
const { hash } = require("bcryptjs");
const { WorkspacesService } = require("../dist/core/workspaces/workspaces.service");
const { WorkspaceProvisioningService } = require("../dist/database/workspace-provisioning.service");
const { TenantMigrationRunner } = require("../dist/database/tenant-migration.runner");
const { StoreLifecycleService } = require("../dist/core/tenant/store-lifecycle.service");
const { decryptWorkspaceCredential } = require("../dist/database/workspace-credential.crypto");

const root = path.resolve(__dirname, "../../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const controlUrl = new URL(process.env.CONTROL_DATABASE_URL || "");
const adminUrl = new URL(process.env.WORKSPACE_DATABASE_ADMIN_URL || "");
for (const [url, label] of [[controlUrl, "CONTROL_DATABASE_URL"], [adminUrl, "WORKSPACE_DATABASE_ADMIN_URL"]]) {
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(url.hostname), label + " must point to localhost");
}
assert.equal(controlUrl.pathname, "/syncup_control", "Control DB safety guard failed");
assert.ok(process.env.WEB_ORIGIN, "WEB_ORIGIN is required for write requests");
const apiPort = Number(process.env.SALES_HTTP_E2E_PORT || 43117);
const apiBase = "http://127.0.0.1:" + apiPort + "/api";
const cookieName = process.env.AUTH_COOKIE_NAME || "syncup_session";
const suffix = Date.now().toString(36);
const slug = "sales-http-" + suffix;
const password = randomUUID() + randomUUID();
const credentials = {
  owner: { email: "owner-" + suffix + "@sales-http.local", password },
  manager: { email: "manager-" + suffix + "@sales-http.local", password },
  cashier: { email: "cashier-" + suffix + "@sales-http.local", password },
  viewer: { email: "viewer-" + suffix + "@sales-http.local", password },
};
const ids = { users: [], workspaceId: null, databaseName: null, runtimeRole: null };
let control, admin, tenant, apiProcess, tenantPrisma, workspace;
let apiStarted = false;

function tenantUrl(database) {
  const url = new URL(adminUrl);
  url.pathname = "/" + database;
  return url.toString();
}
async function connect(url) {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 10000 });
  await client.connect();
  return client;
}
async function waitForApi() {
  for (let i = 0; i < 80; i++) {
    if (apiProcess.exitCode !== null) throw new Error("Isolated API process exited before health check");
    try {
      const response = await fetch(apiBase + "/health");
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("Isolated API health check timed out");
}
async function stopApi() {
  if (!apiProcess || apiProcess.exitCode !== null) return;
  apiProcess.kill("SIGTERM");
  await Promise.race([
    new Promise(resolve => apiProcess.once("exit", resolve)),
    new Promise(resolve => setTimeout(resolve, 10000)),
  ]);
  if (apiProcess.exitCode === null) apiProcess.kill("SIGKILL");
  apiProcess = null;
}
async function login(user) {
  const response = await fetch(apiBase + "/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  const body = await response.text();
  assert.equal(response.status, 201, "Login failed for test role: " + body);
  const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get("set-cookie") || ""];
  const cookie = cookies.map(value => value.split(";")[0]).find(value => value.startsWith(cookieName + "="));
  assert.ok(cookie, "Session cookie missing");
  return cookie;
}
async function request(cookie, method, route, body, origin = process.env.WEB_ORIGIN) {
  const response = await fetch(apiBase + route, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(origin ? { origin } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  return { status: response.status, data };
}
function ok(result, expected, label) {
  assert.equal(result.status, expected, label + ": expected HTTP " + expected + ", received " + result.status + " " + JSON.stringify(result.data));
  return result.data;
}

async function main() {
  control = new PrismaClient();
  const permissionBefore = await control.permission.findMany({ select: { key: true }, orderBy: { key: "asc" } });
  try {
    const users = {};
    for (const [role, item] of Object.entries(credentials)) {
      const user = await control.user.create({
        data: { email: item.email, passwordHash: await hash(item.password, 10), displayName: "Sales HTTP E2E " + role, status: "ACTIVE" },
      });
      users[role] = user;
      ids.users.push(user.id);
    }

    const provisioning = new WorkspaceProvisioningService(control, new TenantMigrationRunner());
    const workspaces = new WorkspacesService(control, provisioning);
    await workspaces.create({ slug, name: "Disposable Sales HTTP E2E " + suffix, type: "POS", ownerUserId: users.owner.id });
    const provisionedWorkspace = await control.workspace.findUniqueOrThrow({ where: { slug }, include: { database: true } });
    ids.workspaceId = provisionedWorkspace.id;
    const database = provisionedWorkspace.database;
    assert.ok(database, "Provisioned Tenant database record is missing");
    ids.databaseName = database.databaseName;
    ids.runtimeRole = database.username;
    assert.match(ids.databaseName, /^syncup_ws_[a-f0-9]{12}$/);
    assert.match(ids.runtimeRole, /^syncup_rt_[a-f0-9]{12}$/);

    for (const role of ["manager", "cashier", "viewer"]) {
      const roleRow = await control.role.findFirst({ where: { workspaceId: ids.workspaceId, key: role } });
      assert.ok(roleRow, "Default role missing: " + role);
      await control.membership.create({
        data: { userId: users[role].id, workspaceId: ids.workspaceId, roles: { create: { roleId: roleRow.id } } },
      });
    }

    admin = await connect(tenantUrl(ids.databaseName));
    const migrations = [
      "docs/architecture/tenant-commerce-clean-install.candidate.sql",
      "docs/architecture/tenant-commerce-custom-constraints.candidate.sql",
      "docs/architecture/tenant-canonicalization-constraints.candidate.sql",
      "docs/architecture/tenant-branch-warehouse-lifecycle.candidate.sql",
      "apps/api/prisma/tenant/migrations/20261111000100_tenant_sales_orders.sql",
      "apps/api/prisma/tenant/migrations/20261111000200_tenant_sales_returns.sql",
      "apps/api/prisma/tenant/migrations/20261111000300_tenant_sales_payments_refunds.sql",
    ];
    for (const migration of migrations) await admin.query(read(migration));
    const roleName = '"' + ids.runtimeRole.replace(/"/g, '""') + '"';
    await admin.query("GRANT USAGE ON SCHEMA public TO " + roleName);
    await admin.query("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO " + roleName);
    await admin.query("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO " + roleName);
    await admin.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO " + roleName);
    await admin.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO " + roleName);

    const runtimeUrl = new URL(tenantUrl(ids.databaseName));
    runtimeUrl.username = ids.runtimeRole;
    runtimeUrl.password = decryptWorkspaceCredential(database.secretCipher);
    tenantPrisma = new PrismaClient({ datasources: { db: { url: runtimeUrl.toString() } } });
    await tenantPrisma.$connect();
    const lifecycle = new StoreLifecycleService({ forMembership: async () => tenantPrisma });
    const store = await lifecycle.createStore(users.owner.id, ids.workspaceId, {
      name: "Sales HTTP E2E Store", slug: "sales-http-e2e-" + suffix, branchCode: "HQ", warehouseCode: "MAIN",
    });

    const uomId = randomUUID(), categoryId = randomUUID(), taxProfileId = randomUUID();
    await admin.query(
      "INSERT INTO unit_of_measures (id,code,normalized_code,name,symbol,dimension,updated_at) VALUES ($1,'EA','ea','Each','ea','COUNT',NOW())",
      [uomId],
    );
    await admin.query(
      "INSERT INTO tax_categories (id,code,name,status,created_at,updated_at) VALUES ($1,'STANDARD','Standard VAT','ACTIVE',NOW(),NOW())",
      [categoryId],
    );
    await admin.query(
      "INSERT INTO tax_profiles (id,store_id,name,tax_mode,price_tax_mode,rounding_level,rounding_method,currency_minor_units,valid_from,created_at,updated_at) VALUES ($1,$2,'Default VAT','VAT','EXCLUSIVE','DOCUMENT','HALF_UP',2,NOW()-INTERVAL '1 day',NOW(),NOW())",
      [taxProfileId, store.id],
    );
    await admin.query(
      "INSERT INTO tax_rates (id,tax_profile_id,tax_category_id,rate,valid_from,created_at) VALUES ($1,$2,$3,0.07,NOW()-INTERVAL '1 day',NOW())",
      [randomUUID(), taxProfileId, categoryId],
    );

    const productId = randomUUID(), variantId = randomUUID(), variantUomId = randomUUID();
    const storeProductId = randomUUID(), storeProductVariantId = randomUUID();
    await admin.query("INSERT INTO products (id,name,status,normalized_name,updated_at) VALUES ($1,'HTTP E2E Product','ACTIVE','http e2e product',NOW())", [productId]);
    await admin.query(
      "INSERT INTO store_products (id,store_id,product_id,publish_status,sort_order,featured,created_at,updated_at) VALUES ($1,$2,$3,'PUBLISHED',0,FALSE,NOW(),NOW())",
      [storeProductId, store.id, productId],
    );
    await admin.query(
      "INSERT INTO product_variants (id,product_id,base_uom_id,tax_category_id,sku,normalized_sku,title,status,updated_at) VALUES ($1,$2,$3,$4,'HTTP-E2E-001','http-e2e-001','HTTP E2E Variant','ACTIVE',NOW())",
      [variantId, productId, uomId, categoryId],
    );
    await admin.query(
      "INSERT INTO variant_uoms (id,variant_id,uom_id,usage,conversion_to_base,status,updated_at) VALUES ($1,$2,$3,'BASE',1,'ACTIVE',NOW())",
      [variantUomId, variantId, uomId],
    );
    await admin.query(
      "INSERT INTO store_product_variants (id,store_id,product_id,store_product_id,variant_id,publish_status,sort_order,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,'PUBLISHED',0,NOW(),NOW())",
      [storeProductVariantId, store.id, productId, storeProductId, variantId],
    );
    await admin.query(
      "INSERT INTO product_prices (id,store_product_variant_id,variant_id,variant_uom_id,amount,currency,valid_from,created_by) VALUES ($1,$2,$3,$4,100.00,'THB',NOW()-INTERVAL '1 day',$5)",
      [randomUUID(), storeProductVariantId, variantId, variantUomId, users.owner.id],
    );
    await admin.query(
      "INSERT INTO stock_balances (warehouse_id,variant_id,on_hand,reserved,available,updated_at) VALUES ($1,$2,50,0,50,NOW())",
      [store.defaultWarehouseId, variantId],
    );
    await admin.query(
      "INSERT INTO inventory_costs (warehouse_id,variant_id,quantity,average_unit_cost,inventory_value,updated_at) VALUES ($1,$2,50,30,1500,NOW())",
      [store.defaultWarehouseId, variantId],
    );

    apiProcess = spawn(process.execPath, ["dist/main.js"], {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, API_PORT: String(apiPort) },
      stdio: "ignore",
      windowsHide: true,
    });
    apiStarted = true;
    await waitForApi();
    const prefix = "/tenant/" + ids.workspaceId + "/orders";
    const ownerCookie = await login(credentials.owner);
    const managerCookie = await login(credentials.manager);
    const cashierCookie = await login(credentials.cashier);
    const viewerCookie = await login(credentials.viewer);

    ok(await request(null, "GET", prefix), 401, "Unauthenticated Orders list");
    ok(await request(managerCookie, "POST", prefix, { storeId: store.id, branchId: store.defaultBranchId, warehouseId: store.defaultWarehouseId, items: [], idempotencyKey: randomUUID() }, "https://invalid.example"), 401, "Write with invalid Origin");

    const base = { storeId: store.id, branchId: store.defaultBranchId, warehouseId: store.defaultWarehouseId };
    const orderInput = { ...base, items: [{ variantId, variantUomId, quantity: "2" }], idempotencyKey: randomUUID() };
    const created = ok(await request(managerCookie, "POST", prefix, orderInput), 201, "Manager creates Order");
    assert.equal(created.status, "RESERVED");
    assert.equal(created.total_amount, "214.0000");
    assert.equal(created.items[0].reservation_status, "ACTIVE");
    const replay = ok(await request(managerCookie, "POST", prefix, orderInput), 201, "Manager replays Order create");
    assert.equal(replay.id, created.id);
    assert.equal(replay.idempotentReplay, true);
    const conflict = await request(managerCookie, "POST", prefix, { ...orderInput, items: [{ variantId, variantUomId, quantity: "3" }] });
    assert.equal(conflict.status, 409, "Changed idempotency payload must conflict");

    const listed = ok(await request(managerCookie, "GET", prefix + "?status=RESERVED&page=1&pageSize=10"), 200, "Manager lists Orders");
    assert.ok(listed.items.some(item => item.id === created.id));
    ok(await request(managerCookie, "GET", prefix + "/" + created.id), 200, "Manager views Order detail");

    const cancelledDraft = ok(await request(managerCookie, "POST", prefix, {
      ...base, items: [{ variantId, variantUomId, quantity: "1" }], idempotencyKey: randomUUID(),
    }), 201, "Manager creates cancellable Order");
    ok(await request(managerCookie, "POST", prefix + "/" + cancelledDraft.id + "/cancel", { reason: "HTTP E2E cancel" }), 201, "Manager cancels RESERVED Order");
    const cancelledDetail = ok(await request(managerCookie, "GET", prefix + "/" + cancelledDraft.id), 200, "Manager views cancelled Order");
    assert.equal(cancelledDetail.status, "CANCELLED");

    const posted = ok(await request(managerCookie, "POST", prefix + "/" + created.id + "/post", { idempotencyKey: randomUUID() }), 201, "Manager posts Order");
    assert.equal(posted.status, "POSTED");
    assert.equal(posted.items[0].unit_cost_snapshot, "30.000000");
    const payment = ok(await request(managerCookie, "POST", prefix + "/" + created.id + "/payments", {
      method: "CASH", amount: "214", idempotencyKey: randomUUID(),
    }), 201, "Manager records Payment");
    assert.equal(payment.amount, "214.0000");
    const overpayment = await request(managerCookie, "POST", prefix + "/" + created.id + "/payments", {
      method: "CARD", amount: "0.01", idempotencyKey: randomUUID(),
    });
    assert.equal(overpayment.status, 409, "Overpayment must be rejected");
    ok(await request(managerCookie, "GET", prefix + "/" + created.id + "/payments"), 200, "Manager lists Payments");

    const returned = ok(await request(managerCookie, "POST", prefix + "/" + created.id + "/returns", {
      items: [{ orderItemId: created.items[0].id, quantity: "1" }], reason: "HTTP E2E return", idempotencyKey: randomUUID(),
    }), 201, "Manager creates partial Return");
    assert.equal(returned.status, "POSTED");
    ok(await request(managerCookie, "GET", prefix + "/" + created.id + "/returns"), 200, "Manager lists Returns");
    const refund = ok(await request(managerCookie, "POST", prefix + "/" + created.id + "/returns/" + returned.id + "/refunds", {
      paymentId: payment.id, amount: "107", reason: "HTTP E2E refund", idempotencyKey: randomUUID(),
    }), 201, "Manager creates Refund");
    assert.equal(refund.amount, "107.0000");
    ok(await request(managerCookie, "GET", prefix + "/" + created.id + "/returns/" + returned.id + "/refunds"), 200, "Manager lists Refunds");

    const cashierList = ok(await request(cashierCookie, "GET", prefix), 200, "Cashier views Orders");
    assert.ok(cashierList.items.some(item => item.id === created.id));
    ok(await request(cashierCookie, "GET", prefix + "/" + created.id), 200, "Cashier views Order detail");
    const cashierOrder = ok(await request(cashierCookie, "POST", prefix, {
      ...base, items: [{ variantId, variantUomId, quantity: "1" }], idempotencyKey: randomUUID(),
    }), 201, "Cashier creates Order");
    ok(await request(cashierCookie, "POST", prefix + "/" + cashierOrder.id + "/post", { idempotencyKey: randomUUID() }), 201, "Cashier posts Order");
    ok(await request(cashierCookie, "POST", prefix + "/" + cashierOrder.id + "/payments", {
      method: "CASH", amount: "107", idempotencyKey: randomUUID(),
    }), 201, "Cashier records Payment");
    const cashierCancel = await request(cashierCookie, "POST", prefix + "/" + cancelledDraft.id + "/cancel", { reason: "forbidden" });
    assert.equal(cashierCancel.status, 403, "Cashier must not cancel Orders");
    const cashierReturn = await request(cashierCookie, "POST", prefix + "/" + created.id + "/returns", {
      items: [{ orderItemId: created.items[0].id, quantity: "1" }], idempotencyKey: randomUUID(),
    });
    assert.equal(cashierReturn.status, 403, "Cashier must not create Returns");
    const cashierRefund = await request(cashierCookie, "POST", prefix + "/" + created.id + "/returns/" + returned.id + "/refunds", {
      paymentId: payment.id, amount: "1", idempotencyKey: randomUUID(),
    });
    assert.equal(cashierRefund.status, 403, "Cashier must not create Refunds");

    ok(await request(ownerCookie, "GET", prefix), 200, "Workspace Owner views Orders");
    assert.equal((await request(viewerCookie, "GET", prefix)).status, 403, "Viewer without commerce.orders.view must be forbidden");
    assert.equal((await request(viewerCookie, "POST", prefix, orderInput)).status, 403, "Viewer without commerce.sales.create must be forbidden");

    const finalState = await admin.query(
      "SELECT (SELECT COUNT(*)::int FROM sales_orders) AS orders,(SELECT COUNT(*)::int FROM sales_order_items) AS items," +
      "(SELECT COUNT(*)::int FROM sales_payments) AS payments,(SELECT COUNT(*)::int FROM sales_returns) AS returns," +
      "(SELECT COUNT(*)::int FROM sales_refunds) AS refunds,(SELECT COUNT(*)::int FROM stock_movements WHERE reference_type='ORDER' AND movement_type='SALE') AS sale_movements",
    );
    assert.ok(finalState.rows[0].orders >= 3);
    assert.ok(finalState.rows[0].payments >= 2);
    assert.ok(finalState.rows[0].returns >= 1);
    assert.ok(finalState.rows[0].refunds >= 1);
    assert.ok(finalState.rows[0].sale_movements >= 2);
    console.log("SALES_ORDERS_HTTP_AUTH_RBAC_E2E=PASS");
    console.log("PASS Auth: login/session cookie, unauthenticated 401, invalid Origin 401.");
    console.log("PASS Owner/Manager/Cashier/Viewer RBAC: read/create/post/payment/void/return/refund permissions.");
    console.log("PASS HTTP workflows: create/idempotency conflict, list/detail, reserve/cancel/post, WAC, payment, return, refund and ledger reads.");
    console.log("PASS Business guards: overpayment conflict and forbidden actions leave server-side state guarded.");
    console.log("PASS Disposable workspace fixtures: " + JSON.stringify(finalState.rows[0]));
  } finally {
    await stopApi().catch(() => undefined);
    if (tenantPrisma) await tenantPrisma.$disconnect().catch(() => undefined);
    if (admin) await admin.end().catch(() => undefined);
    if (control) {
      try {
        const persistedWorkspace = await control.workspace.findUnique({ where: { slug }, include: { database: true } });
        if (persistedWorkspace) {
          ids.workspaceId = persistedWorkspace.id;
          ids.databaseName = persistedWorkspace.database?.databaseName ?? ids.databaseName ?? ("syncup_ws_" + persistedWorkspace.id.replace(/-/g, "").slice(0, 12));
          ids.runtimeRole = persistedWorkspace.database?.username ?? ids.runtimeRole ?? ("syncup_rt_" + persistedWorkspace.id.replace(/-/g, "").slice(0, 12));
        }
        if (ids.databaseName) {
          const cleanupAdmin = await connect(adminUrl.toString());
          try {
            await cleanupAdmin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [ids.databaseName]);
            await cleanupAdmin.query('DROP DATABASE IF EXISTS "' + ids.databaseName.replace(/"/g, '""') + '"');
            if (ids.runtimeRole) await cleanupAdmin.query('DROP ROLE IF EXISTS "' + ids.runtimeRole.replace(/"/g, '""') + '"');
            const leftovers = await cleanupAdmin.query(
              "SELECT (SELECT COUNT(*)::int FROM pg_database WHERE datname=$1) AS databases," +
              "(SELECT COUNT(*)::int FROM pg_roles WHERE rolname=$2) AS roles",
              [ids.databaseName, ids.runtimeRole],
            );
            assert.equal(leftovers.rows[0].databases, 0, "Disposable Tenant database must be dropped");
            assert.equal(leftovers.rows[0].roles, 0, "Disposable runtime role must be dropped");
          } finally { await cleanupAdmin.end(); }
        }
        if (ids.workspaceId) await control.role.deleteMany({ where: { workspaceId: ids.workspaceId } });
        if (ids.workspaceId) await control.workspace.deleteMany({ where: { id: ids.workspaceId } });
        if (ids.users.length) await control.user.deleteMany({ where: { id: { in: ids.users } } });
        const leftoverWorkspace = await control.workspace.findUnique({ where: { slug } });
        assert.equal(leftoverWorkspace, null, "Disposable Control workspace must be deleted");
        const leftoverUsers = await control.user.count({ where: { id: { in: ids.users } } });
        assert.equal(leftoverUsers, 0, "Disposable test users must be deleted");
        const permissionAfter = await control.permission.findMany({ select: { key: true }, orderBy: { key: "asc" } });
        assert.deepEqual(permissionAfter, permissionBefore, "Shared Control permission catalog must remain unchanged");
        console.log("DISPOSABLE_CONTROL_RECORDS_CLEANUP=PASS");
      } finally { await control.$disconnect(); }
    }
  }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
