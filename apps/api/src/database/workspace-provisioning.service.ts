import { Injectable, Logger } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { PrismaService } from "./prisma.service";
import { TenantMigrationRunner } from "./tenant-migration.runner";
import { encryptWorkspaceCredential } from "./workspace-credential.crypto";
import { resolveProvisioningProfile } from "../shared/provisioning-profile-catalog";

function quoteIdentifier(value: string): string {
  return '"' + value.replace(/"/g, '""') + '"';
}

function quoteLiteral(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

function safeProvisioningError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[database-url-redacted]")
    .replace(/password\s*[=:]\s*[^\s,;]+/gi, "password=[redacted]")
    .slice(0, 2000);
}

@Injectable()
export class WorkspaceProvisioningService {
  private readonly logger = new Logger(WorkspaceProvisioningService.name);

  constructor(
    private readonly controlDb: PrismaService,
    private readonly tenantMigrations: TenantMigrationRunner
  ) {}

  async provision(workspaceId: string) {
    const workspace = await this.controlDb.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    if (workspace.type !== "POS" && workspace.type !== "ONLINE") {
      throw new Error("Workspace Type must be POS or ONLINE before provisioning");
    }
    if (!resolveProvisioningProfile(workspace.type, workspace.provisioningProfileId, workspace.provisioningProfileVersion)) {
      throw new Error("Workspace Provisioning Profile ID/Version is missing, stale or incompatible with Workspace Type");
    }

    const startedAt = new Date();
    await this.controlDb.workspace.update({
      where: { id: workspaceId },
      data: {
        status: "PROVISIONING",
        provisioningStartedAt: startedAt,
        provisionedAt: null,
        provisioningError: null,
      },
    });

    const adminUrl = process.env.WORKSPACE_DATABASE_ADMIN_URL;
    if (!adminUrl) {
      const message = "WORKSPACE_DATABASE_ADMIN_URL is not configured";
      await this.controlDb.workspace.update({
        where: { id: workspaceId },
        data: { status: "FAILED", provisioningError: message },
      });
      throw new Error(message);
    }

    const suffix = workspace.id.replace(/-/g, "").slice(0, 12);
    const databaseName = `syncup_ws_${suffix}`;
    const runtimeRole = `syncup_rt_${suffix}`;
    const runtimePassword = randomBytes(32).toString("base64url");
    const admin = new Client({ connectionString: adminUrl });

    try {
      await admin.connect();
      const result = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
      if (result.rowCount === 0) {
        await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
      }

      const existingRole = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [runtimeRole]);
      if (existingRole.rowCount === 0) {
        await admin.query(`CREATE ROLE ${quoteIdentifier(runtimeRole)} LOGIN PASSWORD ${quoteLiteral(runtimePassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);
      } else {
        await admin.query(`ALTER ROLE ${quoteIdentifier(runtimeRole)} WITH LOGIN PASSWORD ${quoteLiteral(runtimePassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);
      }

      const memberships = await admin.query(
        "SELECT parent.rolname FROM pg_auth_members membership JOIN pg_roles parent ON parent.oid = membership.roleid JOIN pg_roles member ON member.oid = membership.member WHERE member.rolname = $1",
        [runtimeRole]
      );
      for (const membership of memberships.rows) {
        await admin.query(`REVOKE ${quoteIdentifier(membership.rolname)} FROM ${quoteIdentifier(runtimeRole)}`);
      }

      const parsed = new URL(adminUrl);
      await this.controlDb.workspaceDatabase.upsert({
        where: { workspaceId },
        create: {
          workspaceId, databaseName, host: parsed.hostname,
          port: Number(parsed.port || 5432), username: runtimeRole,
          secretCipher: encryptWorkspaceCredential(runtimePassword)
        },
        update: {
          databaseName, host: parsed.hostname,
          port: Number(parsed.port || 5432), username: runtimeRole,
          secretCipher: encryptWorkspaceCredential(runtimePassword)
        }
      });
    } catch (error) {
      await this.controlDb.workspace.update({
        where: { id: workspaceId },
        data: { status: "FAILED", provisioningError: safeProvisioningError(error) },
      });
      throw error;
    } finally {
      await admin.end().catch(() => undefined);
    }

    try {
      const schemaVersion = await this.tenantMigrations.migrate(databaseName, runtimeRole);
      const database = await this.controlDb.workspaceDatabase.findUniqueOrThrow({ where: { workspaceId } });
      const runtimeUrl = new URL(adminUrl);
      runtimeUrl.username = runtimeRole;
      runtimeUrl.password = runtimePassword;
      runtimeUrl.pathname = "/" + databaseName;
      await this.tenantMigrations.healthCheck(databaseName, runtimeUrl.toString());
      await this.controlDb.workspaceDatabase.update({ where: { workspaceId }, data: { schemaVersion } });
      const completedAt = new Date();
      await this.controlDb.workspace.update({
        where: { id: workspaceId },
        data: { status: "ACTIVE", provisionedAt: completedAt, provisioningError: null },
      });
      this.logger.log(`Workspace ${workspaceId} provisioned with isolated database role`);
      return {
        workspaceId,
        databaseName,
        schemaVersion,
        status: "ACTIVE" as const,
        provisioningProfileId: workspace.provisioningProfileId,
        provisioningProfileVersion: workspace.provisioningProfileVersion,
        provisioningStartedAt: startedAt,
        provisionedAt: completedAt,
      };
    } catch (error) {
      await this.controlDb.workspace.update({
        where: { id: workspaceId },
        data: { status: "FAILED", provisioningError: safeProvisioningError(error) },
      });
      this.logger.error(`Workspace provisioning failed for ${workspaceId}`, error);
      throw error;
    }
  }
}
