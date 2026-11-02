-- REVIEW-ONLY DRAFT for Tenant PostgreSQL constraints.
-- This is NOT a Prisma migration. Do not execute against any database.
-- Review identifiers and business policy before incorporating into a migration.
-- Tables/columns correspond to apps/api/prisma/tenant/schema.prisma.

-- 1) Only one default Branch per Store and one default Warehouse per Branch.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS branches_one_default_per_store
  ON branches (store_id)
  WHERE is_default = TRUE;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS warehouses_one_default_per_branch
  ON warehouses (branch_id)
  WHERE is_default = TRUE;

-- 2) Positive conversion factor and valid UOM precision.
ALTER TABLE variant_uoms
  ADD CONSTRAINT variant_uoms_conversion_positive CHECK (conversion_to_base > 0);

ALTER TABLE unit_of_measures
  ADD CONSTRAINT unit_of_measures_decimal_places_range CHECK (decimal_places BETWEEN 0 AND 3);

-- 3) Stock balance must reconcile exactly. Decimal arithmetic is exact at the
-- chosen NUMERIC scale; application transactions must update all three values.
ALTER TABLE stock_balances
  ADD CONSTRAINT stock_balances_nonnegative_on_hand CHECK (on_hand >= 0),
  ADD CONSTRAINT stock_balances_nonnegative_reserved CHECK (reserved >= 0),
  ADD CONSTRAINT stock_balances_reserved_not_above_on_hand CHECK (reserved <= on_hand),
  ADD CONSTRAINT stock_balances_available_reconciles CHECK (available = on_hand - reserved);

ALTER TABLE inventory_costs
  ADD CONSTRAINT inventory_costs_nonnegative_quantity CHECK (quantity >= 0),
  ADD CONSTRAINT inventory_costs_nonnegative_value CHECK (inventory_value >= 0),
  ADD CONSTRAINT inventory_costs_nonnegative_average_cost CHECK (average_unit_cost >= 0);

ALTER TABLE stock_reservations
  ADD CONSTRAINT stock_reservations_quantity_positive CHECK (quantity > 0);

ALTER TABLE opening_stock_items
  ADD CONSTRAINT opening_stock_items_quantity_positive CHECK (quantity > 0),
  ADD CONSTRAINT opening_stock_items_unit_cost_nonnegative CHECK (unit_cost >= 0),
  ADD CONSTRAINT opening_stock_items_total_cost_nonnegative CHECK (total_cost >= 0);

ALTER TABLE direct_receiving_items
  ADD CONSTRAINT direct_receiving_items_quantity_positive CHECK (quantity > 0),
  ADD CONSTRAINT direct_receiving_items_unit_cost_nonnegative CHECK (unit_cost >= 0),
  ADD CONSTRAINT direct_receiving_items_total_cost_nonnegative CHECK (total_cost >= 0);

-- 4) Valid effective-time intervals. Half-open intervals [valid_from, valid_to)
-- allow one price to end exactly when the next price starts.
ALTER TABLE product_prices
  ADD CONSTRAINT product_prices_valid_interval
  CHECK (valid_to IS NULL OR valid_to > valid_from);

ALTER TABLE tax_profiles
  ADD CONSTRAINT tax_profiles_valid_interval
  CHECK (valid_to IS NULL OR valid_to > valid_from);

ALTER TABLE tax_rates
  ADD CONSTRAINT tax_rates_valid_interval
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  ADD CONSTRAINT tax_rates_rate_nonnegative
  CHECK (rate >= 0);

-- To prevent overlaps robustly, review/enable btree_gist in the target PostgreSQL
-- environment, then add:
--
-- CREATE EXTENSION IF NOT EXISTS btree_gist;
--
-- ALTER TABLE product_prices
--   ADD CONSTRAINT product_prices_no_overlapping_periods
--   EXCLUDE USING gist (
--     store_product_variant_id WITH =,
--     variant_uom_id WITH =,
--     currency WITH =,
--     tstzrange(valid_from, valid_to, '[)') WITH &&
--   );
--
-- Tax profile overlap policy needs a product decision: whether a Store may have
-- multiple simultaneous profiles (e.g. differing use cases). Do not add a blanket
-- exclusion until the business key is decided. Tax rates likely need an exclusion
-- by (tax_profile_id, tax_category_id, tstzrange(valid_from, valid_to, '[)')).
--
-- 5) Cross-model invariants reviewed against schema.prisma (composite relations are now represented in the draft schema and generate database FKs):\n--\n-- A. store_product_variants carries store_id + product_id and uses composite relations to store_products(store_id,id) and product_variants(product_id,id).\n-- B. product_prices carries variant_id and uses composite relations to store_product_variants(id,variant_id) and variant_uoms(variant_id,id).\n-- C. Keep these key fields immutable after publication through service rules or a trigger if direct database writes are in the threat model.\n--\n-- D. branch/warehouse default uniqueness is enforced above, but verifying the
--    default belongs to an active Store/Branch and preventing deletion/demotion
--    of the only default require transactional service rules or deferred trigger.
--
-- E. stock ledger immutability after posting, atomic WAC updates, batch snapshot
--    freshness and import row commit consistency are transaction/service concerns;
--    enforce with restricted DB privileges and triggers where the threat model
--    requires database-level enforcement.
--
-- 6) Operational caveat:
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block. A production
-- migration strategy must handle that explicitly; these statements are a design
-- reference only, not ready-to-run migration SQL.
