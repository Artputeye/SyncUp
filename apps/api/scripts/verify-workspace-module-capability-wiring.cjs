const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const businessControllers = [
  "src/core/inventory/opening-stock.controller.ts",
  "src/core/inventory/stock-inventory.controller.ts",
  "src/core/orders/sales-orders.controller.ts",
  "src/core/products/image-import.controller.ts",
  "src/core/products/media.controller.ts",
  "src/core/products/products.controller.ts",
  "src/core/tenant/branches.controller.ts",
  "src/core/tenant/stores.controller.ts",
  "src/core/tenant/tenant.controller.ts",
  "src/core/tenant/warehouses.controller.ts",
];

test("every POS commerce controller enforces module capability before RBAC", () => {
  for (const relative of businessControllers) {
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    assert.match(source, /@RequireModuleCapability\("commerce"\)/, relative + " missing module capability metadata");
    assert.match(source, /@UseGuards\(AuthGuard, WorkspaceModuleCapabilityGuard, RbacGuard\)/, relative + " missing capability guard");
    assert.match(source, /WorkspaceModuleCapabilityGuard/, relative + " missing guard import");
  }
});

test("all business modules import ModulesModule to provide the shared guard", () => {
  for (const relative of [
    "src/core/inventory/stock-inventory.module.ts",
    "src/core/orders/sales-orders.module.ts",
    "src/core/products/products.module.ts",
    "src/core/tenant/tenant.module.ts",
  ]) {
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    assert.match(source, /import \{ ModulesModule \} from "\.\.\/modules\/modules\.module"/, relative);
    assert.match(source, /imports: \[AuthModule, RbacModule, ModulesModule\]/, relative);
  }
});

test("module management endpoints are not blocked by business capability metadata", () => {
  const source = fs.readFileSync(path.join(root, "src/core/modules/modules.controller.ts"), "utf8");
  assert.doesNotMatch(source, /RequireModuleCapability/);
  assert.match(source, /@UseGuards\(AuthGuard\)/);
});
