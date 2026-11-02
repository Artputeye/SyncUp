-- REVIEW CANDIDATE ONLY. NOT A PRISMA MIGRATION.
-- Never run against production/shared development DB.
-- Disposable PostgreSQL 17 only, after schema-diff reconciliation.
-- Current reviewed Prisma DateTime fields map to timestamp(3) without time zone;
-- therefore this draft uses tsrange, not tstzrange.

-- PREFLIGHT: each query must return zero rows before its constraint is added.
-- SELECT store_id,count(*) FROM branches WHERE is_default GROUP BY store_id HAVING count(*)>1;
-- SELECT branch_id,count(*) FROM warehouses WHERE is_default GROUP BY branch_id HAVING count(*)>1;
-- SELECT id FROM product_prices WHERE valid_to IS NOT NULL AND valid_to <= valid_from;
-- SELECT id FROM product_prices WHERE amount < 0;
-- SELECT warehouse_id,variant_id FROM stock_balances
--  WHERE on_hand<0 OR reserved<0 OR reserved>on_hand OR available<>on_hand-reserved;
-- SELECT id FROM stock_reservations WHERE quantity<=0 OR status NOT IN ('ACTIVE','RELEASED','CONSUMED');
-- SELECT id FROM stock_movements WHERE quantity_delta=0
--   OR (movement_type IN ('OPENING','RECEIVING','SALE_RETURN','ADJUSTMENT_IN','TRANSFER_IN') AND quantity_delta<=0)
--   OR (movement_type IN ('SALE','ADJUSTMENT_OUT','TRANSFER_OUT','WRITE_OFF') AND quantity_delta>=0)
--   OR movement_type IN ('RESERVATION','RESERVATION_RELEASE');

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE UNIQUE INDEX branches_one_default_per_store
  ON branches(store_id) WHERE is_default=TRUE;
CREATE UNIQUE INDEX warehouses_one_default_per_branch
  ON warehouses(branch_id) WHERE is_default=TRUE;

ALTER TABLE variant_uoms
  ADD CONSTRAINT variant_uoms_conversion_positive CHECK(conversion_to_base>0);
ALTER TABLE unit_of_measures
  ADD CONSTRAINT unit_of_measures_decimal_places_range CHECK(decimal_places BETWEEN 0 AND 3);

ALTER TABLE stock_balances
  ADD CONSTRAINT stock_balances_nonnegative_on_hand CHECK(on_hand>=0),
  ADD CONSTRAINT stock_balances_nonnegative_reserved CHECK(reserved>=0),
  ADD CONSTRAINT stock_balances_reserved_not_above_on_hand CHECK(reserved<=on_hand),
  ADD CONSTRAINT stock_balances_available_reconciles CHECK(available=on_hand-reserved);

ALTER TABLE inventory_costs
  ADD CONSTRAINT inventory_costs_nonnegative_quantity CHECK(quantity>=0),
  ADD CONSTRAINT inventory_costs_nonnegative_value CHECK(inventory_value>=0),
  ADD CONSTRAINT inventory_costs_nonnegative_average_cost CHECK(average_unit_cost>=0);

ALTER TABLE stock_reservations
  ADD CONSTRAINT stock_reservations_quantity_positive CHECK(quantity>0),
  ADD CONSTRAINT stock_reservations_status_allowed CHECK(status IN ('ACTIVE','RELEASED','CONSUMED'));

ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_physical_delta_valid CHECK(
    quantity_delta<>0 AND (
      (movement_type IN ('OPENING','RECEIVING','SALE_RETURN','ADJUSTMENT_IN','TRANSFER_IN') AND quantity_delta>0)
      OR (movement_type IN ('SALE','ADJUSTMENT_OUT','TRANSFER_OUT','WRITE_OFF') AND quantity_delta<0)
      OR movement_type='REVERSAL'
    )
  );

ALTER TABLE opening_stock_items
  ADD CONSTRAINT opening_stock_items_quantity_positive CHECK(quantity>0),
  ADD CONSTRAINT opening_stock_items_unit_cost_nonnegative CHECK(unit_cost>=0),
  ADD CONSTRAINT opening_stock_items_total_cost_nonnegative CHECK(total_cost>=0);

