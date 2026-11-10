# Migration Reconciliation Addendum — 2026-11-03

Status: **Review candidate only. No SQL executed. No tenant database modified.**

## Effective-date constraints proposed

The custom-constraints candidate proposes PostgreSQL GiST exclusion constraints using half-open intervals `[valid_from, valid_to)`:

- ProductPrice: exclusion key `store_product_variant_id + variant_uom_id + currency`; overlapping periods for the same sellable variant, UOM and currency are rejected. Adjacent periods are permitted.
- TaxRate: exclusion key `tax_profile_id + tax_category_id`; overlapping periods for the same profile/category are rejected. Adjacent periods are permitted.

Both require `btree_gist` to combine equality operators for UUID/CHAR keys with the range overlap operator. Verify extension availability and creation privileges on disposable PostgreSQL first. Do not assume the tenant runtime role can install extensions.

TaxProfile overlap is intentionally unresolved. The ERD does not define a unique profile-selection key or whether multiple profiles can be active for one Store. Do not add a profile-level exclusion constraint until that rule is decided.

## Posting-state constraints proposed

- OpeningStockSession: POSTED must set `posted_warehouse_id = warehouse_id`, `posted_at`, and `posted_by`; non-POSTED statuses must clear all three. The nullable unique `posted_warehouse_id` then permits only one posted opening session per Warehouse.
- DirectReceiving: POSTED and REVERSED retain `posted_at` and `posted_by`; DRAFT and CANCELLED clear them. Reversal preserves the original posting audit data.

Implementation detail to verify: the Opening Stock CHECK must explicitly require `posted_warehouse_id IS NOT NULL` in the POSTED branch. SQL CHECK constraints accept UNKNOWN, so equality with a NULL value alone is insufficient.

## Canonicalization and QR Code — approved 2026-11-03

See `tenant-canonicalization-policy.md` for the complete approved rules.

- Shared implementation added at `apps/api/src/shared/canonicalization.ts` for Store/Category slug, SKU, Barcode, QR payload, UOM, Branch and Warehouse codes.
- Barcode is always text. Canonicalization trims only outer whitespace and lowercases; it never parses numeric data or removes leading zeroes.
- QR payload is opaque text and is preserved exactly, including case and whitespace. It is never parsed as a number or rewritten. URL/product-key interpretation is separate.
- Added `VariantQRCode` to the Tenant Prisma schema. It stores the original payload as `TEXT` and a unique SHA-256 hash of exact UTF-8 content as the lookup key; multiple QR codes may belong to one variant.
- Added `tenant-canonicalization-constraints.candidate.sql` for canonical slug, Branch/Warehouse code and QR payload/hash-shape checks. It is review-only and not merged/applied.
- Added executable contract checks and the `test:canonicalization` script.
- Commerce API write handlers and CSV/Image Import handlers are not present in the current repository. The shared utility is ready, but integration into those future paths remains pending.
- Regenerated `tenant-commerce-clean-install.candidate.sql` to include the QR Code model. It remains a review artifact, not an executable migration.

## Domain invariants that remain service-level

- Every Branch must have at least one Warehouse. Provision Branch + first default Warehouse in one transaction; prevent removal/disable/archive of the last active Warehouse.
- Default replacement must atomically set the new default before disabling/archiving the previous default.
- Stock posting must lock the `(warehouse_id, variant_id)` balance row and atomically write StockMovement, StockBalance and InventoryCost/WAC. CHECK constraints alone do not prevent lost updates or duplicate ledger posting.

## Incremental upgrade gate

Do not generate the incremental candidate until:
1. The above constraints are reviewed against the exact generated table/column names.
2. The Branch/Warehouse provisioning and archive rules are explicit.
3. TaxProfile selection semantics are decided.
4. The baseline SQL is represented in a controlled, reviewable migration history or an explicit incremental script is authored against the exact baseline.
5. Clean-install and incremental-upgrade SQL are tested on separate disposable PostgreSQL databases.

## Safety

No extension was installed, no SQL was executed, no Prisma Client was generated, and no real tenant database was connected to or changed. Workspace A/B remain SUSPENDED with their databases preserved; POS remains ACTIVE.