const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { hash } = require("bcryptjs");

const envPath = path.resolve(__dirname, "../.env");
const envText = fs.readFileSync(envPath, "utf8");
for (const line of envText.split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
}
const databaseUrl = new URL(process.env.CONTROL_DATABASE_URL || "");
if (!["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname) || databaseUrl.pathname !== "/syncup_control") {
  throw new Error("Refusing to provision E2E user: CONTROL_DATABASE_URL is not the expected local syncup_control database.");
}

const email = (process.env.LOCAL_TEST_MANAGER_EMAIL || "manager-e2e@syncup.local").trim().toLowerCase();
const password = process.env.LOCAL_TEST_MANAGER_PASSWORD || randomBytes(24).toString("base64url");
const workspaceSlug = process.env.E2E_WORKSPACE_SLUG || "pos-local";
const managerPermissions = [
  "workspace.view", "members.view", "modules.manage",
  "commerce.store.view", "commerce.store.manage",
  "commerce.warehouse.view", "commerce.warehouse.manage",
  "commerce.product.view", "commerce.product.create", "commerce.product.update", "commerce.product.archive",
  "commerce.pricing.manage",
  "commerce.inventory.view", "commerce.inventory.reservation.manage", "commerce.inventory.receive",
  "commerce.inventory.issue", "commerce.inventory.movement.reverse",
  "commerce.inventory.adjust", "commerce.inventory.transfer", "commerce.inventory.stocktake",
  "commerce.sales.view", "commerce.sales.create", "commerce.sales.discount", "commerce.sales.void",
  "commerce.orders.view", "commerce.orders.manage", "commerce.reports.view"
];

async function main() {
  const db = new PrismaClient();
  try {
    const workspace = await db.workspace.findUnique({ where: { slug: workspaceSlug } });
    if (!workspace || workspace.status !== "ACTIVE") throw new Error("Target workspace is missing or not ACTIVE.");
    const existing = await db.user.findUnique({ where: { email } });
    if (existing?.isPlatformAdmin) throw new Error("Refusing to repurpose a Platform Administrator account.");
    const passwordHash = await hash(password, 12);
    const user = await db.user.upsert({
      where: { email },
      create: { email, passwordHash, displayName: "E2E Manager", status: "ACTIVE" },
      update: { passwordHash, displayName: "E2E Manager", status: "ACTIVE" }
    });

    await db.permission.createMany({
      data: managerPermissions.map(key => ({ key, description: "Workspace permission" })),
      skipDuplicates: true
    });
    let role = await db.role.findFirst({ where: { workspaceId: workspace.id, key: "manager" } });
    if (!role) role = await db.role.create({ data: { workspaceId: workspace.id, key: "manager", name: "ผู้จัดการ", isSystem: true } });
    const permissions = await db.permission.findMany({ where: { key: { in: managerPermissions } }, select: { id: true } });
    await db.rolePermission.createMany({
      data: permissions.map(permission => ({ roleId: role.id, permissionId: permission.id })),
      skipDuplicates: true
    });

    const membership = await db.membership.upsert({
      where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
      create: { userId: user.id, workspaceId: workspace.id, isOwner: false },
      update: { isOwner: false }
    });
    await db.membershipRole.deleteMany({ where: { membershipId: membership.id } });
    await db.membershipRole.create({ data: { membershipId: membership.id, roleId: role.id } });

    let updatedEnv = envText;
    const setEnv = (key, value) => {
      const line = new RegExp("^" + key + "=.*$", "m");
      if (line.test(updatedEnv)) updatedEnv = updatedEnv.replace(line, key + "=" + value);
      else updatedEnv = updatedEnv.replace(/\s*$/, "") + "\n" + key + "=" + value + "\n";
    };
    setEnv("LOCAL_TEST_MANAGER_EMAIL", email);
    setEnv("LOCAL_TEST_MANAGER_PASSWORD", password);
    fs.writeFileSync(envPath, updatedEnv, "utf8");
    process.stdout.write(JSON.stringify({ success: true, email, workspace: workspaceSlug, role: "manager", createdUser: !existing, createdMembership: !membership.createdAt || false, passwordStoredInEnv: true }) + "\n");
  } finally {
    await db.$disconnect();
  }
}

main().catch(error => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
