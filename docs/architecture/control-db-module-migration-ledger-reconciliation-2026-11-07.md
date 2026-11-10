# Control DB Module Migration Ledger Reconciliation — 2026-11-07

Status: **Root cause path identified; live schema and grants verified read-only; execution provenance not independently proven by an operator log. No ledger repair performed.**

## Scope and safety

- Target: Control DB `syncup_control`, connected as `syncup`.
- Each live inspection ran inside an explicit `BEGIN READ ONLY` transaction; PostgreSQL reported `transaction_read_only=on`.
- No DDL, DML, migration, Prisma command, module lifecycle action, deployment, or source database mutation was performed.
- Temporary read-only inspection scripts were removed after use.

## 1. Live Control DB evidence

The live database contains the structural changes defined by source migration `202611060003_module_registration_activation`:

- `module_installations.status` uses enum `ModuleInstallationStatus` with values `INSTALLED`, `ENABLED`, `DISABLED`, `FAILED`.
- The columns `installed_by`, `enabled_at`, `disabled_at`, `last_error`, and `updated_at` exist.
- Constraint `module_installations_status_enabled_check` exists and enforces equivalence between `status='ENABLED'` and `enabled=true`.
- `platform_audit_logs` exists and is queryable.
- The `syncup` role has SELECT/INSERT/UPDATE on `module_installations`, and SELECT/INSERT (but not UPDATE) on `platform_audit_logs`.

The Control Prisma ledger query returned successful entries for `202611060001` and `202611060002`, but **no rows** for:

- `202611060003_module_registration_activation`
- `202611060004_module_audit_runtime_grants`
- `202611060005_inventory_role_matrix_alignment`

Therefore, the missing 003/004 ledger entries are confirmed against the live database at the time of this inspection. The 005 entry is also absent; its runtime/data implications are a separate follow-up and were not inferred from this inspection.

## 2. Likely mechanism explaining the 003/004 discrepancy

Two existing repository scripts explicitly execute the migration SQL outside Prisma Migrate:

1. `apps/api/scripts/verify-and-apply-module-control-migration.cjs`
   - Reads the 003 migration SQL file.
   - Checks the live Control DB identity and preconditions.
   - Creates a custom-format backup.
   - Restores that backup to an isolated rehearsal database and tests the migration/backfill there.
   - Then executes the SQL directly on the source Control DB using a PostgreSQL client transaction.
   - It does not insert a row into `_prisma_migrations` or invoke `prisma migrate deploy`.

2. `apps/api/scripts/grant-module-audit-runtime-access.cjs`
   - Reads the 004 migration SQL file.
   - Executes it directly using an administrative PostgreSQL client.
   - Verifies SELECT/INSERT privileges through the runtime connection.
   - It does not create a Prisma migration ledger entry.

The live schema, constraint, and grants are consistent with the effects of these two migration files. This is a strong and technically plausible explanation for the missing ledger rows: the changes were applied by direct SQL scripts rather than Prisma Migrate.

**Evidence limitation:** repository script contents and matching live database state do not, by themselves, prove which exact script invocation or operator created the live objects. No execution transcript/log with a timestamp and target database identity was located in the reviewed documentation. Treat the mechanism as the likely explanation, not a fully attributed execution record.

## 3. `pos-local` module lifecycle state

A read-only query scoped to Workspace slug `pos-local` returned one Commerce installation:

- Module: `commerce`
- Version: `0.1.0`
- Status: `ENABLED`
- `enabled=true`
- `disabled_at=NULL`

The same Workspace's audit records show:

- `MODULE_INSTALLED` at `2026-11-05T22:48:02.455Z`
- `MODULE_ENABLED` at `2026-11-05T22:48:02.487Z`

Both records refer to the same installation entity and identify module `commerce`, version `0.1.0`, source `bundled`.

This confirms the module is already enabled; this review did not change that state.

## 4. Reconciliation decision

- Do not insert synthetic `_prisma_migrations` rows. A fabricated `finished_at`, checksum, execution timestamp, or migration log would misrepresent historical execution.
- Do not rerun 003 or 004: their effects are already present, and the current state must not be treated as a clean migration precondition.
- Do not mark the ledger consistent yet. The historical execution record needs to be recovered or a separately approved forward-only reconciliation strategy must be designed after a complete schema/grant comparison.
- Preserve the existing backup and restore evidence. The separate encrypted off-host backup gate remains open.
- Review migration 005 separately before any release or deployment that depends on its permission-catalog alignment.

## 5. Next evidence required

1. Recover execution logs/transcripts for the 003 and 004 scripts, including target database identity, timestamps, and script exit status.
2. Compare the complete live schema/grants for 003 and 004 against their source SQL, including indexes, foreign keys, ownership, and role membership/inherited privileges.
3. Determine whether migration 005 has any live effects and whether application code depends on them.
4. Recover the historical Tenant Candidate SQL artifact (56,340 bytes; SHA-256 `836f1af276b908813be9089cb3a2813363820b9e00d3a054d7693af62d2473b3`) before declaring the separate Tenant artifact comparison complete.
5. Keep Production Activation Sign-off blocked until all independent backup, artifact, migration-history, and operational gates are satisfied.

No production migration, ledger repair, module lifecycle operation, deployment, commit, or push was performed.