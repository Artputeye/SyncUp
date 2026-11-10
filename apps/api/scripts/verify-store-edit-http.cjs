const assert = require("node:assert/strict");
const { Module, UnauthorizedException } = require("@nestjs/common");
const { NestFactory } = require("@nestjs/core");
const { StoresController } = require("../dist/core/tenant/stores.controller");
const { StoreQueryService } = require("../dist/core/tenant/store-query.service");
const { AuthService } = require("../dist/core/auth/auth.service");
const { RbacService } = require("../dist/core/rbac/rbac.service");

const calls = [];
const detail = { id: "store-1", name: "ARTTECH", slug: "arttech", status: "ACTIVE", currency: "THB", timezone: "Asia/Bangkok" };
const storesMock = {
  async listStores(userId, workspaceId) { calls.push(["list", userId, workspaceId]); return [detail]; },
  async getStore(userId, workspaceId, storeId) { calls.push(["get", userId, workspaceId, storeId]); return detail; },
  async updateStore(userId, workspaceId, storeId, body) { calls.push(["update", userId, workspaceId, storeId, body]); return { ...detail, ...body }; }
};
const authMock = {
  async resolveSession(token) {
    if (!["owner-a", "owner-a-no-permission", "owner-b"].includes(token)) throw new UnauthorizedException();
    return { userId: token };
  }
};
const rbacMock = {
  async hasPermission(userId, workspaceId, permission) {
    if (userId !== "owner-a" || workspaceId !== "workspace-a") return false;
    return permission === "commerce.store.view" || permission === "commerce.store.manage";
  }
};
class StoreEditHttpTestModule {}
Module({ controllers: [StoresController], providers: [
  { provide: StoreQueryService, useValue: storesMock },
  { provide: AuthService, useValue: authMock },
  { provide: RbacService, useValue: rbacMock }
]})(StoreEditHttpTestModule);

async function request(base, path, options = {}) {
  const headers = {};
  if (options.auth) headers.cookie = "syncup_session=" + options.auth;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  return fetch(base + path, { method: options.method || "GET", headers, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
}
async function expectStatus(response, expected, label) {
  const body = await response.text();
  assert.equal(response.status, expected, label + ": expected " + expected + ", got " + response.status + "; " + body);
  return body ? JSON.parse(body) : null;
}
async function main() {
  delete process.env.WEB_ORIGIN;
  const app = await NestFactory.create(StoreEditHttpTestModule, { logger: ["error", "warn"] });
  try {
    app.setGlobalPrefix("api");
    await app.listen(0, "127.0.0.1");
    const base = "http://127.0.0.1:" + app.getHttpServer().address().port;
    const path = "/api/tenant/workspace-a/stores/store-1";
    await expectStatus(await request(base, path), 401, "anonymous Store detail");
    await expectStatus(await request(base, path, { auth: "owner-a-no-permission" }), 403, "Store detail without view permission");
    const row = await expectStatus(await request(base, path, { auth: "owner-a" }), 200, "authorized Store detail");
    assert.equal(row.slug, "arttech");
    await expectStatus(await request(base, path, { method: "PATCH", auth: "owner-a-no-permission", body: { name: "Nope" } }), 403, "Store update without manage permission");
    await expectStatus(await request(base, "/api/tenant/workspace-b/stores/store-1", { method: "PATCH", auth: "owner-a", body: { name: "Cross" } }), 403, "cross-workspace Store update");
    const updated = await expectStatus(await request(base, path, { method: "PATCH", auth: "owner-a", body: { name: "ARTTECH Updated" } }), 200, "authorized Store update");
    assert.equal(updated.name, "ARTTECH Updated");
    assert.deepEqual(calls.map((call) => call[0]), ["get", "update"]);
    console.log("PASS Store detail/edit HTTP: authentication, view/manage permissions and workspace isolation");
  } finally { await app.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
