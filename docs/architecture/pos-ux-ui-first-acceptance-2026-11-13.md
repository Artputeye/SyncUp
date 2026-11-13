# POS-5 — POS E2E & Production Acceptance

Date: 2026-11-13

## Scope

Acceptance verification for the POS UX/UI-first workflow from product discovery through checkout, payment, receipt preview/reprint, and Sales API authorization. All browser POS/Orders tests use mocked HTTP responses. Sales API service and HTTP/RBAC suites use disposable test databases/workspaces and perform their documented cleanup.

## Verification results

| Check | Result |
|---|---|
| Web TypeScript typecheck | PASS |
| Web production build | PASS; POS and Orders routes compiled |
| POS + Orders Playwright | PASS 9/9 |
| API Sales service E2E | PASS |
| API Sales HTTP/Auth/RBAC E2E | PASS |
| Git diff check | PASS |
| Web ESLint | BLOCKED by repository configuration; ESLint 9 requires eslint.config.js/.mjs/.cjs and none is present |

### Browser coverage

- Sellable catalog loads; product search accepts SKU/barcode.
- Out-of-stock product cannot be added; empty catalog state is displayed.
- Cart is usable at mobile viewport.
- Order creation, posting and Payment execute in the required order.
- Failed Payment resumes after reload using the same Payment idempotency key; Order and posting are not duplicated.
- Payment is not called before successful posting.
- Failed posting retries with the same posting key; Payment is only called after posting succeeds.
- Orders UI covers Order creation/post/payment, receipt preview/reprint entry, return and refund UI flows.

### API service coverage

- Server-side price/tax snapshots and atomic stock reservations.
- Idempotency replay and changed-payload conflict.
- Multi-line rollback, cancellation release, posting/WAC snapshots and rollback.
- Payments, refunds, returns, balance/quantity caps and ledger reconciliation.
- Concurrency for posting, idempotency and stock reservation.
- Disposable database cleanup PASS.

### HTTP/Auth/RBAC coverage

- Unauthenticated and invalid-Origin requests rejected.
- Owner, Manager, Cashier and Viewer role behavior verified.
- Cashier can create/post/pay but cannot void, return or refund.
- Viewer without required permissions cannot list or create Orders.
- Sales lifecycle, idempotency, WAC, payments, returns and refunds verified over HTTP.
- Disposable workspace and Control records cleanup PASS.

## Acceptance boundary / production blockers

POS-5 automated technical checks pass, but this is not approval to open the POS for live trade.

1. The POS Playwright tests mock API responses; no live sale, reservation, stock posting, Payment or receipt was created.
2. No live database-backed POS catalog request was made against a configured sellable Store.
3. Real product master data, published Store listings, valid UOMs, current prices, tax configuration and opening stock still need business review and controlled intake.
4. Seller legal identity/address/tax ID, receipt numbering and tax-invoice requirements remain unconfigured. The current document is a receipt, not a tax invoice.
5. Browser print is supported; direct ESC/POS, USB/Bluetooth printer integration, cash drawer, card gateway charging, bank-transfer verification and cash reconciliation are not implemented.
6. Production backup protection remains a blocker: available backups are local and unencrypted, and backup storage protection was not verified as enabled.
7. Web ESLint remains blocked by the missing ESLint 9 flat configuration.

## Safety and change boundary

- API service and HTTP/RBAC suites used disposable test resources; both cleanup checks passed.
- No live POS transaction or inventory write was performed.
- No migration, RBAC change, deployment, commit or push was performed in this phase.
- Existing unrelated working-tree changes were preserved.

## Decision

**POS-0 through POS-4 implementation and POS-5 automated technical verification: PASS.**

**Production activation: NOT APPROVED / NOT READY** until the blockers above are resolved and the business owner explicitly approves a controlled live acceptance test.
