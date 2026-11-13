const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");
const { hash } = require("bcryptjs");
const { Client } = require("pg");
const { WorkspacesService } = require("../dist/core/workspaces/workspaces.service");
const { WorkspaceProvisioningService } = require("../dist/database/workspace-provisioning.service");
const { TenantMigrationRunner } = require("../dist/database/tenant-migration.runner");
const { WorkspaceDatabaseRegistry } = require("../dist/database/workspace-database.registry");
const { StoreLifecycleService } = require("../dist/core/tenant/store-lifecycle.service");
const { RbacService } = require("../dist/core/rbac/rbac.service");

const root = path.resolve(__dirname, "../../..");
const envPath = path.resolve(__dirname, "../.env");
const envText = fs.readFileSync(envPath, "utf8");
for (const line of envText.split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
}
const controlUrl = new URL(process.env.CONTROL_DATABASE_URL || "");
const adminUrl = new URL(process.env.WORKSPACE_DATABASE_ADMIN_URL || "");
if (!["127.0.0.1", "localhost", "::1"].includes(controlUrl.hostname) ||
    controlUrl.pathname !== "/syncup_control" ||
    !["127.0.0.1", "localhost", "::1"].includes(adminUrl.hostname)) {
  throw new Error("Safety stop: E2E provisioning is restricted to the local SyncUp PostgreSQL instance.");
}
const slug = "e2e-commerce-20261106";
const users = [
  { key: "OWNER", email: "e2e-owner@syncup.local", displayName: "E2E Workspace Owner", owner: true },
  { key: "ADMIN", email: "e2e-admin@syncup.local", displayName: "E2E Admin", role: "admin" },
  { key: "MANAGER", email: "e2e-manager@syncup.local", displayName: "E2E Manager", role: "manager" },
  { key: "INVENTORY", email: "e2e-inventory@syncup.local", displayName: "E2E Inventory Staff", role: "inventory_staff" },
  { key: "CASHIER", email: "e2e-cashier@syncup.local", displayName: "E2E Cashier", role: "cashier" }
];
const secrets = Object.fromEntries(users.map(user => [user.key, randomBytes(24).toString("base64url")]));
const setEnv = (text, key, value) => {
  const line = new RegExp("^" + key + "=.*$", "m");
  return line.test(text) ? text.replace(line, key + "=" + value) : text.replace(/\s*$/, "") + "\n" + key + "=" + value + "\n";
};

