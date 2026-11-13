# Product Media Upload — 4 Milestones

**Date:** 2026-11-13
**Scope:** Repository implementation for ProductImage / VariantImage, product image storage, Admin UI and bulk ZIP import.

## Executive status

The four implementation workstreams have code in place for the product image lifecycle and bulk import. This is **not yet activated in any Tenant Database**. The forward-only SQL candidate is authored but unapplied; therefore the API endpoints that query the new tables require the migration before they can be used against a workspace.

No Tenant Database was modified, no Prisma Client was regenerated, and no migration was applied.

## Milestone A — Media Storage & API

Implemented:
- Configurable local filesystem root: `MEDIA_STORAGE_ROOT`; default is `<API working directory>/.data/media`.
- Upload API uses in-memory multipart parsing with a 5 MB per-image limit.
- Image decode validation using Sharp; only JPEG, PNG and WebP are accepted.
- Pixel limit: 40 million pixels; rejects undecodable/corrupt images and unsupported formats.
- Writes the original plus generated WebP MAIN (max 1600px) and THUMBNAIL (max 480px) derivatives.
- Random UUID object paths; original filenames are metadata only and never used as storage paths.
- SHA-256 checksums and dimensions are recorded for every derivative.
- Authenticated, Workspace-membership-scoped media read endpoint; no public filesystem path is exposed.
- Workspace RBAC permissions are enforced by the existing AuthGuard/RbacGuard and product view/update permission keys.

Storage deployment requirement:
- Mount `MEDIA_STORAGE_ROOT` on durable storage and share it between API instances.
- Include this directory in encrypted backup and restore procedures.
- The current adapter is local filesystem, not S3/object storage. Do not deploy on ephemeral container storage.

## Milestone B — Product & Variant Image Management

Implemented:
- Product image upload/list/update/delete endpoints.
- Variant image upload/list/update/delete endpoints.
- Primary image, gallery ordering (`sortOrder`) and `altText`.
- Partial unique indexes in the migration candidate enforce at most one primary image per Product or Variant.
- Audit events for upload/delete.
- Media rows are soft-deleted when no Product/Variant association remains. Physical file garbage collection is still an operational follow-up.

## Milestone C — Admin UI Integration

Implemented:
- New Product page accepts an optional primary image and uploads it after Product creation.
- Product detail page supports multiple image uploads, displays persisted thumbnails, sets the primary image and deletes images.
- Variant-specific image upload/list/delete is available on Product detail.
- Product list requests the catalog's primary thumbnail set once and renders compact product cards with real images; placeholder remains when no image exists.
- Multipart requests do not set JSON Content-Type, allowing the browser to provide the boundary.

## Milestone D — Bulk Image Upload

Implemented:
- OWNER/ADMIN-only ZIP preview endpoint and commit endpoint.
- Optional CSV manifest with `filename,targetType,targetId,sku,role,sortOrder,altText`.
- Without a manifest, filenames map to Variant SKU: `SKU.jpg`, `SKU__main.jpg`, `SKU__2.jpg`.
- Preview reports valid/invalid rows before commit.
- Staged files are stored outside the public web root; commit records item-level results and audit trail.
- ZIP protections: 25 MB archive cap, 500 entries, 100 MB expanded total, 5 MB per image, 100:1 compression ratio, encrypted entry rejection, symlink rejection and path traversal/absolute-path rejection.
- Retry behavior skips already-applied rows and can retry failed rows.

## API routes

| Method | Route | Permission / rule |
|---|---|---|
| POST | `/api/tenant/:workspaceId/products/:productId/images` | `commerce.product.update` |
| GET | `/api/tenant/:workspaceId/products/:productId/images` | `commerce.product.view` |
| PATCH / DELETE | `/api/tenant/:workspaceId/products/:productId/images/:imageId` | `commerce.product.update` |
| POST | `/api/tenant/:workspaceId/variants/:variantId/images` | `commerce.product.update` |
| GET | `/api/tenant/:workspaceId/variants/:variantId/images` | `commerce.product.view` |
| PATCH / DELETE | `/api/tenant/:workspaceId/variants/:variantId/images/:imageId` | `commerce.product.update` |
| GET | `/api/tenant/:workspaceId/media/:mediaAssetId/:kind` | `commerce.product.view` |
| GET | `/api/tenant/:workspaceId/product-images/catalog` | `commerce.product.view` |
| POST | `/api/tenant/:workspaceId/image-imports/preview` | `commerce.product.update` plus OWNER/ADMIN |
| POST | `/api/tenant/:workspaceId/image-imports/:batchId/commit` | `commerce.product.update` plus OWNER/ADMIN |

## Migration / activation gate

Candidate:
- `apps/api/prisma/tenant/migrations/20261113000100_tenant_media_images.sql`

Creates:
- `media_assets`
- `media_asset_derivatives`
- `product_images`
- `variant_images`
- `image_import_batches`
- `image_import_items`
- Media and import enums, indexes and one-primary partial unique indexes.

**Not applied.** The existing Tenant migration runner does not automatically apply this new incremental candidate. Do not assume new or existing Workspaces have these tables. A separate, approved backup/rehearsal/activation procedure is required for each named Tenant Database.

## Known limitations / remaining acceptance work

1. Public Store is not implemented in this change. The media endpoint is authenticated; there is no public image route. Roadmap item 1.6f remains open until public publishing is designed and tested.
2. Local filesystem is the first storage adapter. S3-compatible storage remains a future adapter; production needs a durable shared mount and backup/restore drill.
3. No live Tenant DB migration or DB-backed upload/import E2E was run. These require migration rehearsal and explicit approval to target a specific Tenant DB.
4. Bulk import is row-transactional, not one all-or-nothing transaction for the entire ZIP. The batch records APPLIED/FAILED row outcomes and supports retry.
5. Operational retention/expiry for abandoned staging batches and storage quota monitoring remain to be added before broad production rollout.
6. Store logo / non-product media purposes are not exposed by this product-image UI.

## Verification

- API TypeScript typecheck: PASS.
- API Nest build: PASS.
- Tenant Prisma schema validation: PASS using a temporary placeholder `TENANT_DATABASE_URL`; no database connection was made.
- Web TypeScript typecheck: PASS.
- Web Next production build: PASS.
- Product-management Playwright E2E: BLOCKED at sign-in; the test remained on `/login` instead of reaching `/workspaces`. This is an authentication/test-environment failure before the product workflow and is not a passing media test.
- No DB migration, DB write, deployment, commit or push performed.
