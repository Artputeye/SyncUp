# Inventory HTTP E2E Results and API Delivery Plan

Date: 2026-11-07

## Scope and safety

- Test target: local E2E Workspace `e2e-commerce-20261106` only.
- Tenant database was resolved from the Workspace database record and its runtime credential was decrypted in-process. No credential was printed.
- All HTTP calls used the running API and the dedicated `e2e-inventory@syncup.local` account.
- A temporary UOM, Product, Variant, StockBalance, and InventoryCost row were created solely for this test. They were deleted in a finally/cleanup block and verified absent afterward.
- No changes to `pos-local`, Production, migration ledgers, schema, deployment, or permissions.

## HTTP test results

Fixture opening state:

| Field | Value |
|---|---:|
| On hand | 10.000 |
| Reserved | 0.000 |
| Available | 10.000 |
| Cost quantity | 10.000 |
| Average unit cost | 5.000000 |
| Inventory value | 50.000000 |

Inventory Staff called the real HTTP endpoints:

- `POST /api/tenant/:workspaceId/inventory/receipts`
- `POST /api/tenant/:workspaceId/inventory/sales`
- `GET /api/tenant/:workspaceId/inventory/warehouses/:warehouseId/variants/:variantId/balance`
- `POST /api/tenant/:workspaceId/inventory/movements/:movementId/reverse`

Assertions:

| Test | Result |
|---|---|
| Inventory Staff login | 201 |
| Initial balance read | 200; 10.000 |
| Receive 5 at unit cost 8 | 201; movement RECEIVING; total cost 40.000000 |
| Receive idempotent replay | 201; `idempotentReplay=true`; no duplicate movement |
| Reconciled state after receive | On hand 15.000; WAC 6.000000; value 90.000000 |
| Issue 4 | 201; movement SALE |
| Issue idempotent replay | 201; `idempotentReplay=true`; no duplicate movement |
| Reconciled state after issue | On hand 11.000; WAC 6.000000; value 66.000000 |
| Issue 100 with insufficient stock | 409; transaction rollback; balance and cost unchanged |
| JSON numeric quantity instead of decimal string | 400; state unchanged |
| Inventory Staff reverses real test receipt | 403; `Missing workspace permission` |

Exactly two movements were recorded for the fixture: one RECEIVING and one SALE. Cleanup removed the movements, audit events, costs, balances, variant, product, and UOM. Post-cleanup counts for all fixture records were zero.

Reproducible local test harness: `apps/api/scripts/verify-inventory-http-e2e.cjs`. It creates its fixture in the E2E tenant only and cleans it in a finally block.

## Current API surface

The current `StockInventoryController` exposes reservations, receiving, issuing/sales, movement reversal, expiry processing, and balance reads. It does not yet expose Adjustment, Transfer, or Stocktake operations. Do not treat the three permission keys as evidence that those workflows already exist.

The tenant Prisma schema already defines movement types `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`, `TRANSFER_IN`, and `TRANSFER_OUT`, plus reference types `ADJUSTMENT` and `TRANSFER`. The existing ledger can represent these movements without adding enum values.

## Proposed API contracts

### 1. Stock adjustment

- `POST /api/tenant/:workspaceId/inventory/adjustments`
- Guard: `commerce.inventory.adjust`
- Request: `{ warehouseId, variantId, countedQuantity, unitCost?, idempotencyKey, reason }`
- Use the absolute physical count as the input; calculate delta against the locked current on-hand quantity.
- Positive variance: require a valid non-negative `unitCost` for the added quantity and update weighted-average cost.
- Negative variance: reduce inventory value using the current WAC; reject if the resulting quantity/cost would be inconsistent.
- Zero variance: return a no-op result without a movement.
- Persist exactly one ADJUSTMENT_IN or ADJUSTMENT_OUT movement, signed quantity delta, reference type ADJUSTMENT, actor, reason, and idempotency identity in the same transaction as balance/cost updates.
- Reject stale/reused idempotency keys with a different payload; lock balance and cost rows.

### 2. Inter-warehouse transfer

