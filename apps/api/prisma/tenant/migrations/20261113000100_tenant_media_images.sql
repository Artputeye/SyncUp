DO $$ BEGIN
  CREATE TYPE "MediaStatus" AS ENUM ('STAGED', 'READY', 'REJECTED', 'DELETED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "MediaPurpose" AS ENUM ('PRODUCT', 'VARIANT', 'STORE_LOGO', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "MediaDerivativeKind" AS ENUM ('ORIGINAL', 'MAIN', 'THUMBNAIL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "MediaDerivativeStatus" AS ENUM ('STAGED', 'PROCESSING', 'READY', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'VALIDATING', 'PREVIEW_READY', 'COMMITTING', 'COMMITTED', 'FAILED', 'CANCELLED', 'STALE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "ImportRowStatus" AS ENUM ('PENDING', 'VALID', 'INVALID', 'APPLIED', 'SKIPPED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose "MediaPurpose" NOT NULL,
  status "MediaStatus" NOT NULL DEFAULT 'STAGED',
  alt_text VARCHAR(255),
  uploaded_by UUID,
  verified_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS media_assets_status_created_at_idx ON media_assets(status, created_at);

CREATE TABLE IF NOT EXISTS media_asset_derivatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_asset_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  kind "MediaDerivativeKind" NOT NULL,
  status "MediaDerivativeStatus" NOT NULL DEFAULT 'STAGED',
  storage_provider VARCHAR(40) NOT NULL DEFAULT 'local-filesystem',
  bucket VARCHAR(128) NOT NULL,
  object_key VARCHAR(1024) NOT NULL UNIQUE,
  original_filename VARCHAR(255),
  mime_type VARCHAR(127) NOT NULL,
  extension VARCHAR(16),
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  checksum_sha256 CHAR(64) NOT NULL,
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT media_asset_derivatives_media_kind_key UNIQUE(media_asset_id, kind)
);
CREATE INDEX IF NOT EXISTS media_asset_derivatives_status_created_at_idx ON media_asset_derivatives(status, created_at);

CREATE TABLE IF NOT EXISTS product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  media_asset_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT product_images_product_media_key UNIQUE(product_id, media_asset_id)
);
CREATE INDEX IF NOT EXISTS product_images_product_sort_idx ON product_images(product_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS product_images_one_primary_idx ON product_images(product_id) WHERE is_primary;

CREATE TABLE IF NOT EXISTS variant_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  media_asset_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT variant_images_variant_media_key UNIQUE(variant_id, media_asset_id)
);
CREATE INDEX IF NOT EXISTS variant_images_variant_sort_idx ON variant_images(variant_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS variant_images_one_primary_idx ON variant_images(variant_id) WHERE is_primary;

CREATE TABLE IF NOT EXISTS image_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
  source_filename VARCHAR(255) NOT NULL,
  source_checksum CHAR(64) NOT NULL,
  manifest_checksum CHAR(64),
  staging_object_key VARCHAR(1024),
  total_files INTEGER NOT NULL DEFAULT 0,
  processed_files INTEGER NOT NULL DEFAULT 0,
  valid_files INTEGER NOT NULL DEFAULT 0,
  invalid_files INTEGER NOT NULL DEFAULT 0,
  options JSONB,
  error_summary JSONB,
  uploaded_by UUID NOT NULL,
  started_at TIMESTAMPTZ(3),
  completed_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS image_import_batches_status_created_idx ON image_import_batches(status, created_at);
CREATE INDEX IF NOT EXISTS image_import_batches_uploader_created_idx ON image_import_batches(uploaded_by, created_at);

CREATE TABLE IF NOT EXISTS image_import_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES image_import_batches(id) ON DELETE CASCADE,
  media_asset_id UUID REFERENCES media_assets(id) ON DELETE RESTRICT,
  relative_path VARCHAR(1024) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  checksum_sha256 CHAR(64),
  target_type VARCHAR(24),
  target_id UUID,
  mapping_key VARCHAR(160),
  image_role VARCHAR(24),
  sort_order INTEGER NOT NULL DEFAULT 0,
  status "ImportRowStatus" NOT NULL DEFAULT 'PENDING',
  error_code VARCHAR(80),
  error_message VARCHAR(1000),
  metadata JSONB,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT image_import_items_batch_path_key UNIQUE(batch_id, relative_path)
);
CREATE INDEX IF NOT EXISTS image_import_items_batch_status_idx ON image_import_items(batch_id, status);
CREATE INDEX IF NOT EXISTS image_import_items_target_idx ON image_import_items(target_type, target_id);

INSERT INTO tenant_migrations(version)
VALUES ('20261113000100_tenant_media_images')
ON CONFLICT (version) DO NOTHING;
