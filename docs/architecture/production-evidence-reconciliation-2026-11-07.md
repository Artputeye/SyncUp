# SyncUp Production Evidence Reconciliation — 2026-11-07

Status: **Read-only evidence collected; Production Activation Sign-off is not newly granted by this review.**

## Scope and safety

- Reviewed the Control DB and the `pos-local` Tenant DB using PostgreSQL sessions with `default_transaction_read_only=on`.
- Verified both sessions reported `transaction_read_only=on`.
- No DDL, DML, migration, module lifecycle action, deployment, backup creation, restore, or Git operation was performed.
- Existing uncommitted workspace changes were preserved.

## 1. Live migration-ledger evidence

### Control DB

Target identity: `syncup_control`; connected role: `syncup`.

Prisma `_prisma_migrations` contains these successful, non-rolled-back migrations:

- `20261031000100_control_init`
- `20261031000200_platform_admin`
- `202611030001_commerce_store_manage`
- `202611040001_commerce_inventory_manage`
- `202611060001_commerce_inventory_operation_permissions`
- `202611060002_commerce_store_manager_grant`

The historical `20261031000200_platform_admin` row also has one rolled-back attempt followed by a successful row.

**Reconciliation item:** source migrations `202611060003_module_registration_activation` and `202611060004_module_audit_runtime_grants` are not present in the live Prisma migration ledger. However, `module_installations` and `platform_audit_logs` are queryable, and the connected Control role has SELECT/INSERT on `platform_audit_logs`. Determine how these objects/grants reached the database and reconcile the ledger before treating the Control DB migration history as fully consistent.

### Tenant DB — `pos-local`

Control registry identifies Workspace `pos-local` as ACTIVE and maps it to `syncup_ws_c0130bf3c1c0`, runtime role `syncup_rt_c0130bf3c1c0`.

Tenant `tenant_migrations` contains:

- `20261031000100_tenant_baseline`
- `202611030001_tenant_commerce`

This confirms the Commerce Tenant migration is already recorded. Do not reapply migration version `202611030001_tenant_commerce`.

## 2. Candidate SQL reconciliation

Current file: `docs/architecture/tenant-commerce-incremental-upgrade.candidate.sql`

- Current SHA-256: `c70a3bb2c1fc3dfec1c38f1c60ef7e393947e1dd074e7574f9283be372499d8c`
- Current size: 56,238 bytes.
- Historical execution/readiness records identify the candidate used on 2026-11-06 as SHA-256 `836f1af276b908813be9089cb3a2813363820b9e00d3a054d7693af62d2473b3`, size 56,340 bytes.

The historical SQL artifact itself is not present in the current working tree or Git history (the current candidate is untracked). Therefore a byte-level or semantic SQL diff cannot be produced from the available artifacts. The 102-byte size difference and different hashes prove the files differ, but do not identify the SQL changes.

Required before declaring artifact reconciliation complete:

1. Recover the exact historical 56,340-byte artifact from the execution operator's retained copy or approved archive.
2. Compare it against the current candidate and the generator inputs.
3. Preserve both historical and current files/hashes; do not rewrite the historical execution report.
4. Treat the live ledger as authoritative that the migration version is already applied; any required correction must be a separately reviewed forward-only migration.

## 3. Existing backup and recovery evidence

Existing local backup files were found in:

- `D:\\Back up\\SyncUp\\`
- `%LOCALAPPDATA%\\SyncUp\\Backups\\`

The 2026-11-06 execution report records local custom-format archives, SHA-256 verification, and isolated restore rehearsals. It explicitly records that no off-host copy was created and encryption status of the local D: volume was not verified.

No `SYNCUP_BACKUP_CONFIG_FILE` or `SYNCUP_DATA_DIR` override is set in the API environment, and no API-local `backup-location.json` was found. The Synology destination documentation states that its current setting only stores a path and checks directory access; it does not create archives, copy them off-host, encrypt them, schedule retention, or test restore.

**Status: encrypted off-host backup and restore gate remains OPEN.** A fresh archive must not be copied to an assumed location or considered encrypted based only on NTFS ACLs or SHA-256.