ALTER TABLE direct_receiving_items
  ADD CONSTRAINT direct_receiving_items_quantity_positive CHECK(quantity>0),
  ADD CONSTRAINT direct_receiving_items_unit_cost_nonnegative CHECK(unit_cost>=0),
  ADD CONSTRAINT direct_receiving_items_total_cost_nonnegative CHECK(total_cost>=0);

ALTER TABLE product_prices
  ADD CONSTRAINT product_prices_valid_interval CHECK(valid_to IS NULL OR valid_to>valid_from),
  ADD CONSTRAINT product_prices_amount_nonnegative CHECK(amount>=0);

ALTER TABLE product_prices
  ADD CONSTRAINT product_prices_no_overlapping_periods
  EXCLUDE USING gist(
    store_product_variant_id WITH =,
    variant_uom_id WITH =,
    currency WITH =,
    tsrange(valid_from,valid_to,'[)') WITH &&
  );

ALTER TABLE tax_profiles
  ADD CONSTRAINT tax_profiles_valid_interval CHECK(valid_to IS NULL OR valid_to>valid_from);
ALTER TABLE tax_rates
  ADD CONSTRAINT tax_rates_valid_interval CHECK(valid_to IS NULL OR valid_to>valid_from),
  ADD CONSTRAINT tax_rates_rate_nonnegative CHECK(rate>=0);

ALTER TABLE media_asset_derivatives
  ADD CONSTRAINT media_asset_derivatives_size_positive CHECK(size_bytes > 0),
  ADD CONSTRAINT media_asset_derivatives_width_positive CHECK(width > 0),
  ADD CONSTRAINT media_asset_derivatives_height_positive CHECK(height > 0);

-- REVERSAL must negate one original movement in the same warehouse/variant.
-- Existing UNIQUE(reversal_of_id) permits at most one reversal per original.
CREATE OR REPLACE FUNCTION enforce_stock_movement_reversal()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original_delta numeric(20,3);
DECLARE original_warehouse uuid;
DECLARE original_variant uuid;
DECLARE original_type text;
BEGIN
  IF NEW.movement_type='REVERSAL' THEN
    IF NEW.reversal_of_id IS NULL THEN RAISE EXCEPTION 'REVERSAL requires reversal_of_id'; END IF;
    SELECT quantity_delta, warehouse_id, variant_id, movement_type::text
      INTO original_delta, original_warehouse, original_variant, original_type
      FROM stock_movements WHERE id=NEW.reversal_of_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Original stock movement not found'; END IF;
    IF original_type='REVERSAL' THEN RAISE EXCEPTION 'Cannot reverse a reversal'; END IF;
    IF NEW.quantity_delta<>-original_delta THEN
      RAISE EXCEPTION 'REVERSAL delta must be exact opposite of original';
    END IF;
    IF NEW.warehouse_id<>original_warehouse OR NEW.variant_id<>original_variant THEN
      RAISE EXCEPTION 'REVERSAL must use original warehouse and variant';
    END IF;
  ELSIF NEW.reversal_of_id IS NOT NULL THEN
    RAISE EXCEPTION 'reversal_of_id is only valid for REVERSAL';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stock_movement_reversal_guard
BEFORE INSERT ON stock_movements
FOR EACH ROW EXECUTE FUNCTION enforce_stock_movement_reversal();

CREATE OR REPLACE FUNCTION prevent_stock_movement_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Stock movement ledger is append-only; insert a reversal instead';
END $$;
CREATE TRIGGER stock_movement_immutable
BEFORE UPDATE OR DELETE ON stock_movements
FOR EACH ROW EXECUTE FUNCTION prevent_stock_movement_mutation();

-- Service/transaction invariants, not row-local CHECKs:
-- * at least one active default and active parent consistency
-- * Store.currency = ProductPrice.currency; VariantUom ACTIVE on price write
-- * reservation transitions and aggregate StockBalance.reserved
-- * StockBalance.on_hand = InventoryCost.quantity and WAC formula/rounding
-- * receiving/opening/import Store/Branch/Warehouse scope and atomic posting
-- * immutable posted receiving/opening/import batches
-- * Object Storage staging/promotion/READY publication/cleanup
--
-- RESERVATION and RESERVATION_RELEASE are intentionally excluded from physical ledger.
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction; production rollout
-- must split non-transactional index creation from transactional migration steps.
