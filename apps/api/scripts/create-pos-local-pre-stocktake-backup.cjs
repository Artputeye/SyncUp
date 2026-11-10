"use strict";

const { Client } = require("pg");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");

const workspaceId = "c0130bf3-c1c0-4dfa-a915-7ca5155cacfd";
const workspaceSlug = "pos-local";
const sourceDb = "syncup_ws_c0130bf3c1c0";
const runtimeRole = "syncup_rt_c0130bf3c1c0";
const migrationVersion = "20261107000100_tenant_inventory_stocktake";
const migrationPath = path.resolve(__dirname, "../prisma/tenant/migrations/" + migrationVersion + ".sql");
const backupDir = "D:\\Back up\\SyncUp\\Backups";

function assert(ok, message) { if (!ok) throw new Error(message); }
function runTool(name, args, env) {
  const result = spawnSync(name, args, { encoding: "utf8", windowsHide: true, env });
  assert(!result.error && result.status === 0, name + " failed: " + (result.error?.message || result.stderr || result.stdout));
  return result.stdout;
}
function cliArgs(url, db) {
  return ["--host", url.hostname, "--port", url.port || "5432",
    "--username", decodeURIComponent(url.username), "--dbname", db, "--no-password"];
}
async function main() {
  assert(process.platform === "win32", "Backup destination is approved only on this Windows host.");
  const controlUrl = new URL(process.env.CONTROL_DATABASE_URL || "");
  const adminUrl = new URL(process.env.WORKSPACE_DATABASE_ADMIN_URL || "");
  assert(process.env.CONTROL_DATABASE_URL && process.env.WORKSPACE_DATABASE_ADMIN_URL, "Required DB URLs missing.");
  for (const url of [controlUrl, adminUrl]) {
    assert(["localhost", "127.0.0.1", "::1"].includes(url.hostname), "Database host must be localhost.");
  }
  assert(controlUrl.pathname === "/syncup_control", "Unexpected Control DB.");
  assert(fs.existsSync(migrationPath), "Stocktake migration file missing.");
  const migrationSha256 = createHash("sha256").update(fs.readFileSync(migrationPath)).digest("hex");

  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const baseName = "pos-local_pre_stocktake_" + stamp;
  const backupPath = path.join(backupDir, baseName + ".dump");
  const manifestPath = path.join(backupDir, baseName + ".manifest.json");
  fs.mkdirSync(backupDir, { recursive: true });
  assert(!fs.existsSync(backupPath) && !fs.existsSync(manifestPath), "Backup output already exists; refusing overwrite.");

  const control = new Client({
    connectionString: controlUrl.toString(),
    connectionTimeoutMillis: 10000,
    application_name: "syncup-pos-local-pre-stocktake-backup-control",
    options: "-c default_transaction_read_only=on",
  });
  await control.connect();
  let tenant;
  try {
    await control.query("BEGIN READ ONLY");
    const registration = await control.query(
      "SELECT w.id,w.slug,w.status,d.database_name,d.username runtime_role " +
      "FROM public.workspaces w JOIN public.workspace_databases d ON d.workspace_id=w.id WHERE w.id=$1",
      [workspaceId],
    );
    assert(registration.rowCount === 1, "Workspace registration missing or duplicated.");
    const reg = registration.rows[0];
    assert(reg.id === workspaceId && reg.slug === workspaceSlug && reg.status === "ACTIVE" &&
      reg.database_name === sourceDb && reg.runtime_role === runtimeRole,
      "Exact pos-local registry identity mismatch.");
    await control.query("COMMIT");

    tenant = new Client({
      connectionString: adminUrl.toString().replace(/\/[^/]*$/, "/" + sourceDb),
      connectionTimeoutMillis: 10000,
      application_name: "syncup-pos-local-pre-stocktake-backup-source",
      options: "-c default_transaction_read_only=on",
    });
    await tenant.connect();
    await tenant.query("BEGIN READ ONLY");
    const identity = await tenant.query(
      "SELECT current_database() db,current_user role,current_setting('transaction_read_only') read_only",
    );
    assert(identity.rows[0].db === sourceDb && identity.rows[0].role === "syncup_provisioner" &&
      identity.rows[0].read_only === "on", "Tenant source connection identity/read-only mismatch.");
    const pre = await tenant.query(
      "SELECT " +
      "(SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' " +
      "AND table_name IN ('stocktake_sessions','stocktake_lines')) stocktake_tables," +
      "(SELECT count(*)::int FROM public.tenant_migrations WHERE version=$1) stocktake_ledger," +
      "(SELECT count(*)::int FROM public.tenant_migrations) ledger_count," +
      "(SELECT array_agg(version ORDER BY version) FROM public.tenant_migrations) ledger_versions," +
      "(SELECT count(*)::int FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace " +
      "WHERE n.nspname='public' AND t.typname='StocktakeStatus') status_enum," +
      "(SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) FROM pg_type t " +
      "JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid " +
      "WHERE n.nspname='public' AND t.typname='StockReferenceType') stock_reference_values",
      [migrationVersion],
    );
    const state = pre.rows[0];
    assert(state.stocktake_tables === 0 && state.stocktake_ledger === 0 && state.status_enum === 0,
      "Live Tenant is no longer at the reviewed pre-migration state.");
    assert(Array.isArray(state.stock_reference_values) && !state.stock_reference_values.includes("STOCKTAKE"),
      "STOCKTAKE enum value already exists.");
    assert(state.ledger_count === 2, "Unexpected Tenant migration ledger count.");
    await tenant.query("COMMIT");

    const env = { ...process.env, PGPASSWORD: decodeURIComponent(adminUrl.password) };
    const args = cliArgs(adminUrl, sourceDb);
    runTool("pg_dump", [...args, "--format=custom", "--no-owner", "--no-acl", "--file", backupPath], env);
    assert(fs.existsSync(backupPath) && fs.statSync(backupPath).size > 0, "pg_dump output missing or empty.");
    const archiveList = runTool("pg_restore", ["--list", backupPath], env);
    assert(archiveList.includes("TABLE DATA") && archiveList.includes("tenant_migrations"),
      "pg_restore archive listing is missing Tenant migration ledger data.");
    const sha256 = createHash("sha256").update(fs.readFileSync(backupPath)).digest("hex");
    const stat = fs.statSync(backupPath);
    const manifest = {
      status: "VERIFIED",
      workspace: { id: workspaceId, slug: workspaceSlug, status: "ACTIVE" },
      sourceDatabase: sourceDb,
      sourceRole: "syncup_provisioner",
      runtimeRole,
      migrationVersion,
      migrationSha256,
      preMigrationState: state,
      backup: {
        file: path.basename(backupPath),
        path: backupPath,
        format: "pg_dump custom",
        sizeBytes: stat.size,
        sha256,
        createdAt: new Date().toISOString(),
        archiveListVerified: true,
      },
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + os.EOL, { flag: "wx" });
    console.log("POS_LOCAL_PRE_STOCKTAKE_BACKUP " + JSON.stringify({
      status: "PASS",
      workspace: manifest.workspace,
      sourceDatabase: sourceDb,
      migrationVersion,
      migrationSha256,
      preMigrationState: state,
      backup: manifest.backup,
      manifestPath,
      sourceTouchedReadOnly: true,
      migrationApplied: false,
    }, null, 2));
  } finally {
    if (tenant) await tenant.end().catch(() => undefined);
    await control.end().catch(() => undefined);
  }
}
main().catch(error => {
  console.error("POS_LOCAL_PRE_STOCKTAKE_BACKUP_FAILED " + (error.stack || error.message));
  process.exitCode = 1;
});
