-- Internal tender and refund ledger. Does not initiate external payment-provider operations.
-- Candidate only: apply to a registered Tenant only after explicit workspace/migration approval.

CREATE TYPE "SalesPaymentMethod" AS ENUM ('CASH', 'CARD', 'BANK_TRANSFER', 'OTHER');
CREATE TYPE "SalesPaymentStatus" AS ENUM ('CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED');

CREATE TABLE "sales_payments" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "payment_number" VARCHAR(64) NOT NULL,
  "method" "SalesPaymentMethod" NOT NULL,
  "status" "SalesPaymentStatus" NOT NULL DEFAULT 'CAPTURED',
  "currency" CHAR(3) NOT NULL,
  "amount" DECIMAL(24,4) NOT NULL,
  "refunded_amount" DECIMAL(24,4) NOT NULL DEFAULT 0,
  "external_reference" VARCHAR(160),
  "idempotency_key" VARCHAR(160) NOT NULL,
  "idempotency_payload" JSONB NOT NULL,
  "received_by" UUID NOT NULL,
  "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sales_payments_amounts_check" CHECK ("amount" > 0 AND "refunded_amount" >= 0 AND "refunded_amount" <= "amount")
);
CREATE UNIQUE INDEX "sales_payments_idempotency_key_key" ON "sales_payments"("idempotency_key");
CREATE UNIQUE INDEX "sales_payments_payment_number_key" ON "sales_payments"("payment_number");
CREATE INDEX "sales_payments_order_id_received_at_idx" ON "sales_payments"("order_id","received_at");

CREATE TABLE "sales_refunds" (
  "id" UUID NOT NULL,
  "payment_id" UUID NOT NULL,
  "return_id" UUID NOT NULL,
  "refund_number" VARCHAR(64) NOT NULL,
  "status" VARCHAR(12) NOT NULL DEFAULT 'POSTED',
  "currency" CHAR(3) NOT NULL,
  "amount" DECIMAL(24,4) NOT NULL,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "idempotency_payload" JSONB NOT NULL,
  "reason" VARCHAR(500),
  "refunded_by" UUID NOT NULL,
  "refunded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_refunds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "sales_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sales_refunds_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "sales_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sales_refunds_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "sales_refunds_status_check" CHECK ("status" = 'POSTED')
);
CREATE UNIQUE INDEX "sales_refunds_idempotency_key_key" ON "sales_refunds"("idempotency_key");
CREATE UNIQUE INDEX "sales_refunds_refund_number_key" ON "sales_refunds"("refund_number");
CREATE INDEX "sales_refunds_payment_id_refunded_at_idx" ON "sales_refunds"("payment_id","refunded_at");
CREATE INDEX "sales_refunds_return_id_refunded_at_idx" ON "sales_refunds"("return_id","refunded_at");
