## Checkpoint — 2026-11-10: Opening Stock per Warehouse implementation

### Implemented
- Added `OpeningStockService` and `OpeningStockController` in the Inventory module:
  - `GET /api/tenant/:workspaceId/inventory/opening-stocks` — paginated list and status/warehouse filters.
  - `POST /api/tenant/:workspaceId/inventory/opening-stocks` — create a DRAFT session with multi-line variant quantities and unit costs.
  - `GET /api/tenant/:workspaceId/inventory/opening-stocks/:openingStockId` — session detail.
  - `PATCH /api/tenant/:workspaceId/inventory/opening-stocks/:openingStockId` — edit DRAFT reference, notes and lines; posted/cancelled sessions are immutable.
  - `POST .../:openingStockId/post` — atomically post all lines.
  - `POST .../:openingStockId/cancel` — cancel DRAFT only.
- Reused the existing Tenant schema and database objects (`OpeningStockSession`, `OpeningStockItem`, `OpeningStockStatus`, and the unique `posted_warehouse_id` index). A read-only audit confirmed the tables, columns, unique indexes, enum values and runtime CRUD grants already exist in `pos-local`; no migration or Production database write was performed.
- Posting writes StockBalance and InventoryCost, creates `StockMovementType.OPENING` with `StockReferenceType.OPENING_STOCK`, and writes audit events in the same transaction. Opening cost initializes WAC and inventory value directly from quantity × unit cost.
- Safety rules: one posted Opening Stock session per Warehouse; unique variants per draft; positive quantities up to 3 decimals; non-negative unit cost up to 6 decimals; idempotency replay checks the complete payload; changed payload returns conflict; posting is atomic and row-locked; an item with prior movement history or non-empty balance/cost cannot be initialized; a posted session cannot be cancelled.
- Uses existing `commerce.inventory.receive` permission for create/post/cancel and `commerce.inventory.view` for list/detail; no new Control RBAC migration was required.
- Added UI at `/workspace/[slug]/inventory/opening-stock` with multi-line entry, DRAFT editing, CSV import by SKU/quantity/unitCost (including a downloadable template), draft review, post confirmation, cancellation, list/detail and navigation from Inventory/Stocktake. Movement history now displays and filters `OPENING` as “ยอดยกมา”.
- Added `apps/api/scripts/verify-opening-stock-http-e2e.cjs` and `apps/web/e2e/opening-stock-ui.spec.ts`.

### Verification
- API typecheck PASS; API build PASS.
- Web typecheck PASS; Web production build PASS.
- Real API/DB HTTP E2E on `e2e-commerce-20261106` PASS: Inventory Staff create permission, Cashier denied with HTTP 403, create/replay, payload conflict 409, concurrent post (exactly one movement), WAC/InventoryCost/StockBalance reconciliation, movement history filter, one-post-per-warehouse conflict 409, and fixture cleanup.
- Browser UI E2E PASS (1/1). Opening Stock endpoints and supporting catalog/warehouse data are stubbed in this UI test; the separate HTTP E2E above exercises the real API/database.
- API lint could not run because ESLint is not installed in the API workspace. Web lint is currently blocked by the repository's ESLint 9 configuration (no `eslint.config.*`); these are tooling/configuration issues, not passing lint checks.
- No migration, live `pos-local` inventory mutation, deployment, commit or push was performed for this implementation. E2E fixtures were cleaned up.

### Follow-up
1. Completed 2026-11-11: CSV export for selected Opening Stock documents and all-or-nothing bulk CSV validation preview (per-row status/reason; confirm enabled only when every row is valid).
2. Completed 2026-11-11: permission-specific HTTP assertions for Cashier and Viewer on Opening Stock create/edit/post.
3. Keep Opening Stock as a one-time baseline workflow; use Direct Receiving for subsequent inbound stock and Stocktake for physical count reconciliation.

### Follow-up verification — 2026-11-11
- Added DRAFT edit endpoint and UI. PATCH locks the session row, rejects non-DRAFT state, validates active variants and duplicate variants, replaces item lines atomically, and writes a draft-update audit event.
- Preserved create idempotency semantics across edits by storing the original create payload in the `OPENING_STOCK_CREATED` audit metadata. Replaying the original key/payload after an edit still resolves to the original session; a changed payload remains HTTP 409. Legacy DRAFT records receive their original payload snapshot on first edit.
- Added CSV import with case-insensitive SKU matching, duplicate/unknown SKU detection, quantity/cost validation, quoted-field parsing, a 2 MB file-size limit, a 500-item limit, and template download. Import is available when creating or editing a DRAFT.
- API HTTP E2E PASS on `e2e-commerce-20261106`: edit DRAFT, verify edited values, replay original create payload after edit, verify posting, verify PATCH after post returns HTTP 409, reconcile quantity/WAC/inventory value/movement and cleanup.
- Browser UI E2E PASS (1/1): create DRAFT, enter edit mode, import CSV, save edited draft, then post. API/data endpoints remain stubbed in this browser test.
- API typecheck/build PASS; Web typecheck/production build PASS.
- Follow-up: selected document CSV export includes SKU, product/variant, quantity, unit cost, total cost and UOM. CSV import now presents a row-by-row validation preview and only permits all-valid imports; invalid SKU and disabled-confirm behavior are covered by Playwright.
- Browser UI E2E PASS (1/1) including invalid-row preview, successful import confirmation, Draft edit, Post and CSV download.
- No migration, live `pos-local` database write, deployment, commit or push was performed.
- RBAC HTTP E2E extended and PASS: Cashier can read Opening Stock but receives HTTP 403 for create, DRAFT edit and post. The dedicated E2E Cashier membership was temporarily switched to the existing Viewer role to test Viewer; Viewer receives HTTP 403 for list/detail (no `commerce.inventory.view`) and for create/edit/post. The original Cashier role assignment was restored in `finally` and independently verified afterward. No production workspace or production role was changed.
