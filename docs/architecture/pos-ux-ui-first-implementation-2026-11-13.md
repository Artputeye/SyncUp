# POS UX/UI-first implementation — POS-0 through POS-3

Date: 2026-11-13

## POS-0 / POS-1 — Cashier shell

- Added dedicated route `/workspace/[slug]/pos`.
- Kept `/workspace/[slug]/orders` as the back-office Orders management surface.
- Added navigation entry "ขายหน้าร้าน" from Workspace home and Orders.
- Implemented a clean light POS shell with responsive desktop, tablet and mobile layouts.
- Added initial shell Playwright tests.
- No API, database, migration, permission, inventory or payment writes in this phase.

## POS-2 — Product Discovery & Cart

- Replaced demo fixture cards with authenticated Workspace/Store/Branch/Warehouse loading.
- Added `GET /api/tenant/:workspaceId/pos/catalog`, guarded by `commerce.product.view`.
- The POS catalog endpoint returns only ACTIVE products/variants that have PUBLISHED Store and Store Variant listings, an active sell UOM, a current Store-currency price, and valid tax setup (when VAT applies).
- Catalog results include server-resolved unit price, tax rate, currency, UOM conversion and Warehouse available quantity. Available quantity is converted from base UOM into the selected sell UOM.
- POS supports search by product name, SKU, title and barcode; barcode scanners can type into the focused search field.
- Cart supports add, quantity increment/decrement, quantity editing within available stock, and remove. Amounts shown are a client-side estimate; POS-3 re-resolves all values on the server when creating an Order.
- POS-2 creates no Orders, reservations, payments or business records.

### POS-2 verification

- API typecheck/build PASS.
- Web typecheck/build PASS.
- POS Playwright PASS 5/5; Orders UI regression PASS 1/1.
- API catalog query was compile-verified; a live database-backed request against a configured sellable Store was not performed. No live database writes, migrations, RBAC changes, deployment, commit or push.

## POS-3 — Checkout & Payment

- Added a checkout review dialog with payment method selection: CASH, BANK_TRANSFER and CARD.
- Uses the existing Sales API in strict order:
  1. `POST /api/tenant/:workspaceId/orders` — server recalculates price/tax and creates a RESERVED Order while reserving stock.
  2. `POST /api/tenant/:workspaceId/orders/:orderId/post` — posts the Order and consumes reservations, stock and inventory cost.
  3. `POST /api/tenant/:workspaceId/orders/:orderId/payments` — records the full server-returned Order total in the internal Payment Ledger.
- Each stage has a distinct UUID Idempotency Key. The same key and payload are retained for retry; a retry never creates a fresh key for an already-started stage.
- Checkout state is persisted in tab-scoped `sessionStorage` before the first write and after each successful stage. Reload recovery resumes from the last confirmed stage. If create/post/payment response is lost, retry uses the original key so the existing API idempotency behavior can return the prior result.
- Partial-failure guidance distinguishes a RESERVED Order whose posting failed (stock remains reserved and requires an authorized cancellation if unrecoverable) from a POSTED Order whose Payment Ledger write is pending (retry payment only).
- Payment amount is taken from the server-created Order response, not the client estimate. The cashier cannot edit the amount.
- CASH, CARD and BANK_TRANSFER are internal ledger records only. No card gateway charge, bank transfer verification, slip verification or cash-drawer reconciliation is implemented; UI explicitly discloses this.
- After success, the UI shows Order and Payment numbers and clears the cart.
- No new API, database, migration, RBAC, deployment or live business-data changes were made in POS-3.

### POS-3 verification

- Web `npm run typecheck`: PASS.
- Web `npm run build`: PASS; `/workspace/[slug]/pos` compiled.
- POS checkout Playwright: PASS 3/3 (payment retry after reload with same key; payment only after posting; posting retry with same key).
- POS discovery/cart Playwright: PASS 5/5.
- Orders UI regression: PASS 1/1.
- `git diff --check`: PASS.
- POS checkout tests use mocked API responses. No real sale, Order, reservation, stock posting or Payment was created in a live workspace.

## Next

Proceed to POS-4: receipt/print UX and sale completion details, while keeping gateway integration, cash drawer, durable suspended bills and production acceptance as separate readiness gates.


## POS-4 — Receipt & Print UX

- Added a shared receipt preview/print component at apps/web/src/app/workspace/[slug]/pos/receipt-print.tsx, with shared print styling in receipt.css.
- After POS-3 records a Payment successfully, the cashier UI fetches the persisted Order detail and Payment Ledger rows before rendering the receipt. If the follow-up read fails, the sale remains successful and the UI directs the cashier to reprint from Orders.
- The receipt uses persisted Order line items, quantities, unit prices, tax amounts, totals, store/branch/warehouse labels, posting time, Payment numbers/methods/references and refund amounts. The displayed balance is calculated from recorded payments net of recorded refunds.
- Added a print-only 80 mm layout with @page sizing and hides application chrome, modal controls and the disclaimer from the printed sheet. The browser's native print dialog is used; this does not claim direct ESC/POS, Bluetooth, USB or cash-register integration.
- Added reprint access from a POSTED Order detail when at least one Payment Ledger entry exists.
- The document is explicitly labeled as a receipt and states that it is not a tax invoice. No receipt sequence, tax-invoice number, legal seller address, tax ID, logo or legal entity data is fabricated; these remain configuration/requirements work.
- No API, database, migration, RBAC, live Order, Payment or inventory writes were added. The feature only reads the existing Order and Payment endpoints.

### POS-4 verification

- Web npm run typecheck: PASS.
- Web npm run build: PASS; POS and Orders routes compiled.
- POS checkout and Orders UI Playwright: PASS 4/4, including receipt preview after checkout and reprint from Order detail.
- Tests use mocked API data; no live sale or payment was created.
