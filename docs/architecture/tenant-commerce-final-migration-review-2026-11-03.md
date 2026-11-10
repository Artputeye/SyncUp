# Tenant Commerce Final Migration Review — 2026-11-03

Status: **PostgreSQL candidate tests passed; final review prepared; Migration Sign-off NOT GRANTED.**

## 1. Disposable PostgreSQL acceptance

The user ran `npm run test:tenant-migrations` from `apps/api`. The command completed successfully:

- `PASS Clean install: Store/Branch/Warehouse lifecycle constraints and atomic default replacement`
- `PASS Incremental upgrade: Store/Branch/Warehouse lifecycle constraints and atomic default replacement`
- `PASS Incremental upgrade: baseline row retained, migration ledger recorded, duplicate-application guard active`
- `PASS Disposable PostgreSQL verification completed for both candidates.`

The script's build phase (`nest build`) also completed successfully. This is evidence of PostgreSQL execution on the configured localhost disposable instance. It is not evidence of production/real-Tenant execution or restore testing.

## 2. Candidate inventory and disposition

| Artifact | Purpose | Disposition |
|---|---|---|
| `tenant-commerce-clean-install.candidate.sql` | Commerce DDL for a fresh Tenant schema, layered on the existing foundation baseline | Tested; review candidate only |
| `tenant-commerce-incremental-upgrade.candidate.sql` | Preflight exact baseline, add Commerce objects, record `202611030001_tenant_commerce` | Tested; review candidate only |
| `tenant-commerce-custom-constraints.candidate.sql` | Inventory, effective-date, quantity, partial-index and other invariants | Included in tested candidate path |
| `tenant-canonicalization-constraints.candidate.sql` | Slug/code/QR integrity checks | Included in tested candidate path |
| `tenant-branch-warehouse-lifecycle.candidate.sql` | Deferred Store/Branch/Warehouse lifecycle invariants | Included in tested candidate path |
| `202611030001_commerce_store_manage/migration.sql` | Control DB permission registration and admin role grant | Separate Control DB migration; not applied |

Both Tenant candidate paths ran on disposable PostgreSQL. The Incremental Upgrade test confirmed the baseline migration ledger row remained, the Commerce version was recorded, and a duplicate-application attempt was rejected.

## 3. Final review findings

### Accepted for candidate scope
- Tenant baseline is preserved by the incremental candidate; it does not recreate the three baseline tables.
- Candidate SQL is wrapped in a transaction. A failure before COMMIT should roll back transactional DDL and ledger changes.
- Incremental preflight refuses a missing baseline, existing Commerce tables, or an already-recorded Commerce version.
- Default Branch/Warehouse lifecycle invariants and atomic replacement passed the disposable PostgreSQL harness.
- `btree_gist` extension creation and dependent exclusion constraints were exercised by the successful candidate run on that test instance.
- Barcode remains text and leading zeroes are preserved. QR payload is treated as opaque exact text; hash is generated from exact UTF-8 bytes.

### Remaining release blockers / explicit scope limits
1. **Disposable restore rehearsal completed; target-specific recovery remains open.** A 2026-11-04 PostgreSQL 18.6 rehearsal demonstrated custom-format backup and restore into a separate isolated disposable database. A fresh backup and restore of the actual named Tenant is still required before rollout.
2. **Control DB permission migrations tested on disposable databases; not applied to the real Control DB.** Store and Inventory permission migrations passed idempotency and admin-only grant checks. The real Control DB still has neither Commerce permission key nor either migration recorded.
3. **Canonicalization integrations are partial.** Store/Branch/Warehouse write APIs use shared canonicalizers. Product/SKU, Barcode, QR, Category, UOM, CSV import and image-folder import handlers are not yet present; those integrations remain future work and must be completed before those write/import features are released.
4. **Commerce API integration coverage is not implied by SQL harness success.** The harness validates candidate SQL and lifecycle invariants, not full authenticated HTTP-to-Tenant DB behavior for every endpoint.
5. **Domain scope remains bounded.** Order, payment, refund, fulfillment and return domains remain outside the current Tenant schema candidate, as recorded in the migration reconciliation document.
6. **Operational compatibility must be checked at rollout.** Confirm target PostgreSQL version, extension availability/permissions, runtime-role grants, maintenance window, available disk, and application version compatibility for each Tenant before deployment.

