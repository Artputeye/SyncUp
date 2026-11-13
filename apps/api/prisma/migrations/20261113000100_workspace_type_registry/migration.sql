-- Add first-class Workspace product type without guessing classifications for existing rows.
CREATE TYPE "public"."WorkspaceType" AS ENUM ('POS', 'ONLINE');

ALTER TABLE "public"."workspaces"
  ADD COLUMN "type" "public"."WorkspaceType";
