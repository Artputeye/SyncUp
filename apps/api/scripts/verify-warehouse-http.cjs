const assert = require("node:assert/strict");
const { Module, UnauthorizedException } = require("@nestjs/common");
const { NestFactory } = require("@nestjs/core");
const { WarehousesController } = require("../dist/core/tenant/warehouses.controller");
const { WarehouseQueryService } = require("../dist/core/tenant/warehouse-query.service");
const { StoreLifecycleService } = require("../dist/core/tenant/store-lifecycle.service");
const { AuthService } = require("../dist/core/auth/auth.service");
const { RbacService } = require("../dist/core/rbac/rbac.service");
const calls = [];
const row = { id: "warehouse-1", branchId: "branch-1", code: "MAIN", name: "Main", status: "ACTIVE", isDefault: true };
const query = {
  async listWarehouses(userId, workspaceId, storeId, branchId) { calls.push(["list", userId, workspaceId, storeId, branchId]); return [row]; },
  async getWarehouse(userId, workspaceId, storeId, branchId, warehouseId) { calls.push(["get", userId, workspaceId, storeId, branchId, warehouseId]); return row; }
};
const lifecycle = {
  async updateWarehouse(userId, workspaceId, storeId, branchId, warehouseId, body) { calls.push(["update", userId, workspaceId, storeId, branchId, warehouseId, body]); return { ...row, ...body }; }
};
const auth = { async resolveSession(token) { if (!["owner-a", "owner-b"].includes(token)) throw new UnauthorizedException(); return { userId: token }; } };
const rbac = { async hasPermission(userId, workspaceId, permission) { return userId === "owner-a" && workspaceId === "workspace-a" && (permission === "commerce.store.view" || permission === "commerce.store.manage"); } };
class WarehouseHttpTestModule {}
Module({ controllers: [WarehousesController], providers: [
  { provide: WarehouseQueryService, useValue: query }, { provide: StoreLifecycleService, useValue: lifecycle },
  { provide: AuthService, useValue: auth }, { provide: RbacService, useValue: rbac }
]})(WarehouseHttpTestModule);
async function request(base, path, options = {}) {
  const headers = {}; if (options.auth) headers.cookie = "syncup_session=" + options.auth;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  return fetch(base + path, { method: options.method || "GET", headers, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
}
async function expectStatus(response, expected, label) {
  const body = await response.text(); assert.equal(response.status, expected, label + ": " + body); return body ? JSON.parse(body) : null;
}
async function main() {
  delete process.env.WEB_ORIGIN;
  const app = await NestFactory.create(WarehouseHttpTestModule, { logger: ["error", "warn"] });
  try {
    app.setGlobalPrefix("api"); await app.listen(0, "127.0.0.1");
    const base = "http://127.0.0.1:" + app.getHttpServer().address().port;
    const path = "/api/tenant/workspace-a/stores/store-1/branches/branch-1/warehouses";
    await expectStatus(await request(base, path), 401, "anonymous list");
    await expectStatus(await request(base, path, { auth: "owner-b" }), 403, "cross workspace list");
    const rows = await expectStatus(await request(base, path, { auth: "owner-a" }), 200, "authorized list");
    assert.equal(rows[0].id, "warehouse-1");
    await expectStatus(await request(base, path + "/warehouse-1", { method: "PATCH", auth: "owner-b", body: { code: "X", name: "Cross" } }), 403, "cross workspace edit");
    const updated = await expectStatus(await request(base, path + "/warehouse-1", { method: "PATCH", auth: "owner-a", body: { code: "WH2", name: "Overflow" } }), 200, "authorized edit");
    assert.equal(updated.name, "Overflow");
    assert.deepEqual(calls.map((call) => call[0]), ["list", "update"]);
    console.log("PASS Warehouse HTTP: authentication, view/manage RBAC, workspace isolation, list and update routes");
  } finally { await app.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
