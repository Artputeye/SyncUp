# Stocktake schema, API and UI delivery — 2026-11-07

## Scope and safety

Prepared the Stocktake workflow for the isolated E2E workspace. The tenant migration is a candidate only and has NOT been applied to E2E, `pos-local`, or Production. Do not run the HTTP integration harness until the user separately approves applying the migration to the E2E tenant.

## Data model

- `stocktake_sessions`: warehouse, status (DRAFT / IN_PROGRESS / FINALIZED / CANCELLED), reference/notes, snapshot timestamp, creator, finalizer, finalized timestamp, and idempotency key.
- `stocktake_lines`: one row per active variant with a stock-balance row in the warehouse; stores system quantity snapshot, nullable counted quantity, optional unit cost for positive variance, and note.
- Unique (session, variant) prevents duplicate lines. Session idempotency key prevents duplicate session creation.
- New `StockReferenceType.STOCKTAKE` links posted stock movements to the originating session.

## API implemented

- `GET /api/tenant/:workspaceId/inventory/stocktakes` — paginated list with warehouse/status filters.
- `POST /api/tenant/:workspaceId/inventory/stocktakes` — create session and snapshot current balances; idempotent.
- `GET /api/tenant/:workspaceId/inventory/stocktakes/:stocktakeId` — session and count lines.
- `PATCH /api/tenant/:workspaceId/inventory/stocktakes/:stocktakeId/lines/:lineId` — save physical count, optional cost and note.
- `POST /api/tenant/:workspaceId/inventory/stocktakes/:stocktakeId/finalize` — atomically reconcile variances and finalize.
- `POST /api/tenant/:workspaceId/inventory/stocktakes/:stocktakeId/cancel` — cancel an open session.

Permissions:
- List/detail: `commerce.inventory.view`
- Create/count/finalize/cancel: `commerce.inventory.stocktake`

Posting safeguards:
1. Every line must have a count before finalization.
2. Positive variance requires explicit unit cost.
3. Negative variance cannot reduce available stock below reservations.
4. Finalization rejects any balance that changed after the stored snapshot.
5. Stock movements, WAC/inventory value, audit events, and FINALIZED status are committed in one transaction.
6. Finalize replay cannot create duplicate movements; finalized sessions are immutable through the API.

## UI implemented

- Route: `/workspace/[slug]/inventory/stocktakes`.
- Create a stocktake, choose warehouse, enter reference and notes.
- Select a session, enter physical count, optional unit cost and note per line.
- Show system quantity and variance.
- Finalize or cancel an open session.
- Navigation link added to Inventory page.

## Validation

- Prisma tenant schema validation: PASS.
- API build and TypeScript typecheck: PASS.
- Web TypeScript typecheck and Production Build: PASS.
- Playwright inventory UI tests: 3/3 PASS, including a mocked end-to-end Stocktake create/count/finalize flow.
- API HTTP integration harness extended with Stocktake coverage and fixture cleanup; `node --check`: PASS.
- Real Stocktake HTTP integration has NOT been executed because the required tenant schema migration has not been applied.

## Next gated step

This original gate has been completed: the user approved and the migration was applied only to the isolated E2E tenant. See the migration and real browser verification addenda below. No operation against `pos-local` or Production was included.

## Real browser E2E and cost precision verification — 2026-11-07

This section supersedes the earlier pre-migration validation and gated-step statements above.

- The Stocktake migration was approved and applied only to E2E tenant `e2e-commerce-20261106`; see the migration verification section in the inventory E2E plan.
- Real Manager browser workflow against the real API/database passed: create session, count 11 against snapshot 10, enter positive-variance unit cost 7, save, and finalize.
- Verified StockBalance = 11.000; InventoryCost quantity = 11.000, average unit cost = 5.181818, inventory value = 57.000000; one `ADJUSTMENT_IN` movement for +1.000.
- Fixed a precision issue in positive-variance posting: preserve the prior inventory value plus the added variance cost instead of recomputing value from the rounded WAC.
- Fixture and associated audit cleanup passed; post-cleanup Stocktake/Movement audit count is zero.
- API typecheck/build, Web typecheck/build, and Playwright inventory UI suite (3/3) passed.
- No `pos-local` or Production changes; no deploy, commit, or push.


## E2E migration and real HTTP verification — 2026-11-07

- User explicitly approved applying the Stocktake migration only to tenant `e2e-commerce-20261106`.
- Applied `20261107000100_tenant_inventory_stocktake` to `syncup_ws_e65ca36b8068` using the workspace database provisioning admin connection, with a tenant-scoped advisory lock and transactional DDL plus migration-ledger insert.
- Migration SHA-256: `a32e90622cac76ea16a3bdb16ceb74bb34da048004911cfe1c68fd9c5f255ae9`.
- Verified PostgreSQL 18.6; migration ledger contains the new version; `stocktake_sessions`, `stocktake_lines`, and `StockReferenceType.STOCKTAKE` exist. Runtime role has SELECT/INSERT/UPDATE/DELETE on both tables and USAGE on `StocktakeStatus`.
- Ran `apps/api/scripts/verify-inventory-http-e2e.cjs` against the live API and E2E tenant: PASS. Receive/issue/adjust/transfer/history tests remained passing. Stocktake create/idempotency, uncounted-line guard (409), positive-variance missing-cost guard (400), finalize and replay, WAC/inventory value, stale-snapshot rejection (409), and cancellation all passed over real HTTP.
- Fixture cleanup passed. Independent post-check confirmed zero Stocktake sessions, lines, Stocktake movements, and Stocktake audit events remain in the E2E tenant.
- Read-only cross-check of `pos-local` confirmed no Stocktake migration-ledger entry and no Stocktake session/line tables. No DDL/DML or migration was executed against `pos-local`. Production was not accessed.
- Temporary one-off guard/apply/post-check scripts were removed after execution; the reusable HTTP E2E harness remains in the repository.
