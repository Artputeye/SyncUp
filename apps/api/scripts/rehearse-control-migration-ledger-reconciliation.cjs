const { Client } = require("pg");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");

const root = path.resolve(__dirname, "../../..");
const adminUrl = process.env.TEST_POSTGRES_ADMIN_URL;
const backupPath = "D:\\Back up\\SyncUp\\Backups\\syncup_control_20261107022928_d9d27b00.dump";
const expectedBackupSha256 = "f3f5d5ef33a11153a71b8fd640a5b8ec96a70b0dad15e23f6d81cad601cc3992";
const migrationNames = [
  "202611060003_module_registration_activation",
  "202611060004_module_audit_runtime_grants",
];
const migrationFiles = migrationNames.map((name) =>
  path.join(root, "apps", "api", "prisma", "migrations", name, "migration.sql"),
);

function assert(ok, message) {
  if (!ok) throw new Error(message);
}
function quoteId(value) {
  return '"' + value.replace(/"/g, '""') + '"';
}
function databaseUrl(database) {
  const url = new URL(adminUrl);
  url.pathname = "/" + database;
  return url.toString();
}
function pgArgs(database) {
  const url = new URL(adminUrl);
  return ["--host", url.hostname, "--port", url.port || "5432",
    "--username", decodeURIComponent(url.username), "--dbname", database, "--no-password"];
}
function run(command, args, env, allowedExitCodes = []) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, env });
  if (result.error || (result.status !== 0 && !allowedExitCodes.includes(result.status))) {
    throw new Error(command + " failed: " + ([result.error?.message, result.stderr, result.stdout].filter(Boolean).join(" | ")));
  }
  return result.stdout;
}
async function connect(database) {
  const client = new Client({
    connectionString: databaseUrl(database),
    connectionTimeoutMillis: 10000,
    application_name: "syncup-r2-control-ledger-rehearsal",
  });
  await client.connect();
  return client;
}

