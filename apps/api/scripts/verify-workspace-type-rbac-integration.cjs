const assert = require("node:assert/strict");
const { Client } = require("pg");
const { PrismaClient } = require("@prisma/client");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { WorkspacesService } = require("../dist/core/workspaces/workspaces.service.js");

const root = path.resolve(__dirname, "../../..");
const adminUrl = process.env.TEST_POSTGRES_ADMIN_URL;
if (!adminUrl) throw new Error("Set TEST_POSTGRES_ADMIN_URL to a localhost-only disposable PostgreSQL admin connection.");
const parsed = new URL(adminUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
  throw new Error("Safety stop: TEST_POSTGRES_ADMIN_URL must point to localhost only.");
}
const migrations = [
  "apps/api/prisma/migrations/20261031000100_control_init/migration.sql",
  "apps/api/prisma/migrations/20261031000200_platform_admin/migration.sql",
  "apps/api/prisma/migrations/202611030001_commerce_store_manage/migration.sql",
  "apps/api/prisma/migrations/202611040001_commerce_inventory_manage/migration.sql",
  "apps/api/prisma/migrations/202611060001_commerce_inventory_operation_permissions/migration.sql",
  "apps/api/prisma/migrations/202611060002_commerce_store_manager_grant/migration.sql",
  "apps/api/prisma/migrations/202611060003_module_registration_activation/migration.sql",
  "apps/api/prisma/migrations/20261113000100_workspace_type_registry/migration.sql",
  "apps/api/prisma/migrations/20261113000200_workspace_profile_lifecycle/migration.sql",
];
const databaseUrl = (name) => { const url = new URL(adminUrl); url.pathname = "/" + name; return url.toString(); };

async function main() {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  const database = "syncup_rbac_" + process.pid + "_" + Date.now();
  let prisma;
  try {
    await admin.query('CREATE DATABASE "' + database + '"');
    const migrationClient = new Client({ connectionString: databaseUrl(database) });
    await migrationClient.connect();
    for (const migration of migrations) {
      await migrationClient.query(fs.readFileSync(path.join(root, migration), "utf8"));
    }
    await migrationClient.end();

    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl(database) } } });
    await prisma.$connect();
    const owner = await prisma.user.create({
      data: { email: "p0.6-owner-" + process.pid + "@syncup.local", passwordHash: "not-used", displayName: "P0.6 Owner" },
    });
    const pos = await prisma.workspace.create({
      data: { slug: "p06-pos-" + process.pid, name: "P0.6 POS", type: "POS", provisioningProfileId: "pos-standard", provisioningProfileVersion: "1.0.0", status: "ACTIVE" },
    });
    const online = await prisma.workspace.create({
      data: { slug: "p06-online-" + process.pid, name: "P0.6 Online", type: "ONLINE", provisioningProfileId: "online-standard", provisioningProfileVersion: "1.0.0", status: "ACTIVE" },
    });
    await prisma.membership.createMany({
      data: [
        { userId: owner.id, workspaceId: pos.id, isOwner: true },
        { userId: owner.id, workspaceId: online.id, isOwner: true },
      ],
    });

    const service = new WorkspacesService(prisma, {});
    await service.ensureDefaultRoles(pos.id);
    await service.ensureDefaultRoles(online.id);

    const foreignUser = await prisma.user.create({
      data: { email: "p07-foreign-" + process.pid + "@syncup.local", passwordHash: "not-used", displayName: "P0.7 Foreign Member" },
    });
    const foreignMembership = await prisma.membership.create({
      data: { userId: foreignUser.id, workspaceId: pos.id, isOwner: false },
    });


    const posRoleKeys = (await prisma.role.findMany({ where: { workspaceId: pos.id }, select: { key: true } })).map((row) => row.key);
    const onlineRoleKeys = (await prisma.role.findMany({ where: { workspaceId: online.id }, select: { key: true } })).map((row) => row.key);
    assert.ok(posRoleKeys.includes("cashier"), "POS must have Cashier");
    assert.ok(!onlineRoleKeys.includes("cashier"), "ONLINE must not have Cashier");
    assert.ok(!onlineRoleKeys.includes("inventory_staff"), "ONLINE must not have Inventory Staff");

    const posCommerceGrants = await prisma.rolePermission.count({
      where: { role: { workspaceId: pos.id }, permission: { key: { startsWith: "commerce." } } },
    });
    const onlineCommerceGrants = await prisma.rolePermission.count({
      where: { role: { workspaceId: online.id }, permission: { key: { startsWith: "commerce." } } },
    });
    assert.ok(posCommerceGrants > 0, "POS default roles must receive profile-allowed Commerce grants");
    assert.equal(onlineCommerceGrants, 0, "ONLINE must never receive Commerce grants");

    await prisma.moduleInstallation.create({
      data: { workspaceId: pos.id, moduleId: "commerce", version: "0.1.0", enabled: true, status: "ENABLED", enabledAt: new Date() },
    });
    const before = {
      permissions: await prisma.permission.count(),
      roles: await prisma.role.count({ where: { workspaceId: { in: [pos.id, online.id] } } }),
      grants: await prisma.rolePermission.count({ where: { role: { workspaceId: { in: [pos.id, online.id] } } } }),
    };
    const posRoles = await service.listRoles(owner.id, pos.id);
    const onlineRoles = await service.listRoles(owner.id, online.id);
    const after = {
      permissions: await prisma.permission.count(),
      roles: await prisma.role.count({ where: { workspaceId: { in: [pos.id, online.id] } } }),
      grants: await prisma.rolePermission.count({ where: { role: { workspaceId: { in: [pos.id, online.id] } } } }),
    };
    assert.deepEqual(after, before, "GET roles must not mutate Control DB rows");
    assert.ok(posRoles.find((role) => role.key === "cashier").permissions.some((permission) => permission.key.startsWith("commerce.")));
    assert.ok(onlineRoles.every((role) => role.permissions.every((permission) => !permission.key.startsWith("commerce."))));

    const posNavigation = await service.getNavigation(owner.id, pos.id);
    const onlineNavigation = await service.getNavigation(owner.id, online.id);
    assert.ok(posNavigation.items.some((item) => item.id === "pos"));
    assert.ok(!onlineNavigation.items.some((item) => ["pos", "orders", "products", "inventory", "stores"].includes(item.id)));

    await assert.rejects(
      service.updateRolePermissions(owner.id, online.id, "member", ["commerce.sales.create"]),
      (error) => error.status === 400,
    );
    await assert.rejects(
      service.addMember(owner.id, online.id, "nobody@example.test", "cashier"),
      (error) => error.status === 400,
    );

    await assert.rejects(service.updateMemberRole(owner.id, online.id, foreignMembership.id, "member"), (error) => error.status === 404);
    await assert.rejects(service.removeMember(owner.id, online.id, foreignMembership.id), (error) => error.status === 404);

    console.log("PASS Disposable Control DB isolates POS/ONLINE default roles and grants");
    console.log("PASS GET roles is read-only; navigation and permission filters respect enabled modules and Workspace Type");
    console.log("PASS Cross-type permission edits, role assignment and foreign Workspace membership IDs are rejected without persistent DB changes");
  } finally {
    if (prisma) await prisma.$disconnect().catch(() => undefined);
    await admin.query('DROP DATABASE IF EXISTS "' + database + '"').catch(() => undefined);
    await admin.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
