const { Client } = require("pg");
const fs = require("node:fs");
const path = require("node:path");
const runtimeUrl = process.env.CONTROL_DATABASE_URL;
const adminUrl = process.env.TEST_POSTGRES_ADMIN_URL;
if (!runtimeUrl || !adminUrl) throw new Error("Control and admin connection URLs are required.");
const runtime = new URL(runtimeUrl);
const adminParsed = new URL(adminUrl);
if (runtime.pathname !== "/syncup_control" || runtime.hostname !== adminParsed.hostname ||
    (runtime.port || "5432") !== (adminParsed.port || "5432") ||
    !["localhost","127.0.0.1","::1"].includes(runtime.hostname)) {
  throw new Error("Safety stop: expected local syncup_control on the same PostgreSQL instance.");
}
const migration = fs.readFileSync(
  path.resolve(__dirname, "../prisma/migrations/202611060004_module_audit_runtime_grants/migration.sql"),
  "utf8",
);
async function main() {
  const app = new Client({connectionString:runtimeUrl});
  const admin = new Client({connectionString:(() => { const u=new URL(adminUrl);u.pathname="/syncup_control";return u.toString(); })()});
  await app.connect();
  await admin.connect();
  try {
    const permissions = await app.query(
      "SELECT has_table_privilege(current_user,'public.module_installations','SELECT') AS s," +
      "has_table_privilege(current_user,'public.module_installations','INSERT') AS i," +
      "has_table_privilege(current_user,'public.module_installations','UPDATE') AS u",
    );
    if (!permissions.rows[0].s || !permissions.rows[0].i || !permissions.rows[0].u) {
      throw new Error("Control runtime role does not have the expected module_installations privileges.");
    }
    await admin.query(migration);
    const check = await app.query(
      "SELECT has_table_privilege(current_user,'public.platform_audit_logs','SELECT') AS s," +
      "has_table_privilege(current_user,'public.platform_audit_logs','INSERT') AS i",
    );
    if (!check.rows[0].s || !check.rows[0].i) throw new Error("Audit table grants could not be verified for Control runtime.");
    console.log("PASS Migration 202611060004 applied; Control runtime can SELECT and INSERT module lifecycle Audit Log events.");
  } finally {
    await app.end();
    await admin.end();
  }
}
main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
