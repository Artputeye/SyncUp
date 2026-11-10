"use strict";

const { Client } = require("pg");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");

const backupPath = "D:\\Back up\\SyncUp\\Backups\\pos-local_20261107022352_b25ca603.dump";
const expectedBackupSha256 = "01be3ffae783f2c69bcd764c1cc670018675b96c6dd0ad27e0232e644eb9e53c";
const prefix = "syncup_stocktake_rehearsal_";
const runtimeRole = "syncup_rt_c0130bf3c1c0";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function quoteIdentifier(value) {
  return '"' + value.replace(/"/g, '""') + '"';
}
function argsFor(baseUrl, database) {
  const url = new URL(baseUrl);
  return ["--host", url.hostname, "--port", url.port || "5432",
    "--username", decodeURIComponent(url.username), "--dbname", database, "--no-password"];
}
function dbUrl(baseUrl, database) {
  const url = new URL(baseUrl);
  url.pathname = "/" + database;
  return url.toString();
}
async function main() {
  const adminUrl = process.env.TEST_POSTGRES_ADMIN_URL;
  const provisionerUrl = process.env.WORKSPACE_DATABASE_ADMIN_URL;
  assert(adminUrl && provisionerUrl && process.env.CONTROL_DATABASE_URL,
    "TEST_POSTGRES_ADMIN_URL, WORKSPACE_DATABASE_ADMIN_URL and CONTROL_DATABASE_URL are required.");
  const adminParsed = new URL(adminUrl);
  const provisionerParsed = new URL(provisionerUrl);
  assert(["localhost", "127.0.0.1", "::1"].includes(adminParsed.hostname) &&
    ["localhost", "127.0.0.1", "::1"].includes(provisionerParsed.hostname),
    "Safety stop: rehearsal PostgreSQL must be local.");
  assert(adminParsed.pathname === "/postgres" &&
    adminParsed.hostname === provisionerParsed.hostname && adminParsed.port === provisionerParsed.port,
    "Safety stop: unexpected maintenance DB or PostgreSQL server mismatch.");
  assert(fs.existsSync(backupPath), "Pinned pos-local Tenant backup not found.");
  const backupHash = createHash("sha256").update(fs.readFileSync(backupPath)).digest("hex");
  assert(backupHash === expectedBackupSha256, "Pinned Tenant backup SHA-256 mismatch.");

  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const database = prefix + suffix;
  const admin = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 10000 });
  await admin.connect();
  let created = false;
  let setup;
  let observer;
  try {
    const collision = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [database]);
    assert(collision.rowCount === 0, "Disposable database name collision.");
    await admin.query("CREATE DATABASE " + quoteIdentifier(database));
    created = true;
    await admin.query("GRANT CREATE ON DATABASE " + quoteIdentifier(database) + " TO syncup_provisioner");

    setup = new Client({ connectionString: dbUrl(adminUrl, database), connectionTimeoutMillis: 10000 });
    await setup.connect();
    await setup.query("GRANT CREATE ON SCHEMA public TO syncup_provisioner");
    await setup.end();
    setup = undefined;

    const restore = spawnSync("pg_restore", [
      ...argsFor(provisionerUrl, database),
      "--no-owner", "--no-acl", "--exit-on-error", backupPath,
    ], {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, PGPASSWORD: decodeURIComponent(provisionerParsed.password) },
    });
    assert(!restore.error && restore.status === 0,
      "pg_restore as syncup_provisioner failed: " + (restore.error?.message || restore.stderr || restore.stdout));

    setup = new Client({ connectionString: dbUrl(provisionerUrl, database), connectionTimeoutMillis: 10000 });
    await setup.connect();
    await setup.query(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO " +
      quoteIdentifier(runtimeRole),
    );
    await setup.query("REVOKE INSERT, UPDATE, DELETE ON TABLE public.tenant_migrations FROM " + quoteIdentifier(runtimeRole));
    await setup.query("GRANT SELECT ON TABLE public.tenant_migrations TO " + quoteIdentifier(runtimeRole));
    await setup.end();
    setup = undefined;

    observer = new Client({
      connectionString: dbUrl(adminUrl, database),
      connectionTimeoutMillis: 10000,
      application_name: "syncup-stocktake-executor-test-observer",
    });
    await observer.connect();
    const identity = await observer.query("SELECT current_database() AS database_name");
    assert(identity.rows[0].database_name === database, "Observer connected to the wrong disposable database.");

    const executorPath = path.resolve(__dirname, "execute-tenant-incremental-migration.cjs");
    const result = spawnSync(process.execPath, [
      executorPath, "--rehearsal", "--rehearsal-db", database,
    ], { encoding: "utf8", windowsHide: true, env: process.env });
    assert(!result.error && result.status === 0,
      "Executor rehearsal failed: " + (result.error?.message || result.stderr || result.stdout));
    process.stdout.write(result.stdout);

    const ledger = await observer.query(
      "SELECT count(*)::int AS count FROM public.tenant_migrations WHERE version=$1",
      ["20261107000100_tenant_inventory_stocktake"],
    );
    assert(ledger.rows[0].count === 1, "Observer did not see exactly one committed migration ledger row.");

    console.log("TENANT_INCREMENTAL_MIGRATION_EXECUTOR_REHEARSAL " + JSON.stringify({
      status: "PASS",
      sourceBackup: path.basename(backupPath),
      backupSha256: backupHash,
      rehearsalDatabase: database,
      migrationLedgerRows: ledger.rows[0].count,
      cleanup: "Disposable restored database is dropped in finally.",
      livePosLocalTenantTouched: false,
      controlDatabaseMutated: false
    }, null, 2));
  } finally {
    if (setup) await setup.end().catch(() => undefined);
    if (observer) await observer.end().catch(() => undefined);
    if (created) {
      await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1", [database]).catch(() => undefined);
      await admin.query("DROP DATABASE IF EXISTS " + quoteIdentifier(database)).catch(() => undefined);
    }
    await admin.end();
  }
}
main().catch((error) => {
  console.error("TENANT_INCREMENTAL_MIGRATION_EXECUTOR_REHEARSAL_FAILED " + (error.stack || error.message));
  process.exitCode = 1;
});
