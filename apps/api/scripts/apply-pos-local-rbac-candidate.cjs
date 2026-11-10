const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const workspaceId = "c0130bf3-c1c0-4dfa-a915-7ca5155cacfd";
const candidatePath = path.resolve(__dirname, "../../../docs/operations/pos-local-rbac-remediation-candidate-2026-11-10.sql");
const envPath = path.resolve(__dirname, "../.env");

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

async function snapshot(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::int FROM public.membership_roles) membership_role_count,
      (SELECT md5(COALESCE(string_agg(membership_id::text || ':' || role_id::text, ',' ORDER BY membership_id,role_id),'')) FROM public.membership_roles) membership_role_hash,
      (SELECT count(*)::int FROM public.permissions) permission_count,
      (SELECT md5(COALESCE(string_agg(key || ':' || id::text, ',' ORDER BY key),'')) FROM public.permissions) permission_hash,
      (SELECT count(*)::int FROM public._prisma_migrations) ledger_count
  `);
  return result.rows[0];
}

async function grants(client, roleKey) {
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
  const envText = fs.readFileSync(envPath, "utf8");
  const match = envText.match(/^CONTROL_DATABASE_URL=(.*)$/m);
  assert(match, "CONTROL_DATABASE_URL is missing from apps/api/.env");
  const connectionString = match[1].trim().replace(/^["']|["']$/g, "");
  const candidateSql = fs.readFileSync(candidatePath, "utf8");
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10000,
    application_name: "syncup-pos-local-rbac-candidate-apply",
  });

  await client.connect();
  try {
    const identity = await client.query(`
      SELECT current_database() db, current_setting('transaction_read_only') read_only
    `);
    assert(identity.rows[0].db === "syncup_control", "Safety stop: connected database is not syncup_control");
    assert(identity.rows[0].read_only === "off", "Safety stop: session is read-only");

    const workspace = await client.query(
      "SELECT id,slug,status FROM public.workspaces WHERE id=$1",
      [workspaceId],
    );
    assert(
      workspace.rowCount === 1 &&
      workspace.rows[0].slug === "pos-local" &&
      workspace.rows[0].status === "ACTIVE",
      "Safety stop: active pos-local workspace identity mismatch",
    );

    const before = await snapshot(client);
    const beforeAdmin = await grants(client, "admin");
    const beforeManager = await grants(client, "manager");
    const beforeCashier = await grants(client, "cashier");
    assert(beforeAdmin?.length === 12, "Safety stop: Admin baseline differs from reviewed 12 grants");
    assert(beforeManager?.length === 27, "Safety stop: Manager baseline differs from reviewed 27 grants");
    assert(beforeCashier === null, "Safety stop: Cashier already exists; refusing unreviewed state");

    await client.query(candidateSql);

    const after = await snapshot(client);
    const admin = await grants(client, "admin");
    const manager = await grants(client, "manager");
    const cashier = await grants(client, "cashier");
    const inventoryStaff = await client.query(
      "SELECT count(*)::int n FROM public.roles WHERE workspace_id=$1 AND key='inventory_staff'",
      [workspaceId],
    );
    const legacy = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM public.role_permissions rp
        JOIN public.roles r ON r.id=rp.role_id
        JOIN public.permissions p ON p.id=rp.permission_id
        WHERE r.workspace_id=$1 AND r.key='admin' AND p.key='commerce.inventory.manage'
      ) present
    `, [workspaceId]);

    assert(admin?.length === 31 && admin.includes("commerce.inventory.manage"),
      "Post-check failed: Admin must have 30 catalog grants plus preserved legacy grant");
    assert(manager?.length === 27 && JSON.stringify(manager) === JSON.stringify(beforeManager),
      "Post-check failed: Manager grants changed");
    assert(cashier?.length === 7, "Post-check failed: Cashier must have exactly seven grants");
    assert(inventoryStaff.rows[0].n === 0, "Post-check failed: Inventory Staff must remain absent");
    assert(legacy.rows[0].present, "Post-check failed: legacy Admin grant was not preserved");
    assert(after.membership_role_count === before.membership_role_count &&
      after.membership_role_hash === before.membership_role_hash,
      "Post-check failed: membership-role assignments changed");
    for (const key of ["permission_count", "permission_hash", "ledger_count"]) {
      assert(after[key] === before[key], "Post-check failed: unrelated/global state changed: " + key);
    }

    console.log(JSON.stringify({
      status: "PASS",
      database: identity.rows[0].db,
      workspace: workspace.rows[0],
      before: {
        adminGrantCount: beforeAdmin.length,
        managerGrantCount: beforeManager.length,
        cashierPresent: beforeCashier !== null,
      },
      after: {
        adminGrantCountIncludingLegacy: admin.length,
        adminCatalogGrantCount: 30,
        managerGrantCount: manager.length,
        cashierGrantCount: cashier.length,
        inventoryStaffPresent: inventoryStaff.rows[0].n === 1,
        legacyInventoryManagePreserved: legacy.rows[0].present,
      },
      membershipAssignmentsUnchanged: true,
      permissionCatalogUnchanged: true,
      migrationLedgerUnchanged: true,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("POS_LOCAL_RBAC_APPLY_FAILED " + (error.stack || error.message));
  process.exitCode = 1;
});
