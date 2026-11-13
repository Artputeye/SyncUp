const test = require("node:test");
const assert = require("node:assert/strict");
const { WorkspaceModuleCapabilityGuard } = require("../dist/core/modules/workspace-module-capability.guard.js");

const manifest = { id: "commerce", workspaceTypes: ["POS"] };
const profile = { id: "pos-standard", version: "1.0.0", allowedModuleIds: ["commerce"] };

function setup(overrides = {}) {
  const workspace = {
    id: "workspace-pos",
    type: "POS",
    provisioningProfileId: "pos-standard",
    provisioningProfileVersion: "1.0.0",
  };
  const db = {
    membership: {
      findFirst: async () => overrides.membership === undefined ? { id: "membership-1", workspace } : overrides.membership,
    },
    moduleInstallation: {
      findUnique: async () => overrides.installation === undefined
        ? { enabled: true, status: "ENABLED" }
        : overrides.installation,
    },
  };
  const modules = {
    get: () => overrides.manifest === undefined ? manifest : overrides.manifest,
    resolvePersistedProfile: () => overrides.profile === undefined ? profile : overrides.profile,
  };
  const reflector = { getAllAndOverride: () => "commerce" };
  const guard = new WorkspaceModuleCapabilityGuard(reflector, db, modules);
  const request = {
    user: { userId: "user-1" },
    params: { workspaceId: "workspace-pos" },
    headers: {},
  };
  return { guard, request };
}

async function expectForbidden(promise) {
  await assert.rejects(promise, (error) => error && error.getStatus?.() === 403);
}

function context(request) {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

test("allows active member when type, persisted profile and module installation match", async () => {
  const { guard, request } = setup();
  assert.equal(await guard.canActivate(context(request)), true);
  assert.equal(request.workspaceId, "workspace-pos");
});

test("denies missing membership", async () => {
  const { guard, request } = setup({ membership: null });
  await expectForbidden(guard.canActivate(context(request)));
});

test("denies legacy workspace without a type", async () => {
  const { guard, request } = setup({ membership: { workspace: { type: null, provisioningProfileId: null, provisioningProfileVersion: null } } });
  await expectForbidden(guard.canActivate(context(request)));
});

test("denies a POS-only module in an ONLINE workspace", async () => {
  const { guard, request } = setup({ membership: { workspace: { type: "ONLINE", provisioningProfileId: "online-standard", provisioningProfileVersion: "1.0.0" } } });
  await expectForbidden(guard.canActivate(context(request)));
});

test("denies a stale or missing persisted profile", async () => {
  const { guard, request } = setup({ profile: null });
  await expectForbidden(guard.canActivate(context(request)));
});

test("denies when profile does not allow the module", async () => {
  const { guard, request } = setup({ profile: { ...profile, allowedModuleIds: [] } });
  await expectForbidden(guard.canActivate(context(request)));
});

test("denies missing or disabled module installation, including for Owner membership", async () => {
  const { guard, request } = setup({ membership: { id: "owner-membership", isOwner: true, workspace: { id: "workspace-pos", type: "POS", provisioningProfileId: "pos-standard", provisioningProfileVersion: "1.0.0" } }, installation: { enabled: false, status: "DISABLED" } });
  await expectForbidden(guard.canActivate(context(request)));
});

test("denies a conflicting x-workspace-id header instead of overriding route scope", async () => {
  const { guard, request } = setup();
  request.headers["x-workspace-id"] = "workspace-online";
  await expectForbidden(guard.canActivate(context(request)));
});

test("denies malformed multi-value Workspace header", async () => {
  const { guard, request } = setup();
  request.headers["x-workspace-id"] = ["workspace-pos", "workspace-online"];
  await expectForbidden(guard.canActivate(context(request)));
});

test("denies requests without a route workspace context", async () => {
  const { guard, request } = setup();
  request.params = {};
  request.headers["x-workspace-id"] = "workspace-pos";
  await expectForbidden(guard.canActivate(context(request)));
});
