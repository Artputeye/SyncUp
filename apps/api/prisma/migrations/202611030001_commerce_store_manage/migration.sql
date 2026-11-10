-- Add the least-privilege workspace permission for Store/Branch/Warehouse lifecycle.
-- Existing admin roles receive it; member/viewer roles do not.
INSERT INTO "public"."permissions" ("id", "key", "description")
VALUES (gen_random_uuid(), 'commerce.store.manage', 'จัดการ Store, Branch และ Warehouse')
ON CONFLICT ("key") DO UPDATE
SET "description" = EXCLUDED."description";

INSERT INTO "public"."role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "public"."roles" r
JOIN "public"."permissions" p ON p."key" = 'commerce.store.manage'
WHERE r."key" = 'admin'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
