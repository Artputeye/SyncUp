const assert = require("node:assert/strict");
const { Client } = require("pg");
const { randomBytes, randomUUID } = require("node:crypto");
const { WorkspaceDatabaseRegistry } = require("../dist/database/workspace-database.registry.js");
const { encryptWorkspaceCredential } = require("../dist/database/workspace-credential.crypto.js");

const adminUrl = process.env.TEST_POSTGRES_ADMIN_URL;
const encryptionKey = process.env.WORKSPACE_CREDENTIALS_ENCRYPTION_KEY;
const quoteId = (value) => '"' + value.replace(/"/g, '""') + '"';
const quoteLiteral = (value) => "'" + value.replace(/'/g, "''") + "'";
const ensure = (value, message) => { if (!value) throw new Error(message); };

async function main() {
  ensure(adminUrl, "TEST_POSTGRES_ADMIN_URL is required");
  const parsed = new URL(adminUrl);
  ensure(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname), "Safety stop: integration admin must be localhost");
  ensure(parsed.pathname === "/postgres", "Safety stop: integration admin must target /postgres");
  ensure(encryptionKey && /^[a-f0-9]{64}$/i.test(encryptionKey), "WORKSPACE_CREDENTIALS_ENCRYPTION_KEY must be configured");

  const admin = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 8000 });
  await admin.connect();
  const suffixA = randomBytes(6).toString("hex");
  const suffixB = randomBytes(6).toString("hex");
  const records = new Map();
  const createdDatabases = [];
  const createdRoles = [];
  const registry = new WorkspaceDatabaseRegistry({
    membership: {
      findFirst: async ({ where }) => {
        const database = records.get(where.workspaceId);
        if (!database || where.userId !== "p07-integration-user") return null;
        return { workspace: { database } };
      },
    },
    workspaceDatabase: {
      findUnique: async ({ where }) => records.get(where.workspaceId) || null,
    },
  });

  try {
    for (const [suffix, marker] of [[suffixA, "POS_TENANT_A"], [suffixB, "ONLINE_TENANT_B"]]) {
      const workspaceId = randomUUID();
      const databaseName = "syncup_ws_" + suffix;
      const username = "syncup_rt_" + suffix;
      const password = randomBytes(32).toString("base64url");
      await admin.query("CREATE ROLE " + quoteId(username) + " LOGIN PASSWORD " + quoteLiteral(password) + " NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT");
      createdRoles.push(username);
      await admin.query("CREATE DATABASE " + quoteId(databaseName) + " OWNER " + quoteId(username));
      createdDatabases.push(databaseName);
      records.set(workspaceId, {
        workspaceId,
        databaseName,
        host: parsed.hostname,
        port: Number(parsed.port || 5432),
        username,
        secretCipher: encryptWorkspaceCredential(password),
      });
      const db = await registry.forMembership("p07-integration-user", workspaceId);
      await db.$executeRawUnsafe("CREATE TABLE tenant_marker (value text NOT NULL)");
      await db.$executeRawUnsafe("INSERT INTO tenant_marker(value) VALUES ($1)", marker);
      records.get(workspaceId).expectedMarker = marker;
      records.get(workspaceId).client = db;
    }

    const entries = [...records.entries()];
    const [[workspaceA, recordA], [workspaceB, recordB]] = entries;
    const [clientA, clientB] = await Promise.all([
      registry.forMembership("p07-integration-user", workspaceA),
      registry.forMembership("p07-integration-user", workspaceB),
    ]);
    ensure(clientA !== clientB, "different Workspace IDs must have different Prisma clients");
    const [a, b] = await Promise.all([
      clientA.$queryRawUnsafe("SELECT value FROM tenant_marker"),
      clientB.$queryRawUnsafe("SELECT value FROM tenant_marker"),
    ]);
    ensure(a[0].value === recordA.expectedMarker, "Workspace A must resolve only its own Tenant DB");
    ensure(b[0].value === recordB.expectedMarker, "Workspace B must resolve only its own Tenant DB");
    const [againA, againB] = await Promise.all([
      registry.forMembership("p07-integration-user", workspaceA),
      registry.forMembership("p07-integration-user", workspaceB),
    ]);
    ensure(againA === clientA && againB === clientB, "parallel repeated lookups must preserve each Workspace's client");

    let denied = false;
    try { await registry.forMembership("unauthorized-user", workspaceA); } catch { denied = true; }
    ensure(denied, "membership failure must deny database access even when a client is cached");

    console.log("P0.7_WORKSPACE_DATABASE_REGISTRY_INTEGRATION PASS");
    console.log("PASS two localhost-only disposable Tenant databases return distinct Prisma clients");
    console.log("PASS parallel POS/ONLINE-style queries read only their own marker data");
    console.log("PASS cached clients remain Workspace-specific and membership is rechecked");
  } finally {
    await registry.onModuleDestroy().catch(() => undefined);
    for (const databaseName of createdDatabases) {
      await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1", [databaseName]).catch(() => undefined);
      await admin.query("DROP DATABASE IF EXISTS " + quoteId(databaseName)).catch(() => undefined);
    }
    for (const username of createdRoles) await admin.query("DROP ROLE IF EXISTS " + quoteId(username)).catch(() => undefined);
    await admin.end();
  }
}
main().catch((error) => { console.error("P0.7_WORKSPACE_DATABASE_REGISTRY_INTEGRATION_FAILED", error); process.exitCode = 1; });
