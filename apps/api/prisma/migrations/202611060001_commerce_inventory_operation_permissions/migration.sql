-- Split the broad inventory.manage permission into operation-specific workspace permissions.
-- Manager receives operational inventory permissions, including reversal.
-- Inventory staff can reserve, receive and issue stock, but cannot reverse ledger movements.
-- Admin retains every permission; Owner access remains implicit in the RBAC service.
INSERT INTO "public"."permissions" ("id", "key", "description")
VALUES
  (gen_random_uuid(), 'commerce.inventory.reservation.manage', 'สร้างและจัดการการจองสต็อก'),
  (gen_random_uuid(), 'commerce.inventory.receive', 'รับสินค้าเข้าคลัง'),
  (gen_random_uuid(), 'commerce.inventory.issue', 'เบิกหรือตัดสินค้าออกจากคลัง'),
  (gen_random_uuid(), 'commerce.inventory.movement.reverse', 'ย้อนรายการเคลื่อนไหวสต็อก')
ON CONFLICT ("key") DO UPDATE
SET "description" = EXCLUDED."description";

-- All workspace admin roles receive all operation-specific permissions.
INSERT INTO "public"."role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "public"."roles" r
JOIN "public"."permissions" p ON p."key" IN (
  'commerce.inventory.reservation.manage',
  'commerce.inventory.receive',
  'commerce.inventory.issue',
  'commerce.inventory.movement.reverse'
)
WHERE r."key" = 'admin'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- Managers may operate stock and reverse movements; inventory staff may perform
-- day-to-day stock operations but cannot reverse posted movements.
INSERT INTO "public"."role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "public"."roles" r
JOIN "public"."permissions" p ON (
  (r."key" = 'manager' AND p."key" IN (
    'commerce.inventory.reservation.manage',
    'commerce.inventory.receive',
    'commerce.inventory.issue',
    'commerce.inventory.movement.reverse'
  ))
  OR
  (r."key" = 'inventory_staff' AND p."key" IN (
    'commerce.inventory.reservation.manage',
    'commerce.inventory.receive',
    'commerce.inventory.issue'
  ))
)
WHERE r."key" IN ('manager', 'inventory_staff')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
