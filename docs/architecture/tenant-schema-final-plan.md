# Tenant Final Schema / Constraints Plan

Status: **Approved decision baseline; implementation and isolated verification pending**
Date: 2026-11-02
Scope: Tenant PostgreSQL only. This is not production migration authorization.

## 1. Approved decisions

### 1.1 Store / Branch / Warehouse defaults
- Store creation creates Default Branch `สำนักงานใหญ่` and Default Warehouse `คลังหลัก` in one Tenant transaction.
- Every new Branch automatically creates its Default Warehouse in the same transaction.
- Partial unique indexes enforce at most one default per Store/Branch. Service transactions enforce at least one.
- Default switching uses a dedicated service, parent-row lock, atomic replacement and audit actor/reason. The last default cannot be archived/demoted without replacement.

### 1.2 Price History
- Amount zero is allowed; negative amount is prohibited.
- Ordinary API cannot backdate. Future-dated prices are allowed.
- Validity is half-open `[validFrom, validTo)`; overlapping intervals for the same StoreProductVariant + VariantUom + currency are prohibited.
- MVP currency is the Store currency; Server validates/derives it.
- Price updates close the previous interval and insert a new row in one transaction. Effective history is immutable; exceptional corrections require privileged audited workflow.
- API accepts ISO-8601 with offset and normalizes to UTC. Current Prisma DateTime fields lack explicit @db.Timestamptz, so PostgreSQL defaults to timestamp without time zone. Use `tsrange` consistently, or explicitly change schema to timestamptz before using `tstzrange`. Never mix the two.

### 1.3 Reservation / Stock Movement
- Reservation states: ACTIVE -> RELEASED or ACTIVE -> CONSUMED. Expiry releases ACTIVE. Terminal states cannot return to ACTIVE.
- Reserve/release/consume are idempotent and use row locks/conditional updates. Active reservation sum reconciles to StockBalance.reserved.
- StockMovement is the physical ledger; reservation lifecycle is recorded in StockReservation/audit and does not create zero-quantity physical movements.
- Positive movement types: OPENING, RECEIVING, SALE_RETURN, ADJUSTMENT_IN, TRANSFER_IN.
- Negative movement types: SALE, ADJUSTMENT_OUT, TRANSFER_OUT, WRITE_OFF.
- REVERSAL must exactly negate the original movement and may occur only once per original.
- RESERVATION and RESERVATION_RELEASE are not valid physical ledger rows.
- Posted movements are immutable; correction is a new reversal with reason and actor.

### 1.4 WAC / Inventory Cost
- Quantity precision 3 decimals; unit cost and inventory value precision 6 decimals.
- Decimal/NUMERIC arithmetic only; no Float.
- HALF_UP rounding to 6 decimals.
- Negative stock is prohibited. When quantity reaches zero, persist quantity/value/average cost as zero; calculate the final issue cost using the pre-issue average.
- InventoryCost.quantity reconciles to StockBalance.onHand. InventoryValue = quantity × averageUnitCost rounded HALF_UP to 6 decimals. Tolerance: 0.000001 currency units; discrepancies are surfaced, not silently adjusted.
- WAC locks the Warehouse+Variant key and updates Movement, Balance and Cost in one transaction.

