const assert = require("node:assert/strict");
const { Module, UnauthorizedException } = require("@nestjs/common");
const { NestFactory } = require("@nestjs/core");
const { BranchesController } = require("../dist/core/tenant/branches.controller");
const { BranchQueryService } = require("../dist/core/tenant/branch-query.service");
const { StoreLifecycleService } = require("../dist/core/tenant/store-lifecycle.service");
const { AuthService } = require("../dist/core/auth/auth.service");
const { RbacService } = require("../dist/core/rbac/rbac.service");
const calls = [];
const row = { id: "branch-1", storeId: "store-1", code: "HQ", name: "Head Office", status: "ACTIVE", isDefault: true };
const query = {
  async listBranches(userId, workspaceId, storeId) { calls.push(["list", userId, workspaceId, storeId]); return [row]; },
  async getBranch(userId, workspaceId, storeId, branchId) { calls.push(["get", userId, workspaceId, storeId, branchId]); return row; }
};
const lifecycle = {
  async updateBranch(userId, workspaceId, storeId, branchId, body) { calls.push(["update", userId, workspaceId, storeId, branchId, body]); return { ...row, ...body }; }
};
const auth = { async resolveSession(token) { if (!["owner-a", "owner-b", "no-permission"].includes(token)) throw new UnauthorizedException(); return { userId: token }; } };
const rbac = { async hasPermission(userId, workspaceId, permission) { return userId === "owner-a" && workspaceId === "workspace-a" && ((permission === "commerce.store.view") || (permission === "commerce.store.manage" && userId !== "no-permission")); } };
class BranchHttpTestModule {}
Module({ controllers: [BranchesController], providers: [
  { provide: BranchQueryService, useValue: query }, { provide: StoreLifecycleService, useValue: lifecycle },
  { provide: AuthService, useValue: auth }, { provide: RbacService, useValue: rbac }
]})(BranchHttpTestModule);
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
  const app = await NestFactory.create(BranchHttpTestModule, { logger: ["error", "warn"] });
  try {
    app.setGlobalPrefix("api"); await app.listen(0, "127.0.0.1");
    const base = "http://127.0.0.1:" + app.getHttpServer().address().port;
    const path = "/api/tenant/workspace-a/stores/store-1/branches";
    await expectStatus(await request(base, path), 401, "anonymous list");
    await expectStatus(await request(base, path, { auth: "owner-b" }), 403, "cross workspace list");
    const rows = await expectStatus(await request(base, path, { auth: "owner-a" }), 200, "authorized list");
    assert.equal(rows[0].id, "branch-1");
    await expectStatus(await request(base, path + "/branch-1", { method: "PATCH", auth: "owner-b", body: { code: "X", name: "Cross" } }), 403, "cross workspace edit");
    const updated = await expectStatus(await request(base, path + "/branch-1", { method: "PATCH", auth: "owner-a", body: { code: "BKK", name: "Bangkok" } }), 200, "authorized edit");
    assert.equal(updated.name, "Bangkok");
    assert.deepEqual(calls.map((call) => call[0]), ["list", "update"]);
    console.log("PASS Branch HTTP: authentication, view/manage RBAC, workspace isolation and update route");
  } finally { await app.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
