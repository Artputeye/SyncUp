# Control DB Permission Migration Review — 2026-11-06

Status: **Technical review complete; ready for owner decision. Not applied to the real Control DB.**

## Scope

Review of Control Plane permission migrations supporting Store and Inventory authorization. These migrations modify only the Control DB tables `permissions` and `role_permissions`; they do not alter Tenant databases, user accounts, Workspace membership, or Platform Admin authority.

## Reviewed migration set and recommendation

### 1. `202611030001_commerce_store_manage`

**Recommendation: Approve with the follow-up correction below.**

- Creates `commerce.store.manage` and grants it to existing Admin roles.
- Uses `ON CONFLICT` to avoid duplicate permission rows and duplicate role grants.
- Does not grant the permission to Cashier, Inventory Staff, Member or Viewer.
- The original migration is intentionally preserved as immutable history.

### 2. `202611040001_commerce_inventory_manage`

**Recommendation: Approve for compatibility.**

- Creates the legacy broad permission `commerce.inventory.manage` and grants it to Admin only.
- The current Inventory API no longer uses this broad permission; it is retained to preserve compatibility with earlier application releases and existing Control DB data.
- It does not grant inventory write access to Manager, Inventory Staff or Cashier.

### 3. `202611060001_commerce_inventory_operation_permissions`

**Recommendation: Approve.**

- Creates operation-specific permissions:
  - `commerce.inventory.reservation.manage`
  - `commerce.inventory.receive`
  - `commerce.inventory.issue`
  - `commerce.inventory.movement.reverse`
- Grants Reservation, Receive and Issue to Admin, Manager and Inventory Staff.
- Grants Movement Reverse to Admin and Manager only.
- Does not grant inventory write permissions to Cashier.
- Owner retains implicit full Workspace access through the existing ownership bypass; Owner is not represented by a grantable role.

### 4. `202611060002_commerce_store_manager_grant` (follow-up correction)

**Recommendation: Approve together with migration 1.**

- Review found that migration 1 grants `commerce.store.manage` only to Admin, while the approved Workspace RBAC matrix gives Store/Branch/Warehouse management to Manager as well.
- This forward-only migration grants the existing permission to all existing Manager roles across Workspaces.
- The original migration 1 remains unchanged, preserving migration immutability.
- Uses `ON CONFLICT DO NOTHING`; safe to retry.

## Disposable verification

The updated test `apps/api/scripts/verify-inventory-permission-migration.cjs` applies all four migrations twice to a localhost-only disposable PostgreSQL database containing two Workspaces with Admin, Manager, Inventory Staff and Cashier roles.

Verified:
- All four migrations are idempotent.
- Store management is granted to Admin and Manager in both Workspaces.
- Legacy `commerce.inventory.manage` remains Admin-only.
- Reservation, Receive and Issue are granted to Admin, Manager and Inventory Staff.
- Movement Reverse is granted only to Admin and Manager.
- Cashier receives no Store or Inventory write permission.
- Permission keys remain unique.

Result: **PASS**. The disposable test database is dropped by the test script.

## Execution order

Apply the Control DB migrations in timestamp order:

1. `202611030001_commerce_store_manage`
2. `202611040001_commerce_inventory_manage`
3. `202611060001_commerce_inventory_operation_permissions`
4. `202611060002_commerce_store_manager_grant`

The application release that uses operation-specific guards must be deployed in a controlled sequence consistent with the legacy permission compatibility window.

## Safety and approval boundary

- No real Control DB migration was executed.
- No Tenant DB was modified.
- No deployment was performed.
- No migration guard or safety control was disabled.
- This review is a technical recommendation, not authorization to execute.
- Owner approval is still required before applying these migrations to the real Control DB.
