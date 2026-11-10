const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Client } = require("pg");

const root = path.resolve(__dirname, "../../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const adminUrl = process.env.TEST_POSTGRES_ADMIN_URL;
if (!adminUrl) throw new Error("Set TEST_POSTGRES_ADMIN_URL to a localhost-only disposable PostgreSQL admin connection.");
const parsed = new URL(adminUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
  throw new Error("Safety stop: TEST_POSTGRES_ADMIN_URL must point to localhost only.");
}

const migrations = [
  "apps/api/prisma/migrations/202611030001_commerce_store_manage/migration.sql",
  "apps/api/prisma/migrations/202611040001_commerce_inventory_manage/migration.sql",
  "apps/api/prisma/migrations/202611060001_commerce_inventory_operation_permissions/migration.sql",
  "apps/api/prisma/migrations/202611060002_commerce_store_manager_grant/migration.sql",
  "apps/api/prisma/migrations/202611060005_inventory_role_matrix_alignment/migration.sql"
].map(read);

async function connect(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  await client.connect();
  return client;
}

async function main() {
  const admin = await connect(adminUrl);
  const database = "syncup_control_rbac_" + process.pid + "_" + Date.now();
  let db;
  try {
    await admin.query('CREATE DATABASE "' + database + '"');
    const url = new URL(adminUrl);
    url.pathname = "/" + database;
    db = await connect(url.toString());

    await db.query(`CREATE TABLE roles (
      id uuid PRIMARY KEY, workspace_id uuid NULL, key varchar(80) NOT NULL,
      name varchar(120) NOT NULL, is_system boolean NOT NULL DEFAULT false,
      UNIQUE (workspace_id, key)
    )`);
    await db.query(`CREATE TABLE permissions (
      id uuid PRIMARY KEY, key varchar(160) UNIQUE NOT NULL, description varchar(255)
    )`);
    await db.query(`CREATE TABLE role_permissions (
      role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      PRIMARY KEY (role_id, permission_id)
    )`);

    const workspaces = [randomUUID(), randomUUID()];
    for (const workspaceId of workspaces) {
      for (const key of ["admin", "manager", "inventory_staff", "cashier"]) {
        await db.query(
          "INSERT INTO roles(id,workspace_id,key,name,is_system) VALUES($1,$2,$3,$3,true)",
          [randomUUID(), workspaceId, key],
        );
      }
    }

    for (const migration of migrations) await db.query(migration);
    for (const migration of migrations) await db.query(migration);

    async function grants(permission) {
      const result = await db.query(
        "SELECT r.workspace_id::text AS workspace_id, r.key FROM roles r JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE p.key=$1 ORDER BY r.workspace_id,r.key",
        [permission],
      );
      return result.rows.map(row => ({ workspaceId: row.workspace_id, role: row.key }));
    }
    for (const workspaceId of workspaces) {
      const expected = {
        "commerce.store.manage": ["admin", "manager"],
        "commerce.inventory.manage": ["admin"],
        "commerce.inventory.reservation.manage": ["admin", "inventory_staff", "manager"],
        "commerce.inventory.receive": ["admin", "inventory_staff", "manager"],
        "commerce.inventory.issue": ["admin", "inventory_staff", "manager"],
        "commerce.inventory.movement.reverse": ["admin", "manager"],
        "commerce.inventory.adjust": ["admin", "inventory_staff", "manager"],
        "commerce.inventory.transfer": ["admin", "inventory_staff", "manager"],
        "commerce.inventory.stocktake": ["admin", "inventory_staff", "manager"]
      };
      for (const [permission, roles] of Object.entries(expected)) {
        const actual = (await grants(permission))
          .filter(row => row.workspaceId === workspaceId)
          .map(row => row.role);
        assert.deepEqual(actual, roles, permission + " grants mismatch for workspace " + workspaceId);
      }
      const cashierWrites = await db.query(
        "SELECT count(*)::int AS n FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id WHERE r.workspace_id=$1 AND r.key='cashier' AND ((p.key LIKE 'commerce.inventory.%' AND p.key <> 'commerce.inventory.view') OR p.key='commerce.store.manage')",
        [workspaceId],
      );
      assert.equal(cashierWrites.rows[0].n, 0, "Cashier must not receive Store or Inventory write permissions");
    }

    const permissionCounts = await db.query(
      "SELECT key,count(*)::int AS n FROM permissions WHERE key IN ('commerce.store.manage','commerce.inventory.manage','commerce.inventory.reservation.manage','commerce.inventory.receive','commerce.inventory.issue','commerce.inventory.movement.reverse','commerce.inventory.adjust','commerce.inventory.transfer','commerce.inventory.stocktake') GROUP BY key",
    );
    assert.equal(permissionCounts.rows.length, 9, "All expected permission keys must exist exactly once");
    assert(permissionCounts.rows.every(row => row.n === 1), "Permission keys must be unique");
    console.log("PASS Control DB permission migrations are idempotent across two existing Workspaces.");
    console.log("PASS Store management: Admin and Manager; legacy inventory.manage: Admin only.");
    console.log("PASS Inventory operations: Admin/Manager/Inventory Staff grants align with the role catalog; Inventory Staff cannot reverse movements; Cashier has no write grants.");
  } finally {
    if (db) await db.end().catch(() => undefined);
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1", [database]).catch(() => undefined);
    await admin.query('DROP DATABASE IF EXISTS "' + database + '"').catch(() => undefined);
    await admin.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