## 4. Backup, recovery and rollout safeguards

### Before any real Tenant migration
- Identify the exact Tenant DB and confirm its Workspace is in an approved maintenance state.
- Take a consistent database backup using the approved DBA/hosting procedure. Record backup identifier, timestamp, database identity and retention location.
- Restore that backup into a separate isolated database and verify connectivity, baseline tables, migration ledger, row counts and application-critical data.
- Confirm the restored database is isolated and cannot be reached by the application runtime.
- Capture pre-migration schema/ledger state and operational health metrics.
- Verify the deployment artifact checksum/revision matches the reviewed candidate.
- Confirm the Tenant runtime role is not being used to run DDL; use the approved provisioner/DBA identity.

### During migration
- Run only the approved candidate against the explicitly identified Tenant DB.
- Stop immediately on any preflight failure, unexpected object, permission/extension error, lock/timeout, or validation error.
- Do not bypass preflight or manually mark the migration ledger as applied.
- Do not run Clean Install against an existing Tenant. Use Incremental Upgrade only for the exact supported baseline.
- Keep the application from serving incompatible writes until schema and application versions are confirmed compatible.

### Recovery
- If the SQL transaction fails before COMMIT, confirm PostgreSQL rolled back and verify the migration ledger is unchanged before retrying.
- If the migration commits but post-migration verification fails, do not attempt an improvised reverse SQL script. Isolate the Tenant and restore the verified pre-migration backup to a new/controlled recovery target under the DBA procedure; reconcile application traffic and data written after the backup before cutover.
- Preserve failed-run logs and database identity for incident review.
- A restore rehearsal is mandatory because a committed schema migration is not automatically reversible by transaction rollback.

## 5. Verification record

- `npm run test:tenant-migrations`: PASS (user-provided terminal output, 2026-11-03).
- `nest build`: PASS as part of the above command.
- Earlier checks recorded: `npm run test:canonicalization`, Prisma schema validation, and `git diff --check` passed before the PostgreSQL run.
- No real Tenant migration was executed by this review.
- No Prisma Client was generated by this review.
- Workspace A/B remain SUSPENDED with databases preserved; POS remains ACTIVE (must be rechecked immediately before any future rollout).

## 6. Sign-off decision

**Migration Sign-off: NOT REQUESTED / NOT GRANTED.**

The two Tenant SQL candidate paths have passed the disposable PostgreSQL acceptance harness. This does not authorize applying either candidate to Workspace A, Workspace B, POS, or any other real Tenant. Sign-off must remain blocked until the Control DB permission migration is independently validated, backup/restore is rehearsed, release blockers above are resolved or explicitly accepted, and the user gives explicit approval for a named target and migration path.


## Continuation note — 2026-11-04

The application layer has advanced beyond the original SQL-focused review with the Stock Reservation / Inventory MVP. The API now exposes membership-scoped reservation, expiry, receiving, direct issue, reversal and balance operations guarded by operation-specific inventory permissions (`commerce.inventory.reservation.manage`, `commerce.inventory.receive`, `commerce.inventory.issue`, `commerce.inventory.movement.reverse`, and `commerce.inventory.view`). The Control DB permission migration set is prepared but has not been applied; operation-specific grants are defined in `202611060001_commerce_inventory_operation_permissions`. The service uses row locks and transactional NUMERIC WAC updates; reservation lifecycle events are intentionally not physical StockMovement rows.

The project plan records a prior passing Disposable PostgreSQL inventory integration run, including concurrency, expiry, rollback, WAC, reversal and HTTP guard coverage. A follow-up review corrected an expiry edge case in `consume()`: the reservation is now checked against database time under its row lock, expired reservations are released, and no SALE movement is posted. The regression was executed against localhost-only Disposable PostgreSQL and PASSed.

