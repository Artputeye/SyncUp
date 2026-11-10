-- Stocktake sessions and immutable count snapshots.
-- Apply only after explicit approval; this file is a migration candidate.
ALTER TYPE "StockReferenceType" ADD VALUE IF NOT EXISTS 'STOCKTAKE';

CREATE TYPE "StocktakeStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'FINALIZED', 'CANCELLED');

CREATE TABLE "stocktake_sessions" (
  "id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "status" "StocktakeStatus" NOT NULL DEFAULT 'DRAFT',
  "reference" VARCHAR(100),
  "notes" VARCHAR(1000),
  "snapshot_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "idempotency_key" VARCHAR(160),
  "created_by" UUID NOT NULL,
  "finalized_by" UUID,
  "finalized_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "stocktake_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stocktake_sessions_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "stocktake_sessions_idempotency_key_key"
  ON "stocktake_sessions"("idempotency_key");
CREATE INDEX "stocktake_sessions_warehouse_id_status_created_at_idx"
  ON "stocktake_sessions"("warehouse_id", "status", "created_at");

CREATE TABLE "stocktake_lines" (
  "id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "variant_id" UUID NOT NULL,
  "system_quantity" DECIMAL(20,3) NOT NULL,
  "counted_quantity" DECIMAL(20,3),
  "unit_cost" DECIMAL(20,6),
  "note" VARCHAR(500),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "stocktake_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stocktake_lines_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "stocktake_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stocktake_lines_variant_id_fkey"
    FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stocktake_lines_counted_quantity_check"
    CHECK ("counted_quantity" IS NULL OR "counted_quantity" >= 0),
  CONSTRAINT "stocktake_lines_unit_cost_check"
    CHECK ("unit_cost" IS NULL OR "unit_cost" >= 0)
);

CREATE UNIQUE INDEX "stocktake_lines_session_id_variant_id_key"
  ON "stocktake_lines"("session_id", "variant_id");
CREATE INDEX "stocktake_lines_variant_id_idx"
  ON "stocktake_lines"("variant_id");
