"use strict";
const { Client } = require("pg");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const root = path.resolve(__dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const adminUrl = process.env.TEST_POSTGRES_ADMIN_URL;
const provisionerUrl = process.env.WORKSPACE_DATABASE_ADMIN_URL;
if (!adminUrl || !provisionerUrl) {
  throw new Error("TEST_POSTGRES_ADMIN_URL and WORKSPACE_DATABASE_ADMIN_URL are required.");
}
const parsedAdmin = new URL(adminUrl);
const parsedProvisioner = new URL(provisionerUrl);
const loopback = (host) => ["localhost", "127.0.0.1", "::1"].includes(host);
if (!loopback(parsedAdmin.hostname) || !loopback(parsedProvisioner.hostname)
  || parsedAdmin.port !== parsedProvisioner.port) {
  throw new Error("Safety stop: both database URLs must target the same local PostgreSQL server.");
}

const baseline = read("apps/api/prisma/tenant/migrations/20261031000100_tenant_baseline.sql");
const clean = read("docs/architecture/tenant-commerce-clean-install.candidate.sql");
const incremental = read("docs/architecture/tenant-commerce-incremental-upgrade.candidate.sql");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
async function expectFailure(client, sql, code, label) {
  let caught;
  try {
    await client.query(sql);
  } catch (error) {
    caught = error;
  }
  if (!caught) throw new Error("Expected failure did not occur: " + label);
  if (code && caught.code !== code) {
    throw new Error(label + ": expected SQLSTATE " + code + ", received " + caught.code + ": " + caught.message);
  }
  return caught;
}
async function connectToDb(base, database) {
  const url = new URL(base);
  url.pathname = "/" + database;
  const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
  await client.connect();
  return client;
}
async function assertProvisioner(client, label) {
  const result = await client.query(
    "SELECT current_user AS role, " +
    "has_database_privilege(current_user,current_database(),'CREATE') AS can_create, " +
    "EXISTS(SELECT 1 FROM pg_available_extensions WHERE name='btree_gist') AS extension_available, " +
    "(SELECT trusted FROM pg_available_extension_versions WHERE name='btree_gist' ORDER BY version DESC LIMIT 1) AS extension_trusted"
  );
  const row = result.rows[0];
  assert(row.role === "syncup_provisioner", label + ": connected as unexpected role " + row.role);
  assert(row.can_create && row.extension_available && row.extension_trusted,
    label + ": provisioner cannot install trusted btree_gist");
}
async function assertExtension(client, label) {
  const result = await client.query("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='btree_gist') AS installed");
  assert(result.rows[0].installed, label + ": btree_gist was not installed");
}
async function applyBaseline(client) {
  await client.query("BEGIN");
  try {
    await client.query(baseline);
    await client.query("INSERT INTO tenant_migrations(version) VALUES ('20261031000100_tenant_baseline')");
    await client.query("INSERT INTO tenant_settings(key,value) VALUES ('migration-test', '{\"preserved\":true}'::jsonb)");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
async function schemaSnapshot(client) {
  const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const enums = await client.query("SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e' ORDER BY t.typname");
  const constraints = await client.query("SELECT c.relname AS table_name, con.conname AS constraint_name, con.contype AS constraint_type FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname, con.conname");
  const indexes = await client.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname");
  const versions = await client.query("SELECT version FROM public.tenant_migrations ORDER BY version");
  const extension = await client.query("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='btree_gist') AS installed");
  return { tables: tables.rows, enums: enums.rows, constraints: constraints.rows, indexes: indexes.rows, versions: versions.rows, btree_gist: extension.rows[0].installed };
}

async function exerciseLifecycle(client, label) {
  const storeId = randomUUID();
  const branch1 = randomUUID();
  const warehouse1 = randomUUID();
  const branch2 = randomUUID();
  const warehouse2 = randomUUID();
  const warehouse3 = randomUUID();

  await client.query("BEGIN");
  await client.query(
    "INSERT INTO stores (id,name,slug,normalized_slug,updated_at) VALUES ($1,'Test Store','test-store','test-store',NOW())",
    [storeId],
  );
  await client.query(
    "INSERT INTO branches (id,store_id,code,name,status,is_default,updated_at) VALUES ($1,$2,'HQ','Head Office','ACTIVE',TRUE,NOW())",
    [branch1, storeId],
  );
  await client.query(
    "INSERT INTO warehouses (id,branch_id,code,name,status,is_default,updated_at) VALUES ($1,$2,'MAIN','Main','ACTIVE',TRUE,NOW())",
    [warehouse1, branch1],
  );
  await client.query("COMMIT");

  await client.query("BEGIN");
  await client.query(
    "INSERT INTO branches (id,store_id,code,name,status,is_default,updated_at) VALUES ($1,$2,'B2','Branch 2','ACTIVE',FALSE,NOW())",
    [branch2, storeId],
  );
  await client.query(
    "INSERT INTO warehouses (id,branch_id,code,name,status,is_default,updated_at) VALUES ($1,$2,'MAIN','Main','ACTIVE',TRUE,NOW())",
    [warehouse2, branch2],
  );
  await client.query("COMMIT");

  // Replace the default Branch and archive the previous Branch atomically.
  await client.query("BEGIN");
  await client.query("UPDATE branches SET is_default=FALSE,updated_at=NOW() WHERE id=$1", [branch1]);
  await client.query("UPDATE branches SET is_default=TRUE,updated_at=NOW() WHERE id=$1", [branch2]);
  await client.query("UPDATE warehouses SET status='ARCHIVED',is_default=FALSE,updated_at=NOW() WHERE id=$1", [warehouse1]);
  await client.query("UPDATE branches SET status='ARCHIVED',is_default=FALSE,updated_at=NOW() WHERE id=$1", [branch1]);
  await client.query("COMMIT");

  const lastWarehouseError = await expectFailure(
    client,
    "BEGIN; UPDATE warehouses SET status='ARCHIVED',is_default=FALSE,updated_at=NOW() WHERE id='" + warehouse2 + "'; COMMIT;",
    "23514",
    label + ": last Warehouse guard",
  );
  await client.query("ROLLBACK").catch(() => undefined);
  assert(lastWarehouseError.code === "23514", label + ": wrong last Warehouse error");

  // Replace the default Warehouse before archiving the old one in one transaction.
  await client.query("BEGIN");
  await client.query(
    "INSERT INTO warehouses (id,branch_id,code,name,status,is_default,updated_at) VALUES ($1,$2,'WH2','Second','ACTIVE',FALSE,NOW())",
    [warehouse3, branch2],
  );
  await client.query("UPDATE warehouses SET is_default=FALSE,updated_at=NOW() WHERE id=$1", [warehouse2]);
  await client.query("UPDATE warehouses SET is_default=TRUE,updated_at=NOW() WHERE id=$1", [warehouse3]);
  await client.query("UPDATE warehouses SET status='ARCHIVED',is_default=FALSE,updated_at=NOW() WHERE id=$1", [warehouse2]);
  await client.query("COMMIT");

  const lastBranchError = await expectFailure(
    client,
    "BEGIN; UPDATE warehouses SET status='ARCHIVED',is_default=FALSE,updated_at=NOW() WHERE id='" + warehouse3 +
      "'; UPDATE branches SET status='ARCHIVED',is_default=FALSE,updated_at=NOW() WHERE id='" + branch2 + "'; COMMIT;",
    "23514",
    label + ": last Branch guard",
  );
  await client.query("ROLLBACK").catch(() => undefined);
  assert(lastBranchError.code === "23514", label + ": wrong last Branch error");

  const defaults = await client.query(
    "SELECT (SELECT count(*) FROM branches WHERE store_id=$1 AND status='ACTIVE' AND is_default) AS branches, " +
    "(SELECT count(*) FROM warehouses WHERE branch_id=$2 AND status='ACTIVE' AND is_default) AS warehouses",
    [storeId, branch2],
  );
  assert(Number(defaults.rows[0].branches) === 1 && Number(defaults.rows[0].warehouses) === 1,
    label + ": exactly one active default Branch and Warehouse must remain");
  console.log("PASS " + label + ": lifecycle constraints and atomic default replacement");
}

async function run() {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  const suffix = process.pid + "_" + Date.now();
  const databases = ["syncup_clean_" + suffix, "syncup_upgrade_" + suffix];
  const clients = [];
  try {
    for (const database of databases) {
      await admin.query("CREATE DATABASE \"" + database + "\"");
      await admin.query("ALTER DATABASE \"" + database + "\" OWNER TO syncup_provisioner");
    }

    const cleanClient = await connectToDb(provisionerUrl, databases[0]);
    clients.push(cleanClient);
    await assertProvisioner(cleanClient, "Clean install");
    await applyBaseline(cleanClient);
    await cleanClient.query("BEGIN");
    try {
      await cleanClient.query(clean);
      await cleanClient.query("INSERT INTO tenant_migrations(version) VALUES ('202611030001_tenant_commerce')");
      await cleanClient.query("COMMIT");
    } catch (error) {
      await cleanClient.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
    const cleanFoundation = await cleanClient.query(
      "SELECT value->>'preserved' AS preserved FROM tenant_settings WHERE key='migration-test'",
    );
    assert(cleanFoundation.rows[0] && cleanFoundation.rows[0].preserved === "true",
      "Clean install did not preserve the baseline foundation row");
    await assertExtension(cleanClient, "Clean install");
    const cleanSnapshot = await schemaSnapshot(cleanClient);
    await exerciseLifecycle(cleanClient, "Clean install");

    const upgradeClient = await connectToDb(provisionerUrl, databases[1]);
    clients.push(upgradeClient);
    await assertProvisioner(upgradeClient, "Incremental upgrade");
    await applyBaseline(upgradeClient);
    await upgradeClient.query(incremental);
    const upgradeFoundation = await upgradeClient.query(
      "SELECT value->>'preserved' AS preserved FROM tenant_settings WHERE key='migration-test'",
    );
    assert(upgradeFoundation.rows[0] && upgradeFoundation.rows[0].preserved === "true",
      "Incremental upgrade did not preserve the baseline foundation row");
    const ledger = await upgradeClient.query(
      "SELECT version FROM tenant_migrations WHERE version='202611030001_tenant_commerce'",
    );
    assert(ledger.rowCount === 1, "Incremental upgrade did not record its migration version");
    await assertExtension(upgradeClient, "Incremental upgrade");
    const upgradeSnapshot = await schemaSnapshot(upgradeClient);
    assert(JSON.stringify(cleanSnapshot) === JSON.stringify(upgradeSnapshot),
      "Clean install and incremental upgrade schema snapshots differ");
    console.log("PASS Clean install / Incremental upgrade parity: tables, enums, constraints, indexes, migration ledger, and btree_gist match");
    await exerciseLifecycle(upgradeClient, "Incremental upgrade");

    const beforeDuplicate = await schemaSnapshot(upgradeClient);
    const duplicateError = await expectFailure(
      upgradeClient,
      incremental,
      undefined,
      "Incremental duplicate-application guard",
    );
    await upgradeClient.query("ROLLBACK").catch(() => undefined);
    const afterDuplicate = await schemaSnapshot(upgradeClient);
    assert(JSON.stringify(beforeDuplicate) === JSON.stringify(afterDuplicate),
      "Schema changed after rejected duplicate application");
    assert(
      duplicateError.message.includes("Commerce objects already exist; refusing partial or duplicate upgrade"),
      "Duplicate application was rejected for an unexpected reason: " + duplicateError.message,
    );
    console.log("PASS Incremental upgrade: baseline row retained, migration ledger recorded, duplicate guard active");
    console.log("PASS disposable PostgreSQL verification completed for both candidates");
  } finally {
    for (const client of clients) await client.end().catch(() => undefined);
    for (const database of databases) {
      await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1", [database]).catch(() => undefined);
      await admin.query("DROP DATABASE IF EXISTS \"" + database + "\"").catch(() => undefined);
    }
    await admin.end();
  }
}
run().catch((error) => {
  console.error("FAIL tenant migration candidate verification:", error.stack || error.message);
  process.exitCode = 1;
});
