const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { Client } = require("pg");

const api = "http://127.0.0.1:" + (process.env.API_PORT || "4000");
const cookieName = process.env.AUTH_COOKIE_NAME || "syncup_session";
const roleUsers = [
  { role: "admin", email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD },
  { role: "manager", email: process.env.E2E_MANAGER_EMAIL, password: process.env.E2E_MANAGER_PASSWORD },
  { role: "inventory_staff", email: process.env.E2E_INVENTORY_EMAIL, password: process.env.E2E_INVENTORY_PASSWORD },
  { role: "cashier", email: process.env.E2E_CASHIER_EMAIL, password: process.env.E2E_CASHIER_PASSWORD }
];

async function main() {
  const control = new PrismaClient();
  let tenant;
  try {
    const workspace = await control.workspace.findUnique({
      where: { slug: process.env.E2E_WORKSPACE_SLUG }, include: { database: true }
    });
    assert.ok(workspace && workspace.status === "ACTIVE" && workspace.database, "Dedicated E2E workspace must be active.");
    const adminUrl = new URL(process.env.WORKSPACE_DATABASE_ADMIN_URL);
    adminUrl.pathname = "/" + workspace.database.databaseName;
    tenant = new Client({ connectionString: adminUrl.toString() });
    await tenant.connect();
    const storeResult = await tenant.query("SELECT id FROM public.stores WHERE slug='e2e-main-store' LIMIT 1");
    assert.equal(storeResult.rowCount, 1, "E2E Store must exist.");
    const storeId = storeResult.rows[0].id;

    for (const user of roleUsers) {
      assert.ok(user.email && user.password, "Missing dedicated credentials for " + user.role);
      const login = await fetch(api + "/api/auth/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: user.email, password: user.password })
      });
      const loginBody = await login.text();
      assert.equal(login.status, 201, user.role + " login should succeed: " + loginBody);
      const cookies = login.headers.getSetCookie ? login.headers.getSetCookie() : [login.headers.get("set-cookie") || ""];
      const cookie = cookies.map(value => value.split(";")[0]).find(value => value.startsWith(cookieName + "="));
      assert.ok(cookie, user.role + " login should set the session cookie.");

      const request = async (method, path, body) => fetch(api + path, {
        method, headers: { cookie, origin: process.env.WEB_ORIGIN, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const prefix = "/api/tenant/" + workspace.id;
      const storeRead = await request("GET", prefix + "/stores");
      assert.equal(storeRead.status, 200, user.role + " should have Store view access.");

      const writeCases = [
        ["reservation.manage", prefix + "/inventory/reservations", {}, ["admin", "manager", "inventory_staff"]],
        ["inventory.receive", prefix + "/inventory/receipts", {}, ["admin", "manager", "inventory_staff"]],
        ["inventory.issue", prefix + "/inventory/sales", {}, ["admin", "manager", "inventory_staff"]],
        ["inventory.adjust", prefix + "/inventory/adjustments", {}, ["admin", "manager", "inventory_staff"]],
        ["inventory.transfer", prefix + "/inventory/transfers", {}, ["admin", "manager", "inventory_staff"]],
        ["inventory.stocktake", prefix + "/inventory/stocktakes", {}, ["admin", "manager", "inventory_staff"]],
        ["store.manage", prefix + "/stores/" + storeId, { name: "" }, ["admin", "manager"]]
      ];
      for (const [label, path, body, allowedRoles] of writeCases) {
        const response = await request(label === "store.manage" ? "PATCH" : "POST", path, body);
        const allowed = allowedRoles.includes(user.role);
        assert.equal(response.status, allowed ? 400 : 403,
          user.role + " " + label + " should " + (allowed ? "pass RBAC and fail safe input validation" : "be forbidden") +
          "; received HTTP " + response.status);
      }

      const reverse = await request("POST", prefix + "/inventory/movements/" + randomUUID() + "/reverse", {});
      const reverseAllowed = user.role === "admin" || user.role === "manager";
      assert.equal(reverse.status, reverseAllowed ? 400 : 403,
        user.role + " movement.reverse should " + (reverseAllowed ? "pass RBAC and fail input validation" : "be forbidden") +
        "; received HTTP " + reverse.status);
      console.log("PASS HTTP RBAC " + user.role + ": Store view; inventory reservation/receive/issue/adjust/transfer/stocktake; Store manage; movement reverse.");
    }
    console.log("PASS Inventory RBAC HTTP smoke test: 4 roles, 36 authorization assertions, no business mutations.");
  } finally {
    if (tenant) await tenant.end().catch(() => undefined);
    await control.$disconnect();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
