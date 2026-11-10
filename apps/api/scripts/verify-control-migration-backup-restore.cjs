const { Client } = require("pg");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const root = path.resolve(__dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const adminUrl = process.env.TEST_POSTGRES_ADMIN_URL;
if (!adminUrl) throw new Error("Set TEST_POSTGRES_ADMIN_URL to a localhost-only disposable PostgreSQL admin connection.");
const parsed = new URL(adminUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) throw new Error("Safety stop: TEST_POSTGRES_ADMIN_URL must point to localhost only.");

const controlInit = read("apps/api/prisma/migrations/20261031000100_control_init/migration.sql");
const platformAdmin = read("apps/api/prisma/migrations/20261031000200_platform_admin/migration.sql");
const permissionMigration = read("apps/api/prisma/migrations/202611030001_commerce_store_manage/migration.sql");
const storeManagerGrantMigration = read("apps/api/prisma/migrations/202611060002_commerce_store_manager_grant/migration.sql");
const tenantBaseline = read("apps/api/prisma/tenant/migrations/20261031000100_tenant_baseline.sql");
const tenantIncremental = read("docs/architecture/tenant-commerce-incremental-upgrade.candidate.sql");

function assert(ok, message) { if (!ok) throw new Error(message); }
function connectionArgs(database) {
  return ["--host", parsed.hostname, "--port", parsed.port || "5432", "--username", decodeURIComponent(parsed.username), "--dbname", database];
}
function runPgTool(name, args, backupPath) {
  const result = spawnSync(name, args, { encoding: "utf8", env: { ...process.env, PGPASSWORD: decodeURIComponent(parsed.password) }, windowsHide: true });
  if (result.error) throw new Error(name + " is unavailable: " + result.error.message);
  if (result.status !== 0) throw new Error(name + " failed (exit " + result.status + "): " + (result.stderr || result.stdout));
}
async function connect(database) {
  const u = new URL(adminUrl); u.pathname = "/" + database;
  const client = new Client({ connectionString: u.toString(), connectionTimeoutMillis: 5000 });
  await client.connect(); return client;
}

async function main() {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  const suffix = process.pid + "_" + Date.now();
  const controlDb = "syncup_ctrl_test_" + suffix;
  const tenantDb = "syncup_tenant_backup_src_" + suffix;
  const restoreDb = "syncup_tenant_backup_dst_" + suffix;
  const databases = [controlDb, tenantDb, restoreDb];
  const clients = [];
  const backupPath = path.join(os.tmpdir(), "syncup_tenant_backup_" + suffix + ".dump");
  try {
    for (const database of databases) await admin.query('CREATE DATABASE "' + database + '"');

    const control = await connect(controlDb); clients.push(control);
    await control.query(controlInit);
    await control.query(platformAdmin);
    await control.query("BEGIN");
    await control.query(
      "INSERT INTO roles (id,workspace_id,key,name,is_system) VALUES ($1,$4,'admin','Admin',TRUE),($2,$4,'manager','Manager',TRUE),($3,$4,'viewer','Viewer',TRUE)",
      [randomUUID(), randomUUID(), randomUUID(), randomUUID()],
    );
    await control.query(permissionMigration);
    await control.query(permissionMigration);
    const permission = await control.query("SELECT id FROM permissions WHERE key='commerce.store.manage'");
    assert(permission.rowCount === 1, "Permission migration created duplicate permission rows");
    const grants = await control.query(
      "SELECT r.key FROM roles r JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE p.key='commerce.store.manage' ORDER BY r.key",
    );
    assert(grants.rows.map((row) => row.key).join(",") === "admin", "Permission must be assigned to admin only; received: " + grants.rows.map((row) => row.key).join(","));
    await control.query("COMMIT");
    console.log("PASS Control DB migration: permission is idempotent and granted to Admin only");

    const tenant = await connect(tenantDb); clients.push(tenant);
    await tenant.query(tenantBaseline);
    await tenant.query("INSERT INTO tenant_migrations(version) VALUES ('20261031000100_tenant_baseline')");
    await tenant.query(tenantIncremental);
    const storeId = randomUUID();
    const branchId = randomUUID();
    const warehouseId = randomUUID();
    await tenant.query("BEGIN");
    await tenant.query(
      "INSERT INTO stores (id,name,slug,normalized_slug,updated_at) VALUES ($1,'Backup rehearsal','backup-rehearsal','backup-rehearsal',NOW())",
      [storeId],
    );
    await tenant.query(
      "INSERT INTO branches (id,store_id,code,name,status,is_default,updated_at) VALUES ($1,$2,'MAIN','Main Branch','ACTIVE',TRUE,NOW())",
      [branchId, storeId],
    );
    await tenant.query(
      "INSERT INTO warehouses (id,branch_id,code,name,status,is_default,updated_at) VALUES ($1,$2,'MAIN','Main Warehouse','ACTIVE',TRUE,NOW())",
      [warehouseId, branchId],
    );
    await tenant.query("COMMIT");
    await tenant.query("INSERT INTO tenant_settings(key,value) VALUES ($1,$2::jsonb)", ["backup-rehearsal", JSON.stringify({ survives: true })]);
    const before = await tenant.query(
      "SELECT (SELECT count(*)::int FROM stores WHERE id=$1) AS stores, (SELECT count(*)::int FROM tenant_migrations WHERE version='202611030001_tenant_commerce') AS ledger, (SELECT value->>'survives' FROM tenant_settings WHERE key='backup-rehearsal') AS sentinel",
      [storeId],
    );
    assert(before.rows[0].stores === 1 && before.rows[0].ledger === 1 && before.rows[0].sentinel === "true", "Source database seed verification failed");

    runPgTool("pg_dump", [...connectionArgs(tenantDb), "--format=custom", "--no-owner", "--no-acl", "--file", backupPath], backupPath);
    assert(fs.existsSync(backupPath) && fs.statSync(backupPath).size > 0, "pg_dump did not create a non-empty backup");
    runPgTool("pg_restore", [...connectionArgs(restoreDb), "--no-owner", "--no-acl", "--exit-on-error", backupPath], backupPath);

    const restored = await connect(restoreDb); clients.push(restored);
    const after = await restored.query(
      "SELECT (SELECT count(*)::int FROM stores WHERE id=$1) AS stores, (SELECT count(*)::int FROM tenant_migrations WHERE version='202611030001_tenant_commerce') AS ledger, (SELECT value->>'survives' FROM tenant_settings WHERE key='backup-rehearsal') AS sentinel",
      [storeId],
    );
    assert(after.rows[0].stores === 1 && after.rows[0].ledger === 1 && after.rows[0].sentinel === "true", "Restored database schema/data/ledger verification failed");
    const identity = await restored.query("SELECT current_database() AS database_name");
    assert(identity.rows[0].database_name === restoreDb, "Restore verification connected to an unexpected database");
    console.log("PASS Backup/restore rehearsal: Tenant schema, Commerce ledger and sentinel data restored to isolated database");
    console.log("PASS Disposable Control DB + Tenant backup/restore verification completed.");
  } finally {
    for (const client of clients) await client.end().catch(() => undefined);
    for (const database of databases) {
      await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1", [database]).catch(() => undefined);
      await admin.query('DROP DATABASE IF EXISTS "' + database + '"').catch(() => undefined);
    }
    await admin.end();
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
