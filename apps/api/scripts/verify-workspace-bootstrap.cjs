const assert = require("node:assert/strict");
const { WorkspacesService } = require("../dist/core/workspaces/workspaces.service.js");

async function run() {
  const events = [];
  const db = {
    workspace: {
      create: async () => {
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
  const result = await service.create({ slug: "test", name: "Test", ownerUserId: "owner" });
  assert.equal(result.status, "ACTIVE");
  assert.equal(provisionCalled, true);
  assert.ok(events.indexOf("role-permissions:26") < events.indexOf("provision:tenant"));
  assert.ok(events.indexOf("role:create:manager") < events.indexOf("provision:tenant"));
  assert.ok(events.indexOf("role:create:cashier") < events.indexOf("provision:tenant"));
  assert.equal(events.includes("role:create:inventory_staff"), false, "Inventory Staff must be deferred during initial bootstrap.");
  await service.ensureDefaultRoles("workspace-test", true);
  assert.equal(events.includes("role:create:inventory_staff"), true, "Explicit Inventory Staff provisioning should create the role.");

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
    failingService.create({ slug: "test-failure", name: "Test Failure", ownerUserId: "owner" }),
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
