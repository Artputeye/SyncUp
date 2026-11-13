"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { createHash, randomBytes } = require("node:crypto");
const { Client } = require("pg");

const WORKSPACE = { id: "c0130bf3-c1c0-4dfa-a915-7ca5155cacfd", slug: "pos-local", db: "syncup_ws_c0130bf3c1c0", runtimeRole: "syncup_rt_c0130bf3c1c0" };
const APPROVED = [
  { version: "20261111000100_tenant_sales_orders", file: "../prisma/tenant/migrations/20261111000100_tenant_sales_orders.sql", sha256: "5bf9eaed524b37d39b3ce0aa4881235fca85a819b226213ba161e1e3fdd6244a" },
  { version: "20261111000200_tenant_sales_returns", file: "../prisma/tenant/migrations/20261111000200_tenant_sales_returns.sql", sha256: "c5af8a5e5e1b67e78b96e5e8fddd9d7a574e847a381e2bb0bd7f48c9fd2b2081" },
  { version: "20261111000300_tenant_sales_payments_refunds", file: "../prisma/tenant/migrations/20261111000300_tenant_sales_payments_refunds.sql", sha256: "b80fb997628e5d545e2ab46bf3ba4351437bc067c980e758cdc8a8da475425ee" },
];
const BASE_LEDGER = [
  "20261031000100_tenant_baseline",
  "202611030001_tenant_commerce",
  "20261107000100_tenant_inventory_stocktake",
];
const BACKUP_DIR = "D:\\Back up\\SyncUp\\Backups";
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backupPath = path.join(BACKUP_DIR, "pos-local_pre_sales_activation_" + stamp + ".dump");
const manifestPath = path.join(BACKUP_DIR, "pos-local_pre_sales_activation_" + stamp + ".manifest.json");
const rehearsalDb = "syncup_sales_activation_check_" + stamp + "_" + randomBytes(3).toString("hex");
const migrationRoot = path.resolve(__dirname, "../prisma/tenant/migrations");

