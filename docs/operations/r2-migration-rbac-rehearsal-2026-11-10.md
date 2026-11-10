# R2 Migration Lineage and RBAC Rehearsal — 2026-11-10

## Scope and safety boundary

This work used only disposable PostgreSQL databases restored from the pinned Control backup. The live `syncup_control` database and `pos-local` tenant database were not modified. Every disposable database was dropped in the test script's `finally` cleanup.

Pinned source backup:
- File: `syncup_control_20261107022928_d9d27b00.dump`
- SHA-256: `f3f5d5ef33a11153a71b8fd640a5b8ec96a70b0dad15e23f6d81cad601cc3992`

## 1. Migration lineage rehearsal

Script: `apps/api/scripts/rehearse-control-migration-ledger-reconciliation.cjs`

The script restored the pinned backup to a unique localhost-only disposable database. Before repair it verified:
- Seven existing Prisma ledger rows.
- No ledger rows for migrations 003 or 004.
- The 003 schema effects already existed: `module_installations`, all six added columns, and `platform_audit_logs`.

It then ran Prisma's supported `prisma migrate resolve --applied` separately for:
- `202611060003_module_registration_activation`
- `202611060004_module_audit_runtime_grants`

Result: PASS.
- Both Prisma commands succeeded.
- Both ledger rows have `finished_at`, no rollback timestamp, and the current migration-file SHA-256 as their checksum.
- `prisma migrate status` reports 005 as the only pending migration.
- The disposable clone was dropped after verification.

Decision implication: Prisma-native ledger reconciliation is technically viable for these exact two versions. This does not authorize running it against live `syncup_control`. That remains a separate approval gate. Do not use direct INSERT into `_prisma_migrations`, do not rerun 003/004 SQL, and do not run `prisma migrate deploy` until the live ledger gap has been explicitly reconciled and reviewed.

## 2. RBAC remediation candidate rehearsal

Candidate SQL: `docs/operations/pos-local-rbac-remediation-candidate-2026-11-10.sql`

Test script: `apps/api/scripts/rehearse-pos-local-rbac-candidate.cjs`

The script restored the same pinned Control backup to a separate disposable database and verified the target workspace identity was active `pos-local`.

Before candidate:
- Admin: 11 of 30 catalog grants; 12 total grants including the legacy permission.
- Manager: exact reviewed 27-key grant set.
- Cashier: role absent.
- Inventory Staff: role absent.

Candidate applied successfully twice. Results after first application:
- Admin: all 30 catalog grants plus the existing legacy `commerce.inventory.manage` grant (31 total); legacy grant preserved.
- Manager: same 27 grants; unchanged.
- Cashier: system role created with exactly seven reviewed read/sales grants.
- Inventory Staff: remains absent/on-demand.
- Membership-role assignments: unchanged.
- Global permission catalog: unchanged.
- Roles and grants in other workspaces: unchanged.
- Prisma migration ledger: unchanged.
- Second run: complete role/grant state remained identical; idempotence PASS.

The rehearsal also caught and corrected a PostgreSQL array type comparison in the candidate's preflight/final verification. The current candidate passed after that correction.

## 3. Candidate design boundaries

- Candidate is stored under `docs/operations`, not under `apps/api/prisma/migrations`.
- It is not approved for live application.
- It performs additive grant inserts only; no grant deletion/revocation.
- It does not assign any member to Cashier or change any membership.
- It does not create Inventory Staff.
- It preserves the legacy `commerce.inventory.manage` permission and existing Admin grant.
- It does not touch Tenant DB data or Stocktake schema.

## 4. Remaining work and approval gates

1. Owner approval is still required before running `prisma migrate resolve --applied` for exactly 003 and 004 against live `syncup_control`.
2. Owner approval is separately required before applying the RBAC candidate to Control DB workspace `pos-local` (`c0130bf3-c1c0-4dfa-a915-7ca5155cacfd`). The proposed change is limited to Admin grants and Cashier role/grants; no membership assignment.
3. Keep migration 005 unapplied until its contents are reconciled against this tested candidate and the migration-lineage decision.
4. Keep Stocktake migration application separate; it requires its own Tenant DB schema/backup rehearsal and explicit approval.
5. The `WorkspacesService.listRoles()` GET path still calls mutating `ensureDefaultRoles()`. A separate code change/test is required so GET is read-only while explicit authorized write paths provision missing default roles.

## Verification commands

Run from `apps/api`:
- `node --check scripts/rehearse-control-migration-ledger-reconciliation.cjs`
- `node --env-file=.env scripts/rehearse-control-migration-ledger-reconciliation.cjs`
- `node --check scripts/rehearse-pos-local-rbac-candidate.cjs`
- `node --env-file=.env scripts/rehearse-pos-local-rbac-candidate.cjs`

No live Control/Tenant DB mutation, role/membership change, Inventory Data change, migration application, deployment, commit, or push was performed.


## 5. Stocktake candidate review and disposable Tenant rehearsal

Candidate: `apps/api/prisma/tenant/migrations/20261107000100_tenant_inventory_stocktake.sql`
SHA-256: `a32e90622cac76ea16a3bdb16ceb74bb34da048004911cfe1c68fd9c5f255ae9`

Rehearsal script: `apps/api/scripts/rehearse-pos-local-stocktake-migration.cjs`

Pinned Tenant backup:
- File: `pos-local_20261107022352_b25ca603.dump`
- SHA-256 verified during this run: `01be3ffae783f2c69bcd764c1cc670018675b96c6dd0ad27e0232e644eb9e53c`

The script restored the backup to a disposable database, applied the candidate SQL there, and dropped the clone after verification. Result: PASS.
- Before: both Stocktake tables absent; `StocktakeStatus` absent; `StockReferenceType` had seven existing values; tenant ledger had two rows.
- After: both tables created; session table has 12 columns; line table has 9 columns; `StockReferenceType.STOCKTAKE` exists; `StocktakeStatus` values are DRAFT, IN_PROGRESS, FINALIZED, CANCELLED; seven named PK/FK/CHECK constraints and six indexes exist.
- Both tables are empty; tenant migration ledger was unchanged by the candidate SQL.
- This is SQL/schema rehearsal only, not live application or API/UI E2E approval.

Read-only live readiness audit script: `apps/api/scripts/audit-pos-local-stocktake-readiness.cjs`.
- Confirmed active workspace `pos-local` maps to `syncup_ws_c0130bf3c1c0` and runtime role `syncup_rt_c0130bf3c1c0`.
- Tenant connection verified `transaction_read_only=on`.
- Current Tenant schema: no Stocktake tables, no Stocktake ledger row, two tenant ledger rows, one warehouse and two product variants.
- Runtime role exists, can connect, and has public schema USAGE.
- Provisioner default privileges grant SELECT/INSERT/UPDATE/DELETE on newly created public tables to the Tenant runtime role. The migration must run as `syncup_provisioner` for those defaults to apply.

**Application-path blocker:** `TenantMigrationRunner` currently provisions only the baseline migration; it does not discover/apply this Stocktake incremental candidate. A live application plan therefore needs a dedicated, explicitly approved executor that takes the Tenant advisory lock, checks the exact target database and ledger, takes/verifies a pre-change backup, runs the SQL and inserts `20261107000100_tenant_inventory_stocktake` into `tenant_migrations` in the same transaction, then verifies runtime table privileges and schema objects. Do not run the SQL directly on live `pos-local` or insert a ledger row separately.

Stocktake remains a separate approval gate. No live Tenant/Control mutation was performed.
