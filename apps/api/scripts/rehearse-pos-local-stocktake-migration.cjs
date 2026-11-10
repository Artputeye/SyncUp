const { Client } = require("pg");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");

const adminUrl = process.env.TEST_POSTGRES_ADMIN_URL;
const backupPath = "D:\\Back up\\SyncUp\\Backups\\pos-local_20261107022352_b25ca603.dump";
const expectedBackupSha256 = "01be3ffae783f2c69bcd764c1cc670018675b96c6dd0ad27e0232e644eb9e53c";
const migrationPath = path.resolve(__dirname, "../prisma/tenant/migrations/20261107000100_tenant_inventory_stocktake.sql");
const migrationName = "20261107000100_tenant_inventory_stocktake";

function assert(ok, message) {
  if (!ok) throw new Error(message);
}
function quoteId(value) {
  return '"' + value.replace(/"/g, '""') + '"';
}
function dbUrl(database) {
  const url = new URL(adminUrl);
  url.pathname = "/" + database;
  return url.toString();
}
function pgArgs(database) {
  const url = new URL(adminUrl);
  return ["--host", url.hostname, "--port", url.port || "5432",
    "--username", decodeURIComponent(url.username), "--dbname", database, "--no-password"];
}
function restore(database, env) {
  const result = spawnSync("pg_restore", [
    ...pgArgs(database), "--no-owner", "--no-acl", "--exit-on-error", backupPath,
  ], { encoding: "utf8", windowsHide: true, env });
  if (result.error || result.status !== 0) {
    throw new Error("pg_restore failed: " + (result.error?.message || result.stderr || result.stdout));
  }
}
async function connect(database) {
  const client = new Client({
    connectionString: dbUrl(database),
    connectionTimeoutMillis: 10000,
    application_name: "syncup-stocktake-migration-rehearsal",
  });
  await client.connect();
  return client;
}
async function main() {
  assert(adminUrl, "TEST_POSTGRES_ADMIN_URL is required");
  const parsed = new URL(adminUrl);
  assert(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname), "Safety stop: admin URL must be localhost");
  assert(parsed.pathname === "/postgres", "Safety stop: admin URL must use postgres maintenance DB");
  assert(fs.existsSync(backupPath), "Pinned pos-local Tenant backup not found");
  const backupHash = createHash("sha256").update(fs.readFileSync(backupPath)).digest("hex");
  assert(backupHash === expectedBackupSha256, "Pinned Tenant backup SHA-256 mismatch");
  assert(fs.existsSync(migrationPath), "Stocktake migration candidate missing");
  const migrationSql = fs.readFileSync(migrationPath, "utf8");
  const migrationHash = createHash("sha256").update(migrationSql).digest("hex");

  const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
  const rehearsalDb = "syncup_stocktake_rehearsal_" + suffix;
  const admin = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 10000 });
  await admin.connect();
  let client;
  let created = false;
  try {
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [rehearsalDb]);
    assert(exists.rowCount === 0, "Safety stop: rehearsal database collision");
    await admin.query("CREATE DATABASE " + quoteId(rehearsalDb));
    created = true;
    restore(rehearsalDb, {
      ...process.env,
      PGPASSWORD: decodeURIComponent(parsed.password),
    });
    client = await connect(rehearsalDb);

    const identity = await client.query("SELECT current_database() db, current_setting('transaction_read_only') ro");
    assert(identity.rows[0].db === rehearsalDb && identity.rows[0].ro === "off",
      "Restored disposable Tenant DB identity mismatch");

    const before = await client.query(`
      SELECT
        (SELECT count(*)::int FROM information_schema.tables
          WHERE table_schema='public' AND table_name IN ('stocktake_sessions','stocktake_lines')) stocktake_tables,
        (SELECT count(*)::int FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
          WHERE n.nspname='public' AND t.typname='StocktakeStatus') status_enum,
        (SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
          FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
          JOIN pg_enum e ON e.enumtypid=t.oid
          WHERE n.nspname='public' AND t.typname='StockReferenceType') stock_reference_values,
        (SELECT count(*)::int FROM public.tenant_migrations) ledger_count,
        (SELECT count(*)::int FROM public.warehouses) warehouse_count,
        (SELECT count(*)::int FROM public.product_variants) variant_count
    `);
    assert(before.rows[0].stocktake_tables === 0 && before.rows[0].status_enum === 0,
      "Backup clone already contains Stocktake schema; migration candidate is not applicable");
    assert(before.rows[0].stock_reference_values?.includes("STOCKTAKE") === false,
      "StockReferenceType unexpectedly already contains STOCKTAKE");

    await client.query(migrationSql);

    const after = await client.query(`
      SELECT
        (SELECT count(*)::int FROM information_schema.tables
          WHERE table_schema='public' AND table_name IN ('stocktake_sessions','stocktake_lines')) stocktake_tables,
        (SELECT count(*)::int FROM information_schema.columns
          WHERE table_schema='public' AND table_name='stocktake_sessions') session_columns,
        (SELECT count(*)::int FROM information_schema.columns
          WHERE table_schema='public' AND table_name='stocktake_lines') line_columns,
        (SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
          FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
          JOIN pg_enum e ON e.enumtypid=t.oid
          WHERE n.nspname='public' AND t.typname='StockReferenceType') stock_reference_values,
        (SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
          FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
          JOIN pg_enum e ON e.enumtypid=t.oid
          WHERE n.nspname='public' AND t.typname='StocktakeStatus') stocktake_status_values,
        (SELECT count(*)::int FROM pg_constraint
          WHERE conname = ANY(ARRAY['stocktake_sessions_pkey','stocktake_sessions_warehouse_id_fkey','stocktake_lines_pkey','stocktake_lines_session_id_fkey','stocktake_lines_variant_id_fkey','stocktake_lines_counted_quantity_check','stocktake_lines_unit_cost_check'])) constraint_count,
        (SELECT count(*)::int FROM pg_indexes
          WHERE schemaname='public' AND tablename IN ('stocktake_sessions','stocktake_lines')) index_count,
        (SELECT count(*)::int FROM public.stocktake_sessions) session_rows,
        (SELECT count(*)::int FROM public.stocktake_lines) line_rows,
        (SELECT count(*)::int FROM public.tenant_migrations) ledger_count
    `);
    const row = after.rows[0];
    assert(row.stocktake_tables === 2, "Expected both Stocktake tables");
    assert(row.session_columns === 12 && row.line_columns === 9, "Stocktake table column count mismatch");
    assert(row.stock_reference_values.includes("STOCKTAKE"), "StockReferenceType.STOCKTAKE enum value missing");
    assert((row.stocktake_status_values || []).join(",") === "DRAFT,IN_PROGRESS,FINALIZED,CANCELLED", "StocktakeStatus enum values mismatch: " + JSON.stringify(row.stocktake_status_values));
    assert(row.constraint_count === 7, "Expected seven Stocktake PK/FK/CHECK constraints; got " + row.constraint_count);
    assert(row.index_count === 6, "Expected five Stocktake indexes");
    assert(row.session_rows === 0 && row.line_rows === 0, "Stocktake migration should create empty tables");
    assert(row.ledger_count === before.rows[0].ledger_count,
      "Candidate SQL unexpectedly changed tenant migration ledger");

    console.log("STOCKTAKE_MIGRATION_REHEARSAL " + JSON.stringify({
      status: "PASS",
      sourceBackup: path.basename(backupPath),
      backupSha256: backupHash,
      migration: migrationName,
      migrationSha256: migrationHash,
      rehearsalDb,
      before: before.rows[0],
      after: row,
      tenantLedgerChanged: false,
      sourcePosLocalTenantTouched: false,
      sourceControlDbTouched: false,
      cleanup: "The disposable restored Tenant database is dropped in finally.",
      caveat: "This validates SQL application and schema objects only; it does not approve live application or replace API/UI E2E."
    }, null, 2));
  } finally {
    if (client) await client.end().catch(() => undefined);
    if (created) {
      await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1", [rehearsalDb]).catch(() => undefined);
      await admin.query("DROP DATABASE IF EXISTS " + quoteId(rehearsalDb)).catch(() => undefined);
    }
    await admin.end();
  }
}
main().catch((error) => {
  console.error("STOCKTAKE_MIGRATION_REHEARSAL_FAILED " + (error.stack || error.message));
  process.exitCode = 1;
});
