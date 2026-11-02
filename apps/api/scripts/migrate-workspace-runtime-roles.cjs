const path = require("node:path");
process.loadEnvFile(path.resolve(__dirname, "../.env"));

const { PrismaService } = require("../dist/database/prisma.service");
const { TenantMigrationRunner } = require("../dist/database/tenant-migration.runner");
const { WorkspaceProvisioningService } = require("../dist/database/workspace-provisioning.service");

async function main() {
  const controlDb = new PrismaService();
  await controlDb.$connect();
  try {
    const migrations = new TenantMigrationRunner();
    const provisioning = new WorkspaceProvisioningService(controlDb, migrations);
    const workspaces = await controlDb.workspace.findMany({
      where: { database: { isNot: null } },
      select: { id: true, slug: true }
    });
    for (const workspace of workspaces) {
      console.log(`Migrating workspace ${workspace.slug} (${workspace.id})`);
      const result = await provisioning.provision(workspace.id);
      console.log(`  ${result.status}: ${result.databaseName}`);
    }
    console.log(`Completed isolated runtime role provisioning for ${workspaces.length} workspace(s).`);
  } finally {
    await controlDb.$disconnect();
  }
}

main().catch(error => {
  console.error("Workspace runtime role migration failed:", error.message);
  process.exitCode = 1;
});
