CREATE TYPE "ModuleInstallationStatus" AS ENUM ('INSTALLED', 'ENABLED', 'DISABLED', 'FAILED');

ALTER TABLE "module_installations"
  ADD COLUMN "status" "ModuleInstallationStatus" NOT NULL DEFAULT 'INSTALLED',
  ADD COLUMN "installed_by" UUID,
  ADD COLUMN "enabled_at" TIMESTAMP(3),
  ADD COLUMN "disabled_at" TIMESTAMP(3),
  ADD COLUMN "last_error" TEXT,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Preserve the meaning of any legacy enabled rows during the status backfill.
UPDATE "module_installations"
SET
  "status" = CASE WHEN "enabled" THEN 'ENABLED'::"ModuleInstallationStatus" ELSE 'INSTALLED'::"ModuleInstallationStatus" END,
  "enabled_at" = CASE WHEN "enabled" THEN "installed_at" ELSE NULL END;

ALTER TABLE "module_installations"
  ADD CONSTRAINT "module_installations_status_enabled_check"
  CHECK (("status" = 'ENABLED') = "enabled");

CREATE INDEX "module_installations_workspace_id_status_idx"
  ON "module_installations"("workspace_id", "status");

CREATE TABLE "platform_audit_logs" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "action" VARCHAR(120) NOT NULL,
  "entity_type" VARCHAR(120) NOT NULL,
  "entity_id" VARCHAR(120) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_audit_logs_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "platform_audit_logs_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "platform_audit_logs_workspace_id_occurred_at_idx"
  ON "platform_audit_logs"("workspace_id", "occurred_at");
CREATE INDEX "platform_audit_logs_entity_type_entity_id_occurred_at_idx"
  ON "platform_audit_logs"("entity_type", "entity_id", "occurred_at");
