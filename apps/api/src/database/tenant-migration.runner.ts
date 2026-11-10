import { Injectable, Logger } from "@nestjs/common";
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

function quoteIdentifier(value: string): string {
  return '"' + value.replace(/"/g, '""') + '"';
}

@Injectable()
export class TenantMigrationRunner {
  private readonly logger = new Logger(TenantMigrationRunner.name);

  async migrate(databaseName: string, runtimeRole: string): Promise<string> {
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
      const role = quoteIdentifier(runtimeRole);
      const database = quoteIdentifier(databaseName);
      await client.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
      await client.query(`REVOKE ALL ON DATABASE ${database} FROM syncup_runtime`);
      await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
      await client.query(`REVOKE ALL ON SCHEMA public FROM PUBLIC`);
      await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC`);
      await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC`);
      await client.query(`REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`);
      await client.query(`REVOKE ALL ON SCHEMA public FROM syncup_runtime`);
      await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM syncup_runtime`);
      await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM syncup_runtime`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM syncup_runtime`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM syncup_runtime`);
      await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
      await client.query(`REVOKE INSERT, UPDATE, DELETE ON TABLE public.tenant_migrations FROM ${role}`);
      await client.query(`GRANT SELECT ON TABLE public.tenant_migrations TO ${role}`);
      await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${role}`);
      this.logger.log(`Tenant database ${databaseName} migrated and restricted to ${runtimeRole}`);
      return version;
    } finally {
      try { await client.query("SELECT pg_advisory_unlock(hashtext($1))", [databaseName]); } catch {}
      await client.end();
    }
  }

  async healthCheck(databaseName: string, runtimeUrl: string): Promise<void> {
    const url = new URL(runtimeUrl);
    url.pathname = "/" + databaseName;
    const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
    await client.connect();
    try {
      const result = await client.query("SELECT current_database() AS database_name, current_user AS role_name, to_regclass('public.tenant_settings') AS tenant_settings");
      if (result.rows[0]?.database_name !== databaseName || result.rows[0]?.role_name !== url.username || !result.rows[0]?.tenant_settings) {
        throw new Error("Tenant database health check failed: isolated runtime role or baseline table is unavailable");
      }
    } finally {
      await client.end();
    }
  }
}
