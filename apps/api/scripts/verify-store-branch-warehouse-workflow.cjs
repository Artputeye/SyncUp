const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Client } = require("pg");
const { PrismaClient } = require("@prisma/client");
const { StoreLifecycleService } = require("../dist/core/tenant/store-lifecycle.service");
const { StoreQueryService } = require("../dist/core/tenant/store-query.service");
const { BranchQueryService } = require("../dist/core/tenant/branch-query.service");
const { WarehouseQueryService } = require("../dist/core/tenant/warehouse-query.service");

const root = path.resolve(__dirname, "../../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const adminUrl = process.env.TEST_POSTGRES_ADMIN_URL;
if (!adminUrl) throw new Error("Set TEST_POSTGRES_ADMIN_URL to localhost disposable PostgreSQL.");
const parsed = new URL(adminUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) throw new Error("Safety stop: disposable PostgreSQL must be localhost.");

async function main() {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  const database = "syncup_store_branch_warehouse_" + process.pid + "_" + Date.now();
  let sql, prisma;
  try {
    await admin.query('CREATE DATABASE "' + database + '"');
    const u = new URL(adminUrl); u.pathname = "/" + database;
    sql = new Client({ connectionString: u.toString() }); await sql.connect();
    for (const file of [
      "apps/api/prisma/tenant/migrations/20261031000100_tenant_baseline.sql",
      "docs/architecture/tenant-commerce-clean-install.candidate.sql",
      "docs/architecture/tenant-commerce-custom-constraints.candidate.sql",
      "docs/architecture/tenant-canonicalization-constraints.candidate.sql",
      "docs/architecture/tenant-branch-warehouse-lifecycle.candidate.sql"
    ]) await sql.query(read(file));

    prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });
    await prisma.$connect();
    const registry = { forMembership: async () => prisma };
    const lifecycle = new StoreLifecycleService(registry);
    const storesQuery = new StoreQueryService(registry);
    const branchesQuery = new BranchQueryService(registry);
    const warehousesQuery = new WarehouseQueryService(registry);
    const actor = randomUUID();

    const store = await lifecycle.createStore(actor, "workflow-test", { name: "Workflow Store", slug: "workflow-store" });
    const storeRows = await storesQuery.listStores(actor, "workflow-test");
    assert.ok(storeRows.some(x => x.id === store.id));
    assert.equal(storeRows.find(x => x.id === store.id).activeBranchCount, 1);
    console.log("PASS Store: create + list + default Branch/Warehouse provisioning");

    const initialBranches = await branchesQuery.listBranches(actor, "workflow-test", store.id);
    assert.equal(initialBranches.length, 1);
    assert.equal(initialBranches[0].id, store.defaultBranchId);
    const branch = await lifecycle.createBranch(actor, "workflow-test", store.id, { code: "BKK", name: "Bangkok Branch" });
    const branchRows = await branchesQuery.listBranches(actor, "workflow-test", store.id);
    assert.ok(branchRows.some(x => x.id === branch.id));
    assert.equal(branchRows.filter(x => x.isDefault).length, 1);
    console.log("PASS Branch: create + Store-scoped list + exactly one default Branch");

    const warehouse = await lifecycle.createWarehouse(actor, "workflow-test", branch.id, { code: "WH2", name: "Overflow" });
    let warehouseRows = await warehousesQuery.listWarehouses(actor, "workflow-test", store.id, branch.id);
    assert.ok(warehouseRows.some(x => x.id === warehouse.id));
    assert.equal(warehouseRows.filter(x => x.isDefault).length, 1);
    const detail = await warehousesQuery.getWarehouse(actor, "workflow-test", store.id, branch.id, warehouse.id);
    assert.equal(detail.code, "WH2");
    console.log("PASS Warehouse: create + Branch-scoped list/detail + exactly one default Warehouse");

    const updated = await lifecycle.updateWarehouse(actor, "workflow-test", store.id, branch.id, warehouse.id, { code: "WH2A", name: "Overflow Updated" });
    assert.equal(updated.code, "WH2A");
    assert.equal(updated.name, "Overflow Updated");
    assert.equal((await warehousesQuery.getWarehouse(actor, "workflow-test", store.id, branch.id, warehouse.id)).name, "Overflow Updated");
    await lifecycle.setDefaultWarehouse(actor, "workflow-test", branch.id, warehouse.id, "Workflow verification");
    warehouseRows = await warehousesQuery.listWarehouses(actor, "workflow-test", store.id, branch.id);
    assert.equal(warehouseRows.filter(x => x.isDefault).length, 1);
    assert.equal(warehouseRows.find(x => x.isDefault).id, warehouse.id);
    console.log("PASS Warehouse: update + read-after-write + change default + invariant");

    await lifecycle.setDefaultBranch(actor, "workflow-test", store.id, branch.id, "Workflow verification");
    const finalBranches = await branchesQuery.listBranches(actor, "workflow-test", store.id);
    assert.equal(finalBranches.filter(x => x.isDefault).length, 1);
    assert.equal(finalBranches.find(x => x.isDefault).id, branch.id);
    console.log("PASS Branch: change default + invariant");
    console.log("PASS Full Store → Branch → Warehouse integration workflow completed on disposable PostgreSQL.");
  } finally {
    if (prisma) await prisma.$disconnect().catch(() => undefined);
    if (sql) await sql.end().catch(() => undefined);
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1", [database]).catch(() => undefined);
    await admin.query('DROP DATABASE IF EXISTS "' + database + '"').catch(() => undefined);
    await admin.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
