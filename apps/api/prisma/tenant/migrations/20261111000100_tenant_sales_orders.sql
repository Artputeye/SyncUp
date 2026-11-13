-- Sales Orders + atomic stock reservation foundation.
-- Candidate only: do not apply without explicit workspace/migration approval.

ALTER TABLE "product_variants"
  ADD COLUMN "tax_category_id" UUID;

ALTER TABLE "product_variants"
  ADD CONSTRAINT "product_variants_tax_category_id_fkey"
  FOREIGN KEY ("tax_category_id") REFERENCES "tax_categories"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "product_variants_tax_category_id_idx"
  ON "product_variants"("tax_category_id");

CREATE TYPE "SalesOrderStatus" AS ENUM ('RESERVED', 'CANCELLED', 'POSTED');

CREATE TABLE "order_sequences" (
  "branch_id" UUID NOT NULL,
  "document_type" VARCHAR(12) NOT NULL,
  "sequence_year" INTEGER NOT NULL,
  "last_value" BIGINT NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "order_sequences_pkey" PRIMARY KEY ("branch_id", "document_type", "sequence_year"),
  CONSTRAINT "order_sequences_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "order_sequences_document_type_check"
    CHECK ("document_type" ~ '^[A-Z]{2,12}$'),
  CONSTRAINT "order_sequences_sequence_year_check"
    CHECK ("sequence_year" BETWEEN 2000 AND 9999),
  CONSTRAINT "order_sequences_last_value_check"
    CHECK ("last_value" >= 0)
);

CREATE TABLE "sales_orders" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "order_number" VARCHAR(64) NOT NULL,
  "status" "SalesOrderStatus" NOT NULL DEFAULT 'RESERVED',
  "currency" CHAR(3) NOT NULL DEFAULT 'THB',
  "tax_profile_id" UUID,
  "tax_mode" "TaxMode" NOT NULL DEFAULT 'NO_VAT',
  "price_tax_mode" "PriceTaxMode" NOT NULL DEFAULT 'EXCLUSIVE',
  "rounding_minor_units" INTEGER NOT NULL DEFAULT 2,
  "subtotal" DECIMAL(24,4) NOT NULL DEFAULT 0,
  "tax_amount" DECIMAL(24,4) NOT NULL DEFAULT 0,
  "total_amount" DECIMAL(24,4) NOT NULL DEFAULT 0,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "idempotency_payload" JSONB NOT NULL,
  "created_by" UUID NOT NULL,
  "cancelled_by" UUID,
  "cancelled_at" TIMESTAMPTZ(3),
  "cancel_reason" VARCHAR(500),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_orders_store_id_fkey"
    FOREIGN KEY ("store_id") REFERENCES "stores"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sales_orders_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sales_orders_store_branch_fkey"
    FOREIGN KEY ("store_id", "branch_id") REFERENCES "branches"("store_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sales_orders_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sales_orders_branch_warehouse_fkey"
    FOREIGN KEY ("branch_id", "warehouse_id") REFERENCES "warehouses"("branch_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sales_orders_tax_profile_id_fkey"
    FOREIGN KEY ("tax_profile_id") REFERENCES "tax_profiles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sales_orders_rounding_minor_units_check"
    CHECK ("rounding_minor_units" BETWEEN 0 AND 4),
  CONSTRAINT "sales_orders_amounts_nonnegative_check"
    CHECK ("subtotal" >= 0 AND "tax_amount" >= 0 AND "total_amount" >= 0)
);

CREATE UNIQUE INDEX "sales_orders_idempotency_key_key"
  ON "sales_orders"("idempotency_key");
CREATE UNIQUE INDEX "sales_orders_branch_id_order_number_key"
  ON "sales_orders"("branch_id", "order_number");
CREATE INDEX "sales_orders_store_id_status_created_at_idx"
  ON "sales_orders"("store_id", "status", "created_at" DESC);
CREATE INDEX "sales_orders_branch_id_created_at_idx"
  ON "sales_orders"("branch_id", "created_at" DESC);
CREATE INDEX "sales_orders_warehouse_id_status_idx"
  ON "sales_orders"("warehouse_id", "status");

CREATE TABLE "sales_order_items" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "line_number" INTEGER NOT NULL,
  "variant_id" UUID NOT NULL,
  "variant_uom_id" UUID NOT NULL,
  "reservation_id" UUID NOT NULL,
  "product_name" VARCHAR(200) NOT NULL,
  "variant_title" VARCHAR(160) NOT NULL,
  "sku" VARCHAR(100) NOT NULL,
  "uom_code" VARCHAR(32) NOT NULL,
  "uom_name" VARCHAR(80) NOT NULL,
  "quantity" DECIMAL(20,3) NOT NULL,
  "base_quantity" DECIMAL(20,3) NOT NULL,
  "conversion_factor" DECIMAL(20,9) NOT NULL,
  "price_id" UUID,
  "unit_price" DECIMAL(20,4) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "tax_category_id" UUID,
  "tax_category_code" VARCHAR(40),
  "tax_rate" DECIMAL(9,6) NOT NULL DEFAULT 0,
  "net_amount" DECIMAL(24,4) NOT NULL,
  "tax_amount" DECIMAL(24,4) NOT NULL,
  "total_amount" DECIMAL(24,4) NOT NULL,
  "unit_cost_snapshot" DECIMAL(20,6),
  "total_cost_snapshot" DECIMAL(24,6),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_order_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_order_items_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "sales_orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sales_order_items_variant_id_fkey"
    FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sales_order_items_variant_uom_id_fkey"
    FOREIGN KEY ("variant_uom_id") REFERENCES "variant_uoms"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sales_order_items_variant_uom_pair_fkey"
    FOREIGN KEY ("variant_id", "variant_uom_id") REFERENCES "variant_uoms"("variant_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sales_order_items_reservation_id_fkey"
    FOREIGN KEY ("reservation_id") REFERENCES "stock_reservations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sales_order_items_quantity_check"
    CHECK ("quantity" > 0 AND "base_quantity" > 0 AND "conversion_factor" > 0),
  CONSTRAINT "sales_order_items_amounts_check"
    CHECK ("unit_price" >= 0 AND "tax_rate" >= 0 AND "net_amount" >= 0 AND "tax_amount" >= 0 AND "total_amount" >= 0),
  CONSTRAINT "sales_order_items_cost_snapshot_check"
    CHECK (("unit_cost_snapshot" IS NULL AND "total_cost_snapshot" IS NULL)
      OR ("unit_cost_snapshot" >= 0 AND "total_cost_snapshot" >= 0))
);

CREATE UNIQUE INDEX "sales_order_items_reservation_id_key"
  ON "sales_order_items"("reservation_id");
CREATE UNIQUE INDEX "sales_order_items_order_id_line_number_key"
  ON "sales_order_items"("order_id", "line_number");
CREATE INDEX "sales_order_items_variant_id_created_at_idx"
  ON "sales_order_items"("variant_id", "created_at" DESC);

ALTER TABLE sales_orders
  ADD COLUMN posted_by uuid,
  ADD COLUMN posted_at timestamptz(3),
  ADD COLUMN posting_idempotency_key varchar(160);

CREATE UNIQUE INDEX sales_orders_posting_idempotency_key_key
  ON sales_orders(posting_idempotency_key);
