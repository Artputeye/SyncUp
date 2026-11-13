import type { WorkspaceType } from "../modules/module-manifest";

export interface WorkspacePermissionDefinition {
  key: string;
  description: string;
  owner: "core" | "commerce";
  workspaceTypes: readonly WorkspaceType[];
  moduleId?: string;
}

const BOTH_TYPES: readonly WorkspaceType[] = ["POS", "ONLINE"];
const POS_ONLY: readonly WorkspaceType[] = ["POS"];

const CORE_PERMISSIONS: readonly WorkspacePermissionDefinition[] = [
  { key: "workspace.view", description: "ดูข้อมูล Workspace", owner: "core", workspaceTypes: BOTH_TYPES },
  { key: "workspace.manage", description: "จัดการการตั้งค่า Workspace", owner: "core", workspaceTypes: BOTH_TYPES },
  { key: "members.view", description: "ดูรายชื่อสมาชิก", owner: "core", workspaceTypes: BOTH_TYPES },
  { key: "members.manage", description: "จัดการสมาชิก Workspace", owner: "core", workspaceTypes: BOTH_TYPES },
  { key: "roles.manage", description: "กำหนดสิทธิ์บทบาท Workspace", owner: "core", workspaceTypes: BOTH_TYPES },
  { key: "modules.manage", description: "จัดการโมดูล Workspace", owner: "core", workspaceTypes: BOTH_TYPES },
];

const COMMERCE_PERMISSIONS: readonly WorkspacePermissionDefinition[] = [
  ["commerce.store.view", "ดู Store และสาขา"],
  ["commerce.store.manage", "จัดการ Store และสาขา"],
  ["commerce.warehouse.view", "ดูคลังสินค้า"],
  ["commerce.warehouse.manage", "จัดการคลังสินค้า"],
  ["commerce.product.view", "ดูสินค้าและแคตตาล็อก"],
  ["commerce.product.create", "สร้างสินค้า"],
  ["commerce.product.update", "แก้ไขสินค้า"],
  ["commerce.product.archive", "เก็บสินค้าเข้าคลัง/ยกเลิกการขาย"],
  ["commerce.pricing.manage", "จัดการราคาและส่วนลดสินค้า"],
  ["commerce.inventory.view", "ดูยอดคงเหลือสินค้า"],
  ["commerce.inventory.reservation.manage", "สร้างและจัดการการจองสต็อก"],
  ["commerce.inventory.receive", "รับสินค้าเข้าคลัง"],
  ["commerce.inventory.issue", "เบิกหรือตัดสินค้าออกจากคลัง"],
  ["commerce.inventory.movement.reverse", "ย้อนรายการเคลื่อนไหวสต็อก"],
  ["commerce.inventory.adjust", "ปรับยอดสต็อก"],
  ["commerce.inventory.transfer", "โอนย้ายสินค้าระหว่างคลัง"],
  ["commerce.inventory.stocktake", "ตรวจนับสต็อก"],
  ["commerce.sales.view", "ดูรายการขาย"],
  ["commerce.sales.create", "สร้างรายการขาย/POS"],
  ["commerce.sales.discount", "ให้ส่วนลดในการขาย"],
  ["commerce.sales.void", "ยกเลิกรายการขาย/คืนสินค้า"],
  ["commerce.orders.view", "ดูคำสั่งซื้อ"],
  ["commerce.orders.manage", "จัดการคำสั่งซื้อ"],
  ["commerce.reports.view", "ดูรายงานการขายและสต็อก"],
].map(([key, description]) => ({
  key,
  description,
  owner: "commerce",
  workspaceTypes: POS_ONLY,
  moduleId: "commerce",
}));

export const WORKSPACE_PERMISSION_CATALOG: readonly WorkspacePermissionDefinition[] = [
  ...CORE_PERMISSIONS,
  ...COMMERCE_PERMISSIONS,
];

// Kept as a compatibility export for provisioning and existing consumers.
export const WORKSPACE_PERMISSIONS = WORKSPACE_PERMISSION_CATALOG.map(({ key, description }) => ({ key, description }));