async function main() {
  const db = new PrismaClient();
  let admin;
  try {
    const existing = await db.workspace.findUnique({ where: { slug } });
    if (existing) throw new Error("E2E workspace slug already exists; refusing to overwrite or duplicate existing test data.");
    const userRows = {};
    for (const user of users) {
      const passwordHash = await hash(secrets[user.key], 12);
      userRows[user.key] = await db.user.upsert({
        where: { email: user.email },
        create: { email: user.email, passwordHash, displayName: user.displayName, status: "ACTIVE" },
        update: { passwordHash, displayName: user.displayName, status: "ACTIVE", isPlatformAdmin: false }
      });
    }

    const provisioning = new WorkspaceProvisioningService(db, new TenantMigrationRunner());
    const workspaces = new WorkspacesService(db, provisioning);
    const workspace = await workspaces.create({
      slug, name: "E2E Commerce Workspace", type: "POS", ownerUserId: userRows.OWNER.id
    });
    if (workspace.status !== "ACTIVE") throw new Error("E2E workspace provisioning did not reach ACTIVE.");

    const workspaceRow = await db.workspace.findUniqueOrThrow({
      where: { slug }, include: { database: true }
    });
    if (!workspaceRow.database) throw new Error("Provisioned E2E workspace database record is missing.");

    admin = new Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    const tenantAdminUrl = new URL(adminUrl);
    tenantAdminUrl.pathname = "/" + workspaceRow.database.databaseName;
    const tenantAdmin = new Client({ connectionString: tenantAdminUrl.toString() });
    await tenantAdmin.connect();
    try {
      const commerceSql = fs.readFileSync(path.join(root, "docs/architecture/tenant-commerce-incremental-upgrade.candidate.sql"), "utf8");
      await tenantAdmin.query(commerceSql);
      const roleName = workspaceRow.database.username.replace(/"/g, '""');
      await tenantAdmin.query('GRANT USAGE ON SCHEMA public TO "' + roleName + '"');
      await tenantAdmin.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "' + roleName + '"');
      await tenantAdmin.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "' + roleName + '"');
    } finally {
      await tenantAdmin.end();
    }

    const membershipRole = async (userId, roleKey) => {
      const role = await db.role.findFirst({ where: { workspaceId: workspaceRow.id, key: roleKey } });
      if (!role) throw new Error("Missing seeded workspace role: " + roleKey);
      const membership = await db.membership.create({
        data: { userId, workspaceId: workspaceRow.id, isOwner: false }
      });
      await db.membershipRole.create({ data: { membershipId: membership.id, roleId: role.id } });
    };
    for (const user of users.filter(item => item.role)) {
      await membershipRole(userRows[user.key].id, user.role);
    }

    const registry = new WorkspaceDatabaseRegistry(db);
    const lifecycle = new StoreLifecycleService(registry);
    const store = await lifecycle.createStore(userRows.OWNER.id, workspaceRow.id, {
      name: "E2E Main Store", slug: "e2e-main-store", branchCode: "HQ", warehouseCode: "MAIN"
    });

    const rbac = new RbacService(db);
    const permissionCases = [
      ["ADMIN", "commerce.store.manage", true],
      ["MANAGER", "commerce.store.manage", true],
      ["INVENTORY", "commerce.store.manage", false],
      ["CASHIER", "commerce.store.manage", false],
      ["ADMIN", "commerce.inventory.receive", true],
      ["MANAGER", "commerce.inventory.receive", true],
      ["INVENTORY", "commerce.inventory.receive", true],
      ["CASHIER", "commerce.inventory.receive", false],
      ["ADMIN", "commerce.inventory.issue", true],
      ["MANAGER", "commerce.inventory.issue", true],
      ["INVENTORY", "commerce.inventory.issue", true],
      ["CASHIER", "commerce.inventory.issue", false],
      ["ADMIN", "commerce.inventory.movement.reverse", true],
      ["MANAGER", "commerce.inventory.movement.reverse", true],
      ["INVENTORY", "commerce.inventory.movement.reverse", false],
      ["CASHIER", "commerce.inventory.movement.reverse", false],
      ["MANAGER", "commerce.inventory.view", true],
      ["INVENTORY", "commerce.inventory.view", true],
      ["CASHIER", "commerce.inventory.view", true]
    ];
    for (const [key, permission, expected] of permissionCases) {
      const actual = await rbac.hasPermission(userRows[key].id, workspaceRow.id, permission);
      if (actual !== expected) throw new Error("RBAC mismatch: " + key + " / " + permission + " expected " + expected + " got " + actual);
    }

    let updatedEnv = envText;
    updatedEnv = setEnv(updatedEnv, "E2E_WORKSPACE_SLUG", slug);
    for (const user of users) {
      updatedEnv = setEnv(updatedEnv, "E2E_" + user.key + "_EMAIL", user.email);
      updatedEnv = setEnv(updatedEnv, "E2E_" + user.key + "_PASSWORD", secrets[user.key]);
    }
    updatedEnv = setEnv(updatedEnv, "E2E_OWNER_EMAIL", users[0].email);
    updatedEnv = setEnv(updatedEnv, "E2E_OWNER_PASSWORD", secrets.OWNER);
    updatedEnv = setEnv(updatedEnv, "E2E_MANAGER_EMAIL", users[2].email);
    updatedEnv = setEnv(updatedEnv, "E2E_MANAGER_PASSWORD", secrets.MANAGER);
    fs.writeFileSync(envPath, updatedEnv, "utf8");

    console.log("PASS E2E control workspace provisioned: " + slug);
    console.log("PASS Isolated tenant database: " + workspaceRow.database.databaseName);
    console.log("PASS Tenant Commerce migration applied to E2E tenant only.");
    console.log("PASS Seeded Store with default Branch and Warehouse: " + store.id);
    console.log("PASS Inventory RBAC matrix: " + permissionCases.length + " assertions.");
    console.log("PASS Dedicated E2E Owner/Admin/Manager/Inventory Staff/Cashier credentials stored in ignored apps/api/.env.");
    console.log("E2E_WORKSPACE_SLUG=" + slug);
    await registry.onModuleDestroy();
  } finally {
    if (admin) await admin.end().catch(() => undefined);
    await db.$disconnect();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