- `POST /api/tenant/:workspaceId/inventory/transfers`
- Guard: `commerce.inventory.transfer`
- Request: `{ sourceWarehouseId, destinationWarehouseId, variantId, quantity, idempotencyKey, reason }`
- Require distinct active warehouses and sufficient unreserved source availability.
- Lock source and destination balance/cost rows in deterministic warehouse-ID order to avoid deadlocks.
- Move cost at source WAC: decrease source quantity/value and increase destination inventory using the same transferred total cost, recalculating destination WAC.
- Persist paired TRANSFER_OUT and TRANSFER_IN movements with a shared transfer correlation/reference ID and a stable idempotency strategy. Both sides, both costs, and both balances must commit or roll back together.
- Reject insufficient stock, inactive/missing warehouses, source=destination, malformed decimals, and idempotency conflicts.

### 3. Stocktake

Recommended session-based workflow:

- `POST /api/tenant/:workspaceId/inventory/stocktakes` — create a DRAFT session for one warehouse; guard `commerce.inventory.stocktake`.
- `POST /api/tenant/:workspaceId/inventory/stocktakes/:id/lines` — record counted quantities per variant.
- `POST /api/tenant/:workspaceId/inventory/stocktakes/:id/finalize` — lock and reconcile all lines atomically.
- Store expected quantity at the count snapshot, counted quantity, variance, counter, timestamps, status, and idempotency data. A dedicated stocktake header/line table is needed; these structures do not currently exist in the tenant schema.
- On finalize, detect intervening stock movements since the snapshot. Return a conflict and require recount/reconciliation rather than silently applying a stale count.
- For each non-zero variance, create ADJUSTMENT_IN or ADJUSTMENT_OUT movements and reconcile cost; zero-variance lines create no movement.
- Finalized sessions are immutable. A retry with the same finalize idempotency key returns the original result; a conflicting payload is rejected.

## RBAC and regression matrix

| Role | Adjustment | Transfer | Stocktake | Reverse movement |
|---|---|---|---|---|
| Owner / Admin | Allow | Allow | Allow | Allow |
| Manager | Allow | Allow | Allow | Allow |
| Inventory Staff | Allow | Allow | Allow | Deny (403) |
| Cashier | Deny (403) | Deny (403) | Deny (403) | Deny (403) |

For each new endpoint, add HTTP tests for allowed and denied roles, decimal validation, idempotency replay/conflict, audit evidence, balance/cost reconciliation, transaction rollback, and concurrent requests. Transfer additionally needs a two-warehouse concurrency test; stocktake needs snapshot conflict, zero variance, positive/negative variance, finalize retry, and immutable-finalized tests.

## Delivery order

1. Implement and unit-test adjustment posting against the existing ledger and WAC invariants.
2. Implement transfer posting with deterministic locking and paired ledger movements.
3. Add stocktake session/line tables and a forward-only tenant migration; rehearse and verify the migration before any application. Do not apply it to `pos-local` or Production as part of this plan.
4. Add controller routes and HTTP/RBAC E2E tests for each workflow.
5. Run API build, API typecheck, existing inventory concurrency tests, and new E2E tests.

No Adjustment, Transfer, or Stocktake endpoint or database migration was implemented/applied during this review.


## Execution addendum — 2026-11-07

This addendum supersedes the earlier statements above that Adjustment and Transfer were not implemented.

### Delivered API workflows

- Adjustment: `POST /api/tenant/:workspaceId/inventory/adjustments`, permission `commerce.inventory.adjust`. Supports absolute counted quantity, WAC issue valuation for negative variance, supplied unit cost for positive variance, idempotent replay, reason/audit, and transactional balance/cost updates.
- Transfer: `POST /api/tenant/:workspaceId/inventory/transfers`, permission `commerce.inventory.transfer`. Uses deterministic warehouse lock ordering, paired `TRANSFER_OUT` / `TRANSFER_IN` movements with a shared reference, source-WAC valuation, atomic updates to both warehouses, and idempotent replay.
- No Stocktake API or schema migration has been created/applied.