### 1.5 Image Upload / Object Storage
- Upload source files to isolated staging first. Source upload size is governed by a separately configurable ingress limit; it is not restricted to the 200 KB optimized-output target, so ordinary camera originals can be accepted within the configured safety ceiling.
- Validate declared MIME, magic bytes, actual image decode, checksum, dimensions and decompression/pixel limits before processing.
- Generate two WebP derivatives from the validated source: main image at 800 × 800 px (1:1 square), target 100–200 KB and hard optimized-output ceiling 200 KB; thumbnail at 150 × 150 px, target 20–30 KB and hard optimized-output ceiling 30 KB. Preserve aspect ratio and use a documented crop/fit policy for square output; never stretch images.
- Store main and thumbnail as distinct derivative objects with distinct object keys and metadata. They represent one logical image and must not create duplicate ProductImage/VariantImage relations.
- Promote all required derivatives to permanent storage before the logical MediaAsset becomes READY or any public URL is exposed. Promotion failure is retryable/idempotent; non-READY assets are never public.
- Duplicate checksum must not create duplicate ProductImage/VariantImage relations; existing target+asset unique keys remain final guards. Cross-target physical deduplication is not mandated by a unique constraint.
- Staging cleanup respects retention and never deletes an asset referenced by live content. MAIN image replacement requires explicit mapping/confirmation; retry cannot silently replace it.
- Source upload count, source per-file/total bytes, pixel/dimension, archive entries/expanded bytes/compression-ratio limits remain configurable safety limits to be set before endpoint enablement; do not guess or encode arbitrary values into relational schema.
### 1.6 Workspace / Store Provisioning
- Workspace and Store use separate state machines.
- Workspace becomes ACTIVE only after Tenant DB/runtime role, baseline migration and health checks succeed.
- Store + Default Branch + Default Warehouse are created in one Tenant transaction. Control DB Public Route is enabled only after Tenant readiness; Store becomes ACTIVE/published only after health check.
- Provisioning is idempotent with bounded retries and failure reasons.
- Use compensation for safely reversible resources; use reconciliation for uncertain/non-reversible resources such as partially created DBs or migrations.
- Keep per-Tenant migration version/status registry. Runtime credentials remain least-privileged and separate from provisioning credentials.
- Retry/backoff, orphan DB/role retention and cleanup operator ownership remain operational configuration before production rollout.

### 1.7 Database enforcement
- Composite ownership, unique keys and row-local invariants are enforced in PostgreSQL.
- Default uniqueness uses partial unique indexes; at-least-one is service-enforced.
- ProductPrice overlap uses btree_gist exclusion after isolated verification.
- StockMovement immutability uses a DB trigger plus least-privilege runtime role.
- Stock, reservation, WAC and default switching use transactions and row locks/conditional updates.
- Every constraint requires preflight queries and rollback/recovery planning.

## 2. Schema alignment / cross-row invariants
1. ProductPrice/Tax effective-time fields are Prisma DateTime without explicit native type in the reviewed schema. PostgreSQL therefore uses timestamp without time zone. Candidate SQL must use `tsrange`; alternatively change schema to @db.Timestamptz(3), validate and then use `tstzrange`.
2. Store currency vs ProductPrice.currency and VariantUom ACTIVE are cross-table rules: service transaction or carefully scoped trigger, not CHECK.
3. REVERSAL sign equality is cross-row: trigger/service transaction.
4. StockBalance vs InventoryCost equality and WAC formula are cross-table: atomic service transaction plus reconciliation.
5. At-least-one default and active parent consistency are service transaction rules.
6. Reservation transitions are conditional service updates; DB CHECK only limits allowed labels.
7. Object promotion, image decode, checksum, archive validation, limits and cleanup are worker/application responsibilities.

### MediaAsset / MediaAssetDerivative schema alignment

**Approved representation**
- `MediaAsset` is the logical image and owns purpose, publication lifecycle, alt text, uploader and timestamps. It no longer stores a physical object key or per-file metadata.
- `MediaAssetDerivative` stores every physical file version using `kind`: `ORIGINAL`, `MAIN`, `THUMBNAIL`. Each row owns storage provider, bucket, immutable object key, original filename (when applicable), MIME, extension, byte size, SHA-256, width, height, processing status and timestamps.
- Exactly one row per logical asset and derivative kind: `@@unique([mediaAssetId, kind])`; `objectKey` is globally unique. This is an MVP fixed set, not an arbitrary variant list.
- `ProductImage` and `VariantImage` continue to reference `MediaAsset.id`. They remain the only gallery associations and own `isPrimary`/`sortOrder`; thumbnails and originals never create extra gallery rows.
- Public API resolves `MAIN` for full-size imagery and `THUMBNAIL` for card/list previews. `ORIGINAL` is private and never returned as a public URL.

**Prisma schema implemented**
- Added enums `MediaDerivativeKind` (`ORIGINAL`, `MAIN`, `THUMBNAIL`) and `MediaDerivativeStatus` (`STAGED`, `PROCESSING`, `READY`, `FAILED`).
- Added `MediaAsset.derivatives MediaAssetDerivative[]` and `MediaAssetDerivative` with a restrictive parent FK, unique object key, unique `(mediaAssetId, kind)` and processing index.
- Removed physical-file columns from `MediaAsset`; moved them to `MediaAssetDerivative`. `MediaAsset.altText`, purpose, status, uploader and lifecycle timestamps remain on the logical parent.

