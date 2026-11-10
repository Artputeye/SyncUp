# Control DB Permission + Tenant Backup/Restore Rehearsal — 2026-11-03

## Purpose

This disposable-only verification closes two release gates that are separate from the already-passing Tenant Commerce SQL candidate harness:

1. Apply the Control DB permission migration against a disposable Control DB and verify least-privilege assignment.
2. Exercise a physical PostgreSQL custom-format backup and restore of a disposable Tenant DB into a separate isolated database, then verify schema, Commerce migration ledger and sentinel data.

## Added harness

- Script: `apps/api/scripts/verify-control-migration-backup-restore.cjs`
- Package command: `npm run test:control-backup-restore`
- Requires `TEST_POSTGRES_ADMIN_URL` pointing to localhost only and an account able to create/drop databases.
- Requires PostgreSQL client utilities `pg_dump` and `pg_restore` available on PATH.
- Creates three uniquely named databases: disposable Control DB, Tenant backup source, and isolated restore target.
- Applies only the Control DB baseline migrations and Store permission migration to the disposable Control DB.
- Applies Tenant baseline + Incremental Commerce candidate only to the disposable Tenant source.
- Writes a known Store, Tenant setting and migration ledger row; uses `pg_dump -Fc`, restores with `pg_restore --no-owner --no-acl --exit-on-error`, and verifies the restored DB identity, schema/data sentinels and Commerce ledger.
- Cleans up only the exact databases it created and removes its temporary dump file.

## Control DB assertions

- Migration may be applied twice without creating duplicate permission records or role-permission links.
- `commerce.store.manage` is granted to `admin` only.
- `member` and `viewer` roles do not receive the permission.

## Backup/restore assertions

- Restored database is a different database from the source.
- Store row survives restore.
- Tenant setting sentinel survives restore.
- Commerce migration ledger row survives restore.
- The restore target is verified by `current_database()`.

## Local run instructions

Install PostgreSQL command-line client utilities matching the server's major version (at minimum `pg_dump` and `pg_restore`) and add their `bin` directory to PATH. Confirm:

```powershell
where.exe pg_dump
where.exe pg_restore
```

Then, from `D:\@Project\SyncUp\apps\api`:

```powershell
$env:TEST_POSTGRES_ADMIN_URL = "postgresql://postgres:<LOCAL_PASSWORD>@localhost:5432/postgres"
npm run test:control-backup-restore
```

Use a disposable local PostgreSQL instance only. Do not use a production or real Tenant connection string. Do not post credentials in chat.

## Initial preparation status (superseded by the verification update below)

- Script syntax check: PASS.
- `package.json` JSON parse: PASS.
- `npm run build`: PASS.
- PostgreSQL client binaries: `pg_dump` and `pg_restore` were not found on PATH during preparation.
- Therefore the Control DB permission assertions and physical backup/restore rehearsal have **not yet been executed**.
- No database was created, modified or dropped by this preparation step.
- Migration Sign-off remains NOT GRANTED.


## Verification update — 2026-11-04

The earlier preparation status above is superseded by this execution record:

- PostgreSQL server and client utilities: PostgreSQL 18.6; `pg_dump` and `pg_restore` 18.6 available on PATH.
- API `nest build`: PASS.
- `npm run test:control-backup-restore` from `apps/api`: PASS after the package script was corrected to load `.env`.
- Disposable Control DB Store permission migration: idempotent; `commerce.store.manage` granted only to `admin`.
- Additional disposable Control DB check: Store and Inventory permission migrations were each applied twice; both remained idempotent and each permission was granted only to `admin`.
- Physical custom-format Tenant backup/restore: PASS. `pg_dump -Fc` backup restored with `pg_restore --no-owner --no-acl --exit-on-error` to a separate isolated database; Store row, Tenant setting sentinel and Commerce migration ledger were verified after restore.
- Cleanup verification: zero disposable databases with the harness prefixes remained.
- These are disposable-instance tests only. No backup of the real `pos-local` database was created or restored; no real Control DB migration was applied.
- Migration Sign-off remains NOT GRANTED.

## Actual pos-local target backup/restore — 2026-11-04

This is separate from the disposable-only rehearsal above and closes the target-specific rehearsal step:

- Source: `syncup_ws_c0130bf3c1c0`, Workspace `pos-local`, PostgreSQL 18.6, UTF8, `English_United States.1252`, owner `syncup_provisioner`.
- Backup: `%LOCALAPPDATA%\SyncUp\Backups\pos-local_20261104075738_5bab7de0.dump`; Custom format; 4,746 bytes; created 2026-11-04 14:57:40.615 +07:00.
- SHA-256: `e70190385bf33d614892cc37c41349e0f002479a16ba830cc4723aa9c27d21d5`.
- Recovery target: `syncup_recovery_pos_local_20261104075738_5bab7de0`; isolated, owner `syncup_provisioner`, PUBLIC CONNECT revoked, default transaction read-only.
- Restore checks PASS: database identity/version/locale; schema columns, constraints, indexes and extensions; row count and deterministic row-content checksum for every table; migration ledger; Runtime Role cannot CONNECT to Recovery DB.
- Source and Recovery: 3 public tables; `audit_events=0`, `tenant_settings=0`, `tenant_migrations=1`; ledger only `20261031000100_tenant_baseline`.
- `pg_restore --list` opened the archive successfully; 15 TOC entries.
- Backup file and Recovery DB retained locally pending explicit cleanup approval. No automatic expiry/off-device copy is configured; retention policy still needs owner confirmation.
- Source was read-only throughout; no source DDL/DML, migrations, extension installation, or deployment.
