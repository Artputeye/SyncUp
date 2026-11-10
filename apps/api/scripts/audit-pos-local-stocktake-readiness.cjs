const {Client}=require("pg");
const controlUrl=new URL(process.env.CONTROL_DATABASE_URL||"");
const adminUrl=new URL(process.env.WORKSPACE_DATABASE_ADMIN_URL||"");
const workspaceId="c0130bf3-c1c0-4dfa-a915-7ca5155cacfd";
for(const [u,n] of [[controlUrl,"CONTROL_DATABASE_URL"],[adminUrl,"WORKSPACE_DATABASE_ADMIN_URL"]]){
  if(!["localhost","127.0.0.1","::1"].includes(u.hostname))throw Error(n+" must be localhost");
}
if(controlUrl.pathname!=="/syncup_control")throw Error("Unexpected Control DB");
async function main(){
 const control=new Client({connectionString:controlUrl.toString(),options:"-c default_transaction_read_only=on"});
 await control.connect();let tenant;
 try{
  await control.query("BEGIN READ ONLY");
  const reg=await control.query("SELECT w.slug,w.status,d.database_name,d.username runtime_role FROM workspaces w JOIN workspace_databases d ON d.workspace_id=w.id WHERE w.id=$1",[workspaceId]);
  if(reg.rowCount!==1||reg.rows[0].slug!=="pos-local"||reg.rows[0].status!=="ACTIVE")throw Error("pos-local identity mismatch");
  await control.query("COMMIT");
  const target=reg.rows[0];adminUrl.pathname="/"+target.database_name;
  tenant=new Client({connectionString:adminUrl.toString(),options:"-c default_transaction_read_only=on"});
  await tenant.connect();await tenant.query("BEGIN READ ONLY");
  const identity=await tenant.query("SELECT current_database() db,current_user owner,current_setting('transaction_read_only') ro");
  if(identity.rows[0].db!==target.database_name||identity.rows[0].ro!=="on")throw Error("Tenant identity/read-only mismatch");
  const schema=await tenant.query(`
   SELECT
    (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('stocktake_sessions','stocktake_lines')) stocktake_tables,
    (SELECT count(*)::int FROM tenant_migrations) ledger_count,
    (SELECT count(*)::int FROM tenant_migrations WHERE version='20261107000100_tenant_inventory_stocktake') stocktake_ledger,
    (SELECT count(*)::int FROM warehouses) warehouses,
    (SELECT count(*)::int FROM product_variants) variants,
    (SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' AND t.typname='StockReferenceType') stock_reference_values
  `);
  const privileges=await tenant.query(`
   SELECT $1::text runtime_role,
    EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1) role_exists,
    has_database_privilege($1,current_database(),'CONNECT') can_connect,
    has_schema_privilege($1,'public','USAGE') schema_usage,
    (SELECT array_agg(a.privilege_type ORDER BY a.privilege_type)
     FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
     JOIN pg_roles g ON g.oid=a.grantee
     WHERE d.defaclnamespace='public'::regnamespace
       AND d.defaclrole=(SELECT oid FROM pg_roles WHERE rolname=current_user)
       AND g.rolname=$1 AND d.defaclobjtype='r') table_defaults
  `,[target.runtime_role]);
  const p=privileges.rows[0];
  const expected=["DELETE","INSERT","SELECT","UPDATE"];
  const result={workspace:target,tenant:identity.rows[0],schema:schema.rows[0],runtime:p,
    defaultTablePrivilegesMatch:JSON.stringify(p.table_defaults)===JSON.stringify(expected)};
  if(!p.role_exists||!p.can_connect||!p.schema_usage||!result.defaultTablePrivilegesMatch)throw Error("Runtime grants/default privileges not ready: "+JSON.stringify(result));
  if(schema.rows[0].stocktake_tables!==0||schema.rows[0].stocktake_ledger!==0)throw Error("Stocktake already present on pos-local");
  await tenant.query("COMMIT");
  console.log("POS_LOCAL_STOCKTAKE_READINESS "+JSON.stringify(result,null,2));
 }catch(e){await control.query("ROLLBACK").catch(()=>{});if(tenant)await tenant.query("ROLLBACK").catch(()=>{});throw e}
 finally{if(tenant)await tenant.end();await control.end()}
}
main().catch(e=>{console.error("POS_LOCAL_STOCKTAKE_READINESS_FAILED "+(e.stack||e.message));process.exitCode=1});
