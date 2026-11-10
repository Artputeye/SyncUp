const assert = require("node:assert/strict");
const { Client } = require("pg");

async function main() {
  const control = new Client({ connectionString: process.env.CONTROL_DATABASE_URL });
  await control.connect();
  let posTenant;
  try {
    const pos = await control.query(
      "SELECT w.id,d.database_name FROM workspaces w JOIN workspace_databases d ON d.workspace_id=w.id WHERE w.slug='pos-local' AND w.status='ACTIVE'",
    );
    assert.equal(pos.rowCount, 1, "pos-local must remain active.");
    const workspaceId = pos.rows[0].id;
    const installations = await control.query(
      "SELECT count(*)::int AS count FROM module_installations WHERE workspace_id=$1 AND module_id='commerce'",
      [workspaceId],
    );
    assert.equal(installations.rows[0].count, 0, "Commerce must not be installed in pos-local.");

    const manager = await control.query(
      "SELECT m.is_owner, r.key AS role_key, " +
      "EXISTS(SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=r.id AND p.key='modules.manage') AS can_manage_modules " +
      "FROM memberships m JOIN users u ON u.id=m.user_id " +
      "LEFT JOIN membership_roles mr ON mr.membership_id=m.id LEFT JOIN roles r ON r.id=mr.role_id " +
      "WHERE m.workspace_id=$1 AND u.email='manager-e2e@syncup.local'",
      [workspaceId],
    );
    assert.ok(manager.rows.some((row) => row.role_key === "manager" && row.can_manage_modules),
      "pos-local production Manager must retain modules.manage.");

    const runtimeGrants = await control.query(
      "SELECT has_table_privilege(current_user,'public.platform_audit_logs','SELECT') AS can_select," +
      "has_table_privilege(current_user,'public.platform_audit_logs','INSERT') AS can_insert",
    );
    assert.ok(runtimeGrants.rows[0].can_select && runtimeGrants.rows[0].can_insert,
      "Control runtime audit privileges are missing.");

    const adminUrl = new URL(process.env.WORKSPACE_DATABASE_ADMIN_URL);
    adminUrl.pathname = "/" + pos.rows[0].database_name;
    posTenant = new Client({ connectionString: adminUrl.toString() });
    await posTenant.connect();
    const hierarchy = await posTenant.query(
      "SELECT s.id AS store_id,s.name AS store_name,s.slug,s.status AS store_status," +
      "b.id AS branch_id,b.name AS branch_name,b.code AS branch_code,b.status AS branch_status,b.is_default AS branch_default," +
      "h.id AS warehouse_id,h.name AS warehouse_name,h.code AS warehouse_code,h.status AS warehouse_status,h.is_default AS warehouse_default " +
      "FROM stores s JOIN branches b ON b.store_id=s.id JOIN warehouses h ON h.branch_id=b.id WHERE s.slug='main-store'",
    );
    assert.equal(hierarchy.rowCount, 1, "Expected the approved Main Store / HQ / MAIN hierarchy.");
    const item = hierarchy.rows[0];
    assert.equal(item.store_name, "Main Store");
    assert.equal(item.store_status, "ACTIVE");
    assert.equal(item.branch_name, "สำนักงานใหญ่");
    assert.equal(item.branch_code, "HQ");
    assert.equal(item.branch_status, "ACTIVE");
    assert.equal(item.branch_default, true);
    assert.equal(item.warehouse_name, "คลังหลัก");
    assert.equal(item.warehouse_code, "MAIN");
    assert.equal(item.warehouse_status, "ACTIVE");
    assert.equal(item.warehouse_default, true);
    const storeAudit = await posTenant.query(
      "SELECT count(*)::int AS count FROM audit_logs WHERE action='STORE_CREATED' AND entity_id=$1",
      [item.store_id],
    );
    assert.equal(storeAudit.rows[0].count, 1, "Main Store creation audit event missing.");
    const posLedger = await posTenant.query(
      "SELECT count(*)::int AS count FROM tenant_migrations WHERE version='202611030001_tenant_commerce'",
    );
    assert.equal(posLedger.rows[0].count, 1, "pos-local Commerce tenant schema migration must remain applied.");

    const e2e = await control.query(
      "SELECT w.id,mi.status::text,mi.enabled,mi.id AS installation_id " +
      "FROM workspaces w JOIN module_installations mi ON mi.workspace_id=w.id AND mi.module_id='commerce' " +
      "WHERE w.slug='e2e-commerce-20261106'",
    );
    assert.equal(e2e.rowCount, 1, "E2E Commerce installation record missing.");
    assert.equal(e2e.rows[0].status, "DISABLED");
    assert.equal(e2e.rows[0].enabled, false);
    const e2eAudit = await control.query(
      "SELECT action FROM platform_audit_logs WHERE workspace_id=$1 AND entity_id=$2",
      [e2e.rows[0].id,e2e.rows[0].installation_id],
    );
    for (const action of ["MODULE_INSTALLED","MODULE_ENABLED","MODULE_DISABLED"]) {
      assert.ok(e2eAudit.rows.some((row) => row.action === action), "E2E audit missing " + action);
    }
    console.log("PASS pos-local Main Store, HQ Branch and MAIN Warehouse are active and default as approved.");
    console.log("PASS pos-local has no Commerce Module Installation; tenant Commerce migration remains applied.");
    console.log("PASS pos-local Manager retains modules.manage; Control runtime has Audit Log grants.");
    console.log("PASS E2E Commerce remains DISABLED with lifecycle audit history.");
  } finally {
    if (posTenant) await posTenant.end().catch(() => undefined);
    await control.end();
  }
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
