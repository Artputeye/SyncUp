-- Persist the selected Provisioning Profile snapshot and Workspace provisioning lifecycle.
-- Nullable fields intentionally preserve existing Workspaces without guessing their profile.
ALTER TABLE "public"."workspaces"
  ADD COLUMN "provisioning_profile_id" VARCHAR(120),
  ADD COLUMN "provisioning_profile_version" VARCHAR(40),
  ADD COLUMN "provisioning_started_at" TIMESTAMP(3),
  ADD COLUMN "provisioned_at" TIMESTAMP(3),
  ADD COLUMN "provisioning_error" TEXT;

ALTER TABLE "public"."workspaces"
  ADD CONSTRAINT "workspaces_profile_identity_pair_check"
  CHECK (
    ("provisioning_profile_id" IS NULL AND "provisioning_profile_version" IS NULL)
    OR
    ("provisioning_profile_id" IS NOT NULL AND "provisioning_profile_version" IS NOT NULL)
  );
