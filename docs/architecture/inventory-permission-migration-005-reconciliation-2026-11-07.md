# Inventory Permission Migration 005 Reconciliation — 2026-11-07

Status: **Read-only review complete. Migration 005 is absent from the Control DB ledger and its full intended effects are not present in `pos-local`. No permission changes were made.**

## Scope and safety

- Target Control DB: `syncup_control`, connected as `syncup`.
- All database queries ran inside `BEGIN READ ONLY`; PostgreSQL reported `transaction_read_only=on`.
- Role assignments were scoped by Workspace slug to avoid conflating same-named roles across Workspaces.
- No DDL, DML, migration, role grant/revoke, module lifecycle action, deployment, commit, or push was performed.
- Temporary read-only inspection script was removed after use.

## 1. Migration source intent

`202611060005_inventory_role_matrix_alignment/migration.sql`:

1. Upserts three permission catalog entries and their Thai descriptions:
   - `commerce.inventory.adjust` — `ปรับยอดสต็อก`
   - `commerce.inventory.transfer` — `โอนย้ายสินค้าระหว่างคลัง`
   - `commerce.inventory.stocktake` — `ตรวจนับสต็อก`
2. Grants these three permissions to every existing Workspace role whose key is `admin`, `manager`, or `inventory_staff`.
3. Does not grant `commerce.inventory.movement.reverse` to Inventory Staff; reversal remains reserved for Admin, Manager, and Owner policy.

The source permission catalog agrees: Admin receives all permissions, Manager receives all three plus movement reversal, and Inventory Staff receives adjust/transfer/stocktake but not movement reversal.

## 2. Live ledger and permission catalog

The live Control DB has no `_prisma_migrations` row for `202611060005_inventory_role_matrix_alignment`.

The three permission keys exist, but all three descriptions currently read `Workspace permission`, rather than the Thai descriptions in both the source catalog and migration SQL. This is inconsistent with the intended 005 upsert behavior.

## 3. `pos-local` role assignment results

Roles actually present in `pos-local` include `admin`, `manager`, `member`, and `viewer`. There is no `inventory_staff` role in this Workspace at the time of inspection.

| Role | adjust | transfer | stocktake | movement.reverse |
|---|---:|---:|---:|---:|
| Admin | Missing | Missing | Missing | Granted |
| Manager | Granted | Granted | Granted | Granted |
| Inventory Staff | Role absent | Role absent | Role absent | Role absent |
| Member | Not granted | Not granted | Not granted | Not granted |
| Viewer | Not granted | Not granted | Not granted | Not granted |

Therefore, the intended 005 alignment is **not fully present** in `pos-local`: Admin lacks all three new inventory permissions, and the Workspace has no Inventory Staff role to receive the intended assignments.

## 4. Cross-Workspace observations

The isolated E2E Workspace `e2e-commerce-20261106` does contain `admin`, `manager`, and `inventory_staff` roles, and those three roles have the three permissions assigned. This is consistent with the current `WorkspacesService.ensureDefaultRoles()` implementation, which seeds permissions and role grants when default roles are provisioned.

That seeding method uses `createMany(..., skipDuplicates: true)` for permissions and role grants. It does not update an existing permission description when the permission key already exists. This explains why the E2E role grants can exist while the shared permission descriptions remain the generic `Workspace permission` values.

Same-named roles are Workspace-scoped. A global role-key comparison would have produced duplicate/conflicting rows, so the `pos-local` assessment above is explicitly scoped to its Workspace ID.

## 5. Reconciliation conclusion

- Migration 005 has not been recorded in Prisma's ledger.
- Its intended permission-description upsert is not reflected in the live catalog.
- Its expected Admin grants are absent in `pos-local`.
- Its Inventory Staff grants are present in the E2E Workspace, likely due to default-role seeding, but `pos-local` does not currently have an Inventory Staff role.
- Do not infer that 005 ran just because some role grants exist: those grants can be produced by Workspace provisioning code independently of the migration.
- Do not execute 005 or manually repair grants during this evidence review. First determine whether Inventory Staff should be introduced into `pos-local`, and approve the intended role matrix for the existing Admin account. Any remediation must be a reviewed forward-only operation with a backup and an auditable execution record.

## 6. Recommended next gates

1. Confirm the intended `pos-local` role set: whether `inventory_staff` should exist now or be provisioned only when a warehouse operator is assigned.
2. Confirm Admin should receive all three inventory permissions, consistent with `DEFAULT_WORKSPACE_ROLES` and the proposed matrix.
3. Prepare a forward-only reconciliation plan for descriptions and missing role grants; do not backfill historical Prisma migration metadata.
4. Review whether role provisioning should be exposed as an idempotent, audited operation for existing Workspaces, because current default-role seeding is not automatically a migration mechanism.
5. Keep Production Activation Sign-off blocked pending this approval, the historical Candidate SQL recovery, the 003/004 execution provenance, and encrypted off-host backup.

No production permission changes, migration, ledger repair, module lifecycle operation, deployment, commit, or push was performed.