const assert = require("node:assert/strict");
const { NestFactory } = require("@nestjs/core");
const { AppModule } = require("../dist/app.module");
const { PrismaService } = require("../dist/database/prisma.service");
const { WorkspaceDatabaseRegistry } = require("../dist/database/workspace-database.registry");
const { TenantService } = require("../dist/core/tenant/tenant.service");

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  const controlDb = app.get(PrismaService);
  const registry = app.get(WorkspaceDatabaseRegistry);
  const tenantApi = app.get(TenantService);
  const slugs = ["workspace-a-local", "workspace-b-local"];
  const originals = [];

  try {
    for (const slug of slugs) {
      const workspace = await controlDb.workspace.findUnique({
        where: { slug },
        include: { memberships: { take: 1, orderBy: { createdAt: "asc" } }, database: true }
      });
      assert.ok(workspace, `Missing expected workspace: ${slug}`);
      assert.equal(workspace.status, "ACTIVE", `${slug} must be ACTIVE before this verification`);
      assert.ok(workspace.database, `${slug} database metadata is missing`);
      assert.ok(workspace.memberships[0], `${slug} owner membership is missing`);
      originals.push({ id: workspace.id, status: workspace.status });
      const userId = workspace.memberships[0].userId;

      const client = await registry.forMembership(userId, workspace.id);
      const identity = await client.$queryRaw`SELECT current_database() AS database_name, current_user AS role_name`;
      assert.equal(identity[0].database_name, workspace.database.databaseName);
      assert.equal(identity[0].role_name, workspace.database.username);
      const settings = await tenantApi.listSettings(userId, workspace.id);
      assert.ok(Array.isArray(settings), "Tenant API should return tenant settings");
      console.log(`PASS ACTIVE ${slug}: Tenant API and isolated database connection verified`);

      await controlDb.workspace.update({ where: { id: workspace.id }, data: { status: "SUSPENDED" } });
      await assert.rejects(
        () => tenantApi.listSettings(userId, workspace.id),
        error => error?.status === 403 || error?.getStatus?.() === 403
      );
      console.log(`PASS SUSPENDED ${slug}: Tenant API denied access`);

      const stillExists = await controlDb.$queryRaw`
        SELECT datname FROM pg_database WHERE datname = ${workspace.database.databaseName}
      `;
      assert.equal(stillExists[0]?.datname, workspace.database.databaseName);
      await controlDb.workspace.update({ where: { id: workspace.id }, data: { status: "ACTIVE" } });
      console.log(`PASS PRESERVED ${slug}: database retained; status restored to ACTIVE`);
    }
  } finally {
    for (const item of originals) {
      await controlDb.workspace.update({ where: { id: item.id }, data: { status: item.status } });
    }
    await app.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
