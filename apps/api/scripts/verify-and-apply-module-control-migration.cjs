const { Client } = require("pg");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const controlUrl = process.env.CONTROL_DATABASE_URL;
const adminUrl = process.env.TEST_POSTGRES_ADMIN_URL;
if (!controlUrl || !adminUrl) throw new Error("CONTROL_DATABASE_URL and TEST_POSTGRES_ADMIN_URL are required.");
const control = new URL(controlUrl);
const adminParsed = new URL(adminUrl);
const loopbacks = ["localhost", "127.0.0.1", "::1"];
if (!loopbacks.includes(control.hostname) || !loopbacks.includes(adminParsed.hostname)) {
  throw new Error("Safety stop: migration rehearsal only accepts localhost PostgreSQL connections.");
}
const controlDbName = decodeURIComponent(control.pathname.replace(/^\//, ""));
if (controlDbName !== "syncup_control") throw new Error("Safety stop: expected Control DB syncup_control; received " + controlDbName);
const root = path.resolve(__dirname, "../../..");
const migration = fs.readFileSync(path.join(root, "apps/api/prisma/migrations/202611060003_module_registration_activation/migration.sql"), "utf8");
const backupDir = "D:\\Back up\\SyncUp";
const backupPath = path.join(backupDir, "control_pre_module_activation_" + new Date().toISOString().replace(/[:.]/g, "-") + ".dump");

function assert(ok, message) { if (!ok) throw new Error(message); }
function databaseUrl(base, name) { const url = new URL(base); url.pathname = "/" + name; return url.toString(); }
function tool(name, args, password) {
  const result = spawnSync(name, args, { encoding: "utf8", windowsHide: true, env: { ...process.env, PGPASSWORD: password } });
  if (result.error) throw new Error(name + " unavailable: " + result.error.message);
  if (result.status !== 0) throw new Error(name + " failed: " + (result.stderr || result.stdout));
}
async function clientFor(url) { const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 }); await client.connect(); return client; }
function pgArgs(parsed, database) {
  return ["--host", parsed.hostname, "--port", parsed.port || "5432", "--username",
    decodeURIComponent(parsed.username), "--dbname", database];
}
async function verifyMigration(client) {
  const columns = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='module_installations'",
  );
  const names = new Set(columns.rows.map((row) => row.column_name));
  for (const required of ["status","installed_by","enabled_at","disabled_at","last_error","updated_at"]) {
    assert(names.has(required), "Missing module_installations." + required);
  }
  const audit = await client.query("SELECT to_regclass('public.platform_audit_logs') AS table_name");
  assert(audit.rows[0].table_name === "platform_audit_logs", "platform_audit_logs was not created");
  const check = await client.query(
    "SELECT 1 FROM pg_constraint WHERE conname='module_installations_status_enabled_check'",
  );
  assert(check.rowCount === 1, "Module status/enabled consistency constraint missing");
}

async function main() {
  const admin = await clientFor(adminUrl);
  let sourceClient;
  let rehearsalClient;
  let rehearsalDb;
  try {
    sourceClient = await clientFor(databaseUrl(adminUrl, controlDbName));
    const identity = await sourceClient.query("SELECT current_database() AS name");
    assert(identity.rows[0].name === "syncup_control", "Connected Control DB identity did not match.");
    const preflight = await sourceClient.query(
      "SELECT to_regclass('public.module_installations') AS installations, to_regclass('public.platform_audit_logs') AS audit",
    );
    assert(preflight.rows[0].installations === "module_installations", "Existing module_installations table is missing.");
    const columnsBefore = await sourceClient.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='module_installations' AND column_name='status'",
    );
    assert(columnsBefore.rowCount === 0 && preflight.rows[0].audit === null,
      "Migration appears already or partially applied; stop for manual reconciliation.");

    fs.mkdirSync(backupDir, { recursive: true });
    tool("pg_dump", [...pgArgs(control, controlDbName), "--format=custom", "--no-owner", "--no-acl", "--file", backupPath], decodeURIComponent(control.password));
    assert(fs.existsSync(backupPath) && fs.statSync(backupPath).size > 0, "Control DB backup file is missing or empty.");
    console.log("PASS Control DB backup created: " + backupPath);

    rehearsalDb = "syncup_mod_rehearsal_" + process.pid + "_" + Date.now();
    await admin.query('CREATE DATABASE "' + rehearsalDb + '"');
    tool("pg_restore", [...pgArgs(adminParsed, rehearsalDb), "--no-owner", "--no-acl", "--exit-on-error", backupPath], decodeURIComponent(adminParsed.password));
    rehearsalClient = await clientFor(databaseUrl(adminUrl, rehearsalDb));
    const restoredIdentity = await rehearsalClient.query("SELECT current_database() AS name");
    assert(restoredIdentity.rows[0].name === rehearsalDb, "Backup restore target mismatch.");

    await rehearsalClient.query(
      "INSERT INTO module_installations(id,workspace_id,module_id,version,enabled,source,installed_at) VALUES " +
      "(gen_random_uuid(),gen_random_uuid(),'legacy-enabled','0.1.0',TRUE,'bundled',NOW())," +
      "(gen_random_uuid(),gen_random_uuid(),'legacy-installed','0.1.0',FALSE,'bundled',NOW())",
    );
    await rehearsalClient.query("BEGIN");
    try { await rehearsalClient.query(migration); await rehearsalClient.query("COMMIT"); }
    catch (error) { await rehearsalClient.query("ROLLBACK"); throw error; }
    await verifyMigration(rehearsalClient);
    const backfill = await rehearsalClient.query(
      "SELECT module_id,status::text,enabled FROM module_installations WHERE module_id IN ('legacy-enabled','legacy-installed') ORDER BY module_id",
    );
    assert(backfill.rows.length === 2, "Legacy module fixtures disappeared.");
    assert(backfill.rows[0].module_id === "legacy-enabled" && backfill.rows[0].status === "ENABLED" && backfill.rows[0].enabled,
      "Legacy enabled installation was not preserved.");
    assert(backfill.rows[1].module_id === "legacy-installed" && backfill.rows[1].status === "INSTALLED" && !backfill.rows[1].enabled,
      "Legacy installed installation was not preserved.");
    console.log("PASS Restored Control DB migration, constraints, indexes, audit table and legacy-state backfill");

    await sourceClient.query("BEGIN");
    try { await sourceClient.query(migration); await sourceClient.query("COMMIT"); }
    catch (error) { await sourceClient.query("ROLLBACK"); throw error; }
    await verifyMigration(sourceClient);
    console.log("PASS Migration 202611060003_module_registration_activation applied to Control DB");
  } finally {
    if (rehearsalClient) await rehearsalClient.end().catch(() => undefined);
    if (sourceClient) await sourceClient.end().catch(() => undefined);
    if (rehearsalDb) {
      await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1", [rehearsalDb]).catch(() => undefined);
      await admin.query('DROP DATABASE IF EXISTS "' + rehearsalDb + '"').catch(() => undefined);
    }
    await admin.end();
  }
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
