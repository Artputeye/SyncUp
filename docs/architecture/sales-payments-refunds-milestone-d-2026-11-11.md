# Payments & Refund Ledger — Milestone D

วันที่: 2026-11-11

สถานะ: Implemented and verified on disposable PostgreSQL. Migration is a candidate only; no registered Tenant database was changed.

## Scope delivered

- Candidate migration: `apps/api/prisma/tenant/migrations/20261111000300_tenant_sales_payments_refunds.sql`.
- Tenant schema: `SalesPaymentMethod`, `SalesPaymentStatus`, `SalesPayment`, `SalesRefund`, with relations to SalesOrder, SalesReturn and Payment.
- Payment methods: CASH, CARD, BANK_TRANSFER, OTHER.
- Payment statuses: CAPTURED, PARTIALLY_REFUNDED, REFUNDED.
- Routes:
  - `POST /api/tenant/:workspaceId/orders/:orderId/payments`
  - `GET /api/tenant/:workspaceId/orders/:orderId/payments`
  - `POST /api/tenant/:workspaceId/orders/:orderId/returns/:returnId/refunds`
  - `GET /api/tenant/:workspaceId/orders/:orderId/returns/:returnId/refunds`
- Payment record is accepted only for a POSTED Order; multiple tenders are supported and cumulative payments cannot exceed Order total.
- Refund must reference a POSTED Return and a Payment belonging to the same Order, with matching currency.
- Refund cap is enforced twice: cumulative refunds for a Return cannot exceed its total amount; cumulative refunds against a Payment cannot exceed its captured amount.
- Order row lock serializes payment/refund balance changes. Payment and Refund writes, status changes and audit records are atomic.
- Idempotency keys are bound to normalized payloads; exact replay returns the original record, changed payload conflicts.
- Permission metadata: record Payment uses `commerce.sales.create`; view Payment/Refund uses `commerce.orders.view`; create Refund uses `commerce.sales.void`. No role grants were changed.

## Verification

- API typecheck PASS.
- Prisma schema validate PASS.
- Prisma Client generate PASS.
- `npm run test:sales-orders` PASS; it builds API and executes integration tests on disposable localhost PostgreSQL with migrations 001 + 002 + 003.
- Tests cover split tender (cash + card), overpayment rejection, exact replay / changed-payload conflict, partial Refund, multiple refunds against one Return, one Return refunded across multiple Payments, per-Return and per-Payment caps, status transitions, list endpoints, ledger sum reconciliation, controller permission metadata and database cleanup.
- Existing Order creation, reservation, posting/WAC, Returns, tax, idempotency and concurrency regression tests also PASS.
- These are service-level integration tests and controller decorator metadata assertions, not a full HTTP/Auth/RBAC E2E test.

## Important boundaries

- This is an internal record of a manually confirmed receipt/refund. It does not charge a card, verify a bank transfer, call a QR/payment gateway, send money to a customer, or process provider webhooks.
- No Payment Gateway adapter, settlement/reconciliation job, cash drawer accounting, journal posting or external transaction status lifecycle is included.
- No UI was added.
- Migration `20261111000300_tenant_sales_payments_refunds` is not applied to `pos-local` or any registered Tenant database. Apply only after separate explicit approval naming the exact workspace and migration.
- No Control/Tenant DB mutation, RBAC grant change, deployment, commit or push was performed.