Current-session non-database verification passed: API and Web build/typecheck, Control and Tenant Prisma validation, canonicalization tests, Tenant Lifecycle HTTP integration tests and `git diff --check`. Lint remains unavailable due missing API ESLint installation and missing Web ESLint 9 flat configuration.

These application changes do not themselves authorize rollout. Disposable Control DB permission and backup/restore rehearsals have since passed (see Final Preflight update below), but a fresh backup/restore of the actual named Tenant, collation confirmation, operational deployment plan and explicit named-target Migration Sign-off remain outstanding. No real Tenant SQL or Control DB migration was applied, and no Prisma Client was generated. **Migration Sign-off remains NOT GRANTED.**


## Update — 2026-11-04: pos-local Runtime Privilege Audit Remediation

The three privilege deviations previously recorded for pos-local have now been remediated in the named Tenant database only. The Runtime Role is NOINHERIT, PUBLIC no longer has USAGE on schema public, and the Runtime Role has SELECT-only access to tenant_migrations. The change was applied in a guarded transaction after checking database/role/object identity and ownership. A subsequent read-only audit returned zero ERROR findings, and a connection smoke test using the registered Runtime Role confirmed read access to tenant_settings and the migration ledger with the intended privileges.

This closes the specific pos-local privilege-audit blocker. It does not constitute Migration Sign-off. The remaining release gates still include reviewing target PostgreSQL/extension and operational compatibility, confirming any other target Tenant state immediately before rollout, and obtaining explicit named-target Migration Sign-off. No schema migration or deployment was performed.


## Final Preflight update — `pos-local` — 2026-11-04

### Target identity and live read-only observations

- Control DB registry identifies exactly one `pos-local` workspace with status `ACTIVE`.
- Tenant DB: `syncup_ws_c0130bf3c1c0`; Runtime Role: `syncup_rt_c0130bf3c1c0`; registry schema version: `20261031000100_tenant_baseline`.
- PostgreSQL 18.6 (Windows x86_64); encoding UTF8; collation/ctype `English_United States.1252`; database owner `syncup_provisioner`; size approximately 8 MB at preflight.
- Tenant ledger contains only `20261031000100_tenant_baseline`. The three baseline relations are present and owned by `syncup_provisioner`; no Commerce tables are present. This matches the Incremental Upgrade candidate preconditions, not Clean Install.
- Runtime Role is LOGIN/NOINHERIT with no SUPERUSER, CREATEDB, CREATEROLE, REPLICATION or BYPASSRLS; schema USAGE yes/CREATE no; `tenant_migrations` SELECT yes and INSERT/UPDATE/DELETE no.
- No lock-waiting or idle-in-transaction sessions were observed during the snapshot.
- `btree_gist` 1.8 is available and trusted, but is not installed in `pos-local`. Provisioner has database CREATE and public-schema CREATE capability. Extension installation was not attempted.
- Control DB `syncup_control` has neither `202611030001_commerce_store_manage` nor `202611040001_commerce_inventory_manage` recorded, and neither Commerce permission key exists.

### Exact Tenant candidate

- Candidate: `docs/architecture/tenant-commerce-incremental-upgrade.candidate.sql`.
- Migration version: `202611030001_tenant_commerce`.
- SHA-256: `836f1af276b908813be9089cb3a2813363820b9e00d3a054d7693af62d2473b3`.
- Candidate is transactional and includes `CREATE EXTENSION IF NOT EXISTS btree_gist`; it remains review-only.
- Disposable PostgreSQL 18.6 acceptance passed for clean install and incremental upgrade. `npm run test:control-backup-restore` passed on 2026-11-04; a custom-format backup of a disposable Tenant restored to a separate isolated database with schema/data/ledger sentinels verified.
- A separate disposable Control DB check applied both Store and Inventory permission migrations twice; idempotency and admin-only grants passed. Disposable database cleanup check found zero leftover test databases.

