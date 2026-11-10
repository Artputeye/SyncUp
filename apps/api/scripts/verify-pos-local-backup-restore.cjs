// One-off target-specific rehearsal: creates a new local backup and isolated Recovery DB.
// Re-running creates additional retained artifacts; inspect the architecture docs first.
// The source database identity is hard-coded and revalidated; this never targets another workspace.
const { Client } = require("pg");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");

const sourceDb = "syncup_ws_c0130bf3c1c0";
const workspace = "pos-local";
const adminUrl = new URL(process.env.WORKSPACE_DATABASE_ADMIN_URL || "");
const controlUrl = process.env.CONTROL_DATABASE_URL;
if (!process.env.WORKSPACE_DATABASE_ADMIN_URL || !controlUrl) throw Error("Required DB URLs are missing");
const controlParsed = new URL(controlUrl);
for (const h of [adminUrl.hostname, controlParsed.hostname]) {
  if (!["localhost", "127.0.0.1", "::1"].includes(h)) throw Error("Safety stop: database connections must be localhost");
}
const quoteId = (s) => '"' + s.replace(/"/g, '""') + '"';
const quoteLit = (s) => "'" + s.replace(/'/g, "''") + "'";
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const id = randomUUID().slice(0, 8);
const recoveryDb = `syncup_recovery_pos_local_${stamp}_${id}`.toLowerCase();
const backupDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "SyncUp", "Backups");
const backupPath = path.join(backupDir, `pos-local_${stamp}_${id}.dump`);

async function connect(db, readOnly = false) {
  const u = new URL(process.env.WORKSPACE_DATABASE_ADMIN_URL);
  u.pathname = "/" + db;
  const c = new Client({
    connectionString: u.toString(),
    connectionTimeoutMillis: 10000,
    application_name: "syncup-pos-local-backup-restore-rehearsal",
    ...(readOnly ? { options: "-c default_transaction_read_only=on" } : {}),
  });
  await c.connect();
  return c;
}
function pgArgs(db) {
  return ["--host", adminUrl.hostname, "--port", adminUrl.port || "5432",
    "--username", decodeURIComponent(adminUrl.username), "--dbname", db, "--no-password"];
}
function pgTool(name, args) {
  const r = spawnSync(name, args, {
    encoding: "utf8", windowsHide: true,
    env: { ...process.env, PGPASSWORD: decodeURIComponent(adminUrl.password) },
  });
  if (r.error || r.status !== 0) throw Error(`${name} failed: ${r.error?.message || r.stderr || r.stdout}`);
}
async function schemaSnapshot(c) {
  const q = await c.query(`
    SELECT table_schema,table_name,column_name,ordinal_position,data_type,udt_name,
           is_nullable,column_default
    FROM information_schema.columns
    WHERE table_schema NOT IN ('pg_catalog','information_schema')
    ORDER BY 1,2,4
  `);
  const k = await c.query(`
    SELECT n.nspname schema_name,t.relname table_name,x.conname,x.contype,
           pg_get_constraintdef(x.oid,true) definition
    FROM pg_constraint x JOIN pg_class t ON t.oid=x.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2,3
  `);
  const i = await c.query(`
    SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes
    WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2,3
  `);
  const e = await c.query(`
    SELECT e.extname,e.extversion,n.nspname schema_name
    FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace ORDER BY 1
  `);
  return { columns:q.rows, constraints:k.rows, indexes:i.rows, extensions:e.rows };
}
async function dataSnapshot(c) {
  const ts = await c.query(`
    SELECT n.nspname schema_name,t.relname table_name
    FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE t.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema')
    ORDER BY 1,2
  `);
  const result = [];
  for (const t of ts.rows) {
    const rel = `${quoteId(t.schema_name)}.${quoteId(t.table_name)}`;
    const r = await c.query(`
      SELECT count(*)::bigint rows,
        md5(COALESCE(string_agg(row_data,E'\\n' ORDER BY row_data),'')) checksum
      FROM (SELECT row_to_json(src)::text row_data FROM ${rel} src) x
    `);
    result.push({ schema:t.schema_name, table:t.table_name, rows:String(r.rows[0].rows), checksum:r.rows[0].checksum });
  }
  return result;
}
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  if (process.platform !== "win32") throw Error("Safety stop: expected Windows LocalAppData storage");
  fs.mkdirSync(backupDir, { recursive:true });
  if (fs.existsSync(backupPath)) throw Error("Backup file already exists");
  const adminDb = decodeURIComponent(adminUrl.pathname.slice(1)) || "postgres";
  const admin = await connect(adminDb);
  const control = new Client({
    connectionString:controlUrl, connectionTimeoutMillis:10000,
    application_name:"syncup-pos-local-backup-registry-check",
    options:"-c default_transaction_read_only=on",
  });
  await control.connect();
  let source, recovery, recoveryCreated = false;
  try {
    await control.query("BEGIN READ ONLY");
    const reg = await control.query(`
      SELECT w.slug,w.status,d.database_name,d.username runtime_role
      FROM workspaces w JOIN workspace_databases d ON d.workspace_id=w.id
      WHERE w.slug=$1
    `, [workspace]);
    if (reg.rowCount !== 1 || reg.rows[0].status !== "ACTIVE" || reg.rows[0].database_name !== sourceDb) {
      throw Error("Safety stop: exact pos-local registry identity/status mismatch");
    }
    await control.query("COMMIT");
    const target = reg.rows[0];

    await admin.query("BEGIN READ ONLY");
    const meta = await admin.query(`
      SELECT datname,pg_get_userbyid(datdba) owner,pg_database_size(oid)::bigint size_bytes,
             pg_encoding_to_char(encoding) encoding,datcollate,datctype
      FROM pg_database WHERE datname=$1
    `, [sourceDb]);
    const priv = await admin.query(`
      SELECT current_user role,
        has_database_privilege(current_user,$1,'CONNECT') can_connect,
        has_database_privilege(current_user,$1,'CREATE') can_create
    `, [sourceDb]);
    const collision = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [recoveryDb]);
    if (meta.rowCount !== 1 || meta.rows[0].owner !== "syncup_provisioner" ||
        priv.rows[0].role !== "syncup_provisioner" || !priv.rows[0].can_connect ||
        !priv.rows[0].can_create || collision.rowCount) {
      throw Error("Safety stop: target owner/provisioner privileges/recovery name precondition failed");
    }
    await admin.query("COMMIT");

    source = await connect(sourceDb, true);
    await source.query("BEGIN READ ONLY");
    const identity = await source.query(`
      SELECT current_database() db,current_user role,current_setting('server_version') server_version,
             pg_encoding_to_char(encoding) encoding,datcollate,datctype
      FROM pg_database WHERE datname=current_database()
    `);
    if (identity.rows[0].db !== sourceDb || identity.rows[0].role !== "syncup_provisioner") {
      throw Error("Safety stop: source connection identity mismatch");
    }
    const sessions = await source.query(`
      SELECT count(*)::int total,
        count(*) FILTER (WHERE wait_event_type='Lock')::int lock_waits,
        count(*) FILTER (WHERE state='idle in transaction')::int idle_tx
      FROM pg_stat_activity WHERE datname=current_database() AND pid != pg_backend_pid()
    `);
    if (sessions.rows[0].lock_waits || sessions.rows[0].idle_tx) {
      throw Error("Safety stop: source has lock waits or idle-in-transaction sessions");
    }
    const sourceSchema = await schemaSnapshot(source);
    const sourceData = await dataSnapshot(source);
    const sourceLedger = await source.query("SELECT version FROM public.tenant_migrations ORDER BY version");
    await source.query("COMMIT");

    const m = meta.rows[0];
    await admin.query(`CREATE DATABASE ${quoteId(recoveryDb)} WITH OWNER syncup_provisioner TEMPLATE template0 ENCODING ${quoteLit(m.encoding)} LC_COLLATE ${quoteLit(m.datcollate)} LC_CTYPE ${quoteLit(m.datctype)}`);
    recoveryCreated = true;
    await admin.query(`REVOKE CONNECT ON DATABASE ${quoteId(recoveryDb)} FROM PUBLIC`);

    pgTool("pg_dump", [...pgArgs(sourceDb), "--format=custom","--no-owner","--no-acl","--file",backupPath]);
    if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size === 0) throw Error("pg_dump produced an empty backup");
    pgTool("pg_restore", [...pgArgs(recoveryDb),"--no-owner","--no-acl","--exit-on-error",backupPath]);

    recovery = await connect(recoveryDb, true);
    await recovery.query("BEGIN READ ONLY");
    const restoredIdentity = await recovery.query(`
      SELECT current_database() db,current_setting('server_version') server_version,
             pg_encoding_to_char(encoding) encoding,datcollate,datctype
      FROM pg_database WHERE datname=current_database()
    `);
    const restoredSchema = await schemaSnapshot(recovery);
    const restoredData = await dataSnapshot(recovery);
    const restoredLedger = await recovery.query("SELECT version FROM public.tenant_migrations ORDER BY version");
    const runtimeDenied = await recovery.query(
      "SELECT NOT has_database_privilege($1,current_database(),'CONNECT') denied", [target.runtime_role]
    );
    const checks = {
      recoveryIdentity: restoredIdentity.rows[0].db === recoveryDb,
      serverVersion: restoredIdentity.rows[0].server_version === identity.rows[0].server_version,
      encodingAndLocale: restoredIdentity.rows[0].encoding === identity.rows[0].encoding &&
        restoredIdentity.rows[0].datcollate === identity.rows[0].datcollate &&
        restoredIdentity.rows[0].datctype === identity.rows[0].datctype,
      schemaObjects: equal(sourceSchema,restoredSchema),
      everyTableDataChecksum: equal(sourceData,restoredData),
      migrationLedger: equal(sourceLedger.rows,restoredLedger.rows),
      runtimeRoleCannotConnect: runtimeDenied.rows[0].denied,
    };
    if (Object.values(checks).some(v => !v)) throw Error("Restore verification failed: " + JSON.stringify(checks));
    await recovery.query("COMMIT");
    await recovery.end(); recovery = null;

    await admin.query(`ALTER DATABASE ${quoteId(recoveryDb)} SET default_transaction_read_only=on`);
    const readOnlyCheck = await connect(recoveryDb, true);
    const readOnlySetting = await readOnlyCheck.query("SELECT current_setting('default_transaction_read_only') value");
    await readOnlyCheck.end();
    if (readOnlySetting.rows[0].value !== "on") throw Error("Recovery DB is not read-only by default");

    const file = fs.statSync(backupPath);
    const sha256 = createHash("sha256").update(fs.readFileSync(backupPath)).digest("hex");
    console.log("POS_LOCAL_BACKUP_RESTORE_RESULT " + JSON.stringify({
      status:"PASS",workspace,sourceDb,recoveryDb,runtimeRole:target.runtime_role,
      source:identity.rows[0],sourceSizeBytes:Number(m.size_bytes),sourceSessions:sessions.rows[0],
      tableCount:sourceData.length,totalRows:sourceData.reduce((n,x)=>n+Number(x.rows),0),
      ledger:sourceLedger.rows.map(x=>x.version),checks,
      backup:{path:backupPath,sizeBytes:file.size,sha256,createdAt:file.birthtime.toISOString()},
      recoveryConnectRevokedFromPublic:true,recoveryReadOnlyByDefault:true,
      note:"Source was read only. No source DDL/DML, migrations, extension installation, runtime-role grants, or deployment."
    }));
  } catch (e) {
    if (source) await source.query("ROLLBACK").catch(()=>{});
    if (recovery) await recovery.end().catch(()=>{});
    if (recoveryCreated) await admin.query(`DROP DATABASE IF EXISTS ${quoteId(recoveryDb)}`).catch(()=>{});
    throw e;
  } finally {
    if (source) await source.end().catch(()=>{});
    await admin.end().catch(()=>{});
    await control.end().catch(()=>{});
  }
}
main().catch(e=>{ console.error("POS_LOCAL_BACKUP_RESTORE_FAILED "+e.message); process.exitCode=1; });