const POS_ALL = WORKSPACE_PERMISSION_CATALOG.filter((permission) => permission.workspaceTypes.includes("POS")).map(({ key }) => key);
const ONLINE_CORE = CORE_PERMISSIONS.map(({ key }) => key);

const POS_MANAGER = [
  "workspace.view", "members.view", "modules.manage",
  "commerce.store.view", "commerce.store.manage",
  "commerce.warehouse.view", "commerce.warehouse.manage",
  "commerce.product.view", "commerce.product.create", "commerce.product.update", "commerce.product.archive",
  "commerce.pricing.manage",
  "commerce.inventory.view", "commerce.inventory.reservation.manage", "commerce.inventory.receive",
  "commerce.inventory.issue", "commerce.inventory.movement.reverse",
  "commerce.inventory.adjust", "commerce.inventory.transfer", "commerce.inventory.stocktake",
  "commerce.sales.view", "commerce.sales.create", "commerce.sales.discount", "commerce.sales.void",
  "commerce.orders.view", "commerce.orders.manage", "commerce.reports.view",
] as const;
const POS_CASHIER = [
  "workspace.view", "commerce.store.view", "commerce.product.view",
  "commerce.inventory.view", "commerce.sales.view", "commerce.sales.create",
  "commerce.orders.view",
] as const;
const POS_INVENTORY = [
  "workspace.view", "commerce.store.view", "commerce.warehouse.view",
  "commerce.product.view", "commerce.inventory.view", "commerce.inventory.reservation.manage",
  "commerce.inventory.receive", "commerce.inventory.issue", "commerce.inventory.adjust",
  "commerce.inventory.transfer", "commerce.inventory.stocktake",
  "commerce.orders.view", "commerce.reports.view",
] as const;

export interface WorkspaceRoleDefinition {
  key: string;
  name: string;
  permissions: readonly string[];
}

const POS_ROLES: readonly WorkspaceRoleDefinition[] = [
  { key: "admin", name: "ผู้ดูแลระบบ", permissions: POS_ALL },
  { key: "manager", name: "ผู้จัดการ", permissions: POS_MANAGER },
  { key: "cashier", name: "พนักงานขาย", permissions: POS_CASHIER },
  { key: "inventory_staff", name: "พนักงานคลังสินค้า", permissions: POS_INVENTORY },
  { key: "member", name: "สมาชิก", permissions: ["workspace.view", "members.view"] },
  { key: "viewer", name: "ผู้ดูอย่างเดียว", permissions: ["workspace.view", "members.view"] },
];

const ONLINE_ROLES: readonly WorkspaceRoleDefinition[] = [
  { key: "admin", name: "ผู้ดูแลระบบ", permissions: ONLINE_CORE },
  { key: "manager", name: "ผู้จัดการ", permissions: ["workspace.view", "members.view", "members.manage", "modules.manage"] },
  { key: "member", name: "สมาชิก", permissions: ["workspace.view", "members.view"] },
  { key: "viewer", name: "ผู้ดูอย่างเดียว", permissions: ["workspace.view"] },
];

export function getWorkspaceRoleDefinitions(type: WorkspaceType): readonly WorkspaceRoleDefinition[] {
  return type === "POS" ? POS_ROLES : ONLINE_ROLES;
}

export function getWorkspacePermissionDefinitions(
  type: WorkspaceType,
  allowedModuleIds: readonly string[],
  enabledModuleIds: readonly string[] = allowedModuleIds,
): readonly WorkspacePermissionDefinition[] {
  return WORKSPACE_PERMISSION_CATALOG.filter((permission) =>
    permission.workspaceTypes.includes(type)
    && (!permission.moduleId || (allowedModuleIds.includes(permission.moduleId) && enabledModuleIds.includes(permission.moduleId))),
  );
}

export function getWorkspaceRoleDefinition(type: WorkspaceType, roleKey: string): WorkspaceRoleDefinition | undefined {
  return getWorkspaceRoleDefinitions(type).find((role) => role.key === roleKey);
}
