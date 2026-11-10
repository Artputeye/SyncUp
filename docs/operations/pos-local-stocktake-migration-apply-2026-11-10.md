# pos-local Stocktake Migration — Live Apply Report — 2026-11-10

## Result

**PASS — approved incremental migration applied to the live `pos-local` Tenant and verified.**

- Workspace ID: `c0130bf3-c1c0-4dfa-a915-7ca5155cacfd`
- Workspace: `pos-local` (ACTIVE)
- Tenant database: `syncup_ws_c0130bf3c1c0`
- Runtime role: `syncup_rt_c0130bf3c1c0`
- Provisioner role used for DDL: `syncup_provisioner`
- Migration: `20261107000100_tenant_inventory_stocktake`
- Migration SHA-256: `a32e90622cac76ea16a3bdb16ceb74bb34da048004911cfe1c68fd9c5f255ae9`

## Authorization and pre-change backup

The user explicitly approved the live migration for this exact workspace and migration.

A fresh custom-format backup was created before the migration:

- Archive: `D:\Back up\SyncUp\Backups\pos-local_pre_stocktake_20261110044830.dump`
- Manifest: `D:\Back up\SyncUp\Backups\pos-local_pre_stocktake_20261110044830.manifest.json`
- Size: 125,633 bytes
- SHA-256: `b78890368bf2014664c38bb1e817d84f6716f0f8768d37b56010db6ebbe0ac40`
- `pg_restore --list` verification: PASS
- Backup source connected read-only as `syncup_provisioner`.
- Pre-migration state verified: no Stocktake tables, no Stocktake enum, no Stocktake ledger row; exactly two expected Tenant ledger entries.

The archive is a local unencrypted dump. Do not describe it as encrypted or off-host protected.

## Apply procedure

Executor: `apps/api/scripts/execute-tenant-incremental-migration.cjs`

The live execution required explicit exact-match arguments for workspace, migration and backup manifest. It:

1. Revalidated the Control DB workspace registration and exact Tenant database/runtime role.
2. Revalidated the backup manifest, archive SHA-256, archive listing and age (within 24 hours).
3. Connected to the Tenant as `syncup_provisioner`.
4. Acquired the same session advisory lock key as `TenantMigrationRunner`: `pg_advisory_lock(hashtext(databaseName))`.
5. Revalidated the pre-migration schema and exact two-entry ledger baseline.
6. Applied the candidate SQL and inserted the matching `tenant_migrations` row in the same transaction.
7. Verified schema objects and runtime grants before releasing the lock.

Executor result: **PASS / LIVE**. Control DB was read-only and not mutated.

## Post-migration verification

Read-only verifier: `apps/api/scripts/verify-pos-local-stocktake-migration.cjs`

| Check | Result |
|---|---:|
| Stocktake tables | 2 |
| Session columns | 12 |
| Line columns | 9 |
| `StockReferenceType.STOCKTAKE` | Present |
| `StocktakeStatus` | DRAFT, IN_PROGRESS, FINALIZED, CANCELLED |
| Named PK/FK/CHECK constraints | 7 |
| Indexes (including PK indexes) | 6 |
| New Stocktake rows | 0 sessions, 0 lines |
| Tenant migration ledger | 3 entries; Stocktake exactly once |
| Runtime SELECT/INSERT/UPDATE/DELETE on Stocktake tables | PASS |
| Runtime `tenant_migrations` access | SELECT only |
| Pre-migration backup SHA-256 | Unchanged |

## API and inventory/Stocktake HTTP E2E

- API health: HTTP 200 (`{"status":"ok","service":"syncup-api"}`).
- `npm run typecheck`: PASS.
- `npm run build`: PASS.
- Targeted HTTP E2E: `apps/api/scripts/verify-pos-local-stocktake-http-e2e.cjs`.
- Authenticated using the `pos-local` Manager account.
- Receive/Issue/Adjustment/Transfer and movement history: PASS.
- Stocktake create and idempotent replay: PASS.
- Uncounted-line finalization guard: PASS.
- Positive variance unit-cost validation: PASS.
- Finalization and idempotent replay: PASS.
- WAC/inventory value assertions: PASS.
- Stale snapshot conflict and cancel: PASS.
- Transfer concurrency/idempotency guards: PASS.
- Fixture and audit cleanup: PASS; no E2E fixture rows left behind.

The first adapted run exposed that the `pos-local` Manager is permitted to reverse movements, unlike the Inventory Staff role used by the original E2E. The Manager E2E therefore omits that role-specific negative assertion; no permission or role was changed.

## Files created or updated for this operation

- `apps/api/scripts/create-pos-local-pre-stocktake-backup.cjs`
- `apps/api/scripts/execute-tenant-incremental-migration.cjs` (supports guarded rehearsal and exact-confirmation live mode)
- `apps/api/scripts/verify-pos-local-stocktake-migration.cjs`
- `apps/api/scripts/verify-pos-local-stocktake-http-e2e.cjs`
- `docs/operations/pos-local-stocktake-migration-apply-2026-11-10.md`

## Scope boundaries

- No Control DB schema or data changed.
- No RBAC or membership assignments changed.
- No tenant business data was seeded by the migration.
- E2E fixtures were cleaned up.
- No deployment, commit or push was performed.
- Off-host/encrypted backup remains a separate open operational concern.
