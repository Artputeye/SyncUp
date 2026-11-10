-- Align existing Workspace role assignments with the default permission catalog.
-- Inventory Staff can adjust, transfer and stocktake, but cannot reverse posted movements.
INSERT INTO "public"."permissions" ("id", "key", "description")
VALUES
  (gen_random_uuid(), 'commerce.inventory.adjust', 'ปรับยอดสต็อก'),
  (gen_random_uuid(), 'commerce.inventory.transfer', 'โอนย้ายสินค้าระหว่างคลัง'),
  (gen_random_uuid(), 'commerce.inventory.stocktake', 'ตรวจนับสต็อก')
ON CONFLICT ("key") DO UPDATE
SET "description" = EXCLUDED."description";

-- Keep Admin, Manager and Inventory Staff aligned with DEFAULT_WORKSPACE_ROLES.
INSERT INTO "public"."role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "public"."roles" r
JOIN "public"."permissions" p ON p."key" IN (
  'commerce.inventory.adjust',
  'commerce.inventory.transfer',
  'commerce.inventory.stocktake'
)
WHERE r."key" IN ('admin', 'manager', 'inventory_staff')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
