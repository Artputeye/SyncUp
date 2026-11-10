const { Client } = require("pg");
const { TenantMigrationRunner } = require("../dist/database/tenant-migration.runner");
const { randomUUID } = require("node:crypto");
const adminUrl=process.env.TEST_POSTGRES_ADMIN_URL;
if(!adminUrl) throw new Error("Set TEST_POSTGRES_ADMIN_URL to localhost disposable PostgreSQL.");
const parsed=new URL(adminUrl);
if(!["localhost","127.0.0.1","::1"].includes(parsed.hostname)) throw new Error("Safety stop: localhost only.");
const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
async function connect(url){const c=new Client({connectionString:url,connectionTimeoutMillis:5000});await c.connect();return c;}
async function denied(c,sql,label){try{await c.query(sql);throw new Error("Expected denial: "+label);}catch(e){if(e.message==="Expected denial: "+label)throw e;if(e.code!=="42501")throw new Error(label+": expected 42501, got "+e.code+" "+e.message);}}
async function main(){
 const admin=await connect(adminUrl),suffix=process.pid+"_"+Date.now(),db="syncup_rtgrant_"+suffix,role="syncup_rt_test_"+suffix,pass=randomUUID()+randomUUID();
 const u=new URL(adminUrl);u.pathname="/"+db;const ru=new URL(u);ru.username=role;ru.password=pass;let runtime;
 try{
  await admin.query('CREATE DATABASE "'+db+'"');
  const roleSql = await admin.query("SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', $1::text, $2::text) AS sql", [role, pass]);
  await admin.query(roleSql.rows[0].sql);
  process.env.WORKSPACE_DATABASE_ADMIN_URL=adminUrl;
  await new TenantMigrationRunner().migrate(db,role);
  const flags=await admin.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1",[role]);
  assert(flags.rowCount===1&&Object.values(flags.rows[0]).every(v=>v===false),"Runtime role has elevated cluster attributes");
  const owner=await connect(u.toString());try{await owner.query("CREATE TABLE public.runtime_grants_future_probe(id BIGSERIAL PRIMARY KEY,value TEXT NOT NULL)");}finally{await owner.end();}
  runtime=await connect(ru.toString());
  await runtime.query("INSERT INTO tenant_settings(key,value) VALUES ('runtime-grants','{}'::jsonb)");
  await runtime.query("UPDATE tenant_settings SET value='{"+'"ok":true'+"}'::jsonb WHERE key='runtime-grants'");
  const setting=await runtime.query("SELECT value->>'ok' AS ok FROM tenant_settings WHERE key='runtime-grants'");
  assert(setting.rows[0]?.ok==="true","Tenant settings DML failed");
  await runtime.query("DELETE FROM tenant_settings WHERE key='runtime-grants'");
  const ledger=await runtime.query("SELECT version FROM tenant_migrations WHERE version='20261031000100_tenant_baseline'");
  assert(ledger.rowCount===1,"Cannot read migration ledger");
  await denied(runtime,"INSERT INTO tenant_migrations(version) VALUES ('forbidden')","migration ledger write");
  await denied(runtime,"CREATE TABLE public.runtime_forbidden(id integer)","schema DDL");
  await denied(runtime,"CREATE ROLE runtime_forbidden","role creation");
  await runtime.query("INSERT INTO runtime_grants_future_probe(value) VALUES ('default grants')");
  const future=await runtime.query("SELECT value FROM runtime_grants_future_probe");
  assert(future.rows[0]?.value==="default grants","Future table/sequence default grants failed");
  console.log("PASS Runtime role: least-privilege cluster attributes");
  console.log("PASS Runtime role: tenant_settings DML and migration-ledger SELECT");
  console.log("PASS Runtime role: migration-ledger writes, schema DDL and role creation denied");
  console.log("PASS Runtime role: default table and sequence grants for future objects");
 }finally{
  if(runtime)await runtime.end().catch(()=>{});
  await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1",[db]).catch(()=>{});
  await admin.query('DROP DATABASE IF EXISTS "'+db+'"').catch(()=>{});
  await admin.query('DROP ROLE IF EXISTS "'+role+'"').catch(()=>{});
  await admin.end();
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
