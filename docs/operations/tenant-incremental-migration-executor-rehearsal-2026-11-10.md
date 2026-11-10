# Tenant Incremental Migration Executor Rehearsal — 2026-11-10

## Result

**PASS — disposable rehearsal only. Live `pos-local` Tenant was not modified.**

The rehearsal used the pinned backup:

- File: `pos-local_20261107022352_b25ca603.dump`
- SHA-256: `01be3ffae783f2c69bcd764c1cc670018675b96c6dd0ad27e0232e644eb9e53c`
- Workspace: `pos-local`
- Workspace ID: `c0130bf3-c1c0-4dfa-a915-7ca5155cacfd`
- Registered live Tenant DB: `syncup_ws_c0130bf3c1c0`
- Runtime role: `syncup_rt_c0130bf3c1c0`
- Candidate: `20261107000100_tenant_inventory_stocktake`
- Candidate SHA-256: `a32e90622cac76ea16a3bdb16ceb74bb34da048004911cfe1c68fd9c5f255ae9`

## Executor behavior implemented

File: `apps/api/scripts/execute-tenant-incremental-migration.cjs`

1. Rehearsal-only gate; it rejects live execution and accepts only a disposable DB name with the reserved prefix `syncup_stocktake_rehearsal_`.
2. Reads the workspace registration from Control DB in a read-only transaction and verifies exact workspace ID, slug, ACTIVE status, registered Tenant DB and runtime role.
3. Requires local PostgreSQL connections and the expected Control DB.
4. Connects to the rehearsal Tenant as `syncup_provisioner`.
5. Verifies runtime-role existence, CONNECT, schema USAGE and provisioner default table privileges.
6. Acquires the same database advisory lock key used by the existing `TenantMigrationRunner`.
7. Refuses an already-applied or partially-applied Stocktake schema.
8. Applies candidate SQL and inserts the matching `tenant_migrations.version` row in one transaction.
9. Verifies tables, columns, enum values, named constraints, indexes, empty initial data, exactly one ledger row and runtime DML grants. Runtime remains SELECT-only on `tenant_migrations`.

## Rehearsal evidence

The executor was run against a newly restored disposable clone and returned PASS.

| Check | Result |
|---|---|
| Pre-state: Stocktake tables/status enum absent | PASS |
| Pre-state: STOCKTAKE enum value absent | PASS |
| Stocktake session table | 12 columns |
| Stocktake line table | 9 columns |
| StockReferenceType.STOCKTAKE | Present |
| StocktakeStatus | DRAFT, IN_PROGRESS, FINALIZED, CANCELLED |
| Named PK/FK/CHECK constraints | 7 |
| Indexes including PK indexes | 6 |
| Initial Stocktake rows | 0 sessions, 0 lines |
| Tenant migration ledger | Exactly 1 new row |
| Runtime SELECT/INSERT/UPDATE/DELETE on Stocktake tables | PASS |
| Runtime access to tenant_migrations | SELECT only |
| Schema + ledger atomic transaction | PASS |

The rehearsal harness recreated the live provisioner's default ACL and the runtime role's ledger SELECT-only grant inside the disposable clone because the backup restore uses `--no-acl`. Those setup grants were confined to the disposable database.

## Live database safety re-check

After the rehearsal, `audit-pos-local-stocktake-readiness.cjs` ran in read-only mode against the live registered Tenant:

- Database identity: `syncup_ws_c0130bf3c1c0`
- Transaction read-only: `on`
- Stocktake tables: 0
- Stocktake ledger rows: 0
- Tenant ledger rows: 2
- Runtime default table privileges: DELETE, INSERT, SELECT, UPDATE
- One warehouse and two product variants remain present

This confirms the live Tenant remains at its pre-migration state.

## Files created

- `apps/api/scripts/execute-tenant-incremental-migration.cjs`
- `apps/api/scripts/test-tenant-incremental-migration-executor.cjs`
- `docs/operations/tenant-incremental-migration-executor-rehearsal-2026-11-10.md`

## Remaining gate

**Do not run a live migration yet.** The executor is deliberately rehearsal-only. A separate explicit approval is still required for the exact live target and migration. Before enabling live mode, the operational run must also verify a fresh pre-change backup and checksum, retain the advisory lock, apply SQL + ledger atomically as `syncup_provisioner`, and verify runtime grants and schema after commit. API/UI Stocktake E2E on `pos-local` is also still pending.


## Subsequent live execution update — 2026-11-10

The remaining gate described above was subsequently cleared after the user explicitly approved the exact live target and migration. A fresh pre-change backup was created and verified, the executor was extended with guarded live mode, and the Stocktake migration was applied to `syncup_ws_c0130bf3c1c0`. Post-migration read-only verification and authenticated `pos-local` Manager HTTP E2E both passed. See `docs/operations/pos-local-stocktake-migration-apply-2026-11-10.md` for the authoritative live-apply record.
