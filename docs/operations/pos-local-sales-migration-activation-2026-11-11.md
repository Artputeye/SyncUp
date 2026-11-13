# pos-local — Sales Migration Activation Report

Date: 2026-11-11
Status: **APPLIED AND VERIFIED**

## Approval and scope

The user explicitly approved applying exactly these Tenant migrations to Workspace `pos-local`:

1. `20261111000100_tenant_sales_orders`
2. `20261111000200_tenant_sales_returns`
3. `20261111000300_tenant_sales_payments_refunds`

No other Workspace, Control migration, RBAC/permission change, deployment, commit or push was included.

## Target identity

- Workspace: `pos-local`
- Workspace ID: `c0130bf3-c1c0-4dfa-a915-7ca5155cacfd`
- Tenant database: `syncup_ws_c0130bf3c1c0`
- Runtime role: `syncup_rt_c0130bf3c1c0`
- Migration executor: `syncup_provisioner`
- Control DB registration was read-only and matched the exact Workspace/database/runtime-role identity.

## Fresh pre-activation backup

Created immediately before the live apply:

- Archive: `D:\Back up\SyncUp\Backups\pos-local_pre_sales_activation_20261111074409.dump`
- Manifest: `D:\Back up\SyncUp\Backups\pos-local_pre_sales_activation_20261111074409.manifest.json`
- Format: PostgreSQL custom
- Size: 132,122 bytes
- SHA-256: `d6feb9a1647fd6d9bdbc87ed69a1cd7e8727774350c3961b25d92b418f5ced5d`
- `pg_restore --list`: PASS
- Restored to a disposable verification database before activation: PASS
- Restored baseline matched the exact three-entry Tenant ledger; no Sales tables/types or tax-category column existed.
- Restore-check database was dropped and absence verified.
- Backup SHA-256 rechecked after activation: PASS.

Storage caveat: this is a local backup. BitLocker protection was previously found Off, so this file is not represented as encrypted or secure-at-rest. Encrypted off-host backup remains an outstanding operational requirement.

## Migration execution

A guarded executor was added at `apps/api/scripts/activate-pos-local-sales-migrations.cjs` with npm command:

```powershell
npm run activate:pos-local-sales -- --live --confirm-workspace pos-local --confirm-migrations 20261111000100_tenant_sales_orders,20261111000200_tenant_sales_returns,20261111000300_tenant_sales_payments_refunds
```

The executor checks the exact local Control DB, exact Workspace registration, provisioner connection identity, exact approved migration checksums (matching the rehearsed candidates), fresh backup, restore verification, exact pre-migration ledger and a Tenant advisory lock. It applies all three SQL files and inserts all three ledger entries in one database transaction. Any verification failure before commit rolls back the full migration transaction.

Result: `POS_LOCAL_SALES_MIGRATION_ACTIVATION=PASS`.

Migration checksums:

| Migration | SHA-256 |
|---|---|
| `20261111000100_tenant_sales_orders` | `5bf9eaed524b37d39b3ce0aa4881235fca85a819b226213ba161e1e3fdd6244a` |
| `20261111000200_tenant_sales_returns` | `c5af8a5e5e1b67e78b96e5e8fddd9d7a574e847a381e2bb0bd7f48c9fd2b2081` |
| `20261111000300_tenant_sales_payments_refunds` | `b80fb997628e5d545e2ab46bf3ba4351437bc067c980e758cdc8a8da475425ee` |

## Post-migration database verification

A separate post-commit read-only verification confirmed:

- Tenant migration ledger contains exactly six entries: Baseline, Commerce, Stocktake and all three Sales migrations.
- Tenant public table count increased from 39 to 46.
- Seven Sales tables exist: `order_sequences`, `sales_orders`, `sales_order_items`, `sales_returns`, `sales_return_items`, `sales_payments`, `sales_refunds`.
- Four Sales enums have the expected labels.
- `product_variants.tax_category_id` exists.
- All 3 posting columns and 2 WAC cost snapshot columns exist.
- 20 foreign keys and 29 indexes are present.
- New Sales business tables remain empty: Orders, Order Items, Returns, Return Items, Payments and Refunds all have 0 rows.
- Runtime role has CONNECT, schema USAGE and SELECT/INSERT/UPDATE/DELETE on all seven Sales tables.
- Runtime role has SELECT on `tenant_migrations` and cannot INSERT into it.
- Control registration remains unchanged.
- Verification session used `syncup_provisioner` with `transaction_read_only=on`.

## Application verification

API:
- `npm run typecheck`: PASS
- Prisma tenant schema `validate`: PASS
- Prisma tenant client `generate`: PASS
- `npm run test:sales-orders`: PASS, including build and disposable PostgreSQL service integration tests for Orders, Reservations, WAC posting, Returns, Payments, Refunds, idempotency, concurrency and rollback.
- `npm run test:sales-orders-http`: PASS, including build and real NestJS login/session/HTTP/Auth/RBAC tests against a disposable Workspace. Temporary Workspace, users, database and runtime role were cleaned up.
- API health `http://127.0.0.1:4000/api/health`: HTTP success, `{"status":"ok","service":"syncup-api"}`.

Web:
- `npm run typecheck`: PASS
- `npm run build`: PASS
- `npx playwright test e2e/orders-ui.spec.ts --project=chromium`: 1/1 PASS.

These disposable tests do not create Sales records in `pos-local`; the post-migration read-only query independently confirmed all Sales business tables are empty.

## Safety result

- Sales Tenant migrations applied only to `pos-local`.
- Control DB schema/ledger and permissions were not changed.
- No RBAC role grants changed.
- No Sales/Order/Payment/Return/Refund business records created in `pos-local`.
- Fresh backup verified and retained locally.
- No deployment, Git commit or Git push performed.
- Existing uncommitted Milestones A–F changes were preserved.

## Next operational considerations

The Sales database schema is now active in `pos-local`. This does not mean the POS is fully production-ready: confirm the application service is running the newly built API/Web version, perform a controlled Manager/Cashier smoke test in the actual UI when ready, and resolve the encrypted off-host backup requirement before treating the backup posture as production-safe.
