import { Injectable, Logger } from "@nestjs/common";
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

@Injectable()
export class TenantMigrationRunner {
  private readonly logger = new Logger(TenantMigrationRunner.name);

  async migrate(databaseName: string): Promise<string> {
    const adminUrl = process.env.WORKSPACE_DATABASE_ADMIN_URL;
    if (!adminUrl) throw new Error("WORKSPACE_DATABASE_ADMIN_URL is not configured");
    const url = new URL(adminUrl);
    url.pathname = "/" + databaseName;
    const client = new Client({ connectionString: url.toString() });
    await client.connect();
    try {
      await client.query("SELECT pg_advisory_lock(hashtext($1))", [databaseName]);
      await client.query(`CREATE TABLE IF NOT EXISTS tenant_migrations (
        version VARCHAR(80) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      const version = "20261031000100_tenant_baseline";
      const applied = await client.query("SELECT 1 FROM tenant_migrations WHERE version = $1", [version]);
      if (applied.rowCount === 0) {
        const migrationPath = join(__dirname, "../../prisma/tenant/migrations/20261031000100_tenant_baseline.sql");
        const sql = await readFile(migrationPath, "utf8");
        await client.query("BEGIN");
        try {
          await client.query(sql);
          await client.query("INSERT INTO tenant_migrations(version) VALUES ($1)", [version]);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      }
      const runtimeUrl = process.env.WORKSPACE_DATABASE_RUNTIME_URL;
      if (!runtimeUrl) throw new Error("WORKSPACE_DATABASE_RUNTIME_URL is not configured");
      const runtimeRole = decodeURIComponent(new URL(runtimeUrl).username);
      if (!runtimeRole || runtimeRole.includes("\\0")) throw new Error("Runtime database role is invalid");
      const quotedRole = '"' + runtimeRole.replace(/"/g, '""') + '"';
      const quotedDatabase = '"' + databaseName.replace(/"/g, '""') + '"';
      await client.query(`GRANT CONNECT ON DATABASE ${quotedDatabase} TO ${quotedRole}`);
      await client.query(`GRANT USAGE ON SCHEMA public TO ${quotedRole}`);
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quotedRole}`);
      await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quotedRole}`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quotedRole}`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${quotedRole}`);
      this.logger.log(`Tenant database ${databaseName} migrated to ${version}`);
      return version;
    } finally {
      try { await client.query("SELECT pg_advisory_unlock(hashtext($1))", [databaseName]); } catch {}
      await client.end();
    }
  }

  async healthCheck(databaseName: string): Promise<void> {
    const runtimeUrl = process.env.WORKSPACE_DATABASE_RUNTIME_URL;
    if (!runtimeUrl) throw new Error("WORKSPACE_DATABASE_RUNTIME_URL is not configured");
    const url = new URL(runtimeUrl);
    url.pathname = "/" + databaseName;
    const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
    await client.connect();
    try {
      const result = await client.query("SELECT current_database() AS database_name, to_regclass('public.tenant_settings') AS tenant_settings");
      if (result.rows[0]?.database_name !== databaseName || !result.rows[0]?.tenant_settings) {
        throw new Error("Tenant database health check failed: baseline table is unavailable");
      }
    } finally {
      await client.end();
    }
  }
}