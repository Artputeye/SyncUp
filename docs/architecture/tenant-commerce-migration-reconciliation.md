# Tenant Commerce Migration SQL Reconciliation — Working Review

Status: **Draft / not approved / not deployable**
Reviewed with Prisma CLI 6.16.2. No tenant database was connected to or modified.

## Inputs

- Tenant Prisma schema: `apps/api/prisma/tenant/schema.prisma`
- Existing tenant baseline: `apps/api/prisma/tenant/migrations/20261031000100_tenant_baseline.sql`
- Domain model: `docs/architecture/commerce-erd.md` (Design Review v8)
- API contract: `docs/api/commerce-api-contracts.md` (Draft v7)

## Candidate artifacts

1. `tenant-commerce-clean-install.candidate.sql` — Prisma-generated DDL from an empty schema to the current Tenant Prisma schema. It is a review artifact only. It contains Commerce objects represented in Prisma, but does **not** recreate the existing baseline tables.
2. `tenant-commerce-custom-constraints.candidate.sql` — proposed PostgreSQL partial indexes and CHECK constraints that Prisma schema syntax does not currently express. It is not tested against PostgreSQL and must not be applied.
3. Existing baseline SQL remains the source for the three pre-existing tables: `tenant_settings`, `audit_events`, `tenant_migrations`.

## Scope reconciliation

The current Prisma schema covers the current Catalog, Store/Branch/Warehouse, UOM, Media/Image Import, Inventory/Opening Stock/Direct Receiving/Stock Adjustment Import, Tax Profile/Rate and Audit Log model set.

The ERD also contains Order, Order Item, Payment, Payment Transaction, Refund, Tax Line, Fulfillment, Return and Return Item domains, plus POS/register/shift/receipt areas. Those are not present in the current Tenant Prisma schema. They must be treated as later-phase scope (not silently included in this migration) or explicitly added to the current schema before sign-off. Online Ordering and payment verification are recorded as a future phase.

## Known schema-to-ERD gaps requiring resolution

- **Default Branch / Warehouse:** ERD requires at most one default per Store/Branch and at least one Warehouse per Branch. Partial unique indexes are proposed in the custom candidate; the minimum-child rule needs a transaction-safe workflow or deferred trigger.
- **Canonical keys — partially closed:** `Store.normalizedSlug` was added and made unique; the custom candidate now adds CHECK constraints requiring `normalized_slug`, `store_categories.normalized_slug`, `product_variants.normalized_sku`, `variant_barcodes.normalized`, and `unit_of_measures.normalized_code` to equal `lower(btrim(raw_value))`. This closes database-level consistency only when the writer supplies both fields; application write paths, CSV import and image filename matching must still call one shared canonicalization function. Existing raw `Store.slug @unique` was replaced with unique `normalizedSlug` so case/whitespace variants cannot bypass uniqueness.
- **Effective-dated prices/tax:** ERD requires no overlapping price/tax effective ranges. Current Prisma indexes are ordinary indexes and do not prevent overlap. Decide the exact exclusion constraint and whether `btree_gist` is available before adopting it.
- **Inventory arithmetic:** enforce non-negative balances/costs, positive reservation and conversion quantities, and `available = on_hand - reserved`; proposed CHECK constraints are in the custom candidate. Confirm whether negative stock is ever a permitted business rule.
- **Opening stock:** `posted_warehouse_id` unique supports one posted session per Warehouse, but status/posted-field consistency and posting atomicity need service-level tests/constraints.
- **Decimal and time semantics:** Tenant Prisma DateTime fields were updated to native `@db.Timestamptz(3)` to match the ERD UTC storage decision; the clean-install candidate was regenerated. Confirm this across every timestamp column in the disposable PostgreSQL verification.
- **SKU uniqueness:** normalized SKU is unique; ensure normalization algorithm is canonical, stable and used by CSV/image matching and API writes. Barcode has a unique normalized field with the same requirement.
- **Image import mapping:** schema supports folder path + target type/id + mapping key; validate allowed target types, image roles, ownership and idempotent checksum handling in API/business rules.

## Clean install vs incremental upgrade

- **Clean install:** baseline objects plus Commerce DDL plus reviewed custom constraints in dependency order.
- **Incremental upgrade:** must preserve the existing baseline objects and data, create only Commerce additions, then record the new version in `tenant_migrations`. Do not run the clean-install candidate wholesale against an existing tenant.
- The baseline is currently a standalone SQL file, not a Prisma migration history that Prisma can safely use as an authoritative `--from-migrations` source. A controlled baseline representation/reconciliation is required before generating a trusted incremental diff.

## Verification still required

1. Timestamp native type has been aligned to `@db.Timestamptz(3)` and Prisma validation passed; verify actual PostgreSQL column types during disposable-database tests. Continue resolving remaining ERD constraints listed above.
2. Confirm intended migration scope (Catalog/Inventory/Media/Tax now; Order/Payment/Return later unless approved).
3. Produce separate clean-install and incremental-upgrade SQL after decisions are closed.
4. Run both candidates on disposable PostgreSQL databases: one empty and one containing the exact baseline.
5. Verify schema objects, indexes, constraints, extension privileges, idempotency, rerun behavior, migration ledger and recovery/rollback procedure.
6. Obtain explicit Migration Sign-off before applying to any real tenant.

## Reconciliation update — 2026-11-03

- Added `Store.normalizedSlug` with a unique constraint; raw Store slug is no longer the uniqueness key.
- Added candidate CHECK constraints for canonical normalized Store slug, StoreCategory slug, SKU, Barcode, and UOM code using `lower(btrim(...))`.
- Regenerated the clean-install candidate from the revised Prisma schema; `prisma validate` passed with Prisma CLI 6.16.2.
- This is a partial closure only: API/CSV/image import writers still need a shared normalization implementation and tests. Price/tax overlap, minimum Warehouse per Branch, archive/default replacement, and Opening Stock status consistency remain open.

## Safety

No `prisma migrate dev`, `prisma migrate deploy`, `db push`, Prisma Client generation, or SQL execution against Workspace A/B or POS was performed. Workspace A/B remain SUSPENDED and their databases are preserved.