### Latest HTTP E2E result

`node --env-file=.env scripts/verify-inventory-http-e2e.cjs` completed with `HTTP_INVENTORY_E2E=PASS` against `e2e-commerce-20261106`. It verified receipt, issue, both adjustment directions, transfer, idempotent replays, same-warehouse rejection (400), insufficient stock rollback (409), malformed numeric quantity (400), and Inventory Staff reverse denial (403). The transfer moved 3 units at WAC 6.173913 (total 18.521739), leaving source quantity/value 8.500 / 52.478261 and destination 3.000 / 18.521739. Exactly one paired movement per direction was recorded. Fixture cleanup passed.

### Inventory UI starter delivered

- Route: `/workspace/[slug]/inventory`
- Added a Workspace navigation entry for `คลังสินค้า`.
- UI loads active products/variants and active warehouses using existing authorized catalog/store APIs, shows on-hand/reserved/available for a selected warehouse and variant, and provides receive, issue, adjustment, and inter-warehouse transfer forms.
- Each submission generates a fresh idempotency key; authorization remains enforced by the API.
- Files: `apps/web/src/app/workspace/[slug]/inventory/page.tsx`, `inventory.css`, and `apps/web/e2e/inventory-management.spec.ts`.

### Validation

- API build: PASS.
- Web typecheck: PASS.
- Web production build: PASS; route `/workspace/[slug]/inventory` compiled.
- Playwright Inventory UI smoke: 1 passed.
- API Inventory HTTP E2E: PASS; temporary fixtures cleaned.

### Remaining

1. Add inventory movement history/listing and richer filters once a read endpoint is designed.
2. Add Stocktake session/line API and forward-only tenant migration, with migration rehearsal before any apply.
3. Extend API E2E with Cashier denial, adjustment idempotency conflict, and transfer concurrency cases.

All execution above remained isolated to the local E2E Workspace. No `pos-local` or Production migration, ledger, module lifecycle, or deployment operation was performed.


## Inventory Movement History delivery — 2026-11-07

### Delivered

- Added authenticated read-only endpoint: `GET /api/tenant/:workspaceId/inventory/movements`.
- Requires `commerce.inventory.view`; workspace database is resolved from authenticated membership through the existing database registry.
- Supports filters: warehouse, variant, movement type, inclusive start timestamp / exclusive end timestamp, and search across product name, SKU, variant title, and reason.
- Supports page/pageSize pagination (page size capped at 100), newest-first ordering, and returns movement quantity delta, unit/total cost, reason, reference, reversal link, actor user ID, warehouse, and product/variant details.
- Added UI route: `/workspace/[slug]/inventory/history`, linked from the Inventory page as “ประวัติ Movement”.
- History UI includes search, warehouse/type/date filters, result count, paginated table, signed quantities, costs, reason, and actor ID. It is read-only; reversals remain on the separately permissioned API.
- No tenant schema change or migration is required.

### Validation

- API build: PASS.
- API HTTP E2E on local `e2e-commerce-20261106`: PASS. The inventory fixture produced six expected movements (RECEIVING, SALE, ADJUSTMENT_IN, ADJUSTMENT_OUT, TRANSFER_IN, TRANSFER_OUT); list endpoint returned all six; variant/type/search filters returned the expected single receipt; pagination metadata was verified. Existing receive/issue/adjust/transfer and RBAC checks also passed. Fixture cleanup passed.
- Web TypeScript typecheck: PASS.
- Web production build: PASS; `/workspace/[slug]/inventory/history` compiled.
- Playwright Manager and Inventory Staff navigation/filter-control smoke tests: 2 passed.
- The first Playwright attempt ran while the API was offline and failed at login; the rerun with temporary local API and Web processes passed 2/2. Temporary processes were stopped afterward.
- No `pos-local`, Production, migration ledger, schema, permission, deployment, commit, or push changes were made.


## Stocktake API and UI implementation — 2026-11-07

