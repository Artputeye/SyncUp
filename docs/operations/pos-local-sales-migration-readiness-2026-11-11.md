# pos-local — Sales Migrations Readiness & Rehearsal

Date: 2026-11-11
Status: **REHEARSAL PASS — NOT APPLIED TO pos-local**

## Scope

Prepared the three Sales Tenant migration candidates for a future, separately approved activation in Workspace `pos-local`:

1. `20261111000100_tenant_sales_orders`
2. `20261111000200_tenant_sales_returns`
3. `20261111000300_tenant_sales_payments_refunds`

This task was limited to read-only inspection of the registered Workspace and Tenant, a fresh local custom-format backup, and migration rehearsal on a disposable database restored from that backup.

## Exact live baseline (read-only)

- Workspace: `pos-local`
- Workspace ID: `c0130bf3-c1c0-4dfa-a915-7ca5155cacfd`
- Tenant DB: `syncup_ws_c0130bf3c1c0`
- Runtime role: `syncup_rt_c0130bf3c1c0`
- Source DB session: `syncup_provisioner`, `transaction_read_only=on`
- Existing Tenant ledger:
  - `20261031000100_tenant_baseline`
  - `202611030001_tenant_commerce`
  - `20261107000100_tenant_inventory_stocktake`
- `product_variants.tax_category_id`: absent
- Sales candidate tables/types: absent

Control registry identity and Tenant identity matched the expected Workspace. The source was never opened for a write transaction.

## Fresh backup

- File: `D:\Back up\SyncUp\Backups\pos-local_pre_sales_20261111072507.dump`
- Manifest: `D:\Back up\SyncUp\Backups\pos-local_pre_sales_20261111072507.manifest.json`
- Format: PostgreSQL custom archive
- Size: 132,122 bytes
- SHA-256: `2abc971ecc0e1362a35f5da13230fd5c31eba22795c147814ed788b36d458901`
- `pg_restore --list`: PASS
- Hash re-verification after rehearsal: PASS

**Storage security limitation:** This is a local backup only. The host's BitLocker protection was previously found Off, so this backup must not be described as encrypted or secure-at-rest. No off-host encrypted copy or key-recovery arrangement was created as part of this task.

## Migration checksums and order

| Order | Migration | SHA-256 |
|---:|---|---|
| 1 | `20261111000100_tenant_sales_orders` | `5bf9eaed524b37d39b3ce0aa4881235fca85a819b226213ba161e1e3fdd6244a` |
| 2 | `20261111000200_tenant_sales_returns` | `c5af8a5e5e1b67e78b96e5e8fddd9d7a574e847a381e2bb0bd7f48c9fd2b2081` |
| 3 | `20261111000300_tenant_sales_payments_refunds` | `b80fb997628e5d545e2ab46bf3ba4351437bc067c980e758cdc8a8da475425ee` |

Dependency order is required: Orders creates the Order/Item foundation and tax-category reference; Returns references Orders, Order Items and SALE movements; Payments/Refunds references Orders and Returns.

## Disposable restore and rehearsal

Command:

```powershell
cd D:\@Project\SyncUp\apps\api
npm run rehearse:sales-migrations
```

The harness restored the fresh backup into `syncup_sales_rehearsal_20261111072507_144195`, applied each candidate SQL and corresponding `tenant_migrations.version` ledger entry transactionally, and then verified:

- All 3 migration ledger entries appended in the expected order.
- 7 Sales tables (including `order_sequences`).
- 4 Sales enum types.
- `product_variants.tax_category_id` exists.
- 3 posting columns and 2 WAC cost snapshot columns exist.
- 20 foreign-key constraints and 29 indexes across the Sales tables.
- All 6 business tables are empty after DDL-only migration.
- Runtime role can connect/use schema and has DML on Sales tables.
- Runtime role can SELECT `tenant_migrations` but cannot INSERT into it.
- Runtime table and sequence default privileges were configured in the disposable clone for the rehearsal.
- Rehearsal database was dropped; a separate catalog check confirmed it no longer exists.

## Live Runtime Grants inspection

Read-only inspection of the actual `pos-local` Tenant confirmed:

- Runtime role has database CONNECT and schema USAGE.
- Runtime role has SELECT/INSERT/UPDATE/DELETE on an existing Stocktake table.
- Runtime role has SELECT on `tenant_migrations` and INSERT is denied.
- Provisioner default privileges grant runtime DML on new tables (`arwd`) and sequence SELECT/USAGE (`rU`).

The rehearsal independently checked equivalent required privileges on the newly created Sales tables. No grants were changed in the registered Tenant.

## Final safety result

- `POS_LOCAL_SALES_MIGRATION_READINESS=PASS`
- Backup hash and archive validation: PASS
- Migration rehearsal: PASS
- Runtime grant compatibility: PASS
- Disposable DB cleanup: PASS
- Live source post-check: still has the original 3-entry ledger, no Sales tables and no `tax_category_id`; read-only mode confirmed.
- Control DB and registered Tenant were not mutated.
- No production migration, role change, deployment, commit or push occurred.

## Activation gate

**Do not apply these migrations yet.** This report establishes that the current candidate set can be restored and executed in the expected order on a clone of the present `pos-local` state. Actual activation still requires a separate explicit approval naming `pos-local` and all three migration versions. Before that execution, create a fresh backup (the current backup is a rehearsal artifact and will become stale), verify its checksum, run the guarded live executor under the approved window, and perform post-migration schema/ledger/runtime-grant plus HTTP regression checks.

The local backup is not a substitute for the outstanding encrypted off-host backup requirement.
