import type { WorkspaceType } from "../modules/module-manifest";

export interface WorkspaceNavigationItem {
  id: string;
  label: string;
  href: string;
  icon: string;
  workspaceTypes: readonly WorkspaceType[];
  permission: string;
  moduleId?: string;
}

const BOTH: readonly WorkspaceType[] = ["POS", "ONLINE"];
const POS: readonly WorkspaceType[] = ["POS"];

export const WORKSPACE_NAVIGATION_CATALOG: readonly WorkspaceNavigationItem[] = [
  { id: "workspace-home", label: "ภาพรวม", href: "home", icon: "home", workspaceTypes: BOTH, permission: "workspace.view" },
  { id: "modules", label: "Modules", href: "modules", icon: "blocks", workspaceTypes: BOTH, permission: "modules.manage" },
  { id: "stores", label: "Store", href: "stores", icon: "store", workspaceTypes: POS, permission: "commerce.store.view", moduleId: "commerce" },
  { id: "products", label: "สินค้า", href: "products", icon: "package", workspaceTypes: POS, permission: "commerce.product.view", moduleId: "commerce" },
  { id: "inventory", label: "คลังสินค้า", href: "inventory", icon: "warehouse", workspaceTypes: POS, permission: "commerce.inventory.view", moduleId: "commerce" },
  { id: "orders", label: "คำสั่งขาย", href: "orders", icon: "receipt", workspaceTypes: POS, permission: "commerce.orders.view", moduleId: "commerce" },
  { id: "pos", label: "ขายหน้าร้าน", href: "pos", icon: "shopping-cart", workspaceTypes: POS, permission: "commerce.sales.create", moduleId: "commerce" },
];

export function composeWorkspaceNavigation(
  type: WorkspaceType,
  slug: string,
  permissions: readonly string[],
  enabledModuleIds: readonly string[],
) {
  const permissionSet = new Set(permissions);
  const base = `/workspace/${encodeURIComponent(slug)}`;
  return WORKSPACE_NAVIGATION_CATALOG.filter((item) =>
    item.workspaceTypes.includes(type)
    && permissionSet.has(item.permission)
    && (!item.moduleId || enabledModuleIds.includes(item.moduleId)),
  ).map(({ id, label, href, icon }) => ({
    id,
    label,
    href: href === "home" ? base + (type === "POS" ? "/pos" : "/online") : base + "/" + href,
    icon,
  }));
}
