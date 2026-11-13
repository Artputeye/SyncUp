const { Client } = require("pg");
const { PrismaClient } = require("@prisma/client");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { ModuleActivationService } = require("../dist/core/modules/module-activation.service");
const { ModuleRegistryService } = require("../dist/core/modules/module-registry.service");
const { RbacService } = require("../dist/core/rbac/rbac.service");

const root = path.resolve(__dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
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
const modulePermissions = [
  "commerce.store.view", "commerce.store.manage", "commerce.warehouse.view",
  "commerce.warehouse.manage", "commerce.product.view", "commerce.product.create",
  "commerce.product.update", "commerce.product.archive", "commerce.pricing.manage",
  "commerce.inventory.view", "commerce.inventory.reservation.manage",
  "commerce.inventory.receive", "commerce.inventory.issue",
  "commerce.inventory.movement.reverse", "commerce.inventory.adjust",
  "commerce.inventory.transfer", "commerce.inventory.stocktake",
  "commerce.sales.view", "commerce.sales.create", "commerce.sales.discount",
  "commerce.sales.void", "commerce.orders.view", "commerce.orders.manage",
  "commerce.reports.view", "modules.manage",
];

function assert(ok, message) { if (!ok) throw new Error(message); }
function argsFor(database) {
  return ["--host", parsed.hostname, "--port", parsed.port || "5432", "--username",
    decodeURIComponent(parsed.username), "--dbname", database];
}
function runTool(name, args, env) {
  const result = spawnSync(name, args, { encoding: "utf8", env, windowsHide: true });
  if (result.error) throw new Error(name + " unavailable: " + result.error.message);
  if (result.status !== 0) throw new Error(name + " failed: " + (result.stderr || result.stdout));
}
function databaseUrl(database) {
  const u = new URL(adminUrl); u.pathname = "/" + database; return u.toString();
}
async function connect(database) {
  const client = new Client({ connectionString: databaseUrl(database), connectionTimeoutMillis: 5000 });
  await client.connect(); return client;
}
function expectBadRequest(promise, label) {
  return promise.then(() => { throw new Error(label + " unexpectedly succeeded"); }, (error) => {
    assert(error.status === 400, label + " returned unexpected error: " + error.message);
  });
}
function expectConflict(promise, label) {
  return promise.then(() => { throw new Error(label + " unexpectedly succeeded"); }, (error) => {
    assert(error.status === 409, label + " returned unexpected error: " + error.message);
  });
}
function expectForbidden(promise, label) {
  return promise.then(() => { throw new Error(label + " unexpectedly succeeded"); }, (error) => {
    assert(error.status === 403 || error.status === 404, label + " returned unexpected error: " + error.message);
  });
}

async function main() {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  const suffix = process.pid + "_" + Date.now();
  const sourceDb = "syncup_module_src_" + suffix;
  const restoreDb = "syncup_module_dst_" + suffix;
  const backupPath = path.join(os.tmpdir(), "syncup_module_" + suffix + ".dump");
  const clients = [];
  let prisma;
  try {
    await admin.query('CREATE DATABASE "' + sourceDb + '"');
    await admin.query('CREATE DATABASE "' + restoreDb + '"');
    const source = await connect(sourceDb); clients.push(source);
    for (const migration of migrations) await source.query(read(migration));
    console.log("PASS Migration SQL applies in a fresh disposable Control DB");

    const workspaceId = randomUUID();
    const ownerId = randomUUID();
    const managerId = randomUUID();
    const deniedId = randomUUID();
    const managerRoleId = randomUUID();
    const memberRoleId = randomUUID();
    const ownerMembershipId = randomUUID();
    const managerMembershipId = randomUUID();
    const deniedMembershipId = randomUUID();

    await source.query(
      "INSERT INTO workspaces(id,slug,name,type,provisioning_profile_id,provisioning_profile_version,status,created_at,updated_at) VALUES ($1,'module-test','Module Test','POS','pos-standard','1.0.0','ACTIVE',NOW(),NOW())",
      [workspaceId],
    );
    for (const [id,email] of [[ownerId,"owner@module-test.local"],[managerId,"manager@module-test.local"],[deniedId,"denied@module-test.local"]]) {
      await source.query(
        "INSERT INTO users(id,email,password_hash,display_name,status,created_at,updated_at) VALUES ($1,$2,'not-used','Test User','ACTIVE',NOW(),NOW())",
        [id,email],
      );
    }
    await source.query(
      "INSERT INTO roles(id,workspace_id,key,name,is_system) VALUES ($1,$3,'manager','Manager',TRUE),($2,$3,'member','Member',TRUE)",
      [managerRoleId,memberRoleId,workspaceId],
    );
    await source.query(
      "INSERT INTO permissions(id,key,description) VALUES ($1,'modules.manage','Manage modules') ON CONFLICT(key) DO NOTHING",
      [randomUUID()],
    );
    for (const key of modulePermissions) {
      await source.query(
        "INSERT INTO permissions(id,key,description) VALUES ($1,$2,$2) ON CONFLICT(key) DO NOTHING",
        [randomUUID(),key],
      );
    }
    const managePermission = await source.query("SELECT id FROM permissions WHERE key='modules.manage'");
    await source.query(
      "INSERT INTO role_permissions(role_id,permission_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [managerRoleId,managePermission.rows[0].id],
    );
    await source.query(
      "INSERT INTO memberships(id,user_id,workspace_id,is_owner) VALUES ($1,$2,$5,TRUE),($3,$4,$5,FALSE),($6,$7,$5,FALSE)",
      [ownerMembershipId,ownerId,managerMembershipId,managerId,workspaceId,deniedMembershipId,deniedId],
    );
    await source.query(
      "INSERT INTO membership_roles(membership_id,role_id) VALUES ($1,$2),($3,$4)",
      [managerMembershipId,managerRoleId,deniedMembershipId,memberRoleId],
    );
    await source.query("CREATE TABLE tenant_migrations(version VARCHAR(120) PRIMARY KEY, applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    await source.query("INSERT INTO tenant_migrations(version) VALUES ('202611030001_tenant_commerce')");

    runTool("pg_dump", [...argsFor(sourceDb), "--format=custom", "--no-owner", "--no-acl", "--file", backupPath], {
      ...process.env, PGPASSWORD: decodeURIComponent(parsed.password),
    });
    assert(fs.existsSync(backupPath) && fs.statSync(backupPath).size > 0, "Control DB backup is empty");
    runTool("pg_restore", [...argsFor(restoreDb), "--no-owner", "--no-acl", "--exit-on-error", backupPath], {
      ...process.env, PGPASSWORD: decodeURIComponent(parsed.password),
    });
    console.log("PASS Control DB pg_dump/pg_restore rehearsal completed");

    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl(restoreDb) } } });
    await prisma.$connect();
    const tenantRegistry = { forMembership: async () => prisma };
    const registry = new ModuleRegistryService();
    const service = new ModuleActivationService(prisma, new RbacService(prisma), registry, tenantRegistry);
    const manifest = registry.get("commerce");
    assert(manifest.id === "commerce" && manifest.version === "0.1.0", "Commerce manifest identity/version mismatch");

    const profile = await service.getProvisioningProfile(ownerId, workspaceId);
    assert(profile.id === "pos-standard" && profile.version === "1.0.0", "POS provisioning profile mismatch");
    assert(profile.allowedModuleIds.includes("commerce"), "POS profile must allow Commerce");
    assert(profile.defaultModuleIds.includes("commerce"), "POS profile must declare Commerce as a default module");
    const compatibility = await service.checkCompatibility(ownerId, workspaceId, "commerce");
    assert(compatibility.compatible, "Owner compatibility check failed: " + compatibility.issues.join("; "));
    assert(compatibility.profileId === "pos-standard" && compatibility.profileVersion === "1.0.0", "Compatibility must report persisted Profile identity/version");
    await prisma.workspace.update({ where: { id: workspaceId }, data: { provisioningProfileVersion: "0.9.0" } });
    const staleProfile = await service.checkCompatibility(ownerId, workspaceId, "commerce");
    assert(!staleProfile.compatible && staleProfile.profileId === null, "Stale persisted Profile version must fail closed");
    await expectConflict(service.getProvisioningProfile(ownerId, workspaceId), "Stale persisted Profile version");
    await prisma.workspace.update({ where: { id: workspaceId }, data: { provisioningProfileVersion: "1.0.0" } });
    await prisma.workspace.update({ where: { id: workspaceId }, data: { provisioningProfileId: "online-standard" } });
    const mismatchedProfile = await service.checkCompatibility(ownerId, workspaceId, "commerce");
    assert(!mismatchedProfile.compatible && mismatchedProfile.profileId === null, "Type-mismatched persisted Profile must fail closed");
    await expectConflict(service.getProvisioningProfile(ownerId, workspaceId), "Type-mismatched persisted Profile");
    await prisma.workspace.update({ where: { id: workspaceId }, data: { provisioningProfileId: "pos-standard" } });
    console.log("PASS POS profile resolves and allows Commerce");

    await prisma.workspace.update({ where: { id: workspaceId }, data: { type: "ONLINE", provisioningProfileId: "online-standard", provisioningProfileVersion: "1.0.0" } });
    const onlineProfile = await service.getProvisioningProfile(ownerId, workspaceId);
    assert(onlineProfile.id === "online-standard" && !onlineProfile.allowedModuleIds.includes("commerce"), "Online profile allowlist mismatch");
    const onlineCompatibility = await service.checkCompatibility(ownerId, workspaceId, "commerce");
    assert(!onlineCompatibility.compatible && onlineCompatibility.issues.some((issue) => issue.includes("ไม่อนุญาต")), "ONLINE must reject POS Commerce");
    await expectBadRequest(service.install(managerId, workspaceId, "commerce"), "ONLINE Commerce install");
    await prisma.workspace.update({ where: { id: workspaceId }, data: { type: null, provisioningProfileId: null, provisioningProfileVersion: null } });
    const legacyCompatibility = await service.checkCompatibility(ownerId, workspaceId, "commerce");
    assert(!legacyCompatibility.compatible && legacyCompatibility.issues.some((issue) => issue.includes("ไม่มี Provisioning Profile")), "Untyped Workspace must fail compatibility");
    await expectConflict(service.getProvisioningProfile(ownerId, workspaceId), "Untyped Workspace profile");
    await expectBadRequest(service.install(managerId, workspaceId, "commerce"), "Untyped Workspace Commerce install");
    await prisma.workspace.update({ where: { id: workspaceId }, data: { type: "POS", provisioningProfileId: "pos-standard", provisioningProfileVersion: "1.0.0" } });
    console.log("PASS ONLINE profile denies POS Commerce; untyped legacy Workspace fails closed");

    await expectForbidden(service.list(deniedId, workspaceId), "Member without modules.manage");
    await expectForbidden(service.install(randomUUID(), workspaceId, "commerce"), "Non-member");
    console.log("PASS Member without permission and non-member are denied");

    const ownerList = await service.list(ownerId, workspaceId);
    assert(ownerList.length === 1 && ownerList[0].manifest.id === "commerce", "Owner module registry listing failed");
    const installed = await service.install(managerId, workspaceId, "commerce");
    assert(installed.status === "INSTALLED" && !installed.enabled, "Manager install state invalid");
    const duplicateInstall = await service.install(managerId, workspaceId, "commerce");
    assert(duplicateInstall.id === installed.id, "Install is not idempotent");
    await prisma.workspace.update({ where: { id: workspaceId }, data: { type: "ONLINE", provisioningProfileId: "online-standard", provisioningProfileVersion: "1.0.0" } });
    await expectBadRequest(service.enable(managerId, workspaceId, "commerce"), "ONLINE Commerce enable");
    await prisma.workspace.update({ where: { id: workspaceId }, data: { type: "POS", provisioningProfileId: "pos-standard", provisioningProfileVersion: "1.0.0" } });
    const enabled = await service.enable(managerId, workspaceId, "commerce");
    assert(enabled.status === "ENABLED" && enabled.enabled, "Manager enable failed");
    await prisma.workspace.update({ where: { id: workspaceId }, data: { type: "ONLINE", provisioningProfileId: "online-standard", provisioningProfileVersion: "1.0.0" } });
    const disabled = await service.disable(managerId, workspaceId, "commerce");
    assert(disabled.status === "DISABLED" && !disabled.enabled, "Disable must remain available for incompatible-module cleanup");
    await prisma.workspace.update({ where: { id: workspaceId }, data: { type: "POS", provisioningProfileId: "pos-standard", provisioningProfileVersion: "1.0.0" } });
    const audit = await service.auditLog(ownerId, workspaceId);
    assert(audit.map((event) => event.action).sort().join(",") === "MODULE_DISABLED,MODULE_ENABLED,MODULE_INSTALLED",
      "Expected all three lifecycle audit events");
    console.log("PASS Manager Install -> Enable -> Disable lifecycle and transactional Audit Log");
    console.log("PASS Owner, Manager, unauthorized member and non-member authorization checks");
    console.log("PASS Module activation integration test completed on restored disposable Control DB");
  } finally {
    if (prisma) await prisma.$disconnect().catch(() => undefined);
    for (const client of clients) await client.end().catch(() => undefined);
    for (const database of [sourceDb,restoreDb]) {
      await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1",[database]).catch(() => undefined);
      await admin.query('DROP DATABASE IF EXISTS "' + database + '"').catch(() => undefined);
    }
    await admin.end();
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
  }
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
