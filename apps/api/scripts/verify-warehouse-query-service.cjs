const assert = require("node:assert/strict");
const { NotFoundException } = require("@nestjs/common");
const { WarehouseQueryService } = require("../dist/core/tenant/warehouse-query.service");

async function main() {
  const calls = [];
  const service = new WarehouseQueryService({ async forMembership(userId, workspaceId) {
    assert.equal(userId, "user-1"); assert.equal(workspaceId, "workspace-1");
    return { async $queryRaw(strings, ...values) {
      const sql = Array.from(strings).join("?"); calls.push({ sql, values });
      if (sql.includes("FROM branches b")) return [{ id: "branch-1" }];
      if (sql.includes("FROM warehouses w")) return [{ id: "warehouse-1", branchId: "branch-1", code: "MAIN", name: "Main", status: "ACTIVE", isDefault: true }];
      return [];
    } };
  } });
  const rows = await service.listWarehouses("user-1", "workspace-1", "store-1", "branch-1");
  assert.equal(rows[0].id, "warehouse-1");
  assert.ok(calls[0].sql.includes("b.store_id"));
  const detail = await service.getWarehouse("user-1", "workspace-1", "store-1", "branch-1", "warehouse-1");
  assert.equal(detail.isDefault, true);
  assert.ok(calls.at(-1).sql.includes("b.store_id"));
  const missing = new WarehouseQueryService({ async forMembership() { return { async $queryRaw() { return []; } }; } });
  await assert.rejects(() => missing.listWarehouses("user-1", "workspace-1", "store-1", "wrong-branch"), NotFoundException);
  await assert.rejects(() => missing.getWarehouse("user-1", "workspace-1", "store-1", "branch-1", "wrong-warehouse"), NotFoundException);
  console.log("PASS Warehouse query service: membership and Store/Branch scoping");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
