/**
 * Workspace permission catalog and default role matrix.
 *
 * Platform administration is intentionally excluded: platform-admin access is
 * controlled by User.isPlatformAdmin and PlatformAdminGuard, never by these roles.
 */
export const WORKSPACE_PERMISSIONS = [
  { key: "workspace.view", description: "ดูข้อมูล Workspace" },
  { key: "workspace.manage", description: "จัดการการตั้งค่า Workspace" },
  { key: "members.view", description: "ดูรายชื่อสมาชิก" },
  { key: "members.manage", description: "จัดการสมาชิก Workspace" },
  { key: "roles.manage", description: "กำหนดสิทธิ์บทบาท Workspace" },
  { key: "modules.manage", description: "จัดการโมดูล Workspace" },
  { key: "commerce.store.view", description: "ดู Store และสาขา" },
  { key: "commerce.store.manage", description: "จัดการ Store และสาขา" },
  { key: "commerce.warehouse.view", description: "ดูคลังสินค้า" },
  { key: "commerce.warehouse.manage", description: "จัดการคลังสินค้า" },
  { key: "commerce.product.view", description: "ดูสินค้าและแคตตาล็อก" },
  { key: "commerce.product.create", description: "สร้างสินค้า" },
  { key: "commerce.product.update", description: "แก้ไขสินค้า" },
  { key: "commerce.product.archive", description: "เก็บสินค้าเข้าคลัง/ยกเลิกการขาย" },
  { key: "commerce.pricing.manage", description: "จัดการราคาและส่วนลดสินค้า" },
  { key: "commerce.inventory.view", description: "ดูยอดคงเหลือสินค้า" },
  { key: "commerce.inventory.reservation.manage", description: "สร้างและจัดการการจองสต็อก" },
  { key: "commerce.inventory.receive", description: "รับสินค้าเข้าคลัง" },
  { key: "commerce.inventory.issue", description: "เบิกหรือตัดสินค้าออกจากคลัง" },
  { key: "commerce.inventory.movement.reverse", description: "ย้อนรายการเคลื่อนไหวสต็อก" },
  { key: "commerce.inventory.adjust", description: "ปรับยอดสต็อก" },
  { key: "commerce.inventory.transfer", description: "โอนย้ายสินค้าระหว่างคลัง" },
  { key: "commerce.inventory.stocktake", description: "ตรวจนับสต็อก" },
  { key: "commerce.sales.view", description: "ดูรายการขาย" },
  { key: "commerce.sales.create", description: "สร้างรายการขาย/POS" },
  { key: "commerce.sales.discount", description: "ให้ส่วนลดในการขาย" },
  { key: "commerce.sales.void", description: "ยกเลิกรายการขาย/คืนสินค้า" },
  { key: "commerce.orders.view", description: "ดูคำสั่งซื้อ" },
  { key: "commerce.orders.manage", description: "จัดการคำสั่งซื้อ" },
  { key: "commerce.reports.view", description: "ดูรายงานการขายและสต็อก" }
] as const;

const ALL_PERMISSION_KEYS = WORKSPACE_PERMISSIONS.map(({ key }) => key);
const MANAGER_PERMISSION_KEYS = [
  "workspace.view", "members.view", "modules.manage",
  "commerce.store.view", "commerce.store.manage",
  "commerce.warehouse.view", "commerce.warehouse.manage",
  "commerce.product.view", "commerce.product.create", "commerce.product.update", "commerce.product.archive",
  "commerce.pricing.manage",
  "commerce.inventory.view", "commerce.inventory.reservation.manage", "commerce.inventory.receive",
  "commerce.inventory.issue", "commerce.inventory.movement.reverse",
  "commerce.inventory.adjust", "commerce.inventory.transfer", "commerce.inventory.stocktake",
  "commerce.sales.view", "commerce.sales.create", "commerce.sales.discount", "commerce.sales.void",
  "commerce.orders.view", "commerce.orders.manage", "commerce.reports.view"
] as const;
const CASHIER_PERMISSION_KEYS = [
  "workspace.view", "commerce.store.view", "commerce.product.view",
  "commerce.inventory.view", "commerce.sales.view", "commerce.sales.create",
  "commerce.orders.view"
] as const;
const INVENTORY_PERMISSION_KEYS = [
  "workspace.view", "commerce.store.view", "commerce.warehouse.view",
  "commerce.product.view", "commerce.inventory.view", "commerce.inventory.reservation.manage",
  "commerce.inventory.receive", "commerce.inventory.issue", "commerce.inventory.adjust",
  "commerce.inventory.transfer", "commerce.inventory.stocktake",
  "commerce.orders.view", "commerce.reports.view"
] as const;

export const DEFAULT_WORKSPACE_ROLES = [
  { key: "admin", name: "ผู้ดูแลระบบ", permissions: ALL_PERMISSION_KEYS },
  { key: "manager", name: "ผู้จัดการ", permissions: MANAGER_PERMISSION_KEYS },
  { key: "cashier", name: "พนักงานขาย", permissions: CASHIER_PERMISSION_KEYS },
  { key: "inventory_staff", name: "พนักงานคลังสินค้า", permissions: INVENTORY_PERMISSION_KEYS },
  { key: "member", name: "สมาชิก", permissions: ["workspace.view", "members.view"] },
  { key: "viewer", name: "ผู้ดูอย่างเดียว", permissions: ["workspace.view", "members.view"] }
] as const;
