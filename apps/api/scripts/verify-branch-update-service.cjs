const assert = require("node:assert/strict");
const { BadRequestException, NotFoundException } = require("@nestjs/common");
const { StoreLifecycleService } = require("../dist/core/tenant/store-lifecycle.service");

async function main() {
  const captured = [];
  const tx = {
    async $queryRaw(strings, ...values) {
      const sql = Array.from(strings).join("?");
      captured.push({ sql, values });
      if (sql.includes("SELECT id, status FROM stores")) return [{ id: "store-1", status: "ACTIVE" }];
      if (sql.includes("FROM branches") && sql.includes("FOR UPDATE")) return [{ id: "branch-1", store_id: "store-1", code: "OLD", name: "Old", status: "ACTIVE", is_default: true, phone: null, address: null }];
      if (sql.includes("UPDATE branches")) return [{ id: "branch-1", code: "HQ", name: "Head Office", status: "ACTIVE", isDefault: true, phone: "02-000-0000", address: { province: "Bangkok" } }];
      return [];
    },
    async $executeRaw(strings, ...values) { captured.push({ sql: Array.from(strings).join("?"), values }); return 1; }
  };
  const service = new StoreLifecycleService({
    async forMembership(userId, workspaceId) {
      assert.equal(userId, "user-1"); assert.equal(workspaceId, "workspace-1");
      return { async $transaction(callback) { return callback(tx); } };
    }
  });
  const updated = await service.updateBranch("user-1", "workspace-1", "store-1", "branch-1", {
    code: "hq", name: " Head Office ", phone: " 02-000-0000 ", address: { province: " Bangkok ", unknown: "ignored" }
  });
  assert.equal(updated.code, "HQ");
  assert.equal(updated.name, "Head Office");
  assert.ok(captured.some((item) => item.sql.includes("FOR UPDATE")));
  assert.ok(captured.some((item) => item.values.includes("BRANCH_UPDATED")));
  assert.ok(captured.some((item) => item.values.includes("HQ")));
  await assert.rejects(() => service.updateBranch("user-1", "workspace-1", "store-1", "branch-1", { code: "bad code", name: "Bad" }), BadRequestException);
  const missingTx = { async $queryRaw(strings) {
    const sql = Array.from(strings).join("?");
    if (sql.includes("SELECT id, status FROM stores")) return [{ id: "store-1", status: "ACTIVE" }];
    return [];
  }};
  const missing = new StoreLifecycleService({ async forMembership() {
    return { async $transaction(callback) { return callback(missingTx); } };
  }});
  await assert.rejects(() => missing.updateBranch("user-1", "workspace-1", "store-1", "missing", { code: "HQ", name: "Missing" }), NotFoundException);
  console.log("PASS Branch update service: membership scope, validation, row lock, update and audit");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
