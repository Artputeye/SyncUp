# Sales Returns — Milestone C implementation

วันที่: 2026-11-11

สถานะ: API/service implementation and disposable PostgreSQL integration tests PASS. Migration is a candidate only; it has not been applied to any registered workspace. No UI or payment-provider refund integration is included.

## Scope delivered

- New candidate migration: `apps/api/prisma/tenant/migrations/20261111000200_tenant_sales_returns.sql`.
- New Prisma models: `SalesReturn`, `SalesReturnItem`, and `SalesReturnStatus`; reverse relations added to Order, Order Item, Warehouse and Product Variant.
- New `SalesReturnsService` and Order routes:
  - `POST /api/tenant/:workspaceId/orders/:orderId/returns`
  - `GET /api/tenant/:workspaceId/orders/:orderId/returns`
- Create Return accepts original `orderItemId` and base-unit quantity. It is permitted only against a POSTED Order and references the exact original SALE movement by its deterministic movement idempotency key.
- Supports partial and multiple returns. All prior return quantities are summed under the Order row lock; cumulative return quantity cannot exceed the original sold base quantity.
- Return amounts are prorated from original Order Item net/tax/gross snapshots using the Order currency precision. The final return for a line takes the remaining monetary amount so multiple partial returns reconcile exactly to the original line amount.
- Inventory is restored atomically: StockBalance on-hand/available increases, InventoryCost quantity/value increases using the original sale's `unit_cost_snapshot`, and WAC is recalculated. Current WAC is not substituted for historical sale cost.
- Creates `SALE_RETURN` StockMovement records referencing the Return document, Return header/items, and `SALES_RETURN_POSTED` audit event in one transaction.
- Idempotency key is bound to normalized order/items/reason payload. Exact replay returns the original Return; changed payload conflicts. Concurrent duplicate requests are resolved by unique-key recovery.
- Permission contract reuses existing `commerce.sales.void` for creating a return (catalog description already includes returns) and `commerce.orders.view` for listing.

## Verification

- `npm run typecheck` PASS.
- `npm run build` PASS (inside `npm run test:sales-orders`).
- `npx prisma validate --schema prisma/tenant/schema.prisma` PASS with a placeholder `TENANT_DATABASE_URL` for schema parsing.
- `npm run test:sales-orders` PASS on a disposable localhost PostgreSQL database. It applies baseline, commerce, Sales Orders and Sales Returns SQL candidates, then tests:
  - Controller permission metadata.
  - Order creation/reservation/posting and WAC snapshots.
  - Partial return followed by a second return completing the sold quantity.
  - Over-return guard, return list, exact idempotent replay.
  - Restored stock quantity, inventory value and historical WAC cost.
  - Return movement types/quantities.
  - Existing Sales Orders regression suite.
  - Disposable database cleanup.
- The integration script tests service/controller metadata directly; it is not yet a full HTTP/Auth/RBAC end-to-end test.

## Explicit limitations / next gates

- This milestone restores inventory and records the monetary value attributable to returned lines. It does not issue a cash/card refund, create Payment/Refund ledger records, or integrate a payment provider. Payment/Refund remains a separate milestone.
- No Orders/Returns UI was added.
- Migration `20261111000200_tenant_sales_returns` is not applied to `pos-local` or any other registered Tenant database. Applying it requires separate explicit approval naming the exact workspace and migration.
- No Control DB, Tenant DB, role grant, deployment, commit or push was performed.