- Added tenant schema models `StocktakeSession` / `StocktakeLine`, `StocktakeStatus`, relation fields and `StockReferenceType.STOCKTAKE`.
- Added forward-only migration candidate `apps/api/prisma/tenant/migrations/20261107000100_tenant_inventory_stocktake.sql`. It has not been applied to any database.
- Implemented list/create/detail/count/finalize/cancel service methods and HTTP endpoints. Finalization is transactional, checks every line is counted, requires unit cost for positive variance, prevents negative available stock, and rejects stale snapshots.
- Added `/workspace/[slug]/inventory/stocktakes` UI for creating a count session, entering quantities/cost/notes, reviewing variances, and finalizing/cancelling. Added navigation from Inventory.
- Extended `apps/api/scripts/verify-inventory-http-e2e.cjs` with real HTTP assertions for create idempotency, uncounted-line guard, positive-variance cost guard, finalization/replay, WAC, stale-snapshot guard, cancellation, and fixture cleanup. This script must only be run after the user separately approves applying the migration to the E2E tenant.
- Validation: Prisma schema validation PASS; API build/typecheck PASS; Web typecheck/build PASS; Playwright inventory suite 3/3 PASS (Stocktake workflow uses mocked Stocktake API); API integration harness JavaScript syntax check PASS.
- Real API/DB Stocktake E2E remains gated. No migration, tenant DB change, `pos-local`, or Production operation was performed.


## E2E migration and real HTTP verification — 2026-11-07

- User explicitly approved applying the Stocktake migration only to tenant `e2e-commerce-20261106`.
- Applied `20261107000100_tenant_inventory_stocktake` to `syncup_ws_e65ca36b8068` using the workspace database provisioning admin connection, with a tenant-scoped advisory lock and transactional DDL plus migration-ledger insert.
- Migration SHA-256: `a32e90622cac76ea16a3bdb16ceb74bb34da048004911cfe1c68fd9c5f255ae9`.
- Verified PostgreSQL 18.6; migration ledger contains the new version; `stocktake_sessions`, `stocktake_lines`, and `StockReferenceType.STOCKTAKE` exist. Runtime role has SELECT/INSERT/UPDATE/DELETE on both tables and USAGE on `StocktakeStatus`.
- Ran `apps/api/scripts/verify-inventory-http-e2e.cjs` against the live API and E2E tenant: PASS. Receive/issue/adjust/transfer/history tests remained passing. Stocktake create/idempotency, uncounted-line guard (409), positive-variance missing-cost guard (400), finalize and replay, WAC/inventory value, stale-snapshot rejection (409), and cancellation all passed over real HTTP.
- Fixture cleanup passed. Independent post-check confirmed zero Stocktake sessions, lines, Stocktake movements, and Stocktake audit events remain in the E2E tenant.
- Read-only cross-check of `pos-local` confirmed no Stocktake migration-ledger entry and no Stocktake session/line tables. No DDL/DML or migration was executed against `pos-local`. Production was not accessed.
- Temporary one-off guard/apply/post-check scripts were removed after execution; the reusable HTTP E2E harness remains in the repository.

## Real Stocktake browser UI E2E — 2026-11-07

- Added reusable harness `apps/api/scripts/verify-stocktake-ui-real-api-e2e.cjs` to exercise the Manager browser workflow against the running Web, real API, and isolated E2E tenant.
- The browser logged in as the E2E Manager, created a stocktake session, counted 11 against a snapshot of 10, supplied unit cost 7.000000 for the positive variance, saved the count, and finalized the session through the actual UI/API.
- Verified database state after finalize: StockBalance on-hand 11.000; InventoryCost quantity 11.000, WAC 5.181818, inventory value 57.000000; exactly one `ADJUSTMENT_IN` movement with delta 1.000.
- This test exposed precision loss when inventory value was recalculated from the six-decimal rounded WAC. Updated Stocktake positive-variance posting to preserve the exact prior inventory value plus the incoming variance cost, while retaining six-decimal WAC. No schema change or migration was needed.
- Corrected the browser E2E harness to use the actual movement column `quantity_delta` and to delete Movement audit events before deleting the movement rows.
- Final rerun: `UI_CREATE_AND_COUNT_REAL_API=PASS`; `UI_FINALIZE_REAL_API=PASS`; expected WAC/value and movement assertions PASS; fixture cleanup PASS; explicit post-cleanup Stocktake/Movement audit count = 0.
- API typecheck/build PASS; Web typecheck/build PASS; Playwright inventory suite 3/3 PASS, including the mocked UI Stocktake workflow. Web production build includes `/workspace/[slug]/inventory/stocktakes`.
- The test target remained `e2e-commerce-20261106` / `syncup_ws_e65ca36b8068`. No operation was performed against `pos-local` or Production. No deployment, commit, or push was performed.