**Lifecycle and invariants**
1. Create one logical `MediaAsset` as `STAGED`; create its `ORIGINAL` derivative from the uploaded source. The original must pass file signature, decode, checksum and dimension validation.
2. Generate `MAIN` (WebP 800 × 800, <=200 KB) and `THUMBNAIL` (WebP 150 × 150, <=30 KB). Each derivative is a separate immutable object with its own metadata and checksum.
3. A derivative becomes `READY` only after its permanent object is verified. Parent `MediaAsset` becomes `READY` only when all three required kinds (`ORIGINAL`, `MAIN`, `THUMBNAIL`) are READY.
4. Create/commit `ProductImage` or `VariantImage` only after the parent is READY; retries must not create duplicate associations.
5. Reprocessing writes a new versioned object key, then atomically updates the derivative row; delete the prior object only after retention and reference checks. Never overwrite objects in place.
6. Database constraints enforce derivative kind uniqueness and object key uniqueness. The worker/service enforces required derivative set, MIME/dimension/size policy, readiness and atomic parent lifecycle because these are cross-row/object-storage invariants.
7. Keep `ORIGINAL` private. Retention/deletion is explicit lifecycle policy; do not delete originals while import recovery, audit or reprocessing still depends on them.

**Compatibility and migration note**
- The current schema edit is not backward-compatible with the old `media_assets` physical-file columns. Existing data migration must create one `ORIGINAL` derivative per legacy MediaAsset and copy its storage metadata before dropping legacy columns. The exact backfill and rollback strategy must be included in a future reviewed migration.
- Existing `ProductImage` and `VariantImage` rows remain linked to the same logical `MediaAsset`; no duplicate thumbnail associations are created.
- No migration has been created or applied; no database or generated Prisma Client has been changed.

## 3. Constraint / index plan
- Preserve approved StoreProduct unique key `(storeId,id,productId)`, StoreProductVariant three-column FK and ProductPrice composite FKs.
- Partial unique indexes: branches(store_id) WHERE is_default; warehouses(branch_id) WHERE is_default. Preflight duplicates and missing defaults.
- ProductPrice: valid interval CHECK, amount >= 0 CHECK, GiST exclusion on `(store_product_variant_id, variant_uom_id, currency, tsrange(valid_from,valid_to,'[)'))` after confirming column type and btree_gist.
- StockBalance: on_hand >= 0, reserved >= 0, reserved <= on_hand, available = on_hand - reserved.
- InventoryCost: quantity/value/average cost >= 0.
- StockReservation: quantity > 0; status in ACTIVE/RELEASED/CONSUMED.
- StockMovement: non-zero physical delta, signs match movement type, reservation pseudo-types rejected, reversal exactly negates original; UPDATE/DELETE blocked.
- OpeningStockItem/DirectReceivingItem: quantity > 0, unit_cost >= 0, total_cost >= 0.
- VariantUom conversion > 0; UOM decimal_places between 0 and 3.
- MediaAssetDerivative: size_bytes > 0, width > 0, height > 0; checksum format and decoded content are validated by the worker/application.
- Tax valid intervals and nonnegative tax rate. Do not add blanket TaxProfile exclusion until business key semantics are specified.

## 4. Isolated migration verification sequence
1. Inspect existing Tenant migration history. The repository already contains `apps/api/prisma/tenant/migrations/20261031000100_tenant_baseline.sql`; preserve it as history.
2. Reconcile timestamp native types.
3. Generate a candidate schema SQL diff without applying it; merge reviewed custom indexes/checks/triggers.
4. Run preflight queries against a disposable PostgreSQL 17 database.
5. Apply candidate only to that disposable database; inspect constraints/indexes and run positive, negative, concurrency and rollback tests.
6. Verify clean-install and upgrade paths from existing Tenant baseline, plus rollback/recovery.
7. Record PostgreSQL version, extension availability, SQL hash, test output and test DB disposal.
8. Only after gates pass, request separate Migration Sign-off. Production Tenant DB is out of scope.

## 5. Verification status / blockers
- Prisma validation previously passed for current Tenant schema.
- Docker CLI exists, but Docker Desktop engine is unavailable (`docker ps` cannot connect to dockerDesktopLinuxEngine).
- Host PATH has no `psql` or `pg_isready`.
- No isolated PostgreSQL instance is currently available; SQL execution/constraint verification cannot be claimed.
- Existing Tenant baseline migration must be reconciled; do not overwrite historical migrations.
- No production migration has been created/applied in this step.
