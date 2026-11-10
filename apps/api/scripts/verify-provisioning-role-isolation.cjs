const { Client } = require("pg");
const { randomUUID } = require("node:crypto");
const { WorkspaceProvisioningService } = require("../dist/database/workspace-provisioning.service");
const { TenantMigrationRunner } = require("../dist/database/tenant-migration.runner");
const { decryptWorkspaceCredential } = require("../dist/database/workspace-credential.crypto");

const adminUrl = process.env.TEST_POSTGRES_ADMIN_URL;
if (!adminUrl) throw new Error("Set TEST_POSTGRES_ADMIN_URL to localhost disposable PostgreSQL.");
const parsed = new URL(adminUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) throw new Error("Safety stop: localhost only.");
process.env.WORKSPACE_DATABASE_ADMIN_URL = adminUrl;
process.env.WORKSPACE_CREDENTIALS_ENCRYPTION_KEY ??= "a".repeat(64);
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const quote = value => '"' + value.replace(/"/g, '""') + '"';
async function connect(url) {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  await client.connect();
  return client;
}
async function main() {
  const admin = await connect(adminUrl);
  const workspaceId = randomUUID();
  const suffix = workspaceId.replace(/-/g, "").slice(0, 12);
  const databaseName = "syncup_ws_" + suffix;
  const runtimeRole = "syncup_rt_" + suffix;
  const inheritedRole = "syncup_test_group_" + suffix;
  let tenantAdmin;
  let savedCipher;
  try {
    await admin.query("CREATE DATABASE " + quote(databaseName));
    await admin.query("CREATE ROLE " + quote(inheritedRole) + " NOLOGIN");
    await admin.query("CREATE ROLE " + quote(runtimeRole) + " LOGIN PASSWORD 'temporary-test-password'");
    await admin.query("GRANT " + quote(inheritedRole) + " TO " + quote(runtimeRole));
    const tenantUrl = new URL(adminUrl);
    tenantUrl.pathname = "/" + databaseName;
    tenantAdmin = await connect(tenantUrl.toString());
    await tenantAdmin.query("CREATE TABLE public.public_acl_probe(id integer PRIMARY KEY)");
    await tenantAdmin.query("GRANT SELECT ON TABLE public.public_acl_probe TO PUBLIC");
    await tenantAdmin.end();
    tenantAdmin = undefined;
    const workspace = { id: workspaceId, status: "ACTIVE" };
    const controlDb = {
      workspace: { findUniqueOrThrow: async () => workspace, update: async () => ({ }) },
      workspaceDatabase: {
        upsert: async args => { savedCipher = args.create.secretCipher; return {}; },
        findUniqueOrThrow: async () => ({ workspaceId, databaseName, username: runtimeRole }),
        update: async () => ({ })
      }
    };
    const service = new WorkspaceProvisioningService(controlDb, new TenantMigrationRunner());
    const result = await service.provision(workspaceId);
    assert(result.status === "ACTIVE", "Provisioning did not complete successfully.");
    const roleState = await admin.query(
      "SELECT r.rolinherit, (SELECT count(*) FROM pg_auth_members m WHERE m.member = r.oid) AS memberships FROM pg_roles r WHERE r.rolname = $1",
      [runtimeRole]
    );
    assert(roleState.rowCount === 1, "Runtime role was not found.");
    assert(roleState.rows[0].rolinherit === false, "Runtime role still has INHERIT enabled.");
    assert(Number(roleState.rows[0].memberships) === 0, "Runtime role retained inherited role memberships.");
    assert(Boolean(savedCipher), "Provisioning did not persist encrypted runtime credentials.");
    const runtimeUrl = new URL(adminUrl);
    runtimeUrl.username = runtimeRole;
    runtimeUrl.password = decryptWorkspaceCredential(savedCipher);
    runtimeUrl.pathname = "/" + databaseName;
    const runtime = await connect(runtimeUrl.toString());
    try {
      const aclCheck = await runtime.query(
        "SELECT EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a wHERE c.oid = 'public.public_acl_probe'::regclass AND a.grantee = 0 AND a.privilege_type = 'SELECT') AS public_can_select"
      );
      assert(aclCheck.rows[0].public_can_select === false, "Existing PUBLIC table SELECT grant was not revoked.");
      await runtime.query("SELECT 1 FROM tenant_settings");
    } finally { await runtime.end(); }
    console.log("PASS Provisioning: existing Runtime Role membership revoked.");
    console.log("PASS Provisioning: Runtime Role set to NOINHERIT with zero memberships.");
    console.log("PASS Provisioning: existing PUBLIC table grants revoked.");
    console.log("PASS Provisioning: encrypted credential persistence and runtime health check.");
  } finally {
    if (tenantAdmin) await tenantAdmin.end().catch(() => {});
    await admin.query("SELECT pk_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1", [databaseName]).catch(() => {});
    await admin.query("DROP DATABASE IF EXISTS " + quote(databaseName)).catch(() => {});
    await admin.query("DROP ROLE IF EXISTS " + quote(runtimeRole)).catch(() => {});
    await admin.query("DROP ROLE IF EXISTS " + quote(inheritedRole)).catch(() => {});
    await admin.end();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });