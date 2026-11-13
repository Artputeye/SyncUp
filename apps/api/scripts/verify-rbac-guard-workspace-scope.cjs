const test = require("node:test");
const assert = require("node:assert/strict");
const { RbacGuard } = require("../dist/core/rbac/rbac.guard.js");

function setup(permission = "commerce.product.view") {
  const calls = [];
  const reflector = { getAllAndOverride: () => permission };
  const rbac = { hasPermission: async (...args) => { calls.push(args); return true; } };
  const guard = new RbacGuard(reflector, rbac);
  const request = { user: { userId: "user-1" }, params: { workspaceId: "workspace-a" }, headers: {} };
  const context = {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  };
  return { guard, request, context, calls };
}
async function forbidden(promise) {
  await assert.rejects(promise, (error) => error && error.getStatus?.() === 403);
}

test("authorizes only against route Workspace and records request scope", async () => {
  const { guard, request, context, calls } = setup();
  assert.equal(await guard.canActivate(context), true);
  assert.deepEqual(calls, [["user-1", "workspace-a", "commerce.product.view"]]);
  assert.equal(request.workspaceId, "workspace-a");
});

test("rejects header-only Workspace scope", async () => {
  const { guard, request, context, calls } = setup();
  request.params = {};
  request.headers["x-workspace-id"] = "workspace-a";
  await forbidden(guard.canActivate(context));
  assert.equal(calls.length, 0);
});

test("rejects conflicting and multi-value Workspace headers", async () => {
  const conflict = setup();
  conflict.request.headers["x-workspace-id"] = "workspace-b";
  await forbidden(conflict.guard.canActivate(conflict.context));
  assert.equal(conflict.calls.length, 0);

  const multiple = setup();
  multiple.request.headers["x-workspace-id"] = ["workspace-a", "workspace-b"];
  await forbidden(multiple.guard.canActivate(multiple.context));
  assert.equal(multiple.calls.length, 0);
});

test("allows a matching optional Workspace header", async () => {
  const { guard, request, context, calls } = setup();
  request.headers["x-workspace-id"] = "workspace-a";
  assert.equal(await guard.canActivate(context), true);
  assert.equal(calls.length, 1);
});

test("does not require Workspace scope on routes without permission metadata", async () => {
  const { guard, request, context, calls } = setup(null);
  request.params = {};
  assert.equal(await guard.canActivate(context), true);
  assert.equal(calls.length, 0);
});
