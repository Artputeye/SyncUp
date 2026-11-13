process.loadEnvFile(".env");
const { hash } = require("bcryptjs");
const { PrismaService } = require("../dist/database/prisma.service");
const { TenantMigrationRunner } = require("../dist/database/tenant-migration.runner");
const { WorkspaceProvisioningService } = require("../dist/database/workspace-provisioning.service");
const { WorkspacesService } = require("../dist/core/workspaces/workspaces.service");
const { AuthService } = require("../dist/core/auth/auth.service");
const { WorkspaceDatabaseRegistry } = require("../dist/database/workspace-database.registry");

async function main() {
  const db = new PrismaService();
  const registry = new WorkspaceDatabaseRegistry(db);
  await db.$connect();
  try {
    const users = [
      { email: "owner-a@syncup.local", displayName: "Workspace A Owner", password: process.env.LOCAL_TEST_USER_A_PASSWORD },
      { email: "owner-b@syncup.local", displayName: "Workspace B Owner", password: process.env.LOCAL_TEST_USER_B_PASSWORD }
    ];
    const saved = [];
    for (const item of users) {
      if (!item.password) throw new Error("Local test user passwords are missing from .env");
      const passwordHash = await hash(item.password, 12);
      const user = await db.user.upsert({
        where: { email: item.email },
        create: { email: item.email, displayName: item.displayName, passwordHash, status: "ACTIVE" },
        update: { displayName: item.displayName, passwordHash, status: "ACTIVE" }
      });
      saved.push(user);
    }

    const auth = new AuthService(db);
    for (const item of users) {
      const session = await auth.createSession(item.email, item.password, { userAgent: "syncup-local-isolation-test" });
      const resolved = await auth.resolveSession(session.token);
      if (resolved.email !== item.email) throw new Error("Login/session validation failed for " + item.email);
    }

    const provisioner = new WorkspaceProvisioningService(db, new TenantMigrationRunner());
    const workspaceService = new WorkspacesService(db, provisioner);
    const workspaceA = await workspaceService.create({ slug: "workspace-a-local", name: "Workspace A", type: "POS", ownerUserId: saved[0].id });
    const workspaceB = await workspaceService.create({ slug: "workspace-b-local", name: "Workspace B", type: "ONLINE", ownerUserId: saved[1].id });

    const tenantA = await registry.forMembership(saved[0].id, workspaceA.workspaceId);
    const tenantB = await registry.forMembership(saved[1].id, workspaceB.workspaceId);
    const aName = (await tenantA.$queryRawUnsafe("SELECT current_database() AS name"))[0].name;
    const bName = (await tenantB.$queryRawUnsafe("SELECT current_database() AS name"))[0].name;
    if (aName !== workspaceA.databaseName || bName !== workspaceB.databaseName || aName === bName) {
      throw new Error("Tenant database routing check failed");
    }

    let aToBBlocked = false;
    let bToABlocked = false;
    try { await registry.forMembership(saved[0].id, workspaceB.workspaceId); }
    catch (e) { aToBBlocked = e.status === 403 || e.name === "ForbiddenException"; }
    try { await registry.forMembership(saved[1].id, workspaceA.workspaceId); }
    catch (e) { bToABlocked = e.status === 403 || e.name === "ForbiddenException"; }
    if (!aToBBlocked || !bToABlocked) throw new Error("Cross-workspace access was not denied in both directions");

    console.log(JSON.stringify({
      login: "PASS (2 users)",
      workspaceA: { status: workspaceA.status, database: aName, owner: users[0].email },
      workspaceB: { status: workspaceB.status, database: bName, owner: users[1].email },
      crossWorkspaceAtoB: aToBBlocked ? "BLOCKED (403)" : "FAILED",
      crossWorkspaceBtoA: bToABlocked ? "BLOCKED (403)" : "FAILED"
    }, null, 2));
  } finally {
    await registry.onModuleDestroy();
    await db.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
