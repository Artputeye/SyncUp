-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."RecordStatus" AS ENUM ('ACTIVE', 'DISABLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "public"."StoreType" AS ENUM ('PHYSICAL', 'ONLINE', 'OMNICHANNEL');

-- CreateEnum
CREATE TYPE "public"."StorePublishStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'UNPUBLISHED');

-- CreateEnum
CREATE TYPE "public"."ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "public"."UomUsage" AS ENUM ('BASE', 'SELL', 'PURCHASE', 'SELL_AND_PURCHASE');

-- CreateEnum
CREATE TYPE "public"."MediaStatus" AS ENUM ('STAGED', 'READY', 'REJECTED', 'DELETED');

-- CreateEnum
CREATE TYPE "public"."MediaPurpose" AS ENUM ('PRODUCT', 'VARIANT', 'STORE_LOGO', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."MediaDerivativeKind" AS ENUM ('ORIGINAL', 'MAIN', 'THUMBNAIL');

-- CreateEnum
CREATE TYPE "public"."MediaDerivativeStatus" AS ENUM ('STAGED', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."ImportStatus" AS ENUM ('UPLOADED', 'VALIDATING', 'PREVIEW_READY', 'COMMITTING', 'COMMITTED', 'FAILED', 'CANCELLED', 'STALE');

-- CreateEnum
CREATE TYPE "public"."ImportRowStatus" AS ENUM ('PENDING', 'VALID', 'INVALID', 'APPLIED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."StockMovementType" AS ENUM ('OPENING', 'RECEIVING', 'SALE', 'SALE_RETURN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'TRANSFER_IN', 'TRANSFER_OUT', 'REVERSAL', 'WRITE_OFF');

-- CreateEnum
CREATE TYPE "public"."StockReferenceType" AS ENUM ('OPENING_STOCK', 'DIRECT_RECEIVING', 'ORDER', 'RETURN', 'ADJUSTMENT', 'TRANSFER', 'MANUAL');

-- CreateEnum
CREATE TYPE "public"."StockAdjustmentStatus" AS ENUM ('DRAFT', 'PREVIEWED', 'POSTED', 'CANCELLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "public"."OpeningStockStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."ReceivingStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "public"."CategoryStatus" AS ENUM ('ACTIVE', 'DISABLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "public"."TaxMode" AS ENUM ('VAT', 'NO_VAT');

-- CreateEnum
CREATE TYPE "public"."PriceTaxMode" AS ENUM ('INCLUSIVE', 'EXCLUSIVE');

-- CreateEnum
CREATE TYPE "public"."TaxRoundingLevel" AS ENUM ('DOCUMENT');

-- CreateEnum
CREATE TYPE "public"."TaxRoundingMethod" AS ENUM ('HALF_UP');

-- CreateTable
CREATE TABLE "public"."stores" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "normalized_slug" VARCHAR(80) NOT NULL,
    "store_type" "public"."StoreType" NOT NULL DEFAULT 'OMNICHANNEL',
    "status" "public"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "description" TEXT,
    "logo_media_id" UUID,
    "contact_email" VARCHAR(320),
    "contact_phone" VARCHAR(40),
    "address" JSONB,
    "currency" CHAR(3) NOT NULL DEFAULT 'THB',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Bangkok',
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."branches" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "status" "public"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "address" JSONB,
    "phone" VARCHAR(40),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."warehouses" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "status" "public"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."unit_of_measures" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "normalized_code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "symbol" VARCHAR(24) NOT NULL,
    "dimension" VARCHAR(40) NOT NULL,
    "decimal_places" INTEGER NOT NULL DEFAULT 0,
    "status" "public"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "unit_of_measures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."products" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "status" "public"."ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "normalized_name" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."product_variants" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "base_uom_id" UUID NOT NULL,
    "sku" VARCHAR(100) NOT NULL,
    "normalized_sku" VARCHAR(100) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "barcode" VARCHAR(128),
    "status" "public"."ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "attributes" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."variant_uoms" (
    "id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "uom_id" UUID NOT NULL,
    "usage" "public"."UomUsage" NOT NULL,
    "conversion_to_base" DECIMAL(20,9) NOT NULL DEFAULT 1,
    "status" "public"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "variant_uoms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."variant_barcodes" (
    "id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "barcode" VARCHAR(128) NOT NULL,
    "normalized" VARCHAR(128) NOT NULL,
    "symbology" VARCHAR(24) NOT NULL DEFAULT 'EAN13',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variant_barcodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."variant_qr_codes" (
    "id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "payload" TEXT NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "symbology" VARCHAR(24) NOT NULL DEFAULT 'QR_CODE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variant_qr_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."store_products" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "publish_status" "public"."StorePublishStatus" NOT NULL DEFAULT 'DRAFT',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "store_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."store_product_variants" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "store_product_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "publish_status" "public"."StorePublishStatus" NOT NULL DEFAULT 'DRAFT',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "store_product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."store_categories" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "normalized_slug" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "status" "public"."CategoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "store_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."store_product_categories" (
    "store_id" UUID NOT NULL,
    "store_product_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_product_categories_pkey" PRIMARY KEY ("store_id","store_product_id","category_id")
);

-- CreateTable
CREATE TABLE "public"."product_prices" (
    "id" UUID NOT NULL,
    "store_product_variant_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "variant_uom_id" UUID NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'THB',
    "valid_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "product_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."media_assets" (
    "id" UUID NOT NULL,
    "purpose" "public"."MediaPurpose" NOT NULL,
    "status" "public"."MediaStatus" NOT NULL DEFAULT 'STAGED',
    "alt_text" VARCHAR(255),
    "uploaded_by" UUID,
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."media_asset_derivatives" (
    "id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "kind" "public"."MediaDerivativeKind" NOT NULL,
    "status" "public"."MediaDerivativeStatus" NOT NULL DEFAULT 'STAGED',
    "storage_provider" VARCHAR(40) NOT NULL DEFAULT 's3-compatible',
    "bucket" VARCHAR(128) NOT NULL,
    "object_key" VARCHAR(1024) NOT NULL,
    "original_filename" VARCHAR(255),
    "mime_type" VARCHAR(127) NOT NULL,
    "extension" VARCHAR(16),
    "size_bytes" BIGINT NOT NULL,
    "checksum_sha256" CHAR(64) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "media_asset_derivatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."product_images" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."variant_images" (
    "id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variant_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."image_import_batches" (
    "id" UUID NOT NULL,
    "status" "public"."ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "source_filename" VARCHAR(255) NOT NULL,
    "source_checksum" CHAR(64) NOT NULL,
    "manifest_checksum" CHAR(64),
    "staging_object_key" VARCHAR(1024),
    "total_files" INTEGER NOT NULL DEFAULT 0,
    "processed_files" INTEGER NOT NULL DEFAULT 0,
    "valid_files" INTEGER NOT NULL DEFAULT 0,
    "invalid_files" INTEGER NOT NULL DEFAULT 0,
    "options" JSONB,
    "error_summary" JSONB,
    "uploaded_by" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "image_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."image_import_items" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "media_asset_id" UUID,
    "relative_path" VARCHAR(1024) NOT NULL,
    "original_filename" VARCHAR(255) NOT NULL,
    "checksum_sha256" CHAR(64),
    "target_type" VARCHAR(24),
    "target_id" UUID,
    "mapping_key" VARCHAR(160),
    "image_role" VARCHAR(24),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "public"."ImportRowStatus" NOT NULL DEFAULT 'PENDING',
    "error_code" VARCHAR(80),
    "error_message" VARCHAR(1000),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "image_import_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."stock_balances" (
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "on_hand" DECIMAL(20,3) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(20,3) NOT NULL DEFAULT 0,
    "available" DECIMAL(20,3) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("warehouse_id","variant_id")
);

-- CreateTable
CREATE TABLE "public"."stock_movements" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "movement_type" "public"."StockMovementType" NOT NULL,
    "quantity_delta" DECIMAL(20,3) NOT NULL,
    "unit_cost" DECIMAL(20,6),
    "total_cost" DECIMAL(24,6),
    "reference_type" "public"."StockReferenceType" NOT NULL,
    "reference_id" UUID,
    "idempotency_key" VARCHAR(160),
    "reversal_of_id" UUID,
    "reason" VARCHAR(500),
    "actor_user_id" UUID,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."stock_reservations" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" DECIMAL(20,3) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    "reference_type" VARCHAR(40) NOT NULL,
    "reference_id" UUID,
    "idempotency_key" VARCHAR(160),
    "expires_at" TIMESTAMPTZ(3),
    "released_at" TIMESTAMPTZ(3),
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."inventory_costs" (
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" DECIMAL(20,3) NOT NULL DEFAULT 0,
    "average_unit_cost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "inventory_value" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inventory_costs_pkey" PRIMARY KEY ("warehouse_id","variant_id")
);

-- CreateTable
CREATE TABLE "public"."opening_stock_sessions" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "posted_warehouse_id" UUID,
    "status" "public"."OpeningStockStatus" NOT NULL DEFAULT 'DRAFT',
    "reference" VARCHAR(100),
    "notes" VARCHAR(1000),
    "idempotency_key" VARCHAR(160),
    "created_by" UUID NOT NULL,
    "posted_by" UUID,
    "posted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "opening_stock_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."opening_stock_items" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" DECIMAL(20,3) NOT NULL,
    "unit_cost" DECIMAL(20,6) NOT NULL,
    "total_cost" DECIMAL(24,6) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opening_stock_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."direct_receivings" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "status" "public"."ReceivingStatus" NOT NULL DEFAULT 'DRAFT',
    "document_number" VARCHAR(100),
    "supplier_reference" VARCHAR(160),
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" VARCHAR(1000),
    "idempotency_key" VARCHAR(160),
    "created_by" UUID NOT NULL,
    "posted_by" UUID,
    "posted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "direct_receivings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."direct_receiving_items" (
    "id" UUID NOT NULL,
    "receiving_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" DECIMAL(20,3) NOT NULL,
    "unit_cost" DECIMAL(20,6) NOT NULL,
    "total_cost" DECIMAL(24,6) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direct_receiving_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."stock_adjustment_import_batches" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "status" "public"."ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "source_filename" VARCHAR(255) NOT NULL,
    "source_checksum" CHAR(64) NOT NULL,
    "snapshot_checksum" CHAR(64) NOT NULL,
    "snapshot_taken_at" TIMESTAMPTZ(3) NOT NULL,
    "template_version" VARCHAR(32) NOT NULL,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "valid_row_count" INTEGER NOT NULL DEFAULT 0,
    "invalid_row_count" INTEGER NOT NULL DEFAULT 0,
    "applied_row_count" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" VARCHAR(160),
    "staging_object_key" VARCHAR(1024),
    "status_message" VARCHAR(1000),
    "uploaded_by" UUID NOT NULL,
    "committed_by" UUID,
    "committed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_adjustment_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."stock_adjustment_import_rows" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "variant_id" UUID,
    "sku_snapshot" VARCHAR(100) NOT NULL,
    "expected_on_hand" DECIMAL(20,3),
    "counted_quantity" DECIMAL(20,3),
    "delta_quantity" DECIMAL(20,3),
    "unit_cost" DECIMAL(20,6),
    "status" "public"."ImportRowStatus" NOT NULL DEFAULT 'PENDING',
    "error_code" VARCHAR(80),
    "error_message" VARCHAR(1000),
    "raw_data" JSONB,
    "validation_result" JSONB,
    "applied_movement_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_adjustment_import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tax_categories" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(255),
    "status" "public"."RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tax_profiles" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "tax_mode" "public"."TaxMode" NOT NULL DEFAULT 'VAT',
    "price_tax_mode" "public"."PriceTaxMode" NOT NULL DEFAULT 'EXCLUSIVE',
    "rounding_level" "public"."TaxRoundingLevel" NOT NULL DEFAULT 'DOCUMENT',
    "rounding_method" "public"."TaxRoundingMethod" NOT NULL DEFAULT 'HALF_UP',
    "currency_minor_units" INTEGER NOT NULL DEFAULT 2,
    "valid_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tax_rates" (
    "id" UUID NOT NULL,
    "tax_profile_id" UUID NOT NULL,
    "tax_category_id" UUID NOT NULL,
    "rate" DECIMAL(9,6) NOT NULL,
    "valid_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_logs" (
    "id" UUID NOT NULL,
    "store_id" UUID,
    "actor_user_id" UUID,
    "action" VARCHAR(120) NOT NULL,
    "entity_type" VARCHAR(120) NOT NULL,
    "entity_id" UUID,
    "reason" VARCHAR(1000),
    "request_id" VARCHAR(128),
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stores_normalized_slug_key" ON "public"."stores"("normalized_slug");

-- CreateIndex
CREATE INDEX "stores_status_is_published_idx" ON "public"."stores"("status", "is_published");

-- CreateIndex
CREATE INDEX "branches_store_id_status_idx" ON "public"."branches"("store_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "branches_store_id_code_key" ON "public"."branches"("store_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "branches_store_id_id_key" ON "public"."branches"("store_id", "id");

-- CreateIndex
CREATE INDEX "warehouses_branch_id_status_idx" ON "public"."warehouses"("branch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_branch_id_code_key" ON "public"."warehouses"("branch_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_branch_id_id_key" ON "public"."warehouses"("branch_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "unit_of_measures_code_key" ON "public"."unit_of_measures"("code");

-- CreateIndex
CREATE UNIQUE INDEX "unit_of_measures_normalized_code_key" ON "public"."unit_of_measures"("normalized_code");

-- CreateIndex
CREATE INDEX "unit_of_measures_dimension_status_idx" ON "public"."unit_of_measures"("dimension", "status");

-- CreateIndex
CREATE INDEX "products_status_name_idx" ON "public"."products"("status", "name");

-- CreateIndex
CREATE INDEX "products_normalized_name_idx" ON "public"."products"("normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_normalized_sku_key" ON "public"."product_variants"("normalized_sku");

-- CreateIndex
CREATE INDEX "product_variants_product_id_status_idx" ON "public"."product_variants"("product_id", "status");

-- CreateIndex
CREATE INDEX "product_variants_sku_idx" ON "public"."product_variants"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_product_id_id_key" ON "public"."product_variants"("product_id", "id");

-- CreateIndex
CREATE INDEX "variant_uoms_uom_id_status_idx" ON "public"."variant_uoms"("uom_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "variant_uoms_variant_id_uom_id_key" ON "public"."variant_uoms"("variant_id", "uom_id");

-- CreateIndex
CREATE UNIQUE INDEX "variant_uoms_variant_id_id_key" ON "public"."variant_uoms"("variant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "variant_barcodes_normalized_key" ON "public"."variant_barcodes"("normalized");

-- CreateIndex
CREATE INDEX "variant_barcodes_variant_id_idx" ON "public"."variant_barcodes"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "variant_qr_codes_payload_hash_key" ON "public"."variant_qr_codes"("payload_hash");

-- CreateIndex
CREATE INDEX "variant_qr_codes_variant_id_idx" ON "public"."variant_qr_codes"("variant_id");

-- CreateIndex
CREATE INDEX "store_products_store_id_publish_status_sort_order_idx" ON "public"."store_products"("store_id", "publish_status", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "store_products_store_id_product_id_key" ON "public"."store_products"("store_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "store_products_store_id_id_key" ON "public"."store_products"("store_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "store_products_store_id_id_product_id_key" ON "public"."store_products"("store_id", "id", "product_id");

-- CreateIndex
CREATE INDEX "store_product_variants_store_product_id_publish_status_sort_idx" ON "public"."store_product_variants"("store_product_id", "publish_status", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "store_product_variants_store_product_id_variant_id_key" ON "public"."store_product_variants"("store_product_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "store_product_variants_store_product_id_id_key" ON "public"."store_product_variants"("store_product_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "store_product_variants_id_variant_id_key" ON "public"."store_product_variants"("id", "variant_id");

-- CreateIndex
CREATE INDEX "store_categories_store_id_parent_id_sort_order_idx" ON "public"."store_categories"("store_id", "parent_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "store_categories_store_id_normalized_slug_key" ON "public"."store_categories"("store_id", "normalized_slug");

-- CreateIndex
CREATE UNIQUE INDEX "store_categories_store_id_id_key" ON "public"."store_categories"("store_id", "id");

-- CreateIndex
CREATE INDEX "store_product_categories_store_id_category_id_idx" ON "public"."store_product_categories"("store_id", "category_id");

-- CreateIndex
CREATE INDEX "product_prices_store_product_variant_id_variant_uom_id_curr_idx" ON "public"."product_prices"("store_product_variant_id", "variant_uom_id", "currency", "valid_from");

-- CreateIndex
CREATE INDEX "media_assets_status_created_at_idx" ON "public"."media_assets"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "media_asset_derivatives_object_key_key" ON "public"."media_asset_derivatives"("object_key");

-- CreateIndex
CREATE INDEX "media_asset_derivatives_status_created_at_idx" ON "public"."media_asset_derivatives"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "media_asset_derivatives_media_asset_id_kind_key" ON "public"."media_asset_derivatives"("media_asset_id", "kind");

-- CreateIndex
CREATE INDEX "product_images_product_id_sort_order_idx" ON "public"."product_images"("product_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "product_images_product_id_media_asset_id_key" ON "public"."product_images"("product_id", "media_asset_id");

-- CreateIndex
CREATE INDEX "variant_images_variant_id_sort_order_idx" ON "public"."variant_images"("variant_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "variant_images_variant_id_media_asset_id_key" ON "public"."variant_images"("variant_id", "media_asset_id");

-- CreateIndex
CREATE INDEX "image_import_batches_status_created_at_idx" ON "public"."image_import_batches"("status", "created_at");

-- CreateIndex
CREATE INDEX "image_import_batches_uploaded_by_created_at_idx" ON "public"."image_import_batches"("uploaded_by", "created_at");

-- CreateIndex
CREATE INDEX "image_import_items_batch_id_status_idx" ON "public"."image_import_items"("batch_id", "status");

-- CreateIndex
CREATE INDEX "image_import_items_target_type_target_id_idx" ON "public"."image_import_items"("target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "image_import_items_batch_id_relative_path_key" ON "public"."image_import_items"("batch_id", "relative_path");

-- CreateIndex
CREATE INDEX "stock_balances_variant_id_warehouse_id_idx" ON "public"."stock_balances"("variant_id", "warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_idempotency_key_key" ON "public"."stock_movements"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_reversal_of_id_key" ON "public"."stock_movements"("reversal_of_id");

-- CreateIndex
CREATE INDEX "stock_movements_warehouse_id_variant_id_occurred_at_idx" ON "public"."stock_movements"("warehouse_id", "variant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "stock_movements_reference_type_reference_id_idx" ON "public"."stock_movements"("reference_type", "reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_reservations_idempotency_key_key" ON "public"."stock_reservations"("idempotency_key");

-- CreateIndex
CREATE INDEX "stock_reservations_warehouse_id_variant_id_status_idx" ON "public"."stock_reservations"("warehouse_id", "variant_id", "status");

-- CreateIndex
CREATE INDEX "stock_reservations_status_expires_at_idx" ON "public"."stock_reservations"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "opening_stock_sessions_posted_warehouse_id_key" ON "public"."opening_stock_sessions"("posted_warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "opening_stock_sessions_idempotency_key_key" ON "public"."opening_stock_sessions"("idempotency_key");

-- CreateIndex
CREATE INDEX "opening_stock_sessions_warehouse_id_status_idx" ON "public"."opening_stock_sessions"("warehouse_id", "status");

-- CreateIndex
CREATE INDEX "opening_stock_items_variant_id_idx" ON "public"."opening_stock_items"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "opening_stock_items_session_id_variant_id_key" ON "public"."opening_stock_items"("session_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "direct_receivings_idempotency_key_key" ON "public"."direct_receivings"("idempotency_key");

-- CreateIndex
CREATE INDEX "direct_receivings_warehouse_id_status_received_at_idx" ON "public"."direct_receivings"("warehouse_id", "status", "received_at");

-- CreateIndex
CREATE INDEX "direct_receiving_items_variant_id_idx" ON "public"."direct_receiving_items"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "direct_receiving_items_receiving_id_variant_id_key" ON "public"."direct_receiving_items"("receiving_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustment_import_batches_idempotency_key_key" ON "public"."stock_adjustment_import_batches"("idempotency_key");

-- CreateIndex
CREATE INDEX "stock_adjustment_import_batches_warehouse_id_status_created_idx" ON "public"."stock_adjustment_import_batches"("warehouse_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "stock_adjustment_import_batches_uploaded_by_created_at_idx" ON "public"."stock_adjustment_import_batches"("uploaded_by", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustment_import_rows_applied_movement_id_key" ON "public"."stock_adjustment_import_rows"("applied_movement_id");

-- CreateIndex
CREATE INDEX "stock_adjustment_import_rows_batch_id_status_idx" ON "public"."stock_adjustment_import_rows"("batch_id", "status");

-- CreateIndex
CREATE INDEX "stock_adjustment_import_rows_variant_id_idx" ON "public"."stock_adjustment_import_rows"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustment_import_rows_batch_id_row_number_key" ON "public"."stock_adjustment_import_rows"("batch_id", "row_number");

-- CreateIndex
CREATE UNIQUE INDEX "tax_categories_code_key" ON "public"."tax_categories"("code");

-- CreateIndex
CREATE INDEX "tax_profiles_store_id_valid_from_valid_to_idx" ON "public"."tax_profiles"("store_id", "valid_from", "valid_to");

-- CreateIndex
CREATE INDEX "tax_rates_tax_profile_id_tax_category_id_valid_from_idx" ON "public"."tax_rates"("tax_profile_id", "tax_category_id", "valid_from");

-- CreateIndex
CREATE INDEX "audit_logs_store_id_occurred_at_idx" ON "public"."audit_logs"("store_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_occurred_at_idx" ON "public"."audit_logs"("actor_user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_occurred_at_idx" ON "public"."audit_logs"("entity_type", "entity_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "public"."branches" ADD CONSTRAINT "branches_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."warehouses" ADD CONSTRAINT "warehouses_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."product_variants" ADD CONSTRAINT "product_variants_base_uom_id_fkey" FOREIGN KEY ("base_uom_id") REFERENCES "public"."unit_of_measures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."variant_uoms" ADD CONSTRAINT "variant_uoms_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."variant_uoms" ADD CONSTRAINT "variant_uoms_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "public"."unit_of_measures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."variant_barcodes" ADD CONSTRAINT "variant_barcodes_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."variant_qr_codes" ADD CONSTRAINT "variant_qr_codes_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."store_products" ADD CONSTRAINT "store_products_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."store_products" ADD CONSTRAINT "store_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."store_product_variants" ADD CONSTRAINT "store_product_variants_store_id_store_product_id_product_i_fkey" FOREIGN KEY ("store_id", "store_product_id", "product_id") REFERENCES "public"."store_products"("store_id", "id", "product_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."store_product_variants" ADD CONSTRAINT "store_product_variants_product_id_variant_id_fkey" FOREIGN KEY ("product_id", "variant_id") REFERENCES "public"."product_variants"("product_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."store_categories" ADD CONSTRAINT "store_categories_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."store_categories" ADD CONSTRAINT "store_categories_store_id_parent_id_fkey" FOREIGN KEY ("store_id", "parent_id") REFERENCES "public"."store_categories"("store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."store_product_categories" ADD CONSTRAINT "store_product_categories_store_id_store_product_id_fkey" FOREIGN KEY ("store_id", "store_product_id") REFERENCES "public"."store_products"("store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."store_product_categories" ADD CONSTRAINT "store_product_categories_store_id_category_id_fkey" FOREIGN KEY ("store_id", "category_id") REFERENCES "public"."store_categories"("store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."product_prices" ADD CONSTRAINT "product_prices_store_product_variant_id_variant_id_fkey" FOREIGN KEY ("store_product_variant_id", "variant_id") REFERENCES "public"."store_product_variants"("id", "variant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."product_prices" ADD CONSTRAINT "product_prices_variant_id_variant_uom_id_fkey" FOREIGN KEY ("variant_id", "variant_uom_id") REFERENCES "public"."variant_uoms"("variant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."media_asset_derivatives" ADD CONSTRAINT "media_asset_derivatives_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."product_images" ADD CONSTRAINT "product_images_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."variant_images" ADD CONSTRAINT "variant_images_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."variant_images" ADD CONSTRAINT "variant_images_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."image_import_items" ADD CONSTRAINT "image_import_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."image_import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."image_import_items" ADD CONSTRAINT "image_import_items_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_balances" ADD CONSTRAINT "stock_balances_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_balances" ADD CONSTRAINT "stock_balances_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_movements" ADD CONSTRAINT "stock_movements_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_movements" ADD CONSTRAINT "stock_movements_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "public"."stock_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_reservations" ADD CONSTRAINT "stock_reservations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_reservations" ADD CONSTRAINT "stock_reservations_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory_costs" ADD CONSTRAINT "inventory_costs_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory_costs" ADD CONSTRAINT "inventory_costs_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."opening_stock_sessions" ADD CONSTRAINT "opening_stock_sessions_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."opening_stock_items" ADD CONSTRAINT "opening_stock_items_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."opening_stock_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."opening_stock_items" ADD CONSTRAINT "opening_stock_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."direct_receivings" ADD CONSTRAINT "direct_receivings_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."direct_receiving_items" ADD CONSTRAINT "direct_receiving_items_receiving_id_fkey" FOREIGN KEY ("receiving_id") REFERENCES "public"."direct_receivings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."direct_receiving_items" ADD CONSTRAINT "direct_receiving_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_adjustment_import_batches" ADD CONSTRAINT "stock_adjustment_import_batches_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_adjustment_import_rows" ADD CONSTRAINT "stock_adjustment_import_rows_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."stock_adjustment_import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_adjustment_import_rows" ADD CONSTRAINT "stock_adjustment_import_rows_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tax_profiles" ADD CONSTRAINT "tax_profiles_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tax_rates" ADD CONSTRAINT "tax_rates_tax_profile_id_fkey" FOREIGN KEY ("tax_profile_id") REFERENCES "public"."tax_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tax_rates" ADD CONSTRAINT "tax_rates_tax_category_id_fkey" FOREIGN KEY ("tax_category_id") REFERENCES "public"."tax_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- REVIEW CANDIDATE ONLY — CUSTOM INVARIANTS NOT REPRESENTED BY PRISMA.
-- PostgreSQL-specific constraints/indexes for the Commerce schema draft.
-- Do not apply to a tenant database until reviewed against ERD and tested
-- against both a clean-install database and a disposable baseline-upgrade database.

-- A Store can have at most one default Branch.
CREATE UNIQUE INDEX IF NOT EXISTS branches_one_default_per_store_uq
  ON public.branches (store_id)
  WHERE is_default = TRUE;

-- A Branch can have at most one default Warehouse.
CREATE UNIQUE INDEX IF NOT EXISTS warehouses_one_default_per_branch_uq
  ON public.warehouses (branch_id)
  WHERE is_default = TRUE;

-- Quantities and cost invariants.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_balances_nonnegative_ck') THEN
    ALTER TABLE public.stock_balances
      ADD CONSTRAINT stock_balances_nonnegative_ck
      CHECK (on_hand >= 0 AND reserved >= 0 AND available >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_balances_available_ck') THEN
    ALTER TABLE public.stock_balances
      ADD CONSTRAINT stock_balances_available_ck
      CHECK (available = on_hand - reserved);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_reservations_quantity_positive_ck') THEN
    ALTER TABLE public.stock_reservations
      ADD CONSTRAINT stock_reservations_quantity_positive_ck CHECK (quantity > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_costs_nonnegative_ck') THEN
    ALTER TABLE public.inventory_costs
      ADD CONSTRAINT inventory_costs_nonnegative_ck
      CHECK (quantity >= 0 AND average_unit_cost >= 0 AND inventory_value >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'variant_uoms_conversion_positive_ck') THEN
    ALTER TABLE public.variant_uoms
      ADD CONSTRAINT variant_uoms_conversion_positive_ck CHECK (conversion_to_base > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opening_stock_items_amounts_ck') THEN
    ALTER TABLE public.opening_stock_items
      ADD CONSTRAINT opening_stock_items_amounts_ck
      CHECK (quantity > 0 AND unit_cost >= 0 AND total_cost >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'direct_receiving_items_amounts_ck') THEN
    ALTER TABLE public.direct_receiving_items
      ADD CONSTRAINT direct_receiving_items_amounts_ck
      CHECK (quantity > 0 AND unit_cost >= 0 AND total_cost >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_asset_derivatives_dimensions_ck') THEN
    ALTER TABLE public.media_asset_derivatives
      ADD CONSTRAINT media_asset_derivatives_dimensions_ck
      CHECK (size_bytes > 0 AND width > 0 AND height > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_prices_valid_range_ck') THEN
    ALTER TABLE public.product_prices
      ADD CONSTRAINT product_prices_valid_range_ck
      CHECK (valid_to IS NULL OR valid_to > valid_from);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tax_profiles_valid_range_ck') THEN
    ALTER TABLE public.tax_profiles
      ADD CONSTRAINT tax_profiles_valid_range_ck
      CHECK (valid_to IS NULL OR valid_to > valid_from);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tax_rates_valid_range_ck') THEN
    ALTER TABLE public.tax_rates
      ADD CONSTRAINT tax_rates_valid_range_ck
      CHECK (rate >= 0 AND (valid_to IS NULL OR valid_to > valid_from));
  END IF;

  -- Canonical keys are stored explicitly; all writers must use lower(trim(value)).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stores_slug_normalized_ck') THEN
    ALTER TABLE public.stores
      ADD CONSTRAINT stores_slug_normalized_ck
      CHECK (normalized_slug = lower(btrim(slug)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_categories_slug_normalized_ck') THEN
    ALTER TABLE public.store_categories
      ADD CONSTRAINT store_categories_slug_normalized_ck
      CHECK (normalized_slug = lower(btrim(slug)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_sku_normalized_ck') THEN
    ALTER TABLE public.product_variants
      ADD CONSTRAINT product_variants_sku_normalized_ck
      CHECK (normalized_sku = lower(btrim(sku)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'variant_barcodes_normalized_ck') THEN
    ALTER TABLE public.variant_barcodes
      ADD CONSTRAINT variant_barcodes_normalized_ck
      CHECK (normalized = lower(btrim(barcode)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unit_of_measures_code_normalized_ck') THEN
    ALTER TABLE public.unit_of_measures
      ADD CONSTRAINT unit_of_measures_code_normalized_ck
      CHECK (normalized_code = lower(btrim(code)));
  END IF;
END $$;

-- Effective-dated records use half-open intervals [valid_from, valid_to).
-- Adjacent periods are valid; overlapping periods for the same business key are not.
-- btree_gist is required so UUID/CHAR equality can participate in GiST exclusion.
-- Extension creation may require elevated database privileges: preflight this on
-- the disposable PostgreSQL instance and provision it through the approved DBA path.
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_prices_no_overlapping_periods_excl'
      AND conrelid = 'public.product_prices'::regclass
  ) THEN
    ALTER TABLE public.product_prices
      ADD CONSTRAINT product_prices_no_overlapping_periods_excl
      EXCLUDE USING gist (
        store_product_variant_id WITH =,
        variant_uom_id WITH =,
        currency WITH =,
        tstzrange(valid_from, COALESCE(valid_to, 'infinity'::timestamptz), '[)') WITH &&
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tax_rates_no_overlapping_periods_excl'
      AND conrelid = 'public.tax_rates'::regclass
  ) THEN
    ALTER TABLE public.tax_rates
      ADD CONSTRAINT tax_rates_no_overlapping_periods_excl
      EXCLUDE USING gist (
        tax_profile_id WITH =,
        tax_category_id WITH =,
        tstzrange(valid_from, COALESCE(valid_to, 'infinity'::timestamptz), '[)') WITH &&
      );
  END IF;

  -- A posted Opening Stock session claims its Warehouse exactly once.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'opening_stock_sessions_posting_state_ck'
      AND conrelid = 'public.opening_stock_sessions'::regclass
  ) THEN
    ALTER TABLE public.opening_stock_sessions
      ADD CONSTRAINT opening_stock_sessions_posting_state_ck
      CHECK (
        (status = 'POSTED'
          AND posted_warehouse_id IS NOT NULL
          AND posted_warehouse_id = warehouse_id
          AND posted_at IS NOT NULL
          AND posted_by IS NOT NULL)
        OR
        (status <> 'POSTED'
          AND posted_warehouse_id IS NULL
          AND posted_at IS NULL
          AND posted_by IS NULL)
      );
  END IF;

  -- REVERSED receiving documents retain the original posting audit fields.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'direct_receivings_posting_state_ck'
      AND conrelid = 'public.direct_receivings'::regclass
  ) THEN
    ALTER TABLE public.direct_receivings
      ADD CONSTRAINT direct_receivings_posting_state_ck
      CHECK (
        (status IN ('POSTED', 'REVERSED')
          AND posted_at IS NOT NULL
          AND posted_by IS NOT NULL)
        OR
        (status IN ('DRAFT', 'CANCELLED')
          AND posted_at IS NULL
          AND posted_by IS NULL)
      );
  END IF;
END $$;

-- Invariants intentionally not enforced by these candidates:
-- * TaxProfile overlap/selection: ERD does not define the profile-selection key.
-- * Default Branch/Warehouse replacement must switch defaults atomically.
-- * StockBalance writes must lock (warehouse_id, variant_id) and update
--   on_hand/reserved/available plus ledger/cost records in one transaction.
-- Active Store / Branch / Warehouse lifecycle is enforced by the deferred trigger below.

-- Additional canonical-value constraints included in this shared custom candidate.
-- QR payload hash is application-generated from exact UTF-8 bytes; no pgcrypto dependency.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stores_slug_canonical_ck') THEN
    ALTER TABLE public.stores ADD CONSTRAINT stores_slug_canonical_ck
      CHECK (normalized_slug = lower(btrim(slug)) AND normalized_slug ~ '^[a-z0-9-]+$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_categories_slug_canonical_ck') THEN
    ALTER TABLE public.store_categories ADD CONSTRAINT store_categories_slug_canonical_ck
      CHECK (normalized_slug = lower(btrim(slug)) AND normalized_slug ~ '^[a-z0-9-]+$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'branches_code_canonical_ck') THEN
    ALTER TABLE public.branches ADD CONSTRAINT branches_code_canonical_ck
      CHECK (code = upper(btrim(code)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouses_code_canonical_ck') THEN
    ALTER TABLE public.warehouses ADD CONSTRAINT warehouses_code_canonical_ck
      CHECK (code = upper(btrim(code)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'variant_qr_codes_payload_ck') THEN
    ALTER TABLE public.variant_qr_codes ADD CONSTRAINT variant_qr_codes_payload_ck
      CHECK (length(payload) > 0 AND payload_hash ~ '^[0-9a-f]{64}$');
  END IF;
END $$;

-- REVIEW CANDIDATE ONLY — lifecycle invariants not expressible as row-local CHECKs.
-- Run after Commerce tables and the partial unique default indexes exist.
-- The deferred checks evaluate the final transaction state, allowing Store+Branch+Warehouse
-- and Branch+default-Warehouse to be created atomically.

CREATE OR REPLACE FUNCTION public.assert_store_branch_warehouse_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.stores s
    WHERE s.status = 'ACTIVE'
      AND (
        (SELECT count(*) FROM public.branches b
         WHERE b.store_id = s.id AND b.status = 'ACTIVE' AND b.is_default) <> 1
        OR EXISTS (
          SELECT 1 FROM public.branches b
          WHERE b.store_id = s.id AND b.status = 'ACTIVE'
            AND (
              (SELECT count(*) FROM public.warehouses w
               WHERE w.branch_id = b.id AND w.status = 'ACTIVE') < 1
              OR
              (SELECT count(*) FROM public.warehouses w
               WHERE w.branch_id = b.id AND w.status = 'ACTIVE' AND w.is_default) <> 1
            )
        )
      )
  ) THEN
    RAISE EXCEPTION 'Active Store must have exactly one active default Branch; each active Branch must have at least one active Warehouse and exactly one active default Warehouse'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS stores_branch_warehouse_lifecycle_ct ON public.stores;
CREATE CONSTRAINT TRIGGER stores_branch_warehouse_lifecycle_ct
AFTER INSERT OR UPDATE ON public.stores
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_store_branch_warehouse_lifecycle();

DROP TRIGGER IF EXISTS branches_branch_warehouse_lifecycle_ct ON public.branches;
CREATE CONSTRAINT TRIGGER branches_branch_warehouse_lifecycle_ct
AFTER INSERT OR UPDATE OR DELETE ON public.branches
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_store_branch_warehouse_lifecycle();

DROP TRIGGER IF EXISTS warehouses_branch_warehouse_lifecycle_ct ON public.warehouses;
CREATE CONSTRAINT TRIGGER warehouses_branch_warehouse_lifecycle_ct
AFTER INSERT OR UPDATE OR DELETE ON public.warehouses
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_store_branch_warehouse_lifecycle();

-- Audit is written in the same application transaction as each lifecycle mutation.
-- Partial unique indexes remain the immediate at-most-one-default concurrency guard.