function check(v, m) { assert.ok(v, m); }
function sha(b) { return createHash("sha256").update(b).digest("hex"); }
function dbUrl(base, db) { const u = new URL(base.toString()); u.pathname = "/" + db; return u; }
function ident(v) { return '"' + v.replace(/"/g, '""') + '"'; }
function cliArgs(url, db) { return ["--host", url.hostname, "--port", url.port || "5432", "--username", decodeURIComponent(url.username), "--dbname", db, "--no-password"]; }
function run(name, args, env) {
  const r = spawnSync(name, args, { encoding: "utf8", windowsHide: true, env, maxBuffer: 32 * 1024 * 1024 });
  check(!r.error && r.status === 0, name + " failed: " + (r.error?.message || r.stderr || r.stdout));
  return r.stdout || "";
}
async function connect(url, app, readOnly = false) {
  const c = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 10000, application_name: app,
    ...(readOnly ? { options: "-c default_transaction_read_only=on" } : {}) });
  await c.connect(); return c;
}
async function readState(c) {
  const r = await c.query(
    "SELECT (SELECT array_agg(version ORDER BY version) FROM public.tenant_migrations) ledger," +
    "(SELECT count(*)::int FROM public.tenant_migrations) ledger_count," +
    "(SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public') table_count," +
    "EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='product_variants' AND column_name='tax_category_id') tax_category_id," +
    "(SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_name IN " +
    "('order_sequences','sales_orders','sales_order_items','sales_returns','sales_return_items','sales_payments','sales_refunds')) sales_tables," +
    "(SELECT count(*)::int FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname IN " +
    "('SalesOrderStatus','SalesReturnStatus','SalesPaymentMethod','SalesPaymentStatus')) sales_types"
  );
  return r.rows[0];
}
async function verifyPost(c) {
  const state = await readState(c);
  assert.deepEqual(state.ledger, [...BASE_LEDGER, ...APPROVED.map(x => x.version)], "Final Tenant migration lineage mismatch.");
  assert.equal(state.ledger_count, 6);
  assert.equal(state.sales_tables, 7);
  assert.equal(state.sales_types, 4);
  assert.equal(state.tax_category_id, true);
  const enums = await c.query(
    "SELECT t.typname, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) labels FROM pg_type t " +
    "JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid " +
    "WHERE n.nspname='public' AND t.typname IN ('SalesOrderStatus','SalesReturnStatus','SalesPaymentMethod','SalesPaymentStatus') GROUP BY t.typname"
  );
  const labels = Object.fromEntries(enums.rows.map(x => [x.typname, x.labels]));
  assert.deepEqual(labels, {
    SalesOrderStatus: ["RESERVED","CANCELLED","POSTED"],
    SalesReturnStatus: ["POSTED","CANCELLED"],
    SalesPaymentMethod: ["CASH","CARD","BANK_TRANSFER","OTHER"],
    SalesPaymentStatus: ["CAPTURED","PARTIALLY_REFUNDED","REFUNDED"],
  }, "Sales enum labels mismatch.");
  const columns = await c.query(
    "SELECT " +
    "(SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_orders' AND column_name IN ('posted_by','posted_at','posting_idempotency_key')) post_columns," +
    "(SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_order_items' AND column_name IN ('unit_cost_snapshot','total_cost_snapshot')) cost_columns"
  );
  assert.equal(columns.rows[0].post_columns, 3);
  assert.equal(columns.rows[0].cost_columns, 2);
  const integrity = await c.query(
    "SELECT " +
    "(SELECT count(*)::int FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='f' AND conrelid::regclass::text IN " +
    "('sales_orders','sales_order_items','sales_returns','sales_return_items','sales_payments','sales_refunds')) foreign_keys," +
    "(SELECT count(*)::int FROM pg_indexes WHERE schemaname='public' AND tablename IN " +
    "('order_sequences','sales_orders','sales_order_items','sales_returns','sales_return_items','sales_payments','sales_refunds')) indexes"
  );
  assert.ok(integrity.rows[0].foreign_keys >= 20, "Sales foreign-key count below rehearsal baseline.");
  assert.ok(integrity.rows[0].indexes >= 29, "Sales index count below rehearsal baseline.");
  const rows = await c.query(
    "SELECT (SELECT count(*)::int FROM sales_orders) orders," +
    "(SELECT count(*)::int FROM sales_order_items) order_items," +
    "(SELECT count(*)::int FROM sales_returns) returns," +
    "(SELECT count(*)::int FROM sales_return_items) return_items," +
    "(SELECT count(*)::int FROM sales_payments) payments," +
    "(SELECT count(*)::int FROM sales_refunds) refunds"
  );
  assert.deepEqual(rows.rows[0], { orders: 0, order_items: 0, returns: 0, return_items: 0, payments: 0, refunds: 0 },
    "New Sales business tables unexpectedly contain data.");
  const grants = await c.query(
    "SELECT has_database_privilege($1,current_database(),'CONNECT') can_connect," +
    "has_schema_privilege($1,'public','USAGE') schema_usage," +
    "has_table_privilege($1,'public.order_sequences','SELECT') order_sequences_select," +
    "has_table_privilege($1,'public.order_sequences','INSERT') order_sequences_insert," +
    "has_table_privilege($1,'public.order_sequences','UPDATE') order_sequences_update," +
    "has_table_privilege($1,'public.order_sequences','DELETE') order_sequences_delete," +
    "has_table_privilege($1,'public.sales_orders','SELECT') sales_orders_select," +
    "has_table_privilege($1,'public.sales_orders','INSERT') sales_orders_insert," +
    "has_table_privilege($1,'public.sales_orders','UPDATE') sales_orders_update," +
    "has_table_privilege($1,'public.sales_orders','DELETE') sales_orders_delete," +
    "has_table_privilege($1,'public.sales_order_items','SELECT') sales_items_select," +
    "has_table_privilege($1,'public.sales_order_items','INSERT') sales_items_insert," +
    "has_table_privilege($1,'public.sales_order_items','UPDATE') sales_items_update," +
    "has_table_privilege($1,'public.sales_order_items','DELETE') sales_items_delete," +
    "has_table_privilege($1,'public.sales_returns','SELECT') sales_returns_select," +
    "has_table_privilege($1,'public.sales_returns','INSERT') sales_returns_insert," +
    "has_table_privilege($1,'public.sales_returns','UPDATE') sales_returns_update," +
    "has_table_privilege($1,'public.sales_returns','DELETE') sales_returns_delete," +
    "has_table_privilege($1,'public.sales_return_items','SELECT') sales_return_items_select," +
    "has_table_privilege($1,'public.sales_return_items','INSERT') sales_return_items_insert," +
    "has_table_privilege($1,'public.sales_return_items','UPDATE') sales_return_items_update," +
    "has_table_privilege($1,'public.sales_return_items','DELETE') sales_return_items_delete," +
    "has_table_privilege($1,'public.sales_payments','SELECT') sales_payments_select," +
    "has_table_privilege($1,'public.sales_payments','INSERT') sales_payments_insert," +
    "has_table_privilege($1,'public.sales_payments','UPDATE') sales_payments_update," +
    "has_table_privilege($1,'public.sales_payments','DELETE') sales_payments_delete," +
    "has_table_privilege($1,'public.sales_refunds','SELECT') sales_refunds_select," +
    "has_table_privilege($1,'public.sales_refunds','INSERT') sales_refunds_insert," +
    "has_table_privilege($1,'public.sales_refunds','UPDATE') sales_refunds_update," +
    "has_table_privilege($1,'public.sales_refunds','DELETE') sales_refunds_delete," +
    "has_table_privilege($1,'public.tenant_migrations','SELECT') ledger_select," +
    "has_table_privilege($1,'public.tenant_migrations','INSERT') ledger_insert",
    [WORKSPACE.runtimeRole]
  );
  for (const [k,v] of Object.entries(grants.rows[0])) {
    if (k === "ledger_insert") assert.equal(v, false, "Runtime role must not insert into migration ledger.");
    else assert.equal(v, true, "Runtime grant missing: " + k);
  }
  return { state, enums: labels, columns: columns.rows[0], integrity: integrity.rows[0], rows: rows.rows[0], runtimeGrants: grants.rows[0] };
}

