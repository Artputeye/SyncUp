export type WorkspaceType = "POS" | "ONLINE";

export interface ModuleManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  source: "bundled";
  workspaceTypes: WorkspaceType[];
  compatibility: {
    minPlatformVersion: string;
    maxPlatformVersionExclusive: string;
  };
  dependencies: string[];
  requiredTenantMigrations: string[];
  permissions: string[];
}

export const COMMERCE_MODULE_MANIFEST: ModuleManifest = {
  id: "commerce",
  name: "Commerce",
  description: "Store, branch, warehouse, product, inventory and sales capabilities.",
  version: "0.1.0",
  source: "bundled",
  workspaceTypes: ["POS"],
  compatibility: {
    minPlatformVersion: "0.1.0",
    maxPlatformVersionExclusive: "1.0.0",
  },
  dependencies: [],
  requiredTenantMigrations: ["202611030001_tenant_commerce"],
  permissions: [
    "commerce.store.view",
    "commerce.store.manage",
    "commerce.warehouse.view",
    "commerce.warehouse.manage",
    "commerce.product.view",
    "commerce.product.create",
    "commerce.product.update",
    "commerce.product.archive",
    "commerce.pricing.manage",
    "commerce.inventory.view",
    "commerce.inventory.reservation.manage",
    "commerce.inventory.receive",
    "commerce.inventory.issue",
    "commerce.inventory.movement.reverse",
    "commerce.inventory.adjust",
    "commerce.inventory.transfer",
    "commerce.inventory.stocktake",
    "commerce.sales.view",
    "commerce.sales.create",
    "commerce.sales.discount",
    "commerce.sales.void",
    "commerce.orders.view",
    "commerce.orders.manage",
    "commerce.reports.view",
  ],
};
