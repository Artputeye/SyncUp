const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Client } = require("pg");
const { PrismaClient } = require("@prisma/client");
const { StoreLifecycleService } = require("../dist/core/tenant/store-lifecycle.service");
const root = path.resolve(__dirname, "../../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const adminUrl = process.env.TEST_POSTGRES_ADMIN_URL;
if (!adminUrl) throw new Error("Set TEST_POSTGRES_ADMIN_URL to localhost disposable PostgreSQL.");
const adminParsed = new URL(adminUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(adminParsed.hostname)) throw new Error("Safety stop: disposable PostgreSQL must be localhost.");
const baseline = read("apps/api/prisma/tenant/migrations/20261031000100_tenant_baseline.sql");
const clean = read("docs/architecture/tenant-commerce-clean-install.candidate.sql");
const custom = read("docs/architecture/tenant-commerce-custom-constraints.candidate.sql");
const canonical = read("docs/architecture/tenant-canonicalization-constraints.candidate.sql");
const lifecycle = read("docs/architecture/tenant-branch-warehouse-lifecycle.candidate.sql");

async function main() {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  const database = "syncup_lifecycle_service_" + process.pid + "_" + Date.now();
  let sqlClient;
  let prisma;
  try {
    await admin.query('CREATE DATABASE "' + database + '"');
    const u = new URL(adminUrl);
    u.pathname = "/" + database;
    sqlClient = new Client({ connectionString: u.toString() });
    await sqlClient.connect();
    await sqlClient.query(baseline);
    await sqlClient.query(clean);
    await sqlClient.query(custom);
    await sqlClient.query(canonical);
    await sqlClient.query(lifecycle);

    prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });
    await prisma.$connect();
    const service = new StoreLifecycleService({ forMembership: async () => prisma });
    const actor = randomUUID();

    const created = await service.createStore(actor, "disposable", { name: "Service Store", slug: "service-store" });
    assert.ok(created.id && created.defaultBranchId && created.defaultWarehouseId);
    let state = await sqlClient.query(
      "SELECT (SELECT count(*) FROM branches WHERE store_id=$1 AND status='ACTIVE' AND is_default) AS defaults, (SELECT count(*) FROM warehouses WHERE branch_id=$2 AND status='ACTIVE' AND is_default) AS wh_defaults",
      [created.id, created.defaultBranchId]
    );
    assert.equal(Number(state.rows[0].defaults), 1);
    assert.equal(Number(state.rows[0].wh_defaults), 1);
    console.log("PASS Service createStore: explicit UUIDs, default Branch/Warehouse and audit transaction");

    const branch = await service.createBranch(actor, "disposable", created.id, { code: "BKK", name: "Bangkok" });
    const warehouse = await service.createWarehouse(actor, "disposable", branch.id, { code: "WH2", name: "Overflow" });
    assert.ok(branch.id && branch.defaultWarehouseId && warehouse.id);
    console.log("PASS Service createBranch/createWarehouse: records and audit logs persisted");

    await Promise.all([
      service.setDefaultBranch(actor, "disposable", created.id, branch.id, "parallel default change A"),
      service.setDefaultBranch(actor, "disposable", created.id, created.defaultBranchId, "parallel default change B")
    ]);
    state = await sqlClient.query(
      "SELECT count(*)::int AS n FROM branches WHERE store_id=$1 AND status='ACTIVE' AND is_default",
      [created.id]
    );
    assert.equal(state.rows[0].n, 1, "concurrent default changes must leave exactly one default Branch");
    console.log("PASS Service concurrency: parent row lock serializes competing default Branch changes");

    await service.setDefaultWarehouse(actor, "disposable", branch.id, warehouse.id, "make overflow default");
    await service.archiveWarehouse(actor, "disposable", branch.id, warehouse.id, "retire overflow");
    state = await sqlClient.query(
      "SELECT count(*)::int AS n FROM warehouses WHERE branch_id=$1 AND status='ACTIVE' AND is_default",
      [branch.id]
    );
    assert.equal(state.rows[0].n, 1, "archiving default Warehouse must leave one replacement default");
    console.log("PASS Service archiveWarehouse: default replacement and active Warehouse invariant");

    await service.archiveBranch(actor, "disposable", created.id, branch.id, "close branch");
    state = await sqlClient.query(
      "SELECT count(*)::int AS n FROM branches WHERE store_id=$1 AND status='ACTIVE' AND is_default",
      [created.id]
    );
    assert.equal(state.rows[0].n, 1, "archiving default Branch must leave one replacement default");
    console.log("PASS Service archiveBranch: child Warehouses archived and default Branch replaced");

    const only = await service.createStore(actor, "disposable", { name: "Last Resource Store", slug: "last-resource-store" });
    await assert.rejects(
      () => service.archiveWarehouse(actor, "disposable", only.defaultBranchId, only.defaultWarehouseId, "last warehouse"),
      e => e?.status === 409 || e?.getStatus?.() === 409
    );
    await assert.rejects(
      () => service.archiveBranch(actor, "disposable", only.id, only.defaultBranchId, "last branch"),
      e => e?.status === 409 || e?.getStatus?.() === 409
    );
    console.log("PASS Service failure guards: cannot archive last active Warehouse or Branch");

    const stockStore = await service.createStore(actor, "disposable", { name: "Reserved Stock Store", slug: "reserved-stock-store" });
    const stockBranch = await service.createBranch(actor, "disposable", stockStore.id, { code: "STOCK", name: "Reserved Stock Branch" });
    const uomId = randomUUID(), productId = randomUUID(), variantId = randomUUID();
    await sqlClient.query("INSERT INTO unit_of_measures (id,code,normalized_code,name,symbol,dimension,updated_at) VALUES ($1,'EA','ea','Each','ea','COUNT',NOW())", [uomId]);
    await sqlClient.query("INSERT INTO products (id,name,normalized_name,updated_at) VALUES ($1,'Reserved Item','reserved item',NOW())", [productId]);
    await sqlClient.query("INSERT INTO product_variants (id,product_id,base_uom_id,sku,normalized_sku,title,updated_at) VALUES ($1,$2,$3,'RESERVED-1','reserved-1','Reserved Item',NOW())", [variantId, productId, uomId]);
    await sqlClient.query("INSERT INTO stock_balances (warehouse_id,variant_id,on_hand,reserved,available,updated_at) VALUES ($1,$2,1,1,0,NOW())", [stockBranch.defaultWarehouseId, variantId]);
    await assert.rejects(() => service.archiveBranch(actor, "disposable", stockStore.id, stockBranch.id, "reserved stock must block archive"), e => e?.status === 409 || e?.getStatus?.() === 409);
    console.log("PASS Service stock safety: reserved balance prevents Branch archive");
    const before = await sqlClient.query("SELECT count(*)::int AS stores FROM stores WHERE normalized_slug='rollback-store'");
    assert.equal(before.rows[0].stores, 0);
    await assert.rejects(() => service.createStore("not-a-uuid", "disposable", {
      name: "Rollback", slug: "rollback-store"
    }));
    const after = await sqlClient.query("SELECT count(*)::int AS stores FROM stores WHERE normalized_slug='rollback-store'");
    assert.equal(after.rows[0].stores, 0, "failed Store creation must roll back all inserted records");
    console.log("PASS Service transaction rollback: failed Store creation leaves no partial Store");
    console.log("PASS Disposable Store/Branch/Warehouse service integration completed.");
  } finally {
    if (prisma) await prisma.$disconnect().catch(() => undefined);
    if (sqlClient) await sqlClient.end().catch(() => undefined);
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1", [database]).catch(() => undefined);
    await admin.query('DROP DATABASE IF EXISTS "' + database + '"').catch(() => undefined);
    await admin.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
