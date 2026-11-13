"use strict";
require("reflect-metadata");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
const { Client } = require("pg");
const { hash } = require("bcryptjs");
const { WorkspacesService } = require("../dist/core/workspaces/workspaces.service");
const { WorkspaceProvisioningService } = require("../dist/database/workspace-provisioning.service");
const { TenantMigrationRunner } = require("../dist/database/tenant-migration.runner");
const { decryptWorkspaceCredential } = require("../dist/database/workspace-credential.crypto");

const root = path.resolve(__dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const controlUrl = new URL(process.env.CONTROL_DATABASE_URL || "");
const adminUrl = new URL(process.env.WORKSPACE_DATABASE_ADMIN_URL || "");
for (const [url, label] of [[controlUrl, "CONTROL_DATABASE_URL"], [adminUrl, "WORKSPACE_DATABASE_ADMIN_URL"]]) {
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(url.hostname), label + " must point to localhost");
}
assert.equal(adminUrl.pathname, "/postgres", "Disposable admin connection must target /postgres");
assert.ok(process.env.WEB_ORIGIN, "WEB_ORIGIN is required");
const apiPort = Number(process.env.P07_HTTP_E2E_PORT || 43129);
const apiBase = "http://127.0.0.1:" + apiPort + "/api";
const cookieName = process.env.AUTH_COOKIE_NAME || "syncup_session";
const suffix = Date.now().toString(36);
const controlDbName = "syncup_p07_control_" + suffix;
const password = randomUUID() + randomUUID();
const users = {
  a: { email: "p07-a-" + suffix + "@syncup.local", password },
  b: { email: "p07-b-" + suffix + "@syncup.local", password },
  bAdmin: { email: "p07-b-admin-" + suffix + "@syncup.local", password },
};
const fixtures = [];
const userIds = [];
let control, apiProcess, tempRoot, apiStarted = false;

function quoteId(value) { return '"' + value.replace(/"/g, '""') + '"'; }
function quoteLiteral(value) { return "'" + value.replace(/'/g, "''") + "'"; }
function tenantUrl(database) {
  const url = new URL(adminUrl);
  url.pathname = "/" + database;
  return url.toString();
}
async function connect(url) {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 10000 });
  await client.connect();
  return client;
}
async function setupTenant(workspace) {
  const dbMeta = workspace.database;
  assert.ok(dbMeta, "Tenant DB metadata missing");
  assert.match(dbMeta.databaseName, /^syncup_ws_[a-f0-9]{12}$/);
  assert.match(dbMeta.username, /^syncup_rt_[a-f0-9]{12}$/);
  const admin = await connect(tenantUrl(dbMeta.databaseName));
  try {
    const migrations = [
      "docs/architecture/tenant-commerce-clean-install.candidate.sql",
      "docs/architecture/tenant-commerce-custom-constraints.candidate.sql",
      "docs/architecture/tenant-canonicalization-constraints.candidate.sql",
      "docs/architecture/tenant-branch-warehouse-lifecycle.candidate.sql",
      "apps/api/prisma/tenant/migrations/20261113000100_tenant_media_images.sql",
    ];
    for (const migration of migrations) await admin.query(read(migration));
    const roleName = quoteId(dbMeta.username);
    await admin.query("GRANT USAGE ON SCHEMA public TO " + roleName);
    await admin.query("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO " + roleName);
    await admin.query("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO " + roleName);
    await admin.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO " + roleName);
    await admin.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO " + roleName);
    const productId = randomUUID();
    await admin.query(
      "INSERT INTO products (id,name,status,normalized_name,updated_at) VALUES ($1,'P07 HTTP Product','ACTIVE','p07 http product',NOW())",
      [productId],
    );
    const batchId = randomUUID();
    await admin.query(
      "INSERT INTO image_import_batches (id,status,source_filename,source_checksum,total_files,processed_files,valid_files,invalid_files,uploaded_by,created_at,updated_at) VALUES ($1,'PREVIEW_READY'::\"ImportStatus\",'p07.zip',$2,0,0,0,0,$3,NOW(),NOW())",
      [batchId, "a".repeat(64), workspace.ownerUserId],
    );
    const fixture = fixtures.find((item) => item.workspaceId === workspace.id);
    if (!fixture) throw new Error("Workspace fixture missing during Tenant setup");
    Object.assign(fixture, { productId, batchId });
  } finally {
    await admin.end();
  }
}
async function waitForApi() {
  for (let i = 0; i < 80; i++) {
    if (apiProcess.exitCode !== null) throw new Error("API process exited before health check");
    try {
      const response = await fetch(apiBase + "/health");
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("API health check timed out");
}
async function stopApi() {
  if (!apiProcess || apiProcess.exitCode !== null) return;
  apiProcess.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => apiProcess.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 10000)),
  ]);
  if (apiProcess.exitCode === null) apiProcess.kill("SIGKILL");
  apiProcess = null;
}
async function login(user) {
  const response = await fetch(apiBase + "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(user),
  });
  const body = await response.text();
  assert.equal(response.status, 201, "Login failed: " + body);
  const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get("set-cookie") || ""];
  const cookie = cookies.map((value) => value.split(";")[0]).find((value) => value.startsWith(cookieName + "="));
  assert.ok(cookie, "Session cookie missing");
  return cookie;
}
async function request(cookie, method, route, body, origin = undefined) {
  const response = await fetch(apiBase + route, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(origin ? { origin } : {}),
      ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}),
    },
    ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  return { status: response.status, data, headers: response.headers };
}
function expect(result, status, label) {
  assert.equal(result.status, status, label + ": expected " + status + ", received " + result.status + " " + JSON.stringify(result.data));
  return result.data;
}

