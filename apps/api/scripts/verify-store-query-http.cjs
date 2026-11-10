const assert = require("node:assert/strict");
const { Module, UnauthorizedException } = require("@nestjs/common");
const { NestFactory } = require("@nestjs/core");
const { StoresController } = require("../dist/core/tenant/stores.controller");
const { StoreQueryService } = require("../dist/core/tenant/store-query.service");
const { AuthService } = require("../dist/core/auth/auth.service");
const { RbacService } = require("../dist/core/rbac/rbac.service");

const calls = [];
const storesMock = {
  async listStores(userId, workspaceId) {
    calls.push([userId, workspaceId]);
    return [{ id: "store-1", name: "ARTTECH", slug: "arttech", status: "ACTIVE", activeBranchCount: 1 }];
  }
};
const authMock = {
  async resolveSession(token) {
    if (token !== "owner-a" && token !== "owner-a-no-permission" && token !== "owner-b") throw new UnauthorizedException();
    return { userId: token };
  }
};
const rbacMock = {
  async hasPermission(userId, workspaceId, permission) {
    return permission === "commerce.store.view" && userId === "owner-a" && workspaceId === "workspace-a";
  }
};
class StoreQueryHttpTestModule {}
Module({ controllers: [StoresController], providers: [
  { provide: StoreQueryService, useValue: storesMock },
  { provide: AuthService, useValue: authMock },
  { provide: RbacService, useValue: rbacMock }
]})(StoreQueryHttpTestModule);

async function request(base, path, auth) {
  const headers = {};
  if (auth) headers.cookie = "syncup_session=" + auth;
  return fetch(base + path, { headers });
}
async function expectStatus(response, expected, label) {
  const body = await response.text();
  assert.equal(response.status, expected, label + ": expected " + expected + ", got " + response.status + "; " + body);
  return body ? JSON.parse(body) : null;
}
async function main() {
  delete process.env.WEB_ORIGIN;
  const app = await NestFactory.create(StoreQueryHttpTestModule, { logger: ["error", "warn"] });
  try {
    app.setGlobalPrefix("api");
    await app.listen(0, "127.0.0.1");
    const base = "http://127.0.0.1:" + app.getHttpServer().address().port;
    const path = "/api/tenant/workspace-a/stores";
    await expectStatus(await request(base, path), 401, "anonymous Store list");
    await expectStatus(await request(base, path, "owner-a-no-permission"), 403, "Store list without permission");
    await expectStatus(await request(base, "/api/tenant/workspace-b/stores", "owner-a"), 403, "cross-workspace Store list");
    const rows = await expectStatus(await request(base, path, "owner-a"), 200, "authorized Store list");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].slug, "arttech");
    assert.deepEqual(calls, [["owner-a", "workspace-a"]]);
    console.log("PASS Store list HTTP: authentication, commerce.store.view, workspace isolation and response shape");
  } finally {
    await app.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
