const assert = require("node:assert/strict");
const { BadRequestException, NotFoundException } = require("@nestjs/common");
const { BranchQueryService } = require("../dist/core/tenant/branch-query.service");

async function main() {
  const captured = [];
  const db = { async $queryRaw(strings, ...values) {
    const sql = Array.from(strings).join("?");
    captured.push({ sql, values });
    if (sql.includes("FROM stores")) return [{ id: "store-1" }];
    if (sql.includes("FROM branches")) return [{ id: "branch-1", storeId: "store-1", code: "HQ", name: "Head Office", status: "ACTIVE", isDefault: true, phone: null, address: null }];
    return [];
  }};
  const service = new BranchQueryService({ async forMembership(userId, workspaceId) { assert.equal(userId, "user-1"); assert.equal(workspaceId, "workspace-1"); return db; } });
  const rows = await service.listBranches("user-1", "workspace-1", "store-1");
  assert.equal(rows[0].isDefault, true);
  const detail = await service.getBranch("user-1", "workspace-1", "store-1", "branch-1");
  assert.equal(detail.code, "HQ");
  const missing = new BranchQueryService({ async forMembership() { return { async $queryRaw() { return []; } }; } });
  await assert.rejects(() => missing.listBranches("user-1", "workspace-1", "missing"), NotFoundException);
  await assert.rejects(() => missing.getBranch("user-1", "workspace-1", "store-1", "missing"), NotFoundException);
  assert.ok(captured.some((item) => item.sql.includes("store_id")));
  console.log("PASS Branch query service: membership scope, Store scope, list/detail and not-found");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
