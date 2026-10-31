import { Injectable, Logger } from "@nestjs/common";
import { Client } from "pg";
import { PrismaService } from "./prisma.service";
import { TenantMigrationRunner } from "./tenant-migration.runner";

@Injectable()
export class WorkspaceProvisioningService {
  private readonly logger = new Logger(WorkspaceProvisioningService.name);

  constructor(
    private readonly controlDb: PrismaService,
    private readonly tenantMigrations: TenantMigrationRunner
  ) {}

  async provision(workspaceId: string) {
    const workspace = await this.controlDb.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    const adminUrl = process.env.WORKSPACE_DATABASE_ADMIN_URL;
    if (!adminUrl) throw new Error("WORKSPACE_DATABASE_ADMIN_URL is not configured");

    const suffix = workspace.id.replace(/-/g, "").slice(0, 12);
    const databaseName = `syncup_ws_${suffix}`;
    const admin = new Client({ connectionString: adminUrl });
    try {
      await admin.connect();
      const result = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
      if (result.rowCount === 0) {
        const safeIdentifier = '"' + databaseName.replace(/"/g, '""') + '"';
        await admin.query(`CREATE DATABASE ${safeIdentifier}`);
      }
      const parsed = new URL(adminUrl);
      await this.controlDb.workspaceDatabase.upsert({
        where: { workspaceId },
        create: {
          workspaceId, databaseName, host: parsed.hostname,
          port: Number(parsed.port || 5432), username: decodeURIComponent(parsed.username)
        },
        update: {
          databaseName, host: parsed.hostname,
          port: Number(parsed.port || 5432), username: decodeURIComponent(parsed.username)
        }
      });
    } catch (error) {
      await this.controlDb.workspace.update({ where: { id: workspaceId }, data: { status: "FAILED" } });
      throw error;
    } finally {
      await admin.end().catch(() => undefined);
    }

    try {
      const schemaVersion = await this.tenantMigrations.migrate(databaseName);
      await this.tenantMigrations.healthCheck(databaseName);
      await this.controlDb.workspaceDatabase.update({
        where: { workspaceId }, data: { schemaVersion }
      });
      await this.controlDb.workspace.update({
        where: { id: workspaceId }, data: { status: "ACTIVE" }
      });
      this.logger.log(`Workspace ${workspaceId} provisioned and healthy`);
      return { workspaceId, databaseName, schemaVersion, status: "ACTIVE" as const };
    } catch (error) {
      await this.controlDb.workspace.update({ where: { id: workspaceId }, data: { status: "FAILED" } });
      this.logger.error(`Workspace provisioning failed for ${workspaceId}`, error);
      throw error;
    }
  }
}