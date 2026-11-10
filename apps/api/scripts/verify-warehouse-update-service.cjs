const assert = require("node:assert/strict");
const { BadRequestException, ConflictException, NotFoundException } = require("@nestjs/common");
const { StoreLifecycleService } = require("../dist/core/tenant/store-lifecycle.service");

async function main() {
  const captured = [];
  const tx = {
    async $queryRaw(strings, ...values) {
      const sql = Array.from(strings).join("?");
      captured.push({ sql, values });
      if (sql.includes("SELECT id, store_id, status FROM branches")) return [{ id: "branch-1", store_id: "store-1", status: "ACTIVE" }];
      if (sql.includes("FROM warehouses") && sql.includes("FOR UPDATE")) return [{ id: "warehouse-1", code: "OLD", name: "Old", status: "ACTIVE", is_default: true }];
      if (sql.includes("UPDATE warehouses")) return [{ id: "warehouse-1", branchId: "branch-1", code: "MAIN", name: "Main Warehouse", status: "ACTIVE", isDefault: true }];
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
  const updated = await service.updateWarehouse("user-1", "workspace-1", "store-1", "branch-1", "warehouse-1", { code: "main", name: " Main Warehouse " });
  assert.equal(updated.code, "MAIN");
  assert.equal(updated.name, "Main Warehouse");
  assert.ok(captured.some((item) => item.sql.includes("FOR UPDATE")));
  assert.ok(captured.some((item) => item.values.includes("WAREHOUSE_UPDATED")));
  await assert.rejects(() => service.updateWarehouse("user-1", "workspace-1", "store-1", "branch-1", "warehouse-1", { code: "bad code", name: "Bad" }), BadRequestException);
  const wrongStore = new StoreLifecycleService({ async forMembership() { return { async $transaction(callback) { return callback({
    async $queryRaw(strings) { const sql = Array.from(strings).join("?"); if (sql.includes("SELECT id, store_id, status FROM branches")) return [{ id: "branch-1", store_id: "other-store", status: "ACTIVE" }]; return []; }
  }); } }; } });
  await assert.rejects(() => wrongStore.updateWarehouse("user-1", "workspace-1", "store-1", "branch-1", "warehouse-1", { code: "MAIN", name: "Main" }), NotFoundException);
  const archived = new StoreLifecycleService({ async forMembership() { return { async $transaction(callback) { return callback({
    async $queryRaw(strings) { const sql = Array.from(strings).join("?"); if (sql.includes("SELECT id, store_id, status FROM branches")) return [{ id: "branch-1", store_id: "store-1", status: "ACTIVE" }]; if (sql.includes("FROM warehouses")) return [{ id: "warehouse-1", code: "OLD", name: "Old", status: "ARCHIVED", is_default: false }]; return []; }
  }); } }; } });
  await assert.rejects(() => archived.updateWarehouse("user-1", "workspace-1", "store-1", "branch-1", "warehouse-1", { code: "MAIN", name: "Main" }), ConflictException);
  console.log("PASS Warehouse update service: membership scope, store/branch scope, validation, row lock and audit");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