async function main() {
  const args = process.argv.slice(2);
  check(process.platform === "win32", "This activation is restricted to the approved Windows host.");
  check(args.includes("--live"), "Live mode is required.");
  check(args.includes("--confirm-workspace") && args[args.indexOf("--confirm-workspace")+1] === WORKSPACE.slug,
    "Exact workspace confirmation is required.");
  const confirmMigrations = args[args.indexOf("--confirm-migrations")+1];
  check(args.includes("--confirm-migrations") && confirmMigrations === APPROVED.map(x=>x.version).join(","),
    "Exact three-migration confirmation is required.");
  const controlUrl = new URL(process.env.CONTROL_DATABASE_URL || "");
  const adminUrl = new URL(process.env.WORKSPACE_DATABASE_ADMIN_URL || "");
  check(process.env.CONTROL_DATABASE_URL && process.env.WORKSPACE_DATABASE_ADMIN_URL, "Database URLs are missing.");
  for (const u of [controlUrl, adminUrl]) check(["localhost","127.0.0.1","::1"].includes(u.hostname), "Only local DB endpoints are permitted.");
  check(controlUrl.pathname === "/syncup_control", "Unexpected Control database.");
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  check(!fs.existsSync(backupPath) && !fs.existsSync(manifestPath), "Backup path collision; refusing overwrite.");
  const migrationInfo = APPROVED.map(m => {
    const bytes = fs.readFileSync(path.join(migrationRoot, path.basename(m.file)));
    const actual = sha(bytes);
    assert.equal(actual, m.sha256, "Migration checksum differs from the rehearsed and approved file: " + m.version);
    return { version: m.version, file: path.basename(m.file), sha256: actual, sql: bytes.toString("utf8") };
  });
  const control = await connect(controlUrl, "syncup-pos-local-sales-activation-control", true);
  let source, tenant, cloneAdmin, clone, cloneCreated = false, lockAcquired = false, manifest;
  try {
    await control.query("BEGIN READ ONLY");
    const reg = await control.query(
      "SELECT w.id,w.slug,w.status,d.database_name,d.username runtime_role FROM public.workspaces w " +
      "JOIN public.workspace_databases d ON d.workspace_id=w.id WHERE w.id=$1", [WORKSPACE.id]
    );
    assert.equal(reg.rowCount, 1, "Workspace registration missing.");
    assert.deepEqual(reg.rows[0], {
      id: WORKSPACE.id, slug: WORKSPACE.slug, status: "ACTIVE", database_name: WORKSPACE.db, runtime_role: WORKSPACE.runtimeRole
    }, "Control registration identity mismatch.");
    await control.query("COMMIT");

    source = await connect(dbUrl(adminUrl, WORKSPACE.db), "syncup-pos-local-sales-backup-source", true);
    await source.query("BEGIN READ ONLY");
    const identity = await source.query("SELECT current_database() db,current_user role,current_setting('transaction_read_only') read_only");
    assert.deepEqual(identity.rows[0], { db: WORKSPACE.db, role: "syncup_provisioner", read_only: "on" },
      "Backup source identity/read-only guard failed.");
    const before = await readState(source);
    assert.deepEqual(before.ledger, BASE_LEDGER, "Tenant ledger changed since readiness rehearsal.");
    assert.equal(before.ledger_count, 3);
    assert.equal(before.tax_category_id, false);
    assert.equal(before.sales_tables, 0);
    assert.equal(before.sales_types, 0);
    await source.query("COMMIT");

    const env = { ...process.env, PGPASSWORD: decodeURIComponent(adminUrl.password) };
    run("pg_dump", [...cliArgs(adminUrl, WORKSPACE.db), "--format=custom", "--no-owner", "--no-acl", "--file", backupPath], env);
    check(fs.existsSync(backupPath) && fs.statSync(backupPath).size > 0, "Fresh pg_dump output missing.");
    const archiveList = run("pg_restore", ["--list", backupPath], env);
    check(archiveList.includes("TABLE DATA") && archiveList.includes("tenant_migrations"), "Fresh backup archive validation failed.");
    const backupHash = sha(fs.readFileSync(backupPath));
    manifest = {
      status: "BACKUP_VERIFIED",
      workspace: { id: WORKSPACE.id, slug: WORKSPACE.slug, status: "ACTIVE" },
      sourceDatabase: WORKSPACE.db, sourceRole: "syncup_provisioner", runtimeRole: WORKSPACE.runtimeRole,
      preMigrationLedger: before.ledger, migrations: migrationInfo.map(({version,file,sha256})=>({version,file,sha256})),
      backup: { file: path.basename(backupPath), path: backupPath, format: "pg_dump custom",
        sizeBytes: fs.statSync(backupPath).size, sha256: backupHash, createdAt: new Date().toISOString(), archiveListVerified: true },
      activationApproved: true, applied: [],
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + os.EOL, { flag: "wx" });

    cloneAdmin = await connect(adminUrl, "syncup-pos-local-sales-backup-restore-check");
    const collision = await cloneAdmin.query("SELECT 1 FROM pg_database WHERE datname=$1", [rehearsalDb]);
    assert.equal(collision.rowCount, 0, "Backup restore-check database name already exists.");
    await cloneAdmin.query("CREATE DATABASE " + ident(rehearsalDb));
    cloneCreated = true;
    run("pg_restore", ["--exit-on-error", "--no-owner", "--no-acl", ...cliArgs(adminUrl, rehearsalDb), backupPath], env);
    clone = await connect(dbUrl(adminUrl, rehearsalDb), "syncup-pos-local-sales-backup-restore-verify");
    const cloneIdentity = await clone.query("SELECT current_database() db,current_user role");
    assert.deepEqual(cloneIdentity.rows[0], { db: rehearsalDb, role: "syncup_provisioner" });
    const restoredState = await readState(clone);
    assert.deepEqual(restoredState.ledger, BASE_LEDGER, "Fresh backup restore ledger mismatch.");
    assert.equal(restoredState.ledger_count, 3);
    assert.equal(restoredState.sales_tables, 0);
    assert.equal(restoredState.sales_types, 0);
    assert.equal(restoredState.tax_category_id, false);
    await clone.end(); clone = null;
    await cloneAdmin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [rehearsalDb]);
    await cloneAdmin.query("DROP DATABASE " + ident(rehearsalDb));
    cloneCreated = false;
    const restoreCleanup = await cloneAdmin.query("SELECT 1 FROM pg_database WHERE datname=$1", [rehearsalDb]);
    assert.equal(restoreCleanup.rowCount, 0, "Fresh backup restore-check database cleanup failed.");
    manifest.backup.restoreVerified = true;
    manifest.backup.restoredBaseline = restoredState;
    manifest.backup.restoreCheckDatabaseDropped = true;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + os.EOL);
    await cloneAdmin.end(); cloneAdmin = null;

    tenant = await connect(dbUrl(adminUrl, WORKSPACE.db), "syncup-pos-local-sales-migration-activation");
    const lock = await tenant.query("SELECT pg_try_advisory_lock(hashtext($1)) acquired", [WORKSPACE.db]);
    assert.equal(lock.rows[0].acquired, true, "Tenant migration advisory lock is already held.");
    lockAcquired = true;
    const liveIdentity = await tenant.query("SELECT current_database() db,current_user role");
    assert.deepEqual(liveIdentity.rows[0], { db: WORKSPACE.db, role: "syncup_provisioner" });
    const lockedBefore = await readState(tenant);
    assert.deepEqual(lockedBefore.ledger, BASE_LEDGER, "Tenant ledger changed after fresh backup; stop without applying.");
    assert.equal(lockedBefore.sales_tables, 0);
    assert.equal(lockedBefore.sales_types, 0);

    await tenant.query("BEGIN");
    try {
      for (const m of migrationInfo) {
        await tenant.query(m.sql);
        await tenant.query("INSERT INTO public.tenant_migrations(version) VALUES ($1)", [m.version]);
        manifest.applied.push(m.version);
        manifest.status = "APPLYING";
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + os.EOL);
      }
      const verification = await verifyPost(tenant);
      await tenant.query("COMMIT");
      manifest.status = "APPLIED_VERIFIED";
      manifest.postMigration = verification;
      manifest.completedAt = new Date().toISOString();
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + os.EOL);
    } catch (error) {
      await tenant.query("ROLLBACK").catch(() => undefined);
      manifest.status = "ROLLED_BACK";
      manifest.applied = [];
      manifest.error = error.message;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + os.EOL);
      throw error;
    }

    await tenant.query("BEGIN READ ONLY");
    const committed = await verifyPost(tenant);
    await tenant.query("COMMIT");
    manifest.status = "PASS";
    manifest.postCommitVerification = committed;
    manifest.backupHashRechecked = sha(fs.readFileSync(backupPath)) === backupHash;
    assert.equal(manifest.backupHashRechecked, true, "Fresh backup hash changed during activation.");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + os.EOL);
    console.log("POS_LOCAL_SALES_MIGRATION_ACTIVATION=PASS");
    console.log(JSON.stringify({
      workspace: manifest.workspace, tenantDatabase: WORKSPACE.db,
      backup: manifest.backup, migrations: manifest.migrations,
      postMigration: committed, backupHashRechecked: manifest.backupHashRechecked,
      liveTenantMutated: true, controlDatabaseMutated: false, manifestPath,
    }, null, 2));
  } catch (error) {
    if (manifest && manifest.status !== "ROLLED_BACK") {
      manifest.status = manifest.status === "BACKUP_VERIFIED" ? "NOT_APPLIED" : "FAILED_REVIEW_REQUIRED";
      manifest.error = error.message;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + os.EOL);
    }
    throw error;
  } finally {
    if (tenant && lockAcquired) await tenant.query("SELECT pg_advisory_unlock(hashtext($1))", [WORKSPACE.db]).catch(()=>undefined);
    if (tenant) await tenant.end().catch(()=>undefined);
    if (clone) await clone.end().catch(()=>undefined);
    if (cloneAdmin && cloneCreated) {
      await cloneAdmin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [rehearsalDb]).catch(()=>undefined);
      await cloneAdmin.query("DROP DATABASE IF EXISTS " + ident(rehearsalDb)).catch(()=>undefined);
    }
    if (cloneAdmin) await cloneAdmin.end().catch(()=>undefined);
    if (source) await source.end().catch(()=>undefined);
    await control.end().catch(()=>undefined);
  }
}
main().catch(e=>{ console.error("POS_LOCAL_SALES_MIGRATION_ACTIVATION_FAILED " + (e.stack || e.message)); process.exitCode=1; });
