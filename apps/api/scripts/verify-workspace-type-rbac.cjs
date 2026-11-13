const assert = require("node:assert/strict");
const {
  getWorkspacePermissionDefinitions,
  getWorkspaceRoleDefinitions,
  getWorkspaceRoleDefinition,
} = require("../dist/core/rbac/permission-catalog.js");
const { composeWorkspaceNavigation } = require("../dist/core/workspaces/workspace-navigation-catalog.js");
const { WorkspacesService } = require("../dist/core/workspaces/workspaces.service.js");

async function run() {
  const posPermissions = getWorkspacePermissionDefinitions("POS", ["commerce"], ["commerce"]);
  const onlinePermissions = getWorkspacePermissionDefinitions("ONLINE", []);
  assert.ok(posPermissions.some((item) => item.key === "commerce.sales.create"));
  assert.ok(onlinePermissions.every((item) => !item.key.startsWith("commerce.")));
  assert.ok(getWorkspaceRoleDefinitions("POS").some((role) => role.key === "cashier"));
  assert.equal(getWorkspaceRoleDefinition("ONLINE", "cashier"), undefined);
  assert.ok(getWorkspaceRoleDefinitions("ONLINE").every((role) => role.permissions.every((key) => !key.startsWith("commerce."))));
  assert.ok(!getWorkspacePermissionDefinitions("POS", ["commerce"], []).some((item) => item.key.startsWith("commerce.")));

  const onlineNav = composeWorkspaceNavigation("ONLINE", "shop-online", ["workspace.view", "modules.manage"], []);
  assert.ok(onlineNav.some((item) => item.href.endsWith("/online")));
  assert.ok(onlineNav.some((item) => item.id === "modules"));
  assert.ok(onlineNav.every((item) => !["pos", "orders", "products", "inventory", "stores"].includes(item.id)));
  const posNav = composeWorkspaceNavigation("POS", "shop-pos", ["workspace.view", "commerce.sales.create"], ["commerce"]);
  assert.ok(posNav.some((item) => item.id === "pos"));
  assert.ok(!posNav.some((item) => item.id === "products"));

  let writes = 0;
  const roleRows = [{
    id: "role-online-member", key: "member", name: "สมาชิก", isSystem: true,
    permissions: [
      { permission: { id: "p1", key: "workspace.view", description: "ดูข้อมูล Workspace" } },
      { permission: { id: "p2", key: "commerce.sales.create", description: "สร้างรายการขาย" } },
    ],
  }];
  const db = {
    membership: {
      findUnique: async () => ({ id: "membership-1", isOwner: true, workspace: { status: "ACTIVE" }, roles: [] }),
    },
    workspace: {
      findUnique: async () => ({ id: "workspace-online", slug: "shop-online", type: "ONLINE", provisioningProfileId: "online-standard", provisioningProfileVersion: "1.0.0" }),
    },
    moduleInstallation: { findMany: async () => [] },
    role: { findMany: async () => roleRows, findFirst: async () => ({ id: "role-online-member", key: "member" }) },
    permission: { createMany: async () => { writes++; }, findMany: async () => { writes++; return []; } },
    rolePermission: { createMany: async () => { writes++; }, deleteMany: async () => { writes++; }, create: async () => { writes++; } },
    membershipRole: { deleteMany: async () => { writes++; }, create: async () => { writes++; } },
    user: { findUnique: async () => null },
    $transaction: async () => { writes++; },
  };
  const staleProfileService = new WorkspacesService({ ...db, workspace: { findUnique: async () => ({ id: "workspace-online", slug: "shop-online", type: "POS", provisioningProfileId: "stale-profile", provisioningProfileVersion: "1.0.0" }) } }, {});
  await assert.rejects(staleProfileService.listRoles("owner", "workspace-online"), /Provisioning Profile/);

  const service = new WorkspacesService(db, {});
  const listed = await service.listRoles("owner", "workspace-online");
  assert.deepEqual(listed[0].permissions.map((item) => item.key), ["workspace.view"]);
  assert.equal(writes, 0, "GET roles must not write permissions, roles, or grants");

  await assert.rejects(
    service.updateRolePermissions("owner", "workspace-online", "member", ["commerce.sales.create"]),
    /ไม่รองรับ Workspace Type/,
  );
  assert.equal(writes, 0, "Rejected cross-type permission edits must not mutate data");

  await assert.rejects(
    service.addMember("owner", "workspace-online", "cashier@example.test", "cashier"),
    /บทบาทนี้ไม่รองรับ Workspace Type/,
  );
  assert.equal(writes, 0, "Cross-type role assignment must be rejected before writes");

  const navigation = await service.getNavigation("owner", "workspace-online");
  assert.equal(navigation.workspace.type, "ONLINE");
  assert.ok(navigation.items.every((item) => !["pos", "orders", "products", "inventory", "stores"].includes(item.id)));

  console.log("Workspace-type permission catalog, role matrix, read-only roles, cross-type guards and navigation: PASS");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
