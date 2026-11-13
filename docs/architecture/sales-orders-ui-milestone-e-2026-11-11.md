# Sales Orders — Milestone E: Orders UI / POS Entry

Date: 2026-11-11

## Scope delivered

The Workspace now has an Orders page at `/workspace/[slug]/orders`.

- Create an Order by selecting an active Store, Branch, Warehouse, Product Variant, sellable UOM and quantity.
- The server resolves published Store listing, active price, currency, tax profile and stock availability. Creating an Order reserves stock atomically; the browser does not calculate or trust prices.
- Search Orders by order number and filter by RESERVED, POSTED or CANCELLED.
- View order lines, tax totals, reservation status and (after posting) WAC cost snapshots.
- Post a RESERVED Order to consume its reservations, create SALE movements and snapshot WAC costs; or cancel it to release reservations.
- Record split or partial payment entries using Cash, Card, Bank Transfer or Other.
- Create partial/multiple Sales Returns and view return entries.
- Record Refund Ledger entries against a Return and source Payment.

Navigation links to Orders were added to Workspace home and Product Catalog.

## API integration and safeguards

The UI calls the existing Sales Orders, Returns and Payments endpoints. Authentication and permission checks remain server-side in AuthGuard/RbacGuard. The page does not bypass or replace RBAC.

Order creation, posting, cancellation, return, payment and refund requests use idempotency keys. The server remains authoritative for order totals, available stock, return quantity limits and payment/refund limits.

Payments and refunds are internal ledger records only. No card processor, bank-transfer verification, payment gateway, provider webhook or actual money movement is implemented.

## Pre-migration compatibility

Milestones A–D introduce optional `product_variants.tax_category_id` through a candidate Tenant migration. Existing registered workspaces do not yet have this column. Product Query and Product Command now inspect the current Tenant schema before referencing it:
- Queries return `taxCategoryId: null` while the column is absent.
- Product create/update omit the column while absent.
- Assigning a Tax Category before the migration is present is rejected with a clear conflict response.

This keeps the existing Product Catalog usable before the Sales Orders migration is approved and applied.

## Verification

- API `npm run typecheck`: PASS.
- API `npm run test:sales-orders`: PASS. This builds the API and exercises Orders, Reservations, WAC posting, Sales Returns, Payments, Refunds, idempotency, concurrency, rollback and controller permission metadata on a disposable PostgreSQL database. Disposable database cleanup: PASS.
- Web `npm run typecheck`: PASS.
- Web `npm run build`: PASS; route `/workspace/[slug]/orders` compiled.
- Playwright browser suite: 11/11 PASS with `--workers=1`. New `orders-ui.spec.ts` covers create/reserve, post, payment, return and refund presentation using stubbed API responses.

The Orders browser test remains a UI contract test using stubbed API responses. The missing HTTP/Auth/RBAC/database integration coverage was subsequently completed in Milestone F on a separate disposable Workspace; see `sales-orders-http-auth-rbac-e2e-2026-11-11.md`.

## Database and release status

The following Tenant migrations remain candidate files and have **not** been applied to any registered workspace:

- `20261111000100_tenant_sales_orders.sql`
- `20261111000200_tenant_sales_returns.sql`
- `20261111000300_tenant_sales_payments_refunds.sql`

No Control DB or registered Tenant DB was migrated or modified in this milestone. No role grants changed. No deployment, commit or push was performed.
