# Tenant Canonicalization Policy

Status: **Approved by user — implementation baseline**
Approval: 2026-11-03
Scope: Tenant API write paths, CSV import, Image Import folder/mapping lookup, and Tenant identifiers.

## Canonical rules

| Field | Canonical form | Notes |
|---|---|---|
| Store slug | trim outer whitespace, lowercase; allow only ASCII a-z, 0-9, hyphen | Validate after normalization. |
| Category slug | Same as Store slug | Same shared function. |
| SKU | trim outer whitespace, lowercase | Preserve internal punctuation and characters. |
| Barcode | trim outer whitespace, lowercase | Always a string. Never numeric conversion, zero-padding removal, or removal of internal characters. Leading zeroes are significant. |
| QR payload | Exact decoded UTF-8 string content | Opaque payload; do not trim, lowercase, parse as number, normalize URL, or rewrite whitespace/case. Reject only the empty string. Classification (URL, product key, arbitrary text) is a separate operation. |
| UOM code | trim outer whitespace, lowercase | Same shared function. |
| Branch code | trim outer whitespace, uppercase | Preserve internal characters. |
| Warehouse code | trim outer whitespace, uppercase | Same shared function as Branch code. |

## QR Code data model

- QR payload is stored as PostgreSQL TEXT / Prisma String, never numeric.
- A SHA-256 hash of the exact UTF-8 payload is stored as a unique lookup key. The hash is not a replacement for the payload; the original payload remains authoritative.
- QR Code rows belong to a ProductVariant. Multiple QR payloads may map to one variant; an exact payload may belong to only one variant in a Tenant.
- symbology defaults to QR_CODE. Payload interpretation is intentionally not embedded in canonicalization.
- Hashing is deterministic and case/whitespace/leading-zero sensitive. On a hash match, applications should compare the stored payload as a defensive collision check.

## Shared implementation contract

`apps/api/src/shared/canonicalization.ts` is the single implementation. All future API, CSV and Image Import handlers must call these functions rather than reimplementing normalization. Image folder matching must treat identifiers as strings and must not strip leading zeroes from filenames/mapping keys.

The current API repository does not yet contain Commerce write controllers/services or active CSV/Image Import handlers. This change provides the shared contract and schema representation; importer integration remains pending until those handlers are introduced.

## Verification / migration boundary

- Contract checks live in `apps/api/src/shared/canonicalization.spec.ts` and can be run after build with `node dist/shared/canonicalization.spec.js`.
- Schema change is review-only. Regenerate and reconcile clean-install and incremental-upgrade SQL candidates separately, then test both against disposable PostgreSQL databases.
- No migration is authorized by this policy. Do not apply SQL, generate Prisma Client, or modify any existing Tenant database without separate migration sign-off.