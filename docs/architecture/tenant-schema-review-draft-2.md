# Tenant Schema Review — Draft 2

Date: 2026-11-02
Status: Review findings only; no migration approved.

## 1. Composite constraints

Prisma validation alone does not prevent a StoreProductVariant from referencing a Variant belonging to a different Product than its parent StoreProduct. Likewise, ProductPrice can point to a VariantUom belonging to a different Variant than the selected StoreProductVariant. Preferred database design: carry scope keys on child rows and add composite foreign keys; a constraint trigger is an alternative. See tenant-schema-constraints-draft.sql for a review-only proposal.

## 2. Default Branch/Warehouse

Use Branch.isDefault and Warehouse.isDefault as source of truth. Partial unique indexes enforce at most one default per Store/Branch. Provisioning must create the initial Branch and Warehouse transactionally where possible; service rules must prevent demoting/deleting the only default without replacement. At-most-one does not guarantee at-least-one, so provisioning and reconciliation are also required.

## 3. Price and tax history

validTo must be null or greater than validFrom. Product prices should use half-open intervals [validFrom, validTo) and a PostgreSQL exclusion constraint to prevent overlapping rows for the same StoreProductVariant + VariantUom + Currency. Review btree_gist availability. TaxProfile overlap cannot be finalized until the business key and simultaneous-profile policy are decided. TaxRate overlap should be constrained by TaxProfile + TaxCategory.

## 4. Stock integrity

Proposed checks include non-negative on-hand/reserved, reserved <= on-hand, available = onHand - reserved, positive reservation quantity, positive conversion factor and non-negative cost. These checks match the default no-negative-stock policy; if authorized negative stock is later supported, checks and WAC policy need explicit revision. Balance, ledger and cost updates must be serialized per Warehouse + Variant and committed atomically. Posted ledger rows must not be mutable by the runtime DB role.

## 5. CSV Import safety — required tests

- Only OWNER can download snapshot/template, upload, preview and commit; direct API calls without permission return 403.
- Reject oversized files/row counts, duplicate SKUs/variants, malformed Decimal strings, scale >3, formula-injection prefixes in exported CSV, invalid encoding/headers and unknown template versions.
- Normalize deterministic snapshot content before SHA-256; commit rejects changed stock as STALE.
- Commit is all-or-nothing: a forced failure on a middle row leaves no partial ledger, balance, cost or APPLIED row state.
- Replaying the same idempotency key returns the prior result and never duplicates movements; conflicting reuse of a key is rejected.
- Concurrent commits against the same Warehouse + Variant serialize/lock and one stale batch fails cleanly.
- Audit includes actor, request/batch ID, source checksum, snapshot checksum, counts, outcome and reason; do not log secrets or full sensitive CSV rows.

## 6. Image upload security — required tests

- Enforce allowlisted formats, verify actual file signature (not just extension/client MIME), and limit compressed bytes, decoded dimensions/pixel count and file count.
- Reject MIME mismatches, malformed images, SVG unless explicitly sanitized/allowed, and decompression bombs.
- Normalize ZIP paths; reject absolute paths, .., drive prefixes, symlinks and entries escaping staging root; enforce total uncompressed size, file count and compression-ratio limits.
- Stage with generated object keys, never trust uploaded paths as storage keys; quarantine until scanning/validation completes; public delivery only for READY assets attached to published entities.
- Test checksum deduplication without cross-entity authorization bypass; verify cleanup of abandoned staging objects and failed batches.

## Migration sign-off checklist

- [ ] Implement composite scope keys/FKs for StoreProductVariant and ProductPrice, or approve a trigger alternative.
- [ ] Add partial unique indexes for default Branch/Warehouse and validate provisioning/reconciliation.
- [ ] Add interval checks and exclusion constraints for prices; decide TaxProfile overlap semantics.
- [ ] Approve and test stock checks, lock ordering, WAC rounding, ledger immutability and reconciliation.
- [ ] Implement and test OWNER-only CSV flow, stale snapshot, atomic commit, idempotency and CSV formula-injection protection.
- [ ] Implement and test bulk image validation, ZIP traversal/bomb defense, quarantine and cleanup.
- [ ] Compare Tenant schema against Commerce ERD/API contracts; review numeric precision with accounting.
- [ ] Review Tenant provisioning/migration versioning and rollback/recovery plan.
- [ ] Approve schema review before creating a Migration.

This document and the SQL draft are review artifacts only. They have not been applied to any database and are not approved production migration scripts.


## Implementation status � composite constraints (2026-11-02)

- [x] `StoreProductVariant` carries `storeId` and `productId`; its composite relations bind `(storeId, storeProductId)` to `StoreProduct(storeId, id)` and `(productId, variantId)` to `ProductVariant(productId, id)`. This prevents cross-store/product variant attachment at the FK level.
- [x] `ProductPrice` carries `variantId`; composite relations bind `(storeProductVariantId, variantId)` to `StoreProductVariant(id, variantId)` and `(variantId, variantUomId)` to `VariantUom(variantId, id)`. This prevents pricing a unit from a different variant.
- [x] Prisma schema validation passed with a temporary `TENANT_DATABASE_URL` value. Validation did not connect to or modify a database.
- [ ] Review the required write DTO/service implications of the added `storeId`, `productId`, and `variantId` fields before implementing tenant write APIs.
- [ ] PostgreSQL-only partial indexes, exclusion constraints, and CHECK constraints remain review-only SQL proposals; they are not applied and are not a migration.
