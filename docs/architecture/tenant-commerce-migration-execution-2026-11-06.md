# SyncUp Commerce Migration Execution Report — 2026-11-06

Status: **COMPLETED — 5/5 migrations applied and post-migration checks passed**

Execution date: 2026-11-06 (Asia/Bangkok, ICT)
Scope: 4 Control DB migrations + 1 Tenant DB migration
Target Tenant: `pos-local`
Tenant database: `syncup_ws_c0130bf3c1c0`

This report records the actual execution and supersedes earlier readiness notes that stated the migrations had not yet been applied.

## 1. Backup and recovery gate

Backup directory selected by the operator:

`D:\Back up\SyncUp\`

| Database | Backup file | Size | SHA-256 |
|---|---|---:|---|
| Control | `syncup_control_20261106.dump` | 27,291 bytes | `4f769edfa84b0d9b9e92def541271deda625f19ab875b9d834bde6382c402906` |
| Tenant `pos-local` | `pos-local_20261106031011_fec4face.dump` | 4,746 bytes | `0dcc49358efa9405d4648a096649fe20dbfcf4ab12ed9108bd57c1e5e91dfdb6` |

Both copied files were re-hashed in the destination directory; the hashes matched the source files. `pg_restore --list` successfully read both archives.

The `D:\Back up\SyncUp` directory and both files have NTFS access entries for the operator's Windows account, SYSTEM, and BUILTIN\Administrators only. Inheritance from the parent directory was removed for this SyncUp backup directory.

### Restore verification

**Control DB**
- Restored `syncup_control` to isolated database `syncup_control_recovery_20261106`.
- PostgreSQL 18.6; UTF8; collation and ctype matched the source.
- 11 tables and 102 rows checked.
- Schema, table data checksums, and Prisma migration ledger matched.
- Recovery database configured with `default_transaction_read_only=on`; CONNECT revoked from PUBLIC.
- Recovery database retained.

**Tenant DB**
- Restored `syncup_ws_c0130bf3c1c0` to isolated database `syncup_recovery_pos_local_20261106031011_fec4face`.
- Schema, data checksums, and migration ledger matched during the backup rehearsal.
- Runtime role connection was denied.
- Recovery database configured read-only by default and CONNECT revoked from PUBLIC.
- Recovery database retained.

Storage limitation: these backups are stored on the local D: volume as requested. No off-host copy was created. BitLocker/encryption status of D: was not verified in this run; do not interpret NTFS ACLs or SHA-256 as encryption.

## 2. Control DB migrations

Target: `syncup_control`
Execution: Prisma 6.16.2 `migrate deploy`

| Migration | Result |
|---|---|
| `202611030001_commerce_store_manage` | Applied |
| `202611040001_commerce_inventory_manage` | Applied |
| `202611060001_commerce_inventory_operation_permissions` | Applied |
| `202611060002_commerce_store_manager_grant` | Applied |

Post-checks:
- All four new migration ledger entries have `finished_at` set and `rolled_back_at` null.
- `prisma migrate status` reports the Control DB schema is up to date.
- Store management is granted to Admin and Manager.
- Inventory reservation, receive, issue, and movement reversal are granted to Admin and Manager.
- Inventory Staff is not granted movement reversal by the migration policy.
- No other Control DB sessions were observed during the final audit.

## 3. Tenant DB migration

Target: `pos-local` / `syncup_ws_c0130bf3c1c0`

Candidate: `docs/architecture/tenant-commerce-incremental-upgrade.candidate.sql`

SHA-256 verified immediately before execution:

`836f1af276b908813be9089cb3a2813363820b9e00d3a054d7693af62d2473b3`

The candidate ran as a transaction and committed successfully. Post-checks:
- Tenant migration ledger contains the original `20261031000100_tenant_baseline` and new `202611030001_tenant_commerce` entries.
- 37 public tables exist.
- Three Store/Branch/Warehouse lifecycle constraint triggers exist.
- 386 public constraints were enumerated.
- All pre-existing baseline rows in `audit_events`, `tenant_migrations`, and `tenant_settings` were compared with the retained pre-migration Recovery DB; baseline data was preserved.
- No other Tenant DB sessions were observed during the final audit.

The first post-migration helper check flagged the expected new Tenant migration-ledger row as a baseline-table difference. The migration was not re-run. A corrected verification compared the original baseline rows against the retained Recovery DB and passed.

## 4. Application validation

After migrations:
- `npm run typecheck` — PASS
- `npm run build` — PASS
- Control Prisma migration status — up to date
- Tenant post-migration ledger, baseline data, lifecycle triggers and table checks — PASS

## 5. Scope boundaries

- No application deployment was performed.
- No Git commit or push was performed.
- No unrelated files or databases were intentionally modified.
- Both Recovery databases were retained; neither is the live application database.

## 6. Operational follow-up

The five approved migrations are complete. Before exposing the updated Commerce workflows to users, perform an application-level smoke test against the running API and UI, especially Store/Branch/Warehouse lifecycle operations and inventory permission boundaries.

Keep the two pre-migration backup archives and Recovery databases until the application smoke test is accepted. Consider a separate off-host copy and disk encryption according to the operator's recovery and device-loss requirements.