async function main() {
  control = new PrismaClient();
  const permissionBefore = await control.permission.findMany({ select: { key: true }, orderBy: { key: "asc" } });
  try {
    const createdUsers = {};
    for (const [key, item] of Object.entries(users)) {
      const user = await control.user.create({
        data: { email: item.email, passwordHash: await hash(item.password, 10), displayName: "P0.7 HTTP " + key, status: "ACTIVE" },
      });
      createdUsers[key] = user;
      userIds.push(user.id);
    }

    const provisioning = new WorkspaceProvisioningService(control, new TenantMigrationRunner());
    const workspaces = new WorkspacesService(control, provisioning);
    for (const key of ["a", "b"]) {
      const slug = "p07-http-" + key + "-" + suffix;
      await workspaces.create({ slug, name: "Disposable P0.7 HTTP " + key, type: "POS", ownerUserId: createdUsers[key].id });
      const workspace = await control.workspace.findUniqueOrThrow({ where: { slug }, include: { database: true } });
      fixtures.push({ workspaceId: workspace.id, databaseName: workspace.database?.databaseName, runtimeRole: workspace.database?.username, slug, ownerUserId: createdUsers[key].id });
      await setupTenant(workspace);
    }
    const workspaceB = await control.workspace.findUniqueOrThrow({ where: { id: fixtures.find((x) => x.slug?.includes("-b-"))?.workspaceId }, include: { database: true } });
    const adminRole = await control.role.findFirst({ where: { workspaceId: workspaceB.id, key: "admin" } });
    assert.ok(adminRole, "Default Admin role missing in Workspace B");
    await control.membership.create({
      data: { userId: createdUsers.bAdmin.id, workspaceId: workspaceB.id, roles: { create: { roleId: adminRole.id } } },
    });

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "syncup-p07-http-media-"));
    apiProcess = spawn(process.execPath, ["dist/main.js"], {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, API_PORT: String(apiPort), MEDIA_STORAGE_ROOT: tempRoot, DATABASE_URL: disposableControlUrl.toString(), CONTROL_DATABASE_URL: disposableControlUrl.toString() },
      stdio: "ignore",
      windowsHide: true,
    });
    apiStarted = true;
    await waitForApi();

    const a = fixtures.find((x) => x.slug?.includes("-a-"));
    const b = fixtures.find((x) => x.slug?.includes("-b-"));
    const cookieA = await login(users.a);
    const cookieB = await login(users.b);
    const cookieBAdmin = await login(users.bAdmin);
    const workspaceListA = expect(await request(cookieA, "GET", "/workspaces"), 200, "Workspace A list");
    assert.ok(workspaceListA.some((item) => item.id === a.workspaceId));
    assert.ok(!workspaceListA.some((item) => item.id === b.workspaceId), "Workspace A list must not disclose Workspace B");
    expect(await request(cookieA, "GET", "/workspaces/" + b.workspaceId + "/members"), 403, "foreign Workspace members");
    expect(await request(cookieA, "GET", "/tenant/" + b.workspaceId + "/products/" + b.productId), 403, "foreign Workspace product route");
    expect(await request(cookieA, "GET", "/tenant/" + a.workspaceId + "/products/" + b.productId), 404, "foreign nested Product ID in own Tenant");
    expect(await request(cookieA, "GET", "/tenant/" + a.workspaceId + "/products/" + a.productId), 200, "own Workspace Product");

    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/F9sAAAAASUVORK5CYII=", "base64");
    const upload = new FormData();
    upload.append("file", new Blob([png], { type: "image/png" }), "p07.png");
    const uploaded = expect(await request(cookieB, "POST", "/tenant/" + b.workspaceId + "/products/" + b.productId + "/images", upload, process.env.WEB_ORIGIN), 201, "Workspace B Media upload");
    const mediaId = uploaded.id;
    assert.ok(mediaId, "Media upload must return media asset ID");

    for (const kind of ["ORIGINAL", "MAIN", "THUMBNAIL"]) {
      const ownMedia = await request(cookieB, "GET", "/tenant/" + b.workspaceId + "/media/" + mediaId + "/" + kind);
      expect(ownMedia, 200, "Workspace B " + kind);
      assert.equal(ownMedia.headers.get("cache-control"), "private, no-store, max-age=0");
      const wrongTenant = await request(cookieA, "GET", "/tenant/" + a.workspaceId + "/media/" + mediaId + "/" + kind);
      expect(wrongTenant, 404, "cross-Tenant Media " + kind + " ID");
      const nonMember = await request(cookieA, "GET", "/tenant/" + b.workspaceId + "/media/" + mediaId + "/" + kind);
      expect(nonMember, 403, "non-member Media " + kind + " request");
    }

    expect(await request(cookieA, "POST", "/tenant/" + b.workspaceId + "/image-imports/" + b.batchId + "/commit", {}, process.env.WEB_ORIGIN), 403, "foreign Workspace Image Import commit");
    expect(await request(cookieA, "POST", "/tenant/" + a.workspaceId + "/image-imports/" + b.batchId + "/commit", {}, process.env.WEB_ORIGIN), 404, "foreign Tenant Image Import Batch ID");
    expect(await request(cookieBAdmin, "POST", "/tenant/" + b.workspaceId + "/image-imports/" + b.batchId + "/commit", {}, process.env.WEB_ORIGIN), 404, "other uploader Image Import Batch");
    const committed = expect(await request(cookieB, "POST", "/tenant/" + b.workspaceId + "/image-imports/" + b.batchId + "/commit", {}, process.env.WEB_ORIGIN), 201, "own Image Import Batch commit");
    assert.equal(committed.status, "COMMITTED");

    console.log("P0.7_AUTHENTICATED_HTTP_MEDIA_IMAGE_IMPORT_ISOLATION PASS");
    console.log("PASS two separately provisioned disposable POS Workspaces and Tenant DBs");
    console.log("PASS Workspace list/member/business route IDOR and nested Product ID isolation");
    console.log("PASS Media ORIGINAL/MAIN/THUMBNAIL own access, cross-Tenant 404, non-member 403 and no-store headers");
    console.log("PASS Image Import Batch cross-Tenant 404, non-member 403, uploader mismatch 404 and own commit");
  } finally {
    await stopApi().catch(() => undefined);
    if (control) await control.$disconnect().catch(() => undefined);
    const cleanupAdmin = await connect(adminUrl.toString());
    try {
      for (const item of fixtures) {
        if (!item.databaseName || !item.runtimeRole) continue;
        await cleanupAdmin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [item.databaseName]);
        await cleanupAdmin.query("DROP DATABASE IF EXISTS " + quoteId(item.databaseName));
        await cleanupAdmin.query("DROP ROLE IF EXISTS " + quoteId(item.runtimeRole));
      }
      await cleanupAdmin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [controlDbName]);
      await cleanupAdmin.query("DROP DATABASE IF EXISTS " + quoteId(controlDbName));
      console.log("P0.7_DISPOSABLE_CONTROL_AND_TENANT_CLEANUP PASS");
    } finally { await cleanupAdmin.end(); }
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
