# SyncUp Workspace Permission Matrix

Date: 2026-11-06
Status: Proposed baseline for Store, Product Catalog and operation-specific Inventory authorization
Scope: Workspace-level authorization only. This matrix does not grant platform administration.

## Authorization boundaries

- **Workspace Owner**: implicit full access within their own ACTIVE Workspace. Ownership is represented by `Membership.isOwner`; it is not a grantable role.
- **Admin**: full set of Workspace permissions. Only the Owner may assign or remove the Admin role.
- **Manager**: operational management across Store, branches, warehouse, catalog, pricing, inventory, sales, orders and reports. Can reverse posted inventory movements. Cannot manage Workspace members, roles, or Workspace settings.
- **Cashier**: POS and sales workflow. Can read Store/product/stock information and create sales; cannot adjust inventory, change prices, void sales, or administer the Workspace.
- **Inventory Staff**: warehouse and stock operations, including reservations, receiving, issue, adjustments, transfers and stocktake. Cannot reverse posted movements, create/void sales, or manage catalog pricing.
- **Member / Viewer (compatibility roles)**: limited to Workspace and member read access. Retained for existing assignments; new operational users should use a named role above.
- **Platform Admin**: separate Control Plane authority enforced by `User.isPlatformAdmin` and `PlatformAdminGuard`. It is not inherited from Workspace roles and must never be added to this matrix.

## Permission matrix

Legend: ✓ allowed; — denied by default. Owner has all permissions by ownership bypass.

| Permission | Owner | Admin | Manager | Cashier | Inventory Staff | Member / Viewer |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| workspace.view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| workspace.manage | ✓ | ✓ | — | — | — | — |
| members.view | ✓ | ✓ | ✓ | — | — | ✓ |
| members.manage | ✓ | ✓ | — | — | — | — |
| roles.manage | ✓ | ✓ | — | — | — | — |
| modules.manage | ✓ | ✓ | ✓ | — | — | — |
| commerce.store.view | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| commerce.store.manage | ✓ | ✓ | ✓ | — | — | — |
| commerce.warehouse.view | ✓ | ✓ | ✓ | — | ✓ | — |
| commerce.warehouse.manage | ✓ | ✓ | ✓ | — | — | — |
| commerce.product.view | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| commerce.product.create | ✓ | ✓ | ✓ | — | — | — |
| commerce.product.update | ✓ | ✓ | ✓ | — | — | — |
| commerce.product.archive | ✓ | ✓ | ✓ | — | — | — |
| commerce.pricing.manage | ✓ | ✓ | ✓ | — | — | — |
| commerce.inventory.view | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| commerce.inventory.reservation.manage | ✓ | ✓ | ✓ | — | ✓ | — |
| commerce.inventory.receive | ✓ | ✓ | ✓ | — | ✓ | — |
| commerce.inventory.issue | ✓ | ✓ | ✓ | — | ✓ | — |
| commerce.inventory.movement.reverse | ✓ | ✓ | ✓ | — | — | — |
| commerce.inventory.adjust | ✓ | ✓ | ✓ | — | ✓ | — |
| commerce.inventory.transfer | ✓ | ✓ | ✓ | — | ✓ | — |
| commerce.inventory.stocktake | ✓ | ✓ | ✓ | — | ✓ | — |
| commerce.sales.view | ✓ | ✓ | ✓ | ✓ | — | — |
| commerce.sales.create | ✓ | ✓ | ✓ | ✓ | — | — |
| commerce.sales.discount | ✓ | ✓ | ✓ | — | — | — |
| commerce.sales.void | ✓ | ✓ | ✓ | — | — | — |
| commerce.orders.view | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| commerce.orders.manage | ✓ | ✓ | ✓ | — | — | — |
| commerce.reports.view | ✓ | ✓ | ✓ | — | ✓ | — |

## Implementation rules

1. Every API endpoint that reads or mutates Workspace business data must declare a permission and enforce it on the server. Hiding a frontend action is not authorization.
2. Permission checks must verify active membership and ACTIVE Workspace status on every request, including requests that use cached Tenant Prisma clients.
3. The Workspace ID must come from a validated route/context and all resource queries must be scoped to that Workspace/Tenant. Never trust a client-supplied resource ID alone.
4. Deny by default. Missing permission metadata must not accidentally expose a business endpoint; apply a controller-level guard or explicit membership policy to each module.
5. Only Owner may assign Admin. Admin may assign operational roles but cannot grant Owner or Platform Admin.
6. Cashier cannot change product master data, prices, inventory balances, or void/discount a sale by default. Discount/void workflows require a separate approval feature before granting these permissions.
7. Inventory Staff can reserve, receive, issue, adjust stock, and perform transfers/stocktakes, but cannot reverse posted stock movements or create sales.
8. Reversal of a posted stock movement is a higher-risk operation reserved for Manager, Admin and Owner.
9. Platform Admin permissions remain separate from Workspace RBAC. Platform support access to Tenant data requires a separately audited support workflow.
10. Legacy `member` and `viewer` roles remain available for compatibility; migrate assignments deliberately after user acceptance, not by silently changing existing roles.

## Store, Product Catalog and Inventory API permission mapping

| API capability | Required permission |
|---|---|
| List/view Store and branches | commerce.store.view |
| Create/update/archive Store or branch | commerce.store.manage |
| List/view warehouses | commerce.warehouse.view |
| Create/update/archive warehouse | commerce.warehouse.manage |
| List/view products and variants | commerce.product.view |
| Create product/variant | commerce.product.create |
| Update product/variant | commerce.product.update |
| Archive/deactivate product | commerce.product.archive |
| Change price lists/base prices | commerce.pricing.manage |
| View on-hand/available stock | commerce.inventory.view |
| Create/release/consume/expire reservations | commerce.inventory.reservation.manage |
| Receive stock | commerce.inventory.receive |
| Issue stock | commerce.inventory.issue |
| Reverse a posted stock movement | commerce.inventory.movement.reverse |

## Explicitly deferred

- Per-branch/per-warehouse scope restrictions (this baseline is Workspace-wide).
- Approval limits for discounts, refunds, voids and stock adjustments.
- Field-level access, sensitive cost/margin visibility and export permissions.
- Custom roles and permission editor UX.
- Audit event requirements and segregation-of-duties policy.
- Actual assignment migration for existing `member` / `viewer` users.

These are deliberate follow-up design items, not implied permissions.
