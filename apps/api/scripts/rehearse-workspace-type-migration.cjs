const { Client } = require("pg");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const root = path.resolve(__dirname, "../../..");
const database = "syncup_control_p0_1_rehearsal";
const adminUrl = process.env.TEST_POSTGRES_ADMIN_URL;
const baselinePath = path.join(root, "apps/api/prisma/migrations/20261031000100_control_init/migration.sql");
const candidatePath = path.join(root, "apps/api/prisma/migrations/20261113000100_workspace_type_registry/migration.sql");
const quoteId = (s) => '"' + s.replace(/"/g, '""') + '"';
const urlFor = (db) => { const u = new URL(adminUrl); u.pathname = "/" + db; return u.toString(); };
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function main() {
  assert(adminUrl, "TEST_POSTGRES_ADMIN_URL is required");
  const parsed = new URL(adminUrl);
  assert(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname), "Safety stop: PostgreSQL admin connection must be localhost");
  assert(parsed.pathname === "/postgres", "Safety stop: admin connection must target postgres maintenance database");
  assert(fs.existsSync(baselinePath) && fs.existsSync(candidatePath), "Required migration SQL file is missing");

  const admin = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 8000, application_name: "syncup-p0-1-workspace-type-rehearsal-admin" });
  await admin.connect();
  let created = false;
  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [database]);
    assert(existing.rowCount === 0, "Safety stop: rehearsal database already exists; refusing to overwrite it");
    await admin.query("CREATE DATABASE " + quoteId(database));
    created = true;

    const db = new Client({ connectionString: urlFor(database), connectionTimeoutMillis: 8000, application_name: "syncup-p0-1-workspace-type-rehearsal" });
    await db.connect();
    try {
      const identity = await db.query("SELECT current_database() AS db, current_user AS usr, current_setting('transaction_read_only') AS read_only");
      assert(identity.rows[0].db === database && identity.rows[0].read_only === "off", "Connected database identity/read-write verification failed");

      await db.query(fs.readFileSync(baselinePath, "utf8"));
      const userId = randomUUID();
      const workspaceId = randomUUID();
      await db.query(
        "INSERT INTO users (id,email,password_hash,display_name,updated_at) VALUES ($1,$2,'test-hash','P0.1 Rehearsal',NOW())",
        [userId, "p01-rehearsal-" + randomUUID() + "@syncup.invalid"],
      );
      await db.query(
        "INSERT INTO workspaces (id,slug,name,status,updated_at) VALUES ($1,'p0-1-rehearsal','P0.1 Existing Workspace Sentinel','ACTIVE',NOW())",
        [workspaceId],
      );
      await db.query(
        "INSERT INTO memberships (id,user_id,workspace_id,is_owner) VALUES ($1,$2,$3,TRUE)",
        [randomUUID(), userId, workspaceId],
      );
      await db.query(
        "INSERT INTO workspace_databases (id,workspace_id,database_name,host,port,username) VALUES ($1,$2,'syncup_p01_sentinel','127.0.0.1',5432,'syncup_test')",
        [randomUUID(), workspaceId],
      );

      const before = await db.query(
        "SELECT w.id,w.slug,w.name,w.status,u.email,m.is_owner,wd.database_name FROM workspaces w JOIN memberships m ON m.workspace_id=w.id JOIN users u ON u.id=m.user_id JOIN workspace_databases wd ON wd.workspace_id=w.id WHERE w.id=$1",
        [workspaceId],
      );
      assert(before.rowCount === 1, "Baseline sentinel data was not created");

      await db.query(fs.readFileSync(candidatePath, "utf8"));

      const enumValues = await db.query(
        "SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='WorkspaceType' ORDER BY e.enumsortorder",
      );
      assert(enumValues.rows.map((r) => r.enumlabel).join(",") === "POS,ONLINE", "WorkspaceType enum values/order mismatch");

      const column = await db.query(
        "SELECT is_nullable, udt_name FROM information_schema.columns WHERE table_schema='public' AND table_name='workspaces' AND column_name='type'",
      );
      assert(column.rowCount === 1 && column.rows[0].is_nullable === "YES" && column.rows[0].udt_name === "WorkspaceType", "Workspace.type column definition mismatch");

      const after = await db.query(
        "SELECT w.id,w.slug,w.name,w.status,w.type::text AS type,u.email,m.is_owner,wd.database_name FROM workspaces w JOIN memberships m ON m.workspace_id=w.id JOIN users u ON u.id=m.user_id JOIN workspace_databases wd ON wd.workspace_id=w.id WHERE w.id=$1",
        [workspaceId],
      );
      assert(after.rowCount === 1, "Existing Workspace sentinel row was lost");
      const oldRow = before.rows[0], newRow = after.rows[0];
      for (const key of ["id","slug","name","status","email","is_owner","database_name"]) {
        assert(String(oldRow[key]) === String(newRow[key]), "Existing data changed during migration: " + key);
      }
      assert(newRow.type === null, "Existing Workspace must remain unclassified; no implicit backfill is allowed");

      const posId = randomUUID(), onlineId = randomUUID();
      await db.query(
        "INSERT INTO workspaces (id,slug,name,type,updated_at) VALUES ($1,'p0-1-pos','P0.1 POS typed Workspace','POS',NOW()),($2,'p0-1-online','P0.1 Online typed Workspace','ONLINE',NOW())",
        [posId, onlineId],
      );
      const typed = await db.query("SELECT type::text AS type FROM workspaces WHERE id = ANY($1::uuid[]) ORDER BY type::text", [[posId, onlineId]]);
      assert(typed.rows.map((r) => r.type).join(",") === "ONLINE,POS", "Typed Workspace inserts failed");

      console.log("P0_1_WORKSPACE_TYPE_REHEARSAL " + JSON.stringify({
        status: "PASS",
        database,
        baselineMigration: path.basename(path.dirname(baselinePath)),
        candidateMigration: path.basename(path.dirname(candidatePath)),
        enumValues: enumValues.rows.map((r) => r.enumlabel),
        workspaceTypeColumn: column.rows[0],
        existingWorkspacePreserved: true,
        existingWorkspaceType: newRow.type,
        typedWorkspaceInserts: typed.rows.map((r) => r.type),
        persistentControlDatabaseTouched: false,
        tenantDatabasesTouched: false,
      }, null, 2));
    } finally {
      await db.end();
    }
  } finally {
    if (created) {
      await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1", [database]).catch(() => undefined);
      await admin.query("DROP DATABASE IF EXISTS " + quoteId(database));
    }
    await admin.end();
  }
}
main().catch((error) => { console.error("P0_1_WORKSPACE_TYPE_REHEARSAL_FAILED " + (error.stack || error.message)); process.exitCode = 1; });
