const { Client } = require("pg");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");

const adminUrl = process.env.TEST_POSTGRES_ADMIN_URL;
const backupPath = "D:\\Back up\\SyncUp\\Backups\\syncup_control_20261107022928_d9d27b00.dump";
const expectedBackupSha256 = "f3f5d5ef33a11153a71b8fd640a5b8ec96a70b0dad15e23f6d81cad601cc3992";
const workspaceId = "c0130bf3-c1c0-4dfa-a915-7ca5155cacfd";
const candidatePath = path.resolve(__dirname, "../../../docs/operations/pos-local-rbac-remediation-candidate-2026-11-10.sql");

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
function runPgRestore(database, env) {
  const result = require("node:child_process").spawnSync(
    "pg_restore",
    [...pgArgs(database), "--no-owner", "--no-acl", "--exit-on-error", backupPath],
    { encoding: "utf8", windowsHide: true, env },
  );
  if (result.error || result.status !== 0) {
    throw new Error("pg_restore failed: " + (result.error?.message || result.stderr || result.stdout));
  }
}
async function connect(database) {
  const client = new Client({
    connectionString: dbUrl(database),
    connectionTimeoutMillis: 10000,
    application_name: "syncup-r2-rbac-candidate-rehearsal",
  });
  await client.connect();
  return client;
}
async function snapshot(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::int FROM public.membership_roles) membership_role_count,
      (SELECT md5(COALESCE(string_agg(membership_id::text || ':' || role_id::text, ',' ORDER BY membership_id,role_id),'')) FROM public.membership_roles) membership_role_hash,
      (SELECT count(*)::int FROM public.permissions) permission_count,
      (SELECT md5(COALESCE(string_agg(key || ':' || id::text, ',' ORDER BY key),'')) FROM public.permissions) permission_hash,
      (SELECT count(*)::int FROM public.roles WHERE workspace_id <> $1) other_role_count,
      (SELECT md5(COALESCE(string_agg(workspace_id::text || ':' || key || ':' || id::text, ',' ORDER BY workspace_id,key),'')) FROM public.roles WHERE workspace_id <> $1) other_role_hash,
      (SELECT count(*)::int FROM public.role_permissions rp JOIN public.roles r ON r.id=rp.role_id WHERE r.workspace_id <> $1) other_grant_count,
      (SELECT md5(COALESCE(string_agg(r.id::text || ':' || rp.permission_id::text, ',' ORDER BY r.id,rp.permission_id),'')) FROM public.role_permissions rp JOIN public.roles r ON r.id=rp.role_id WHERE r.workspace_id <> $1) other_grant_hash,
      (SELECT count(*)::int FROM public._prisma_migrations) ledger_count
  `, [workspaceId]);
  return result.rows[0];
}
async function roleKeys(client, roleKey) {
  const result = await client.query(`
    SELECT array_agg(p.key ORDER BY p.key) keys
    FROM public.roles r
    LEFT JOIN public.role_permissions rp ON rp.role_id=r.id
    LEFT JOIN public.permissions p ON p.id=rp.permission_id
    WHERE r.workspace_id=$1 AND r.key=$2
  `, [workspaceId, roleKey]);
  return result.rows[0]?.keys || null;
}
async function main() {
  assert(adminUrl, "TEST_POSTGRES_ADMIN_URL is required");
  const parsed = new URL(adminUrl);
  assert(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname), "Safety stop: admin URL must be localhost");
  assert(parsed.pathname === "/postgres", "Safety stop: admin URL must connect to postgres maintenance DB");
  assert(fs.existsSync(backupPath), "Pinned Control backup not found");
  const backupHash = createHash("sha256").update(fs.readFileSync(backupPath)).digest("hex");
  assert(backupHash === expectedBackupSha256, "Pinned Control backup SHA-256 mismatch");
  assert(fs.existsSync(candidatePath), "RBAC candidate SQL not found");
  const candidateSql = fs.readFileSync(candidatePath, "utf8");

  const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
  const rehearsalDb = "syncup_r2_rbac_rehearsal_" + suffix;
  const admin = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 10000 });
  await admin.connect();
  let client;
  let created = false;
  try {
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [rehearsalDb]);
    assert(exists.rowCount === 0, "Safety stop: rehearsal database collision");
    await admin.query("CREATE DATABASE " + quoteId(rehearsalDb));
    created = true;
    runPgRestore(rehearsalDb, {
      ...process.env,
      PGPASSWORD: decodeURIComponent(parsed.password),
    });
    client = await connect(rehearsalDb);

    const identity = await client.query(
      "SELECT current_database() db, current_setting('transaction_read_only') ro"
    );
    assert(identity.rows[0].db === rehearsalDb && identity.rows[0].ro === "off",
      "Restored disposable DB identity mismatch");

    const workspace = await client.query(
      "SELECT slug,status FROM public.workspaces WHERE id=$1", [workspaceId]
    );
    assert(workspace.rowCount === 1 && workspace.rows[0].slug === "pos-local" && workspace.rows[0].status === "ACTIVE",
      "Backup does not contain the expected active pos-local workspace");

    const beforeSnapshot = await snapshot(client);
    const beforeAdmin = await roleKeys(client, "admin");
    const beforeManager = await roleKeys(client, "manager");
    const beforeCashier = await roleKeys(client, "cashier");
    const legacyBefore = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM public.role_permissions rp
        JOIN public.roles r ON r.id=rp.role_id
        JOIN public.permissions p ON p.id=rp.permission_id
        WHERE r.workspace_id=$1 AND r.key='admin' AND p.key='commerce.inventory.manage'
      ) value
    `, [workspaceId]);
    assert(beforeManager?.length === 27, "Backup Manager matrix is not the reviewed 27-key set");
    assert(beforeCashier === null, "Backup already has Cashier role; review current role state before test");

    await client.query(candidateSql);
    const afterFirst = await snapshot(client);
    const adminAfter = await roleKeys(client, "admin");
    const managerAfter = await roleKeys(client, "manager");
    const cashierAfter = await roleKeys(client, "cashier");
    const inventoryStaff = await client.query(
      "SELECT count(*)::int n FROM public.roles WHERE workspace_id=$1 AND key='inventory_staff'", [workspaceId]
    );
    const legacyAfter = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM public.role_permissions rp
        JOIN public.roles r ON r.id=rp.role_id
        JOIN public.permissions p ON p.id=rp.permission_id
        WHERE r.workspace_id=$1 AND r.key='admin' AND p.key='commerce.inventory.manage'
      ) value
    `, [workspaceId]);

    assert(adminAfter?.length === 31 && adminAfter.includes("commerce.inventory.manage"),
      "Admin must have 30 catalog grants plus the preserved legacy grant");
    assert(managerAfter?.length === 27 && JSON.stringify(managerAfter) === JSON.stringify(beforeManager),
      "Manager grants changed");
    assert(cashierAfter?.length === 7, "Cashier must have exactly seven grants");
    assert(inventoryStaff.rows[0].n === 0, "Inventory Staff must remain unprovisioned");
    assert(legacyBefore.rows[0].value === legacyAfter.rows[0].value,
      "Legacy commerce.inventory.manage grant changed");
    assert(afterFirst.membership_role_count === beforeSnapshot.membership_role_count &&
      afterFirst.membership_role_hash === beforeSnapshot.membership_role_hash,
      "Membership-role assignments changed");
    for (const key of ["permission_count","permission_hash","other_role_count","other_role_hash",
      "other_grant_count","other_grant_hash","ledger_count"]) {
      assert(afterFirst[key] === beforeSnapshot[key], "Unrelated/global state changed: " + key);
    }

    await client.query(candidateSql);
    const afterSecond = await snapshot(client);
    const secondAdmin = await roleKeys(client, "admin");
    const secondManager = await roleKeys(client, "manager");
    const secondCashier = await roleKeys(client, "cashier");
    assert(JSON.stringify(afterSecond) === JSON.stringify(afterFirst) &&
      JSON.stringify(secondAdmin) === JSON.stringify(adminAfter) &&
      JSON.stringify(secondManager) === JSON.stringify(managerAfter) &&
      JSON.stringify(secondCashier) === JSON.stringify(cashierAfter),
      "Second candidate run changed role/grant state");

    console.log("R2_RBAC_CANDIDATE_REHEARSAL " + JSON.stringify({
      status: "PASS",
      sourceBackup: path.basename(backupPath),
      backupSha256: backupHash,
      rehearsalDb,
      workspace: workspace.rows[0],
      before: {
        adminCatalogGrantCount: beforeAdmin?.filter((key) => key !== "commerce.inventory.manage").length,
        adminTotalGrantCount: beforeAdmin?.length,
        managerGrantCount: beforeManager.length,
        cashierRolePresent: beforeCashier !== null,
      },
      after: {
        adminGrantCountIncludingLegacy: adminAfter.length,
        adminCatalogGrantCount: 30,
        managerGrantCount: managerAfter.length,
        cashierGrantCount: cashierAfter.length,
        inventoryStaffRolePresent: inventoryStaff.rows[0].n === 1,
        legacyInventoryManagePreserved: legacyAfter.rows[0].value,
      },
      membershipAssignmentsUnchanged: true,
      unrelatedWorkspacesUnchanged: true,
      permissionsCatalogUnchanged: true,
      migrationLedgerUnchanged: true,
      secondRunIdempotent: true,
      sourceControlDbTouched: false,
      posLocalTenantDbTouched: false,
      cleanup: "The disposable restored database is dropped in finally.",
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
  console.error("R2_RBAC_CANDIDATE_REHEARSAL_FAILED " + (error.stack || error.message));
  process.exitCode = 1;
});
