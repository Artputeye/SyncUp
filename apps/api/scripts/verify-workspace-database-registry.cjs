const assert = require("node:assert/strict");
process.env.WORKSPACE_CREDENTIALS_ENCRYPTION_KEY = "11".repeat(32);
const { WorkspaceDatabaseRegistry } = require("../dist/database/workspace-database.registry.js");
const { encryptWorkspaceCredential } = require("../dist/database/workspace-credential.crypto.js");

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const makeDatabase = (suffix, password) => ({
  host: "127.0.0.1",
  port: 5432,
  databaseName: "syncup_ws_" + suffix,
  username: "syncup_rt_" + suffix,
  secretCipher: encryptWorkspaceCredential(password),
});
const assertRejects = async (promise, message) => {
  await assert.rejects(promise, message);
};

async function main() {
  let database = makeDatabase("111111111111", "first-password");
  let memberAllowed = true;
  const controlDb = {
    membership: {
      findFirst: async () => memberAllowed ? { workspace: { database } } : null,
    },
    workspaceDatabase: {
      findUnique: async () => database,
    },
  };
  const registry = new WorkspaceDatabaseRegistry(controlDb);
  const clients = [];
  registry.createClient = (url) => {
    const parsed = new URL(url);
    const client = {
      database: parsed.pathname.slice(1),
      connected: false,
      disconnects: 0,
      async $connect() { this.connected = true; },
      async $disconnect() { this.connected = false; this.disconnects++; },
    };
    clients.push(client);
    return client;
  };

  const first = await registry.forMembership(userId, workspaceId);
  assert.equal(first.database, "syncup_ws_111111111111");
  assert.equal(await registry.forMembership(userId, workspaceId), first, "same identity must reuse the Prisma client");
  assert.equal(clients.length, 1);

  database = makeDatabase("333333333333", "second-password");
  const second = await registry.forMembership(userId, workspaceId);
  assert.notEqual(second, first, "database remap must replace the cached client");
  assert.equal(first.disconnects, 1, "stale database client must be disconnected");
  assert.equal(second.database, "syncup_ws_333333333333");

  database = makeDatabase("333333333333", "rotated-password");
  const third = await registry.forMembership(userId, workspaceId);
  assert.notEqual(third, second, "credential rotation must replace the cached client");
  assert.equal(second.disconnects, 1);

  await registry.evict(workspaceId);
  assert.equal(third.disconnects, 1, "eviction must disconnect the current client");

  let releaseConnect;
  let connectStarted;
  const started = new Promise((resolve) => { connectStarted = resolve; });
  const gate = new Promise((resolve) => { releaseConnect = resolve; });
  registry.createClient = (url) => {
    const parsed = new URL(url);
    const client = {
      database: parsed.pathname.slice(1),
      disconnects: 0,
      async $connect() { connectStarted(); await gate; },
      async $disconnect() { this.disconnects++; },
    };
    clients.push(client);
    return client;
  };
  const beforeConcurrent = clients.length;
  const a = registry.forMembership(userId, workspaceId);
  await started;
  const b = registry.forMembership(userId, workspaceId);
  releaseConnect();
  const [parallelA, parallelB] = await Promise.all([a, b]);
  assert.equal(parallelA, parallelB, "parallel first-use requests must share one client");
  assert.equal(clients.length, beforeConcurrent + 1, "parallel first-use must create only one client");

  memberAllowed = false;
  await assertRejects(registry.forMembership(userId, workspaceId), /No active membership/);
  memberAllowed = true;
  await registry.onModuleDestroy();
  assert.ok(clients.at(-1).disconnects >= 1, "module shutdown must disconnect cached clients");


  let racingDatabase = makeDatabase("555555555555", "race-password");
  const raceControl = {
    membership: { findFirst: async () => ({ workspace: { database: racingDatabase } }) },
    workspaceDatabase: { findUnique: async () => racingDatabase },
  };
  const raceRegistry = new WorkspaceDatabaseRegistry(raceControl);
  let releaseRace;
  let signalStarted;
  const raceStarted = new Promise((resolve) => { signalStarted = resolve; });
  const raceGate = new Promise((resolve) => { releaseRace = resolve; });
  let raceClient;
  raceRegistry.createClient = (url) => {
    const parsed = new URL(url);
    raceClient = { disconnected: false, async $connect() { signalStarted(); await raceGate; }, async $disconnect() { this.disconnected = true; } };
    return raceClient;
  };
  const racingConnect = raceRegistry.forMembership(userId, workspaceId);
  await raceStarted;
  racingDatabase = makeDatabase("666666666666", "new-race-password");
  releaseRace();
  await assert.rejects(racingConnect, /identity changed during connection/);
  assert.equal(raceClient.disconnected, true, "client connected against stale mapping must be disconnected");
  let replacementClient;
  raceRegistry.createClient = (url) => {
    const parsed = new URL(url);
    replacementClient = { database: parsed.pathname.slice(1), async $connect() {}, async $disconnect() {} };
    return replacementClient;
  };
  assert.equal((await raceRegistry.forMembership(userId, workspaceId)).database, "syncup_ws_666666666666");
  await raceRegistry.onModuleDestroy();

  console.log("P0.7_WORKSPACE_DATABASE_REGISTRY PASS");
  console.log("PASS active membership checked on every call, including cache hits");
  console.log("PASS cached client replaced on database remap and credential rotation");
  console.log("PASS concurrent first-use shares a single Prisma client");
  console.log("PASS mapping changes during connection fail closed and disconnect the stale client");
  console.log("PASS eviction and module shutdown disconnect clients");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
