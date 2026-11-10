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
