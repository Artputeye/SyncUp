"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { randomBytes, createHash } = require("node:crypto");
const { Client } = require("pg");

const WORKSPACE_ID = "c0130bf3-c1c0-4dfa-a915-7ca5155cacfd";
const WORKSPACE_SLUG = "pos-local";
const SOURCE_DB = "syncup_ws_c0130bf3c1c0";
const RUNTIME_ROLE = "syncup_rt_c0130bf3c1c0";
const PROVISIONER_ROLE = "syncup_provisioner";
const MIGRATIONS = [
  { version: "20261111000100_tenant_sales_orders", file: "../prisma/tenant/migrations/20261111000100_tenant_sales_orders.sql" },
  { version: "20261111000200_tenant_sales_returns", file: "../prisma/tenant/migrations/20261111000200_tenant_sales_returns.sql" },
  { version: "20261111000300_tenant_sales_payments_refunds", file: "../prisma/tenant/migrations/20261111000300_tenant_sales_payments_refunds.sql" },
];
const BACKUP_DIR = "D:\\Back up\\SyncUp\\Backups";
const root = path.resolve(__dirname, "..");
const read = p => fs.readFileSync(path.resolve(__dirname, p), "utf8");
const sha = b => createHash("sha256").update(b).digest("hex");
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backupBase = "pos-local_pre_sales_" + stamp;
const backupPath = path.join(BACKUP_DIR, backupBase + ".dump");
const manifestPath = path.join(BACKUP_DIR, backupBase + ".manifest.json");
const rehearsalDb = "syncup_sales_rehearsal_" + stamp + "_" + randomBytes(3).toString("hex");

