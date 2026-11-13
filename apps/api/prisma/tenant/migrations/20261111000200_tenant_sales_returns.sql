-- Sales returns: partial and cumulative returns against posted sales.
-- Candidate only. Do not apply to a registered workspace without explicit approval.

CREATE TYPE "SalesReturnStatus" AS ENUM ('POSTED', 'CANCELLED');

CREATE TABLE "sales_returns" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "return_number" VARCHAR(64) NOT NULL,
  "status" "SalesReturnStatus" NOT NULL DEFAULT 'POSTED',
  "currency" CHAR(3) NOT NULL,
  "subtotal" DECIMAL(24,4) NOT NULL DEFAULT 0,
  "tax_amount" DECIMAL(24,4) NOT NULL DEFAULT 0,
  "total_amount" DECIMAL(24,4) NOT NULL DEFAULT 0,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "idempotency_payload" JSONB NOT NULL,
  "reason" VARCHAR(500),
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_returns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_returns_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sales_returns_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sales_returns_amounts_check" CHECK ("subtotal" >= 0 AND "tax_amount" >= 0 AND "total_amount" >= 0)
);

CREATE UNIQUE INDEX "sales_returns_idempotency_key_key" ON "sales_returns"("idempotency_key");
CREATE UNIQUE INDEX "sales_returns_return_number_key" ON "sales_returns"("return_number");
CREATE INDEX "sales_returns_order_id_created_at_idx" ON "sales_returns"("order_id","created_at" DESC);

CREATE TABLE "sales_return_items" (
  "id" UUID NOT NULL,
  "return_id" UUID NOT NULL,
  "order_item_id" UUID NOT NULL,
  "original_movement_id" UUID NOT NULL,
  "variant_id" UUID NOT NULL,
  "quantity" DECIMAL(20,3) NOT NULL,
  "unit_cost_snapshot" DECIMAL(20,6) NOT NULL,
  "total_cost_snapshot" DECIMAL(24,6) NOT NULL,
  "subtotal" DECIMAL(24,4) NOT NULL,
  "tax_amount" DECIMAL(24,4) NOT NULL,
  "total_amount" DECIMAL(24,4) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_return_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_return_items_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "sales_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sales_return_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "sales_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sales_return_items_original_movement_id_fkey" FOREIGN KEY ("original_movement_id") REFERENCES "stock_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sales_return_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sales_return_items_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "sales_return_items_amounts_check" CHECK ("unit_cost_snapshot" >= 0 AND "total_cost_snapshot" >= 0 AND "subtotal" >= 0 AND "tax_amount" >= 0 AND "total_amount" >= 0)
);

CREATE UNIQUE INDEX "sales_return_items_return_id_order_item_id_key" ON "sales_return_items"("return_id","order_item_id");
CREATE INDEX "sales_return_items_order_item_id_idx" ON "sales_return_items"("order_item_id");
CREATE INDEX "sales_return_items_variant_id_idx" ON "sales_return_items"("variant_id");