### Sign-off disposition

**Final Preflight: PARTIAL PASS — Migration Sign-off remains NOT GRANTED.**

Remaining blockers before real rollout:
1. Target-specific logical backup/restore rehearsal is complete and verified (see record below). Before rollout, confirm retention/storage policy for the retained local backup and Recovery DB, and take a fresh approved backup immediately before the eventual deployment.
2. Confirm that `English_United States.1252` is the intended database collation/ctype for this Tenant and application.
3. Define maintenance window, application release revision/checksum, deployment/rollback operator and traffic/write-freeze plan.
4. Decide and separately authorize the two Control DB permission migrations; they are tested on disposable databases but remain unapplied to `syncup_control`.
5. Obtain explicit Migration Sign-off naming `pos-local`, the Incremental Upgrade candidate above, and its SHA-256.

No SQL, extension installation, migration, DML, Prisma Client generation or deployment was performed against `pos-local` or the real Control DB during this Final Preflight.

## Target-specific Backup/Restore Rehearsal — `pos-local` — 2026-11-04

- Source Workspace: `pos-local` (ACTIVE); source DB: `syncup_ws_c0130bf3c1c0`; owner: `syncup_provisioner`.
- PostgreSQL 18.6; UTF8; collation/ctype `English_United States.1252`; source database size: 8,410,815 bytes.
- No other sessions, lock waits or idle-in-transaction sessions were observed at the source snapshot.
- Custom-format backup: `%LOCALAPPDATA%\SyncUp\Backups\pos-local_20261104075738_5bab7de0.dump`.
- Backup created 2026-11-04 14:57:40.615 +07:00; size 4,746 bytes.
- SHA-256: `e70190385bf33d614892cc37c41349e0f002479a16ba830cc4723aa9c27d21d5`.
- Restored into separate database: `syncup_recovery_pos_local_20261104075738_5bab7de0`, owned by `syncup_provisioner`.
- Restore checks PASS: exact Recovery DB identity; PostgreSQL version and locale; schema columns/constraints/indexes/extensions; every table's row count and deterministic row-content checksum; exact migration ledger; Runtime Role cannot CONNECT to Recovery DB.
- Source and Recovery each have 3 public tables and 1 total row: `audit_events=0`, `tenant_settings=0`, `tenant_migrations=1`; ledger remains only `20261031000100_tenant_baseline`.
- `pg_restore --list` independently opened the archive and reported 15 TOC entries.
- Recovery DB is isolated: PUBLIC CONNECT revoked and `default_transaction_read_only=on`.
- Backup file and Recovery DB are retained locally pending explicit cleanup approval; no automatic expiry or off-device copy is configured.
- No source DDL/DML, Tenant/Control migration, extension installation, Runtime Role grant, Prisma Client generation or deployment occurred.

The target-specific logical backup/restore rehearsal is now evidenced. Before Migration Sign-off, confirm the intended retention/storage policy, confirm database collation, define deployment/rollback window, separately authorize Control DB permission migrations, and obtain explicit named-target sign-off.


## Owner-approved Backup/Recovery retention policy — 2026-11-05

The Workspace owner approved the following policy for `pos-local` on 2026-11-05:

- Daily backups: retain 30 days.
- Weekly backups: retain 12 weeks.
- Monthly backups: retain 12 months.
- Each pre-migration backup: retain for at least 30 days after successful migration acceptance.
- Rehearsal Recovery DB: retain until an encrypted off-host backup and restore are verified, then retain at least 7 additional days before requesting cleanup approval.
- Maintain one encrypted off-host backup copy and verify SHA-256 on every copy.
- Perform a restore test quarterly.

Approval records the policy only. Operational activation still requires an approved off-host destination and credentials, implementation/verification of retention jobs, and an agreed procedure for quarterly restore tests. No backup was transferred off-host; no expiry job, deletion, cleanup or retention automation was configured. The existing local backup and Recovery DB remain retained.
