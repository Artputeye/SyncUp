-- Align existing Manager roles with the approved Store/Branch/Warehouse RBAC matrix.
-- The original commerce.store.manage migration remains immutable; this forward-only
-- correction grants the existing permission to Manager roles in every Workspace.
INSERT INTO "public"."role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "public"."roles" r
JOIN "public"."permissions" p ON p."key" = 'commerce.store.manage'
WHERE r."key" = 'manager'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