async function main() {
  assert(adminUrl, "TEST_POSTGRES_ADMIN_URL is required");
  const adminParsed = new URL(adminUrl);
  assert(["localhost", "127.0.0.1", "::1"].includes(adminParsed.hostname),
    "Safety stop: admin URL must be localhost");
  assert(adminParsed.pathname === "/postgres",
    "Safety stop: admin URL must connect to postgres maintenance database");
  assert(fs.existsSync(backupPath), "Pinned Control backup not found");
  const actualHash = createHash("sha256").update(fs.readFileSync(backupPath)).digest("hex");
  assert(actualHash === expectedBackupSha256, "Pinned Control backup SHA-256 mismatch");

  const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
  const rehearsalDb = "syncup_r2_control_rehearsal_" + suffix;
  const admin = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 10000 });
  await admin.connect();
  let clone;
  let created = false;
  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [rehearsalDb]);
    assert(existing.rowCount === 0, "Safety stop: rehearsal DB name collision");
    await admin.query("CREATE DATABASE " + quoteId(rehearsalDb));
    created = true;

    run("pg_restore", [...pgArgs(rehearsalDb), "--no-owner", "--no-acl", "--exit-on-error", backupPath], {
      ...process.env,
      PGPASSWORD: decodeURIComponent(adminParsed.password),
    });

    clone = await connect(rehearsalDb);
    const identity = await clone.query(
      "SELECT current_database() db, current_user usr, current_setting('transaction_read_only') ro"
    );
    assert(identity.rows[0].db === rehearsalDb && identity.rows[0].ro === "off",
      "Restored clone identity/read-write check failed");

    const before = await clone.query(`
      SELECT
        (SELECT count(*)::int FROM _prisma_migrations) ledger_count,
        (SELECT count(*)::int FROM _prisma_migrations WHERE migration_name = ANY($1::text[])) target_ledger_count,
        to_regclass('public.module_installations') IS NOT NULL has_module_installations,
        to_regclass('public.platform_audit_logs') IS NOT NULL has_platform_audit_logs,
        (SELECT count(*)::int FROM information_schema.columns
          WHERE table_schema='public' AND table_name='module_installations'
            AND column_name IN ('status','installed_by','enabled_at','disabled_at','last_error','updated_at')) module_columns
    `, [migrationNames]);
    assert(before.rows[0].has_module_installations && before.rows[0].has_platform_audit_logs,
      "Backup clone does not contain 003/004 schema effects; cannot rehearse ledger repair");
    assert(before.rows[0].module_columns === 6, "Backup clone module_installations columns mismatch");
    assert(before.rows[0].target_ledger_count === 0,
      "Backup clone unexpectedly already has 003/004 ledger rows");

    const migrationSqlHashes = migrationFiles.map((file) =>
      createHash("sha256").update(fs.readFileSync(file)).digest("hex"));
    const resolveResults = [];
    for (const name of migrationNames) {
      const output = run(process.execPath, [
        path.join(__dirname, "..", "node_modules", "prisma", "build", "index.js"), "migrate", "resolve", "--applied", name,
        "--schema", path.join(root, "apps", "api", "prisma", "schema.prisma"),
      ], { ...process.env, CONTROL_DATABASE_URL: databaseUrl(rehearsalDb) });
      resolveResults.push({ migration: name, output: output.trim() });
    }

    const after = await clone.query(`
      SELECT migration_name, checksum, finished_at IS NOT NULL AS finished,
             rolled_back_at IS NULL AS not_rolled_back, applied_steps_count
      FROM _prisma_migrations
      WHERE migration_name = ANY($1::text[])
      ORDER BY migration_name
    `, [migrationNames]);
    assert(after.rowCount === 2, "Prisma did not record both resolved migrations");
    for (const row of after.rows) {
      const expectedIndex = migrationNames.indexOf(row.migration_name);
      assert(expectedIndex >= 0, "Unexpected migration row");
      assert(row.checksum === migrationSqlHashes[expectedIndex],
        "Prisma recorded checksum different from current migration file");
      assert(row.finished && row.not_rolled_back,
        "Resolved migration is not marked successfully applied");
    }

    const statusOutput = run(process.execPath, [
      path.join(__dirname, "..", "node_modules", "prisma", "build", "index.js"), "migrate", "status",
      "--schema", path.join(root, "apps", "api", "prisma", "schema.prisma"),
    ], { ...process.env, CONTROL_DATABASE_URL: databaseUrl(rehearsalDb) }, [1]);

    assert(statusOutput.includes("202611060005_inventory_role_matrix_alignment"), "Expected 005 to remain pending");
    assert(!statusOutput.includes("202611060003_module_registration_activation") && !statusOutput.includes("202611060004_module_audit_runtime_grants"), "003/004 unexpectedly pending");
    console.log("R2_CONTROL_LEDGER_REHEARSAL " + JSON.stringify({
      status: "PASS",
      sourceBackup: path.basename(backupPath),
      backupSha256: actualHash,
      rehearsalDb,
      restoredCloneBefore: before.rows[0],
      prismaResolve: resolveResults,
      ledgerAfter: after.rows,
      migrateStatus: statusOutput.trim(),
      sourceControlDbTouched: false,
      posLocalTenantDbTouched: false,
      cleanup: "The disposable restored database is dropped in finally.",
    }, null, 2));
  } finally {
    if (clone) await clone.end().catch(() => undefined);
    if (created) {
      await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1", [rehearsalDb]).catch(() => undefined);
      await admin.query("DROP DATABASE IF EXISTS " + quoteId(rehearsalDb)).catch(() => undefined);
    }
    await admin.end();
  }
}

main().catch((error) => {
  console.error("R2_CONTROL_LEDGER_REHEARSAL_FAILED " + (error.stack || error.message));
  process.exitCode = 1;
});
