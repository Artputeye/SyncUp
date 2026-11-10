const assert = require("node:assert/strict");
const { NestFactory } = require("@nestjs/core");
const { AppModule } = require("../dist/app.module");
const { PrismaService } = require("../dist/database/prisma.service");
const { hash } = require("bcryptjs");

const BASE = "http://127.0.0.1";
const users = {
  a: { email: "owner-a@syncup.local", password: process.env.LOCAL_TEST_USER_A_PASSWORD },
  b: { email: "owner-b@syncup.local", password: process.env.LOCAL_TEST_USER_B_PASSWORD }
};

async function request(baseUrl, path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) }
  });
}

async function login(baseUrl, credentials) {
  assert.ok(credentials.password, "Missing local test-user password in .env");
  const response = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials)
  });
  assert.equal(response.status, 201, "Login should succeed");
  const cookies = response.headers.getSetCookie?.() ?? [];
  const cookieName = process.env.AUTH_COOKIE_NAME ?? "syncup_session";
  const cookie = cookies.map(value => value.split(";")[0]).find(value => value.startsWith(cookieName + "="));
  assert.ok(cookie, "Login response did not set the session cookie");
  return cookie;
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ["error", "warn"] });
  const db = app.get(PrismaService);
  const originals = [];
  let baseUrl;

  try {
    // Align local test-account hashes with the credentials in .env, as the isolation setup does.
    for (const [key, item] of Object.entries(users)) {
      assert.ok(item.password, `Missing local test-user password for ${key}`);
      const user = await db.user.findUnique({ where: { email: item.email } });
      assert.ok(user, `Missing local test user: ${item.email}`);
      await db.user.update({
        where: { id: user.id },
        data: { passwordHash: await hash(item.password, 12), status: "ACTIVE" }
      });
    }

    app.setGlobalPrefix("api");
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    baseUrl = `${BASE}:${address.port}`;

    const workspaceA = await db.workspace.findUnique({ where: { slug: "workspace-a-local" }, include: { database: true } });
    const workspaceB = await db.workspace.findUnique({ where: { slug: "workspace-b-local" }, include: { database: true } });
    assert.ok(workspaceA && workspaceB, "Expected Workspace A and B to exist");
    for (const workspace of [workspaceA, workspaceB]) {
      assert.equal(workspace.status, "ACTIVE", `${workspace.slug} must start ACTIVE`);
      assert.ok(workspace.database, `${workspace.slug} database metadata missing`);
      originals.push({ id: workspace.id, status: workspace.status, databaseName: workspace.database.databaseName });
    }

    const anonymous = await request(baseUrl, `/api/tenant/${workspaceA.id}/settings`);
    assert.equal(anonymous.status, 401, "Tenant endpoint must reject unauthenticated requests");
    console.log("PASS HTTP unauthenticated request: 401");

    const cookieA = await login(baseUrl, users.a);
    const ownA = await request(baseUrl, `/api/tenant/${workspaceA.id}/settings`, { headers: { cookie: cookieA } });
    assert.equal(ownA.status, 200, "Workspace A owner should read own tenant settings");
    assert.ok(Array.isArray(await ownA.json()), "Tenant settings response should be an array");
    console.log("PASS HTTP Workspace A owner: own tenant settings returned");

    const crossA = await request(baseUrl, `/api/tenant/${workspaceB.id}/settings`, { headers: { cookie: cookieA } });
    assert.equal(crossA.status, 403, "Workspace A owner must not access Workspace B");
    console.log("PASS HTTP cross-tenant access: 403");

    const cookieB = await login(baseUrl, users.b);
    const ownB = await request(baseUrl, `/api/tenant/${workspaceB.id}/settings`, { headers: { cookie: cookieB } });
    assert.equal(ownB.status, 200, "Workspace B owner should read own tenant settings");
    assert.ok(Array.isArray(await ownB.json()), "Tenant settings response should be an array");
    console.log("PASS HTTP Workspace B owner: own tenant settings returned");

    await db.workspace.update({ where: { id: workspaceA.id }, data: { status: "SUSPENDED" } });
    try {
      const suspended = await request(baseUrl, `/api/tenant/${workspaceA.id}/settings`, { headers: { cookie: cookieA } });
      assert.equal(suspended.status, 403, "Suspended workspace must deny authenticated tenant requests");
      const exists = await db.$queryRaw`SELECT datname FROM pg_database WHERE datname = ${workspaceA.database.databaseName}`;
      assert.equal(exists[0]?.datname, workspaceA.database.databaseName, "Suspending workspace must not drop its database");
      console.log("PASS HTTP suspended Workspace A: 403; database preserved");
    } finally {
      await db.workspace.update({ where: { id: workspaceA.id }, data: { status: "ACTIVE" } });
    }

    console.log("PASS HTTP verification complete; Workspace A and B remain ACTIVE");
  } finally {
    for (const item of originals) {
      await db.workspace.update({ where: { id: item.id }, data: { status: item.status } });
    }
    await app.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
