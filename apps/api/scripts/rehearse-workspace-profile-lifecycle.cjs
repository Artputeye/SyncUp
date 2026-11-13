const { Client } = require("pg");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const root = path.resolve(__dirname, "../../..");
const database = "syncup_control_p0_3_rehearsal";
const adminUrl = process.env.TEST_POSTGRES_ADMIN_URL;
const migrations = [
  "apps/api/prisma/migrations/20261031000100_control_init/migration.sql",
  "apps/api/prisma/migrations/20261113000100_workspace_type_registry/migration.sql",
  "apps/api/prisma/migrations/20261113000200_workspace_profile_lifecycle/migration.sql",
];
const quoteId = (value) => '"' + value.replace(/"/g, '""') + '"';
const urlFor = (db) => { const url = new URL(adminUrl); url.pathname = "/" + db; return url.toString(); };
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function main() {
  assert(adminUrl, "TEST_POSTGRES_ADMIN_URL is required");
  const parsed = new URL(adminUrl);
  assert(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname), "Safety stop: admin connection must be localhost");
  assert(parsed.pathname === "/postgres", "Safety stop: admin connection must target postgres maintenance database");
  for (const migration of migrations) {
    assert(fs.existsSync(path.join(root, migration)), "Missing migration: " + migration);
  }

  const admin = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 8000, application_name: "syncup-p0-3-profile-rehearsal-admin" });
  await admin.connect();
  let created = false;
  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [database]);
    assert(existing.rowCount === 0, "Safety stop: rehearsal database already exists; refusing to overwrite it");
    await admin.query("CREATE DATABASE " + quoteId(database));
    created = true;

    const db = new Client({ connectionString: urlFor(database), connectionTimeoutMillis: 8000, application_name: "syncup-p0-3-profile-rehearsal" });
    await db.connect();
    try {
      const identity = await db.query("SELECT current_database() AS db,current_setting('transaction_read_only') AS read_only");
      assert(identity.rows[0].db === database && identity.rows[0].read_only === "off", "Disposable DB identity/read-write verification failed");
      await db.query(fs.readFileSync(path.join(root, migrations[0]), "utf8"));

      const userId = randomUUID(), legacyId = randomUUID();
      await db.query(
        "INSERT INTO users(id,email,password_hash,display_name,updated_at) VALUES($1,$2,'test-hash','P0.3 Sentinel',NOW())",
        [userId, "p03-" + randomUUID() + "@syncup.invalid"],
      );
      await db.query(
        "INSERT INTO workspaces(id,slug,name,status,updated_at) VALUES($1,'p03-legacy','P0.3 Legacy Sentinel','ACTIVE',NOW())",
        [legacyId],
      );
      await db.query("INSERT INTO memberships(id,user_id,workspace_id,is_owner) VALUES($1,$2,$3,TRUE)", [randomUUID(), userId, legacyId]);
      const before = await db.query("SELECT id,slug,name,status FROM workspaces WHERE id=$1", [legacyId]);

      await db.query(fs.readFileSync(path.join(root, migrations[1]), "utf8"));
      await db.query(fs.readFileSync(path.join(root, migrations[2]), "utf8"));

      const columns = await db.query(
        "SELECT column_name,is_nullable,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='workspaces' AND column_name = ANY($1::text[]) ORDER BY column_name",
        [["provisioning_profile_id","provisioning_profile_version","provisioning_started_at","provisioned_at","provisioning_error"]],
      );
      assert(columns.rowCount === 5 && columns.rows.every((row) => row.is_nullable === "YES"), "Workspace Profile/lifecycle columns must all be nullable");

      const after = await db.query(
        "SELECT id,slug,name,status,type::text AS type,provisioning_profile_id,provisioning_profile_version,provisioning_started_at,provisioned_at,provisioning_error FROM workspaces WHERE id=$1",
        [legacyId],
      );
      assert(after.rowCount === 1, "Legacy Workspace sentinel was lost");
      for (const key of ["id","slug","name","status"]) assert(String(before.rows[0][key]) === String(after.rows[0][key]), "Legacy Workspace changed: " + key);
      assert(after.rows[0].type === null && after.rows[0].provisioning_profile_id === null && after.rows[0].provisioning_profile_version === null, "Legacy Workspace must remain unclassified and unprofiled");
      assert(after.rows[0].provisioning_started_at === null && after.rows[0].provisioned_at === null && after.rows[0].provisioning_error === null, "Legacy lifecycle metadata must remain NULL");

      const posId = randomUUID(), onlineId = randomUUID();
      await db.query(
        "INSERT INTO workspaces(id,slug,name,type,provisioning_profile_id,provisioning_profile_version,status,updated_at) VALUES($1,'p03-pos','P0.3 POS','POS','pos-standard','1.0.0','PROVISIONING',NOW()),($2,'p03-online','P0.3 Online','ONLINE','online-standard','1.0.0','PROVISIONING',NOW())",
        [posId, onlineId],
      );
      const startedAt = new Date();
      await db.query(
        "UPDATE workspaces SET provisioning_started_at=$2 WHERE id=ANY($1::uuid[])",
        [[posId, onlineId], startedAt],
      );
      const completedAt = new Date();
      await db.query(
        "UPDATE workspaces SET status='ACTIVE',provisioned_at=$2,provisioning_error=NULL WHERE id=$1",
        [posId, completedAt],
      );
      await db.query(
        "UPDATE workspaces SET status='FAILED',provisioning_error='simulated safe failure' WHERE id=$1",
        [onlineId],
      );
      const lifecycle = await db.query(
        "SELECT type::text AS type,provisioning_profile_id,provisioning_profile_version,status::text AS status,provisioning_started_at,provisioned_at,provisioning_error FROM workspaces WHERE id=ANY($1::uuid[]) ORDER BY type",
        [[posId, onlineId]],
      );
      const pos = lifecycle.rows.find((row) => row.type === "POS");
      const online = lifecycle.rows.find((row) => row.type === "ONLINE");
      assert(pos && pos.provisioning_profile_id === "pos-standard" && pos.provisioning_profile_version === "1.0.0", "POS profile identity persistence failed");
      assert(pos.status === "ACTIVE" && pos.provisioning_started_at && pos.provisioned_at && pos.provisioning_error === null, "POS success lifecycle persistence failed");
      assert(online && online.provisioning_profile_id === "online-standard" && online.provisioning_profile_version === "1.0.0", "ONLINE profile identity persistence failed");
      assert(online.status === "FAILED" && online.provisioning_started_at && online.provisioned_at === null && online.provisioning_error === "simulated safe failure", "ONLINE failure lifecycle persistence failed");

      let pairConstraintRejected = false;
      try {
        await db.query("UPDATE workspaces SET provisioning_profile_version=NULL WHERE id=$1", [posId]);
      } catch (error) {
        pairConstraintRejected = error.code === "23514";
      }
      assert(pairConstraintRejected, "Profile ID/version pair constraint did not reject partial identity");

      console.log("P0_3_PROFILE_REHEARSAL " + JSON.stringify({
        status: "PASS",
        database,
        migrations: migrations.map((item) => path.basename(path.dirname(item))),
        nullableColumns: columns.rows.map((row) => row.column_name),
        legacyWorkspacePreserved: true,
        legacyTypeAndProfileRemainNull: true,
        typedProfiles: { POS: "pos-standard@1.0.0", ONLINE: "online-standard@1.0.0" },
        lifecycle: { success: "ACTIVE + startedAt + provisionedAt", failure: "FAILED + startedAt + safe error" },
        profilePairConstraint: "PASS",
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
main().catch((error) => { console.error("P0_3_PROFILE_REHEARSAL_FAILED " + (error.stack || error.message)); process.exitCode = 1; });
