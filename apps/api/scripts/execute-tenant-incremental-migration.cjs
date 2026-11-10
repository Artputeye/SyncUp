"use strict";

const { Client } = require("pg");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const WORKSPACE_ID = "c0130bf3-c1c0-4dfa-a915-7ca5155cacfd";
const WORKSPACE_SLUG = "pos-local";
const TARGET_DATABASE = "syncup_ws_c0130bf3c1c0";
const TARGET_RUNTIME_ROLE = "syncup_rt_c0130bf3c1c0";
const MIGRATION_VERSION = "20261107000100_tenant_inventory_stocktake";
const MIGRATION_PATH = path.resolve(__dirname, "../prisma/tenant/migrations/" + MIGRATION_VERSION + ".sql");
const REHEARSAL_PREFIX = "syncup_stocktake_rehearsal_";
const EXPECTED_LEDGER = ["20261031000100_tenant_baseline", "202611030001_tenant_commerce"];
const APPROVED_BACKUP_DIR = path.resolve("D:\\Back up\\SyncUp\\Backups");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--rehearsal") args.mode = "rehearsal";
    else if (token === "--rehearsal-db") args.rehearsalDb = argv[++i];
    else if (token === "--live") args.mode = "live";
    else if (token === "--confirm-workspace") args.confirmWorkspace = argv[++i];
    else if (token === "--confirm-migration") args.confirmMigration = argv[++i];
    else if (token === "--backup-manifest") args.backupManifest = argv[++i];
    else throw new Error("Unsupported argument: " + token);
  }
  return args;
}
function databaseUrl(base, database) {
  const url = new URL(base);
  url.pathname = "/" + database;
  return url.toString();
}
async function connect(url, applicationName) {
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 10000,
    application_name: applicationName,
  });
  await client.connect();
  return client;
}
function verifyBackupManifest(manifestPath, expectedMigrationSha256) {
  assert(typeof manifestPath === "string" && path.isAbsolute(manifestPath),
    "Live execution requires an absolute --backup-manifest path.");
  const resolved = path.resolve(manifestPath);
  assert(resolved.startsWith(APPROVED_BACKUP_DIR + path.sep),
    "Backup manifest must be inside the approved local backup directory.");
  assert(fs.existsSync(resolved), "Pre-migration backup manifest is missing.");
  const manifest = JSON.parse(fs.readFileSync(resolved, "utf8"));
  assert(manifest.status === "VERIFIED" &&
    manifest.workspace?.id === WORKSPACE_ID &&
    manifest.workspace?.slug === WORKSPACE_SLUG &&
    manifest.sourceDatabase === TARGET_DATABASE &&
    manifest.sourceRole === "syncup_provisioner" &&
    manifest.runtimeRole === TARGET_RUNTIME_ROLE &&
    manifest.migrationVersion === MIGRATION_VERSION &&
    manifest.migrationSha256 === expectedMigrationSha256,
    "Backup manifest does not match the approved workspace, database, role or migration.");
  const backupPath = path.resolve(manifest.backup?.path || "");
  assert(backupPath.startsWith(APPROVED_BACKUP_DIR + path.sep) &&
    fs.existsSync(backupPath) &&
    path.basename(backupPath) === manifest.backup.file,
    "Backup archive path/file does not match the verified manifest.");
  const actualSha = createHash("sha256").update(fs.readFileSync(backupPath)).digest("hex");
  assert(actualSha === manifest.backup.sha256, "Pre-migration backup SHA-256 mismatch.");
  const ageMs = Date.now() - Date.parse(manifest.backup.createdAt);
  assert(Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 24 * 60 * 60 * 1000,
    "Pre-migration backup must be no older than 24 hours and not future-dated.");
  const listing = spawnSync("pg_restore", ["--list", backupPath], { encoding: "utf8", windowsHide: true });
  assert(!listing.error && listing.status === 0 &&
    listing.stdout.includes("TABLE DATA") && listing.stdout.includes("tenant_migrations"),
    "Pre-migration backup failed pg_restore --list validation.");
  return { manifestPath: resolved, backupPath, manifest, sha256: actualSha };
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  assert(args.mode === "rehearsal" || args.mode === "live",
    "Choose exactly one mode: --rehearsal or --live.");
  if (args.mode === "rehearsal") {
    assert(typeof args.rehearsalDb === "string" && args.rehearsalDb.startsWith(REHEARSAL_PREFIX),
      "Safety stop: --rehearsal-db must use the reserved disposable database prefix.");
  } else {
    assert(args.confirmWorkspace === WORKSPACE_SLUG && args.confirmMigration === MIGRATION_VERSION,
      "Live mode requires exact --confirm-workspace pos-local and --confirm-migration " + MIGRATION_VERSION + ".");
    assert(!args.rehearsalDb, "Live mode cannot accept a rehearsal database.");
  }

  const controlUrl = process.env.CONTROL_DATABASE_URL;
  const provisionerUrl = process.env.WORKSPACE_DATABASE_ADMIN_URL;
  assert(controlUrl && provisionerUrl, "CONTROL_DATABASE_URL and WORKSPACE_DATABASE_ADMIN_URL are required.");
  const controlParsed = new URL(controlUrl);
  const provisionerParsed = new URL(provisionerUrl);
  const loopback = (host) => ["localhost", "127.0.0.1", "::1"].includes(host);
  assert(loopback(controlParsed.hostname) && loopback(provisionerParsed.hostname),
    "Safety stop: Control and Tenant connections must target localhost.");
  assert(controlParsed.pathname === "/syncup_control", "Safety stop: unexpected Control database.");
  assert(controlParsed.hostname === provisionerParsed.hostname && controlParsed.port === provisionerParsed.port,
    "Safety stop: Control and Tenant connections must target the same local PostgreSQL server.");
  assert(fs.existsSync(MIGRATION_PATH), "Stocktake migration candidate is missing.");
  const migrationSql = fs.readFileSync(MIGRATION_PATH, "utf8");
  const migrationSha256 = createHash("sha256").update(migrationSql).digest("hex");
  const backup = args.mode === "live" ? verifyBackupManifest(args.backupManifest, migrationSha256) : null;

  const control = await connect(controlUrl, "syncup-incremental-migration-" + args.mode + "-control");
  let tenant;
  let lockAcquired = false;
  const targetDatabase = args.mode === "live" ? TARGET_DATABASE : args.rehearsalDb;
  try {
    await control.query("BEGIN READ ONLY");
    const registration = await control.query(
      "SELECT w.id, w.slug, w.status, d.database_name, d.username AS runtime_role " +
      "FROM public.workspaces w JOIN public.workspace_databases d ON d.workspace_id = w.id WHERE w.id = $1",
      [WORKSPACE_ID],
    );
    assert(registration.rowCount === 1, "Expected exactly one registered pos-local workspace.");
    const workspace = registration.rows[0];
    assert(workspace.slug === WORKSPACE_SLUG && workspace.status === "ACTIVE",
      "Registered workspace identity/status mismatch.");
    assert(workspace.database_name === TARGET_DATABASE && workspace.runtime_role === TARGET_RUNTIME_ROLE,
      "Registered Tenant database/runtime role differs from the reviewed target.");
    await control.query("COMMIT");

    if (args.mode === "rehearsal") {
      assert(targetDatabase !== workspace.database_name,
        "Safety stop: rehearsal target must not be the live registered Tenant database.");
    }

    tenant = await connect(
      databaseUrl(provisionerUrl, targetDatabase),
      "syncup-incremental-migration-" + args.mode + "-tenant",
    );
    const identity = await tenant.query(
      "SELECT current_database() AS database_name, current_user AS provisioner_role, " +
      "current_setting('transaction_read_only') AS transaction_read_only",
    );
    assert(identity.rows[0].database_name === targetDatabase &&
      identity.rows[0].provisioner_role === "syncup_provisioner" &&
      identity.rows[0].transaction_read_only === "off",
      "Tenant identity/provisioner/writable-session mismatch.");

    const runtime = await tenant.query(
      "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = $1) AS role_exists, " +
      "has_database_privilege($1, current_database(), 'CONNECT') AS can_connect, " +
      "has_schema_privilege($1, 'public', 'USAGE') AS schema_usage, " +
      "(SELECT array_agg(a.privilege_type ORDER BY a.privilege_type) " +
      " FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a " +
      " JOIN pg_roles g ON g.oid = a.grantee " +
      " WHERE d.defaclnamespace = 'public'::regnamespace " +
      " AND d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user) " +
      " AND g.rolname = $1 AND d.defaclobjtype = 'r') AS default_table_privileges",
      [workspace.runtime_role],
    );
    const grants = runtime.rows[0];
    assert(grants.role_exists && grants.can_connect && grants.schema_usage,
      "Tenant runtime role is missing or cannot connect/use public schema.");
    assert(JSON.stringify(grants.default_table_privileges) === JSON.stringify(["DELETE", "INSERT", "SELECT", "UPDATE"]),
      "Provisioner default table privileges do not match the required runtime grants.");

    // Match TenantMigrationRunner's session-level advisory lock key exactly.
    await tenant.query("SELECT pg_advisory_lock(hashtext($1))", [targetDatabase]);
    lockAcquired = true;

    const before = await tenant.query(
      "SELECT " +
      "(SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' " +
      " AND table_name IN ('stocktake_sessions','stocktake_lines')) AS stocktake_tables, " +
      "(SELECT count(*)::int FROM public.tenant_migrations WHERE version=$1) AS ledger_version, " +
      "(SELECT count(*)::int FROM public.tenant_migrations) AS ledger_count, " +
      "(SELECT array_agg(version ORDER BY version) FROM public.tenant_migrations) AS ledger_versions, " +
      "(SELECT count(*)::int FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace " +
      " WHERE n.nspname='public' AND t.typname='StocktakeStatus') AS status_enum, " +
      "(SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) FROM pg_type t " +
      " JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid " +
      " WHERE n.nspname='public' AND t.typname='StockReferenceType') AS stock_reference_values",
      [MIGRATION_VERSION],
    );
    const pre = before.rows[0];
    assert(pre.stocktake_tables === 0 && pre.ledger_version === 0 && pre.status_enum === 0,
      "Migration is already partially or fully applied; refusing to continue.");
    assert(Array.isArray(pre.stock_reference_values) && !pre.stock_reference_values.includes("STOCKTAKE"),
      "StockReferenceType is not at the expected pre-migration state.");
    if (args.mode === "live") {
      assert(pre.ledger_count === 2 &&
        JSON.stringify(pre.ledger_versions) === JSON.stringify(EXPECTED_LEDGER),
        "Live Tenant migration ledger differs from the approved pre-migration baseline.");
      const backupState = backup.manifest.preMigrationState;
      assert(backupState.stocktake_tables === 0 && backupState.stocktake_ledger === 0 &&
        backupState.ledger_count === pre.ledger_count &&
        JSON.stringify(backupState.ledger_versions) === JSON.stringify(pre.ledger_versions) &&
        backupState.status_enum === 0 &&
        !backupState.stock_reference_values.includes("STOCKTAKE"),
        "Live Tenant pre-state differs from the fresh backup manifest.");
    }

    await tenant.query("BEGIN");
    try {
      await tenant.query(migrationSql);
      await tenant.query("INSERT INTO public.tenant_migrations(version) VALUES ($1)", [MIGRATION_VERSION]);
      await tenant.query("COMMIT");
    } catch (error) {
      await tenant.query("ROLLBACK").catch(() => undefined);
      throw error;
    }

    const after = await tenant.query(
      "SELECT " +
      "(SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' " +
      " AND table_name IN ('stocktake_sessions','stocktake_lines')) AS stocktake_tables, " +
      "(SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' " +
      " AND table_name='stocktake_sessions') AS session_columns, " +
      "(SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' " +
      " AND table_name='stocktake_lines') AS line_columns, " +
      "(SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) FROM pg_type t " +
      " JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid " +
      " WHERE n.nspname='public' AND t.typname='StockReferenceType') AS stock_reference_values, " +
      "(SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) FROM pg_type t " +
      " JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid " +
      " WHERE n.nspname='public' AND t.typname='StocktakeStatus') AS stocktake_status_values, " +
      "(SELECT count(*)::int FROM pg_constraint WHERE conname = ANY(ARRAY[" +
      "'stocktake_sessions_pkey','stocktake_sessions_warehouse_id_fkey'," +
      "'stocktake_lines_pkey','stocktake_lines_session_id_fkey'," +
      "'stocktake_lines_variant_id_fkey','stocktake_lines_counted_quantity_check'," +
      "'stocktake_lines_unit_cost_check'])) AS constraint_count, " +
      "(SELECT count(*)::int FROM pg_indexes WHERE schemaname='public' " +
      " AND tablename IN ('stocktake_sessions','stocktake_lines')) AS index_count, " +
      "(SELECT count(*)::int FROM public.stocktake_sessions) AS session_rows, " +
      "(SELECT count(*)::int FROM public.stocktake_lines) AS line_rows, " +
      "(SELECT count(*)::int FROM public.tenant_migrations WHERE version=$1) AS ledger_version",
      [MIGRATION_VERSION],
    );
    const result = after.rows[0];
    assert(result.stocktake_tables === 2, "Post-check failed: expected two Stocktake tables.");
    assert(result.session_columns === 12 && result.line_columns === 9, "Post-check failed: table column counts differ.");
    assert(result.stock_reference_values.includes("STOCKTAKE"), "Post-check failed: STOCKTAKE enum value missing.");
    assert(result.stocktake_status_values.join(",") === "DRAFT,IN_PROGRESS,FINALIZED,CANCELLED",
      "Post-check failed: StocktakeStatus enum labels differ.");
    assert(result.constraint_count === 7, "Post-check failed: expected seven named constraints.");
    assert(result.index_count === 6, "Post-check failed: expected six indexes including primary-key indexes.");
    assert(result.session_rows === 0 && result.line_rows === 0, "Post-check failed: new Stocktake tables are not empty.");
    assert(result.ledger_version === 1, "Post-check failed: migration ledger entry is not unique/present.");

    const tablePrivileges = await tenant.query(
      "SELECT " +
      "has_table_privilege($1, 'public.stocktake_sessions', 'SELECT') AS sessions_select, " +
      "has_table_privilege($1, 'public.stocktake_sessions', 'INSERT') AS sessions_insert, " +
      "has_table_privilege($1, 'public.stocktake_sessions', 'UPDATE') AS sessions_update, " +
      "has_table_privilege($1, 'public.stocktake_sessions', 'DELETE') AS sessions_delete, " +
      "has_table_privilege($1, 'public.stocktake_lines', 'SELECT') AS lines_select, " +
      "has_table_privilege($1, 'public.stocktake_lines', 'INSERT') AS lines_insert, " +
      "has_table_privilege($1, 'public.stocktake_lines', 'UPDATE') AS lines_update, " +
      "has_table_privilege($1, 'public.stocktake_lines', 'DELETE') AS lines_delete, " +
      "has_table_privilege($1, 'public.tenant_migrations', 'SELECT') AS ledger_select, " +
      "has_table_privilege($1, 'public.tenant_migrations', 'INSERT') AS ledger_insert",
      [workspace.runtime_role],
    );
    const p = tablePrivileges.rows[0];
    assert(Object.entries(p).filter(([key]) => key !== "ledger_select" && key !== "ledger_insert")
      .every(([, value]) => value === true), "Runtime role lacks DML access to newly created Stocktake tables.");
    assert(p.ledger_select === true && p.ledger_insert === false,
      "Runtime role must have SELECT-only access to tenant_migrations.");

    console.log("TENANT_INCREMENTAL_MIGRATION_EXECUTOR " + JSON.stringify({
      status: "PASS",
      mode: args.mode.toUpperCase(),
      workspace: { id: workspace.id, slug: workspace.slug, status: workspace.status },
      database: targetDatabase,
      provisionerRole: identity.rows[0].provisioner_role,
      migration: MIGRATION_VERSION,
      migrationSha256,
      backup: backup ? {
        manifestPath: backup.manifestPath,
        archivePath: backup.backupPath,
        sha256: backup.sha256,
      } : null,
      before: pre,
      after: result,
      runtimeGrants: p,
      ledgerAndSchemaCommittedAtomically: true,
      liveTenantDatabaseTouched: args.mode === "live",
      controlDatabaseMutated: false,
    }, null, 2));
  } finally {
    if (tenant && lockAcquired) {
      await tenant.query("SELECT pg_advisory_unlock(hashtext($1))", [targetDatabase]).catch(() => undefined);
    }
    if (tenant) await tenant.end().catch(() => undefined);
    await control.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("TENANT_INCREMENTAL_MIGRATION_EXECUTOR_FAILED " + (error.stack || error.message));
  process.exitCode = 1;
});
