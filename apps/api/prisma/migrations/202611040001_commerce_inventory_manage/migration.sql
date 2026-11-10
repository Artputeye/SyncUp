-- Add workspace inventory permission and grant it to existing workspace admin roles.
INSERT INTO "public"."permissions" ("id", "key", "description")
VALUES (gen_random_uuid(), 'commerce.inventory.manage', 'จัดการ Stock Reservation และ Inventory')
ON CONFLICT ("key") DO UPDATE
SET "description" = EXCLUDED."description";

INSERT INTO "public"."role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "public"."roles" r
JOIN "public"."permissions" p ON p."key" = 'commerce.inventory.manage'
WHERE r."key" = 'admin'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
