const assert = require("node:assert/strict");
const { Client } = require("pg");

const api = "http://127.0.0.1:" + (process.env.API_PORT || "4000");
const cookieName = process.env.AUTH_COOKIE_NAME || "syncup_session";
const workspaceSlug = process.env.E2E_WORKSPACE_SLUG;
const users = {
  owner: { email: process.env.E2E_OWNER_EMAIL, password: process.env.E2E_OWNER_PASSWORD },
  manager: { email: process.env.E2E_MANAGER_EMAIL, password: process.env.E2E_MANAGER_PASSWORD },
  inventory: { email: process.env.E2E_INVENTORY_EMAIL, password: process.env.E2E_INVENTORY_PASSWORD },
  cashier: { email: process.env.E2E_CASHIER_EMAIL, password: process.env.E2E_CASHIER_PASSWORD },
};
function assertUser(user, role) {
  assert.ok(user.email && user.password, "Missing dedicated E2E " + role + " credentials.");
}
async function login(user, role) {
  assertUser(user, role);
  const response = await fetch(api + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  assert.equal(response.status, 201, role + " login failed: " + await response.text());
  const values = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get("set-cookie") || ""];
  const cookie = values.map((value) => value.split(";")[0]).find((value) => value.startsWith(cookieName + "="));
  assert.ok(cookie, role + " session cookie missing.");
  return cookie;
}
async function main() {
  assert.ok(workspaceSlug, "E2E_WORKSPACE_SLUG is missing.");
  const control = new Client({ connectionString: process.env.CONTROL_DATABASE_URL });
  let tenant;
  await control.connect();
  try {
    const workspaceResult = await control.query(
      "SELECT w.id,d.database_name FROM workspaces w JOIN workspace_databases d ON d.workspace_id=w.id WHERE w.slug=$1 AND w.status='ACTIVE'",
      [workspaceSlug],
    );
    assert.equal(workspaceResult.rowCount, 1, "Expected one active dedicated E2E workspace.");
    const workspaceId = workspaceResult.rows[0].id;
    const tenantUrl = new URL(process.env.WORKSPACE_DATABASE_ADMIN_URL);
    tenantUrl.pathname = "/" + workspaceResult.rows[0].database_name;
    tenant = new Client({ connectionString: tenantUrl.toString() });
    await tenant.connect();
    const before = await tenant.query(
      "SELECT (SELECT count(*)::int FROM stores) AS stores,(SELECT count(*)::int FROM branches) AS branches,(SELECT count(*)::int FROM warehouses) AS warehouses",
    );

    const ownerCookie = await login(users.owner, "Owner");
    const managerCookie = await login(users.manager, "Manager");
    const inventoryCookie = await login(users.inventory, "Inventory Staff");
    const cashierCookie = await login(users.cashier, "Cashier");
    const request = (cookie, method, path) => fetch(api + path, {
      method,
      headers: { cookie, origin: process.env.WEB_ORIGIN, "content-type": "application/json" },
    });
    const prefix = "/api/workspaces/" + workspaceId + "/modules";
    const ownerRead = await request(ownerCookie, "GET", prefix);
    assert.equal(ownerRead.status, 200, "Owner must be able to read Module Registry.");
    const managerRead = await request(managerCookie, "GET", prefix);
    assert.equal(managerRead.status, 200, "Manager with modules.manage must be able to read Module Registry.");
    for (const [role, cookie] of [["Inventory Staff", inventoryCookie], ["Cashier", cashierCookie]]) {
      const denied = await request(cookie, "GET", prefix);
      assert.equal(denied.status, 403, role + " without modules.manage must be denied; received " + denied.status);
    }

    const compatibility = await request(managerCookie, "GET", prefix + "/commerce/compatibility");
    assert.equal(compatibility.status, 200, "Manager compatibility endpoint failed.");
    const compatibilityBody = await compatibility.json();
    assert.equal(compatibilityBody.compatible, true, "Commerce compatibility failed: " + JSON.stringify(compatibilityBody.issues));

    for (const action of ["install", "enable", "disable"]) {
      const response = await request(managerCookie, "POST", prefix + "/commerce/" + action);
      assert.ok(response.status === 201 || response.status === 200,
        "Manager " + action + " failed: HTTP " + response.status + " " + await response.text());
    }

    const finalRead = await request(ownerCookie, "GET", prefix);
    assert.equal(finalRead.status, 200);
    const modules = await finalRead.json();
    const commerce = modules.find((item) => item.manifest?.id === "commerce");
    assert.ok(commerce?.installation, "Commerce installation record missing.");
    assert.equal(commerce.installation.status, "DISABLED", "Expected final Commerce state DISABLED.");
    assert.equal(commerce.installation.enabled, false, "Disabled Commerce must have enabled=false.");

    const auditResponse = await request(ownerCookie, "GET", prefix + "/audit");
    assert.equal(auditResponse.status, 200, "Owner audit read failed.");
    const events = await auditResponse.json();
    const actions = events.filter((event) => event.entityId === commerce.installation.id).map((event) => event.action);
    for (const required of ["MODULE_INSTALLED", "MODULE_ENABLED", "MODULE_DISABLED"]) {
      assert.ok(actions.includes(required), "Lifecycle Audit Log missing " + required);
    }

    const after = await tenant.query(
      "SELECT (SELECT count(*)::int FROM stores) AS stores,(SELECT count(*)::int FROM branches) AS branches,(SELECT count(*)::int FROM warehouses) AS warehouses",
    );
    assert.deepEqual(after.rows[0], before.rows[0], "Module lifecycle unexpectedly changed Store/Branch/Warehouse data.");
    console.log("PASS E2E HTTP authorization: Owner/Manager allowed; Inventory Staff/Cashier denied.");
    console.log("PASS E2E Commerce Install -> Enable -> Disable; all 3 Audit Log event types present.");
    console.log("PASS E2E tenant Store/Branch/Warehouse counts unchanged.");
  } finally {
    if (tenant) await tenant.end().catch(() => undefined);
    await control.end();
  }
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