function check(value, message) { assert.ok(value, message); }
function run(name, args, env) {
  const result = spawnSync(name, args, { encoding: "utf8", windowsHide: true, env, maxBuffer: 32 * 1024 * 1024 });
  check(!result.error && result.status === 0, name + " failed: " + (result.error?.message || result.stderr || result.stdout));
  return result.stdout || "";
}
function cliArgs(url, db) {
  return ["--host", url.hostname, "--port", url.port || "5432", "--username", decodeURIComponent(url.username), "--dbname", db, "--no-password"];
}
async function connect(url, app, readOnly = false) {
  const c = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 10000, application_name: app,
    ...(readOnly ? { options: "-c default_transaction_read_only=on" } : {}) });
  await c.connect();
  return c;
}
function dbUrl(base, db) { const u = new URL(base.toString()); u.pathname = "/" + db; return u; }
function ident(s) { return '"' + s.replace(/"/g, '""') + '"'; }

async function main() {
  check(process.platform === "win32", "This operation is approved only on the configured Windows workstation.");
  const controlUrl = new URL(process.env.CONTROL_DATABASE_URL || "");
  const adminUrl = new URL(process.env.WORKSPACE_DATABASE_ADMIN_URL || "");
  check(process.env.CONTROL_DATABASE_URL && process.env.WORKSPACE_DATABASE_ADMIN_URL, "Required DB URLs are missing.");
  for (const u of [controlUrl, adminUrl]) check(["localhost", "127.0.0.1", "::1"].includes(u.hostname), "Database endpoints must be local.");
  check(controlUrl.pathname === "/syncup_control", "Unexpected Control database identity.");
  check(path.resolve(BACKUP_DIR) === path.resolve("D:\\Back up\\SyncUp\\Backups"), "Backup directory safety guard failed.");
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  check(!fs.existsSync(backupPath) && !fs.existsSync(manifestPath), "Backup path already exists; refusing overwrite.");

  const control = await connect(controlUrl, "syncup-pos-local-sales-readiness-control", true);
  let source, admin, rehearsal, restoreCreated = false, backupCreated = false;
  try {
    await control.query("BEGIN READ ONLY");
    const reg = await control.query(
      "SELECT w.id,w.slug,w.status,d.database_name,d.username runtime_role " +
      "FROM public.workspaces w JOIN public.workspace_databases d ON d.workspace_id=w.id WHERE w.id=$1",
      [WORKSPACE_ID],
    );
    check(reg.rowCount === 1, "Workspace registration missing.");
    assert.deepEqual(reg.rows[0], {
      id: WORKSPACE_ID, slug: WORKSPACE_SLUG, status: "ACTIVE",
      database_name: SOURCE_DB, runtime_role: RUNTIME_ROLE,
    }, "Control registry identity mismatch.");
    await control.query("COMMIT");

    source = await connect(dbUrl(adminUrl, SOURCE_DB), "syncup-pos-local-sales-source", true);
    await source.query("BEGIN READ ONLY");
    const identity = await source.query(
      "SELECT current_database() db,current_user role,current_setting('transaction_read_only') read_only",
    );
    assert.deepEqual(identity.rows[0], { db: SOURCE_DB, role: PROVISIONER_ROLE, read_only: "on" },
      "Source Tenant identity/read-only guard failed.");
    const pre = await source.query(
      "SELECT (SELECT array_agg(version ORDER BY version) FROM public.tenant_migrations) ledger," +
      "(SELECT count(*)::int FROM public.tenant_migrations) ledger_count," +
      "(SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public') table_count," +
      "EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='product_variants' AND column_name='tax_category_id') tax_category_id," +
      "(SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_name IN " +
      "('sales_orders','sales_order_items','sales_returns','sales_return_items','sales_payments','sales_refunds','order_sequences')) sales_tables," +
      "(SELECT count(*)::int FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname IN " +
      "('SalesOrderStatus','SalesReturnStatus','SalesPaymentMethod','SalesPaymentStatus')) sales_types",
    );
    const before = pre.rows[0];
    assert.deepEqual(before.ledger, [
      "20261031000100_tenant_baseline",
      "202611030001_tenant_commerce",
      "20261107000100_tenant_inventory_stocktake",
    ], "Tenant migration ledger differs from reviewed pos-local baseline.");
    assert.equal(before.ledger_count, 3);
    assert.equal(before.tax_category_id, false, "Sales migration appears partially applied.");
    assert.equal(before.sales_tables, 0, "Sales tables already exist; refusing to layer candidate SQL.");
    assert.equal(before.sales_types, 0, "Sales enum types already exist; refusing to layer candidate SQL.");
    await source.query("COMMIT");

    const env = { ...process.env, PGPASSWORD: decodeURIComponent(adminUrl.password) };
    run("pg_dump", [...cliArgs(adminUrl, SOURCE_DB), "--format=custom", "--no-owner", "--no-acl", "--file", backupPath], env);
    check(fs.existsSync(backupPath) && fs.statSync(backupPath).size > 0, "pg_dump did not create a valid backup.");
    backupCreated = true;
    const archive = run("pg_restore", ["--list", backupPath], env);
    check(archive.includes("TABLE DATA") && archive.includes("tenant_migrations"), "Backup archive list is incomplete.");
    const backupInfo = {
      file: path.basename(backupPath), path: backupPath, format: "pg_dump custom",
      sizeBytes: fs.statSync(backupPath).size, sha256: sha(fs.readFileSync(backupPath)),
      createdAt: new Date().toISOString(), archiveListVerified: true,
    };
    const migrationInfo = MIGRATIONS.map(m => ({ version: m.version, sha256: sha(read(m.file)), file: path.basename(m.file) }));
    const manifest = {
      status: "BACKUP_VERIFIED_REHEARSAL_PENDING",
      workspace: { id: WORKSPACE_ID, slug: WORKSPACE_SLUG, status: "ACTIVE" },
      sourceDatabase: SOURCE_DB, sourceRole: PROVISIONER_ROLE, runtimeRole: RUNTIME_ROLE,
      preMigrationState: before, migrations: migrationInfo, backup: backupInfo,
      rehearsalDatabase: rehearsalDb, encryption: "Not verified; do not treat this local backup as encrypted.",
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + os.EOL, { flag: "wx" });

    admin = await connect(adminUrl, "syncup-pos-local-sales-rehearsal-admin");
    const role = await admin.query("SELECT rolname FROM pg_roles WHERE rolname=$1", [RUNTIME_ROLE]);
    check(role.rowCount === 1, "Existing runtime role is missing; no global role will be created.");
    const dbExists = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [rehearsalDb]);
    check(dbExists.rowCount === 0, "Disposable rehearsal database name already exists.");
    await admin.query("CREATE DATABASE " + ident(rehearsalDb) + " TEMPLATE template0");
    restoreCreated = true;
    run("pg_restore", ["--exit-on-error", "--no-owner", "--no-acl", ...cliArgs(adminUrl, rehearsalDb), backupPath], env);

    rehearsal = await connect(dbUrl(adminUrl, rehearsalDb), "syncup-pos-local-sales-rehearsal");
    const rehearsalIdentity = await rehearsal.query("SELECT current_database() db,current_user role");
    assert.deepEqual(rehearsalIdentity.rows[0], { db: rehearsalDb, role: PROVISIONER_ROLE });
    const clonePre = await rehearsal.query(
      "SELECT (SELECT array_agg(version ORDER BY version) FROM public.tenant_migrations) ledger," +
      "EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='product_variants' AND column_name='tax_category_id') tax_category_id," +
      "(SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_name IN " +
      "('sales_orders','sales_order_items','sales_returns','sales_return_items','sales_payments','sales_refunds','order_sequences')) sales_tables",
    );
    assert.deepEqual(clonePre.rows[0].ledger, before.ledger, "Restored clone ledger differs from source.");
    assert.equal(clonePre.rows[0].tax_category_id, false);
    assert.equal(clonePre.rows[0].sales_tables, 0);

    const applied = [];
    for (const migration of MIGRATIONS) {
      await rehearsal.query("BEGIN");
      try {
        await rehearsal.query(read(migration.file));
        await rehearsal.query("INSERT INTO public.tenant_migrations(version) VALUES ($1)", [migration.version]);
        await rehearsal.query("COMMIT");
        applied.push(migration.version);
      } catch (error) {
        await rehearsal.query("ROLLBACK").catch(() => undefined);
        throw new Error("Migration rehearsal failed at " + migration.version + ": " + error.message);
      }
    }

    const post = await rehearsal.query(
      "SELECT (SELECT array_agg(version ORDER BY version) FROM public.tenant_migrations) ledger," +
      "(SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_name IN " +
      "('order_sequences','sales_orders','sales_order_items','sales_returns','sales_return_items','sales_payments','sales_refunds')) sales_tables," +
      "(SELECT count(*)::int FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname IN " +
      "('SalesOrderStatus','SalesReturnStatus','SalesPaymentMethod','SalesPaymentStatus')) sales_types," +
      "EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='product_variants' AND column_name='tax_category_id') tax_category_id," +
      "(SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_orders' AND column_name IN ('posted_by','posted_at','posting_idempotency_key')) post_columns," +
      "(SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_order_items' AND column_name IN ('unit_cost_snapshot','total_cost_snapshot')) cost_columns," +
      "(SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_name IN " +
      "('sales_orders','sales_order_items','sales_returns','sales_return_items','sales_payments','sales_refunds') AND table_type='BASE TABLE') business_tables",
    );
    const after = post.rows[0];
    assert.deepEqual(after.ledger, [...before.ledger, ...MIGRATIONS.map(m => m.version)].sort(),
      "Rehearsal migration ledger mismatch.");
    assert.equal(after.sales_tables, 7, "Expected 7 Sales tables including order_sequences.");
    assert.equal(after.sales_types, 4, "Expected all 4 Sales enums.");
    assert.equal(after.tax_category_id, true);
    assert.equal(after.post_columns, 3);
    assert.equal(after.cost_columns, 2);
    assert.equal(after.business_tables, 6);

    const fk = await rehearsal.query(
      "SELECT count(*)::int count FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace " +
      "WHERE n.nspname='public' AND c.contype='f' AND c.conrelid::regclass::text IN " +
      "('sales_orders','sales_order_items','sales_returns','sales_return_items','sales_payments','sales_refunds')",
    );
    check(fk.rows[0].count >= 20, "Expected Sales FK constraints are missing.");
    const indexes = await rehearsal.query(
      "SELECT count(*)::int count FROM pg_indexes WHERE schemaname='public' AND tablename IN " +
      "('order_sequences','sales_orders','sales_order_items','sales_returns','sales_return_items','sales_payments','sales_refunds')",
    );
    check(indexes.rows[0].count >= 25, "Expected Sales indexes are missing.");

    const roleName = ident(RUNTIME_ROLE);
    await rehearsal.query("GRANT USAGE ON SCHEMA public TO " + roleName);
    await rehearsal.query("GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO " + roleName);
    await rehearsal.query("REVOKE INSERT,UPDATE,DELETE ON public.tenant_migrations FROM " + roleName);
    await rehearsal.query("GRANT SELECT ON public.tenant_migrations TO " + roleName);
    await rehearsal.query("GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO " + roleName);
    await rehearsal.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO " + roleName);
    await rehearsal.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO " + roleName);
    const privileges = await rehearsal.query(
      "SELECT has_schema_privilege($1,'public','USAGE') schema_usage," +
      "has_table_privilege($1,'public.sales_orders','SELECT,INSERT,UPDATE,DELETE') sales_orders_dml," +
      "has_table_privilege($1,'public.sales_order_items','SELECT,INSERT,UPDATE,DELETE') sales_items_dml," +
      "has_table_privilege($1,'public.sales_returns','SELECT,INSERT,UPDATE,DELETE') sales_returns_dml," +
      "has_table_privilege($1,'public.sales_payments','SELECT,INSERT,UPDATE,DELETE') sales_payments_dml," +
      "has_table_privilege($1,'public.sales_refunds','SELECT,INSERT,UPDATE,DELETE') sales_refunds_dml," +
      "has_table_privilege($1,'public.tenant_migrations','SELECT') ledger_select," +
      "has_table_privilege($1,'public.tenant_migrations','INSERT') ledger_insert",
      [RUNTIME_ROLE],
    );
    const grants = privileges.rows[0];
    for (const key of ["schema_usage","sales_orders_dml","sales_items_dml","sales_returns_dml","sales_payments_dml","sales_refunds_dml","ledger_select"]) {
      assert.equal(grants[key], true, "Runtime grant missing: " + key);
    }
    assert.equal(grants.ledger_insert, false, "Runtime role must not write Tenant migration ledger.");

    const counts = await rehearsal.query(
      "SELECT (SELECT count(*)::int FROM sales_orders) orders," +
      "(SELECT count(*)::int FROM sales_order_items) order_items," +
      "(SELECT count(*)::int FROM sales_returns) returns," +
      "(SELECT count(*)::int FROM sales_return_items) return_items," +
      "(SELECT count(*)::int FROM sales_payments) payments," +
      "(SELECT count(*)::int FROM sales_refunds) refunds",
    );
    assert.deepEqual(counts.rows[0], { orders: 0, order_items: 0, returns: 0, return_items: 0, payments: 0, refunds: 0 });

    manifest.status = "PASS";
    manifest.rehearsal = {
      status: "PASS", database: rehearsalDb, migrationsApplied: applied,
      postMigrationState: after, foreignKeyCount: fk.rows[0].count, indexCount: indexes.rows[0].count,
      runtimePrivileges: grants, businessTableRows: counts.rows[0],
      completedAt: new Date().toISOString(), cleanupPending: true,
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + os.EOL);

    console.log("POS_LOCAL_SALES_MIGRATION_READINESS=PASS");
    console.log(JSON.stringify({
      workspace: manifest.workspace, sourceDatabase: SOURCE_DB, sourceReadOnly: true,
      backup: backupInfo, migrations: migrationInfo, rehearsalDatabase: rehearsalDb,
      migrationsApplied: applied, postMigrationState: after, foreignKeyCount: fk.rows[0].count,
      indexCount: indexes.rows[0].count, runtimePrivileges: grants, businessTableRows: counts.rows[0],
      manifestPath, liveWorkspaceMutated: false,
    }, null, 2));
  } finally {
    if (rehearsal) await rehearsal.end().catch(() => undefined);
    if (admin) {
      if (restoreCreated) {
        await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [rehearsalDb]).catch(() => undefined);
        await admin.query("DROP DATABASE IF EXISTS " + ident(rehearsalDb)).catch(() => undefined);
        const checkDb = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [rehearsalDb]).catch(() => ({ rowCount: 1 }));
        assert.equal(checkDb.rowCount, 0, "Disposable rehearsal database cleanup failed.");
      }
      await admin.end().catch(() => undefined);
    }
    if (source) await source.end().catch(() => undefined);
    await control.end().catch(() => undefined);
    if (backupCreated && fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      manifest.rehearsal = { ...(manifest.rehearsal || {}), cleanupVerified: restoreCreated };
      manifest.status = manifest.rehearsal?.status === "PASS" && restoreCreated ? "PASS" : "REVIEW_REQUIRED";
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + os.EOL);
    }
  }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
