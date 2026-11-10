const { Client } = require("pg");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const adminUrl = process.env.TEST_POSTGRES_ADMIN_URL;
if (!adminUrl) throw new Error("TEST_POSTGRES_ADMIN_URL is required.");
const parsed = new URL(adminUrl);
if (!["localhost","127.0.0.1","::1"].includes(parsed.hostname)) throw new Error("Safety stop: localhost only.");
const root = path.resolve(__dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root,file),"utf8");

async function main() {
  const admin = new Client({connectionString:adminUrl});
  await admin.connect();
  const suffix = process.pid + "_" + Date.now();
  const database = "syncup_audit_grant_" + suffix;
  const role = "syncup_module_runtime_" + suffix;
  try {
    await admin.query('CREATE DATABASE "' + database + '"');
    await admin.query('CREATE ROLE "' + role + '" NOLOGIN');
    const url = new URL(adminUrl); url.pathname = "/" + database;
    const db = new Client({connectionString:url.toString()});
    await db.connect();
    try {
      await db.query(read("apps/api/prisma/migrations/20261031000100_control_init/migration.sql"));
      await db.query(read("apps/api/prisma/migrations/202611060003_module_registration_activation/migration.sql"));
      await db.query('GRANT SELECT, INSERT, UPDATE ON TABLE public.module_installations TO "' + role + '"');
      await db.query(read("apps/api/prisma/migrations/202611060004_module_audit_runtime_grants/migration.sql"));
      const result = await db.query(
        "SELECT has_table_privilege($1,'public.platform_audit_logs','SELECT') AS can_select,has_table_privilege($1,'public.platform_audit_logs','INSERT') AS can_insert",
        [role],
      );
      if (!result.rows[0].can_select || !result.rows[0].can_insert) throw new Error("Application role did not inherit the audit table grants.");
      console.log("PASS Migration 004 carries Control DB application table grants to platform_audit_logs.");
    } finally { await db.end(); }
  } finally {
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1",[database]).catch(()=>undefined);
    await admin.query('DROP DATABASE IF EXISTS "' + database + '"').catch(()=>undefined);
    await admin.query('DROP ROLE IF EXISTS "' + role + '"').catch(()=>undefined);
    await admin.end();
  }
}
main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