## Inventory regression and final verification — 2026-11-07

- Re-ran `corepack pnpm --filter @syncup/api exec node scripts/verify-inventory-http-e2e.cjs` against the live API and E2E tenant: PASS. Receive, Issue, Adjustment OUT/IN, Transfer, Movement History, Stocktake, idempotent replays, validation guards, stale-snapshot rejection, cancellation, insufficient-stock rollback, decimal-input validation, and Inventory Staff reverse RBAC all passed. Fixture cleanup passed.
- Cost invariant verified after Stocktake precision fix: Inventory Value preserves exact posted value (`59.478261`) while WAC is rounded to six decimals (`6.260870`). Regression checks assert both persisted values and movement costs; no tolerance was introduced to mask inventory-value drift.
- Re-ran `corepack pnpm --filter @syncup/api exec node scripts/verify-stocktake-ui-real-api-e2e.cjs`: PASS. Manager created, counted, and finalized Stocktake via real browser UI/API; WAC 5.181818, Inventory Value 57.000000, one `ADJUSTMENT_IN` movement; fixture and related audit cleanup verified (`AUDIT=0`).
- API TypeScript typecheck/build: PASS. Web TypeScript typecheck/production build: PASS; inventory, history, and stocktakes routes compiled.
- Playwright `e2e/inventory-management.spec.ts` on Chromium: 3/3 PASS (Manager inventory/history, Inventory Staff inventory/history, Manager Stocktake workflow).
- All live integration/browser tests targeted only `e2e-commerce-20261106` (`syncup_ws_e65ca36b8068`). No new migration was applied; `pos-local` and Production were not accessed or modified. No deployment, commit, or push was performed.


## Inventory security and concurrency hardening — 2026-11-07

- Extended `apps/api/scripts/verify-e2e-inventory-rbac-http.cjs` to exercise Adjust, Transfer, and Stocktake mutation routes in addition to reservation, receipt, issue, store management, and movement reversal. Four E2E roles (admin, manager, inventory_staff, cashier) completed 36 authorization assertions. Cashier was denied all inventory mutation routes with HTTP 403; permitted roles passed RBAC and reached safe input validation. The harness performs no business mutations.
- Extended `apps/api/scripts/verify-inventory-http-e2e.cjs` with idempotency payload-conflict and parallel transfer coverage. Reusing an existing transfer key with a changed quantity/reason returns HTTP 409 and creates no extra movement.
- Two simultaneous requests with the same idempotency key and payload both returned HTTP 201, exactly one response was marked as replay, and only one paired TRANSFER_OUT/TRANSFER_IN movement set was created.
- Two simultaneous transfers with distinct idempotency keys (1 and 2 units) both completed. Source balance reconciled from 7.500 to 4.500; destination reconciled from 4.000 to 7.000; each transfer had exactly one paired movement set. This verifies row-lock serialization without lost updates for the tested scenario.
- Full Inventory HTTP E2E rerun: PASS, including Receive, Issue, Adjustment IN/OUT, Transfer, Movement History, Stocktake, validation/rollback, RBAC negative test, replay, concurrency and fixture cleanup.
- API TypeScript typecheck/build and both test-script syntax checks: PASS. `git diff --check` on changed test scripts: PASS.
- All tests targeted only the dedicated `e2e-commerce-20261106` tenant. No migration, `pos-local`, Production, deployment, commit, or push operation was performed.
