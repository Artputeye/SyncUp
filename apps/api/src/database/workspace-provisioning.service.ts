import { Injectable, Logger } from "@nestjs/common";
import { Client } from "pg";
import { PrismaService } from "./prisma.service";

@Injectable()
export class WorkspaceProvisioningService {
  private readonly logger = new Logger(WorkspaceProvisioningService.name);

  constructor(private readonly controlDb: PrismaService) {}

  async provision(workspaceId: string) {
    const workspace = await this.controlDb.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    const adminUrl = process.env.WORKSPACE_DATABASE_ADMIN_URL;
    if (!adminUrl) throw new Error("WORKSPACE_DATABASE_ADMIN_URL is not configured");

    const suffix = workspace.id.replace(/-/g, "").slice(0, 12);
    const databaseName = `syncup_ws_${suffix}`;
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();

    try {
      const result = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
      if (result.rowCount === 0) {
        const safeIdentifier = '"' + databaseName.replace(/"/g, '""') + '"';
        await admin.query(`CREATE DATABASE ${safeIdentifier}`);
      }

      const parsed = new URL(adminUrl);
      await this.controlDb.workspaceDatabase.upsert({
        where: { workspaceId },
        create: {
          workspaceId, databaseName,
          host: parsed.hostname,
          port: Number(parsed.port || 5432),
          username: decodeURIComponent(parsed.username)
        },
        update: {
          databaseName, host: parsed.hostname,
          port: Number(parsed.port || 5432),
          username: decodeURIComponent(parsed.username)
        }
      });

      // Workspace stays unavailable until tenant migrations and health checks complete.
      this.logger.log(`Created database for workspace ${workspaceId}; awaiting tenant migrations`);
      return { workspaceId, databaseName, status: "PROVISIONING" as const };
    } catch (error) {
      await this.controlDb.workspace.update({ where: { id: workspaceId }, data: { status: "FAILED" } });
      throw error;
    } finally {
      await admin.end();
    }
  }
}
