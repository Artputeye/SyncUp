const assert = require("node:assert/strict");
const { WorkspacesService } = require("../dist/core/workspaces/workspaces.service.js");
const { WorkspaceProvisioningService } = require("../dist/database/workspace-provisioning.service.js");

async function run() {
  const events = [];
  let createdWorkspaceType = null;
  const db = {
    workspace: {
      findUnique: async () => ({ id: "workspace-test", slug: "test", type: createdWorkspaceType, provisioningProfileId: createdWorkspaceType === "ONLINE" ? "online-standard" : "pos-standard", provisioningProfileVersion: "1.0.0" }),
      create: async ({ data }) => {
        createdWorkspaceType = data.type;
        assert.equal(data.provisioningProfileId, data.type === "POS" ? "pos-standard" : "online-standard");
        assert.equal(data.provisioningProfileVersion, "1.0.0");
        events.push("workspace:create");
        return { id: "workspace-test", status: "PROVISIONING" };
      },
      updateMany: async (args) => {
        events.push("workspace:mark-failed");
        assert.equal(args.where.id, "workspace-test");
        assert.equal(args.where.status, "PROVISIONING");
        assert.equal(args.data.status, "FAILED");
        return { count: 1 };
      }
    },
    moduleInstallation: { findMany: async () => [] },
    permission: {
      createMany: async () => { events.push("permissions:seed"); },
      findMany: async ({ where }) => where.key.in.map((key) => ({ id: `permission-${key}` }))
    },
    role: {
      findFirst: async ({ where }) => {
        events.push(`role:lookup:${where.key}`);
        return null;
      },
      create: async ({ data }) => {
        events.push(`role:create:${data.key}`);
        return { id: `role-${data.key}` };
      }
    },
    rolePermission: {
      createMany: async ({ data }) => { events.push(`role-permissions:${data.length}`); }
    }
  };

  let provisionCalled = false;
  const provisioning = {
    provision: async () => {
      provisionCalled = true;
      events.push("provision:tenant");
      return { workspaceId: "workspace-test", status: "ACTIVE" };
    }
  };

  const service = new WorkspacesService(db, provisioning);
  const result = await service.create({ slug: "test", name: "Test", type: "POS", ownerUserId: "owner" });
  assert.equal(result.status, "ACTIVE");
  assert.equal(createdWorkspaceType, "POS");
  assert.equal(provisionCalled, true);
  const createCountBeforeInvalid = events.filter(event => event === "workspace:create").length;
  await assert.rejects(
    service.create({ slug: "missing-type", name: "Missing Type", ownerUserId: "owner" }),
    /Workspace Type/
  );
  assert.equal(events.filter(event => event === "workspace:create").length, createCountBeforeInvalid, "Invalid type must be rejected before creating a Workspace.");
  assert.ok(events.indexOf("role-permissions:26") < events.indexOf("provision:tenant"));
  assert.ok(events.indexOf("role:create:manager") < events.indexOf("provision:tenant"));
  assert.ok(events.indexOf("role:create:cashier") < events.indexOf("provision:tenant"));
  assert.equal(events.includes("role:create:inventory_staff"), false, "Inventory Staff must be deferred during initial bootstrap.");
  await service.ensureDefaultRoles("workspace-test", true);
  assert.equal(events.includes("role:create:inventory_staff"), true, "Explicit Inventory Staff provisioning should create the role.");

  const untypedProvisioner = new WorkspaceProvisioningService({
    workspace: { findUniqueOrThrow: async () => ({ id: "legacy-workspace", type: null, status: "PROVISIONING" }) }
  }, {});
  await assert.rejects(untypedProvisioner.provision("legacy-workspace"), /Workspace Type must be POS or ONLINE/);

  const mismatchedProfileProvisioner = new WorkspaceProvisioningService({
    workspace: { findUniqueOrThrow: async () => ({ id: "mismatched-workspace", type: "POS", provisioningProfileId: "online-standard", provisioningProfileVersion: "1.0.0" }) }
  }, {});
  await assert.rejects(mismatchedProfileProvisioner.provision("mismatched-workspace"), /missing, stale or incompatible/);

  const failureEvents = [];
  const failingDb = {
    ...db,
    workspace: {
      ...db.workspace,
      updateMany: async (args) => {
        failureEvents.push("workspace:mark-failed");
        assert.equal(args.where.status, "PROVISIONING");
        assert.equal(args.data.status, "FAILED");
      }
    },
    permission: {
      ...db.permission,
      createMany: async () => { throw new Error("seed failure"); }
    }
  };
  let failedProvisionCalled = false;
  const failingService = new WorkspacesService(failingDb, {
    provision: async () => { failedProvisionCalled = true; }
  });

  await assert.rejects(
    failingService.create({ slug: "test-failure", name: "Test Failure", type: "ONLINE", ownerUserId: "owner" }),
    /seed failure/
  );
  assert.equal(failedProvisionCalled, false);
  assert.deepEqual(failureEvents, ["workspace:mark-failed"]);

  console.log("Workspace bootstrap ordering and failure-state checks: PASS");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