## 4. Manager and Store/Branch/Warehouse evidence

Read-only checks returned:

- `manager-e2e@syncup.local`: role `manager`; `modules.manage` permission is present.
- Store: `Main Store` / `main-store` — ACTIVE.
- Branch: `สำนักงานใหญ่` / `HQ` — ACTIVE and default.
- Warehouse: `คลังหลัก` / `MAIN` — ACTIVE and default.

**Important current-state finding:** `pos-local` already has a Commerce module installation with status `ENABLED` and `enabled=true`. The Control DB audit log records `MODULE_INSTALLED` and `MODULE_ENABLED` on 2026-11-05. The previous production activation hold verifier fails because it expects no Commerce installation in `pos-local`.

This review did not install, enable, disable, or otherwise change the module. Activation is therefore not a pending operation according to the live module state; the remaining work is evidence reconciliation and operational assurance.

## 5. Disposition

| Gate | Result |
|---|---|
| Control DB live ledger read | PASS; module-related migration ledger reconciliation OPEN |
| Tenant `pos-local` live ledger read | PASS; Commerce version already applied |
| Historical/current Candidate SQL diff | BLOCKED; historical SQL artifact unavailable |
| Existing local backup/restore evidence | PASS as historical local rehearsal only |
| Encrypted off-host backup + restore | OPEN; destination/encryption not configured or verified |
| Manager permission | PASS |
| Store → Branch → Warehouse hierarchy | PASS |
| Commerce module state | ALREADY ENABLED; audit events present |
| New Production Activation Sign-off | NOT ISSUED by this review |

## 6. Next actions requiring operator input

1. Recover the exact historical Candidate SQL artifact (56,340 bytes; SHA-256 beginning `836f1af2`) for a true diff.
2. Reconcile why Control DB has module registration/audit objects and grants while the corresponding `202611060003` / `202611060004` migration entries are absent from `_prisma_migrations`.
3. Provide/confirm the Synology UNC backup destination and confirm its encryption/key-recovery arrangement. Then perform a fresh encrypted off-host backup and restore into a separate isolated database.
4. Review the already-enabled `pos-local` Commerce state and decide whether it matches the intended approved activation; do not disable or re-enable it as part of evidence review.

No Production migration, module lifecycle change, deployment, commit, or push was performed.
## 7. Local backup location follow-up — 2026-11-07

Operator confirmed that network access is unavailable and requested local storage under `D:\Back up` for now. No NAS/SMB/network connection was attempted.

Verified local directory: `D:\Back up\SyncUp\`

Existing files:

| Archive | Size | SHA-256 | Verification |
|---|---:|---|---|
| `syncup_control_20261106.dump` | 27,291 bytes | `4f769edfa84b0d9b9e92def541271deda625f19ab875b9d834bde6382c402906` | Matches 2026-11-06 execution report; `pg_restore --list` succeeds |
| `pos-local_20261106031011_fec4face.dump` | 4,746 bytes | `0dcc49358efa9405d4648a096649fe20dbfcf4ab12ed9108bd57c1e5e91dfdb6` | Matches 2026-11-06 execution report; `pg_restore --list` succeeds |

The Tenant archive TOC contains only the three Foundation tables (`audit_events`, `tenant_migrations`, `tenant_settings`). It is the pre-Commerce-migration backup documented in the execution report, not a fresh backup of the current Commerce-enabled Tenant state. Do not represent it as a current full Tenant backup.

PostgreSQL 18.6 `pg_dump` and `pg_restore` are available. The two archives are readable custom-format dumps. The historical execution report records isolated restore rehearsals and checksum verification for both archives.

BitLocker status for D: could not be read because `manage-bde -status D:` was denied without administrative rights. Therefore D: encryption remains **UNVERIFIED**. No encryption was applied, no backup was overwritten, no new dump was created, and no database was connected to during this local-storage follow-up.

**Disposition:** Local archive integrity/listing checks PASS; historical restore evidence PASS; current full Tenant backup NOT ESTABLISHED; D: encryption UNVERIFIED; off-host backup remains OPEN and explicitly deferred until network access is restored.
