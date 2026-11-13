# Sales Orders — Milestone F: HTTP / Auth / RBAC E2E

Date: 2026-11-11

## Objective

Verify the Sales Orders, Returns, Payments and Refunds APIs through a real NestJS HTTP process, with actual session authentication, workspace membership and permission enforcement. All tenant schema changes and business fixtures are isolated to a newly provisioned disposable Workspace.

## Test harness

- Script: `apps/api/scripts/verify-sales-orders-http-rbac-e2e.cjs`
- Command: `npm run test:sales-orders-http`
- The command builds the API, provisions a uniquely named temporary Workspace through the normal provisioning service, and starts a separate API process on a dedicated test port.
- The disposable Tenant receives the commerce candidate schema and Sales Orders candidate migrations 001–003. It is not an existing E2E or production Workspace.
- The harness creates unique Owner, Manager, Cashier and Viewer test users and membership-role assignments; logs in through `POST /api/auth/login`; and sends the session cookie plus the configured Web Origin to protected endpoints.
- A published Store Product, sellable BASE UOM, active VAT profile/rate, current price, Stock Balance and Inventory Cost are seeded only in the disposable Tenant.

## HTTP / authentication assertions

| Scenario | Expected | Result |
|---|---:|---|
| Unauthenticated Orders list | 401 | PASS |
| Write request with invalid Origin | 401 | PASS |
| Owner can list Orders | 200 | PASS |
| Manager can list and view Orders | 200 | PASS |
| Manager creates Order and reserves stock | 201 | PASS |
| Exact create idempotency replay | 201 + replay flag | PASS |
| Changed payload with same key | 409 | PASS |
| Manager cancels a RESERVED Order | 201 | PASS |
| Manager posts Order and consumes reservation | 201 | PASS |
| Posted Order exposes WAC cost snapshot | Present | PASS |
| Manager records Payment | 201 | PASS |
| Overpayment | 409 | PASS |
| Manager creates partial Return and lists it | 201 / 200 | PASS |
| Manager creates Refund and lists Refund Ledger | 201 / 200 | PASS |
| Cashier reads Orders and details | 200 | PASS |
| Cashier creates, posts and records Payment | 201 | PASS |
| Cashier attempts cancellation | 403 | PASS |
| Cashier attempts Return | 403 | PASS |
| Cashier attempts Refund | 403 | PASS |
| Viewer without Orders/Sales permissions lists Orders | 403 | PASS |
| Viewer attempts Order creation | 403 | PASS |

The test covers the implemented role matrix: Cashier has `commerce.sales.create` and `commerce.orders.view`, but not `commerce.sales.void`; Viewer has neither Orders view nor Sales create. Owner access is verified through owner membership.

## Data assertions

After HTTP requests, the harness independently queries the disposable Tenant and verifies the expected committed business records:
- 3 Orders, 3 Order Items
- 2 Payment records
- 1 Sales Return
- 1 Refund
- 2 SALE stock movements

The API service integration suite remains complementary and covers rollback, concurrency, WAC reconciliation, multi-line atomicity, replay safety and return/refund quantity/value caps.

## Cleanup and safety

The harness shuts down its isolated API process and disconnects test clients before cleanup. It then:
- Drops the disposable Tenant database and runtime PostgreSQL role, and verifies both are absent.
- Deletes the temporary Workspace and workspace-specific roles from Control DB.
- Deletes the temporary test users and verifies they are absent.
- Verifies the shared Control permission catalog is unchanged.

The run completed with:
- `SALES_ORDERS_HTTP_AUTH_RBAC_E2E=PASS`
- `DISPOSABLE_CONTROL_RECORDS_CLEANUP=PASS`

Only temporary Control records required to register/authenticate the disposable Workspace were created, then removed. No pre-existing Workspace membership, role assignment or Tenant data was changed. No Control or registered Tenant migration was applied. The three Sales Orders Tenant migrations remain candidate files for any registered Workspace and still require separate named-workspace approval, backup and rehearsal before activation.

## Verification

- `npm run typecheck`: PASS.
- `npm run test:sales-orders`: PASS; service integration tests and disposable database cleanup.
- `npm run test:sales-orders-http`: PASS; actual HTTP/Auth/RBAC flow and disposable Workspace cleanup.
- API build: PASS as part of both test commands.
- No deployment, commit or push performed.
