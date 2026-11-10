const assert = require("node:assert/strict");
const { WorkspacesService } = require("../dist/core/workspaces/workspaces.service.js");
const { DEFAULT_WORKSPACE_ROLES } = require("../dist/core/rbac/permission-catalog.js");

function createHarness({ actorHasManage = true, targetExists = false, actorIsOwner = false } = {}) {
  const events = [];
  const roles = new Map();
  const rolePermissions = new Map();
  const permissionKeys = new Set();
  let permissionSeedCalls = 0;
  let userLookupCalls = 0;
  let membershipCreateCalls = 0;
  const actorId = "manager-user";
  const workspaceId = "workspace-e2e";
  const user = { id: "new-user", email: "new.user@example.test", displayName: "New User", status: "ACTIVE" };
  const actorMembership = { id: "actor-membership", userId: actorId, workspaceId, isOwner: actorIsOwner, workspace: { status: "ACTIVE" } };
  const db = {
    membership: {
      findUnique: async ({ where }) => {
        if (where.id === actorMembership.id) {
          const keys = actorHasManage ? ["members.manage"] : [];
          return { roles: [{ role: { permissions: keys.map(key => ({ permission: { key } })) } }] };
        }
        const lookupUserId = where.userId_workspaceId?.userId;
        if (lookupUserId === actorId) return actorMembership;
        if (lookupUserId === user.id && targetExists) return { id: "existing-membership" };
        return null;
      },
      create: async ({ data }) => {
        membershipCreateCalls++;
        events.push("membership:create");
        assert.equal(data.userId, user.id);
        assert.equal(data.workspaceId, workspaceId);
        const assignedRole = [...roles.values()].find(role => role.id === data.roles.create.roleId);
        assert.ok(assignedRole);
        return { id: "new-membership" };
      }
    },
    user: {
      findUnique: async () => { userLookupCalls++; return user; }
    },
    permission: {
      createMany: async ({ data }) => {
        permissionSeedCalls++;
        for (const item of data) permissionKeys.add(item.key);
        events.push("permissions:seed");
      },
      findMany: async ({ where }) => where.key.in.map(key => ({ id: "permission:" + key, key }))
    },
    role: {
      findFirst: async ({ where }) => roles.get(where.key) || null,
      create: async ({ data }) => {
        const role = { id: "role:" + data.key, ...data };
        roles.set(data.key, role);
        events.push("role:create:" + data.key);
        return role;
      },
      findMany: async () => [...roles.values()].map(role => ({
        ...role,
        permissions: (rolePermissions.get(role.id) || []).map(permissionId => ({
          permission: { id: permissionId, key: permissionId.slice("permission:".length) }
        }))
      }))
    },
    rolePermission: {
      createMany: async ({ data }) => {
        if (!data.length) return;
        const roleId = data[0].roleId;
        rolePermissions.set(roleId, [...(rolePermissions.get(roleId) || []), ...data.map(item => item.permissionId)]);
      }
    }
  };
  const provisioning = { provision: async () => ({ status: "ACTIVE" }) };
  return {
    service: new WorkspacesService(db, provisioning),
    roles, events, permissionKeys, get permissionSeedCalls() { return permissionSeedCalls; },
    get userLookupCalls() { return userLookupCalls; },
    get membershipCreateCalls() { return membershipCreateCalls; },
    actorId, workspaceId, user
  };
}

async function expectHttpError(promise, status) {
  await assert.rejects(promise, error => {
    assert.equal(typeof error.getStatus, "function");
    assert.equal(error.getStatus(), status);
    return true;
  });
}

async function main() {
  const inventory = DEFAULT_WORKSPACE_ROLES.find(role => role.key === "inventory_staff");
  const manager = DEFAULT_WORKSPACE_ROLES.find(role => role.key === "manager");
  const admin = DEFAULT_WORKSPACE_ROLES.find(role => role.key === "admin");
  for (const key of ["commerce.inventory.adjust", "commerce.inventory.transfer", "commerce.inventory.stocktake"]) {
    assert.ok(inventory.permissions.includes(key), "Inventory Staff must receive " + key);
    assert.ok(manager.permissions.includes(key), "Manager must retain " + key);
    assert.ok(admin.permissions.includes(key), "Admin must receive " + key);
  }
  assert.ok(!inventory.permissions.includes("commerce.inventory.movement.reverse"));
  assert.ok(manager.permissions.includes("commerce.inventory.movement.reverse"));
  assert.ok(admin.permissions.includes("commerce.inventory.movement.reverse"));

  const allowed = createHarness();
  const created = await allowed.service.addMember(
    allowed.actorId, allowed.workspaceId, " NEW.USER@EXAMPLE.TEST ", "inventory_staff"
  );
  assert.equal(created.role.key, "inventory_staff");
  assert.equal(allowed.roles.has("inventory_staff"), true);
  assert.equal(allowed.membershipCreateCalls, 1);
  assert.ok(allowed.events.indexOf("role:create:inventory_staff") < allowed.events.indexOf("membership:create"));
  assert.equal(allowed.permissionSeedCalls, 1);

  const denied = createHarness({ actorHasManage: false });
  await expectHttpError(
    denied.service.addMember(denied.actorId, denied.workspaceId, "new.user@example.test", "inventory_staff"),
    403
  );
  assert.equal(denied.permissionSeedCalls, 0, "Unauthorized requests must not seed permissions or create roles.");
  assert.equal(denied.roles.has("inventory_staff"), false);
  assert.equal(denied.userLookupCalls, 0);

  const duplicate = createHarness({ targetExists: true });
  await expectHttpError(
    duplicate.service.addMember(duplicate.actorId, duplicate.workspaceId, "new.user@example.test", "inventory_staff"),
    409
  );
  assert.equal(duplicate.permissionSeedCalls, 0, "Duplicate membership must not provision roles.");
  assert.equal(duplicate.roles.has("inventory_staff"), false);
  assert.equal(duplicate.membershipCreateCalls, 0);

  const managerCannotAssignAdmin = createHarness();
  await expectHttpError(
    managerCannotAssignAdmin.service.addMember(
      managerCannotAssignAdmin.actorId, managerCannotAssignAdmin.workspaceId, "new.user@example.test", "admin"
    ),
    403
  );
  assert.equal(managerCannotAssignAdmin.userLookupCalls, 0);
  assert.equal(managerCannotAssignAdmin.permissionSeedCalls, 0);

  const listing = createHarness();
  await listing.service.listRoles(listing.actorId, listing.workspaceId);
  assert.equal(listing.roles.has("inventory_staff"), false, "Role listing must not create Inventory Staff.");

  console.log("Workspace Inventory Staff authorization, provisioning order, duplicate protection, role matrix and deferred-listing checks: PASS");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
