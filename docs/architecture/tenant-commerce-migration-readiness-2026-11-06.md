# Tenant Commerce Migration Readiness Addendum — 2026-11-06

Status: **Preparation updated; Migration Sign-off NOT GRANTED. No real database changes performed.**

## 1. Target and migration path

- Target Workspace: `pos-local` (ACTIVE).
- Tenant database: `syncup_ws_c0130bf3c1c0`.
- Runtime role: `syncup_rt_c0130bf3c1c0`.
- PostgreSQL: 18.6; encoding UTF8.
- Existing Tenant ledger: `20261031000100_tenant_baseline` only.
- Existing foundation relations: `tenant_settings`, `audit_events`, `tenant_migrations`.
- Commerce relations are absent. The correct path is **Incremental Upgrade**, not Clean Install.
- Read-only observation on 2026-11-06 confirmed `stores`, `branches`, `warehouses`, and `audit_logs` are absent. Owner and Manager can authenticate and see `pos-local`; Store list API currently returns HTTP 500 because the Commerce schema has not been installed.

## 2. Exact Tenant candidate artifact

- File: `docs/architecture/tenant-commerce-incremental-upgrade.candidate.sql`.
- Generator: `apps/api/scripts/generate-tenant-incremental-candidate.cjs`.
- Version recorded by candidate: `202611030001_tenant_commerce`.
- SHA-256: `836f1af276b908813be9089cb3a2813363820b9e00d3a054d7693af62d2473b3`.
- Size at review: 56,340 bytes.
- Candidate preflight requires the exact baseline ledger, rejects missing foundation objects, rejects pre-existing Commerce objects, and rejects a duplicate Commerce migration version.
- Candidate is transactional and includes `btree_gist` extension creation plus Commerce DDL and reviewed constraints.
- Candidate remains a review artifact only. Do not edit it after sign-off without recalculating the hash and repeating review.

## 3. Verification evidence

- Disposable PostgreSQL 18.6 clean-install and incremental-upgrade candidate acceptance passed, including Store/Branch/Warehouse lifecycle constraints, atomic default replacement, retained baseline ledger, migration ledger recording, and duplicate-application guard.
- All four Control DB permission migrations were applied twice on a localhost-only disposable PostgreSQL database with two Workspaces; idempotency and least-privilege role grants passed.
- Inventory RBAC design is operation-specific:
  - `commerce.inventory.reservation.manage`: Admin, Manager, Inventory Staff.
  - `commerce.inventory.receive`: Admin, Manager, Inventory Staff.
  - `commerce.inventory.issue`: Admin, Manager, Inventory Staff.
  - `commerce.inventory.movement.reverse`: Admin and Manager; Inventory Staff cannot reverse posted movements.
  - `commerce.inventory.view`: read-only balance access, including Cashier.
  - Workspace Owner retains implicit full access through membership ownership.
- Store management permission is granted to Admin and Manager. The original Store migration remains immutable; a forward-only Manager grant migration corrects existing Workspaces.
- Legacy `commerce.inventory.manage` remains Admin-only for compatibility and is no longer used by Inventory API route guards.
- API permission catalog, default role matrix, inventory controller guards, Manager E2E provisioning permissions, API contract and RBAC documentation were updated to match the operation-specific design.
- API TypeScript typecheck passed; Nest build and Disposable PostgreSQL Stock Reservation / Inventory integration passed, including concurrency, idempotency, expiry, rollback, WAC, reversal, constraints and HTTP Auth/RBAC guards.
- Target-specific logical backup/restore rehearsal for `pos-local` passed on 2026-11-04. Restored database identity, PostgreSQL version/locale, schema, constraints, indexes, extensions, table row counts/content checksums, and migration ledger were verified.
- Owner-approved backup retention policy for `pos-local` was recorded on 2026-11-05.
- Collation review is complete: keep existing `UTF8` encoding and `English_United States.1252` database collation/ctype. No database recreation or collation change is recommended for this migration.
- Latest browser authentication checks (2026-11-06): Owner login/workspace access PASS; Manager login/workspace access PASS. Store → Branch → Warehouse browser checks remain blocked because Commerce tables are absent.
- No real Tenant or Control DB migration, DDL/DML, extension installation, Prisma Client generation, or deployment was performed for this addendum.

## 4. Remaining gates before Migration Sign-off

1. **Backup operations (deferred by user):** perform the fresh encrypted off-host backup as the final preparation step immediately before migration, then verify copied backup SHA-256 and recovery path. Backup has not been waived and remains a hard precondition for execution.
2. **Deployment window:** name the maintenance window, application release revision/checksum, deployment operator, rollback operator, traffic/write-freeze procedure, and post-migration acceptance window.
3. **Control DB permissions:** review and authorize the four Control DB-only migrations listed in `docs/architecture/control-db-permission-migration-review-2026-11-06.md`. The recommended order is:
   - `apps/api/prisma/migrations/202611030001_commerce_store_manage/migration.sql`
   - `apps/api/prisma/migrations/202611040001_commerce_inventory_manage/migration.sql`
   - `apps/api/prisma/migrations/202611060001_commerce_inventory_operation_permissions/migration.sql`
   - `apps/api/prisma/migrations/202611060002_commerce_store_manager_grant/migration.sql`
   None has been applied to the real Control DB.
4. **Named-target sign-off:** obtain explicit approval naming Workspace `pos-local`, the Incremental Upgrade path, migration version `202611030001_tenant_commerce`, and the SHA-256 above.

## 5. Execution sequence after all approvals

1. Reconfirm target Workspace/database/runtime-role identity and baseline ledger.
2. Verify there are no conflicting sessions or active write transactions; enter the approved write-freeze/maintenance window.
3. As the final preparation step, take a fresh encrypted off-host backup, verify SHA-256, and confirm the recovery path.
4. Apply the separately approved Control DB permission migrations only if authorized.
5. Apply the exact Tenant Incremental Upgrade candidate to `pos-local` under the approved operator and maintenance plan.
6. Verify migration ledger, Commerce relations, indexes/constraints/extensions, runtime-role grants, and application health.
7. Re-run Owner and Manager browser E2E for Store → Branch → Warehouse.
8. Accept or rollback according to the signed plan; retain backup/recovery artifacts per policy.

## 6. Explicit non-authorization

This addendum is a readiness record, **not** Migration Sign-off. No migration command may be run against `pos-local` until all remaining gates are resolved and the user explicitly approves the named target and candidate hash. Deferring backup changes its timing only; it does not remove the recovery requirement.
