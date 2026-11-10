# Inventory Permission Forward Reconciliation Plan — 2026-11-07

Status: **Plan prepared; execution NOT authorized.** This plan records the proposed role matrix as the working target following the instruction to proceed. It does not authorize production DDL/DML, Prisma migration execution, permission changes, deployment, or ledger repair.

## 1. Target scope for `pos-local`

| Role | `commerce.inventory.adjust` | `commerce.inventory.transfer` | `commerce.inventory.stocktake` | `commerce.inventory.movement.reverse` |
|---|---:|---:|---:|---:|
| Admin | Grant | Grant | Grant | Preserve current grant |
| Manager | Preserve current grant | Preserve current grant | Preserve current grant | Preserve current grant |
| Inventory Staff | Do not create yet | Do not create yet | Do not create yet | Do not grant |
| Member | No grant | No grant | No grant | No grant |
| Viewer | No grant | No grant | No grant | No grant |

Inventory Staff is deferred until an actual warehouse operator is assigned. This is a deliberate scope decision, not a permanent exclusion from the default role catalog.

## 2. Required Control DB catalog alignment

Update only the descriptions of the following existing permission keys to the source-of-truth Thai descriptions:

- `commerce.inventory.adjust` — `ปรับยอดสต็อก`
- `commerce.inventory.transfer` — `โอนย้ายสินค้าระหว่างคลัง`
- `commerce.inventory.stocktake` — `ตรวจนับสต็อก`

Do not create duplicate permission keys. Confirm uniqueness and the expected current description before applying any update.

## 3. Required `pos-local` role alignment

- Add only the three missing inventory grants to the existing `admin` role.
- Leave Manager grants unchanged.
- Do not create `inventory_staff` during this reconciliation.
- Do not grant these permissions to Member or Viewer.
- Do not alter `commerce.inventory.movement.reverse` or any unrelated permission.
- Preserve Owner semantics; do not change membership ownership or user roles.

## 4. Provisioning-code hazard — prerequisite

Current `WorkspacesService.ensureDefaultRoles()` iterates over every `DEFAULT_WORKSPACE_ROLES` definition and creates any missing role, including `inventory_staff`. It is called by `listRoles()` and `addMember()`, not only by initial Workspace creation.

Therefore the desired deferred-role behavior is not currently guaranteed. Before claiming that Inventory Staff will remain absent until needed:

1. Separate initial Workspace bootstrap from routine role/permission reconciliation.
2. Make routine reconciliation avoid creating deferred roles, or introduce an explicit, audited role-provisioning path for Inventory Staff.
3. Preserve existing role grants and avoid replacing a role's permission set during reconciliation.
4. Add tests proving that ordinary role listing/member operations do not create Inventory Staff, and that explicit provisioning creates it with the intended default permissions while excluding movement reversal.
5. Review whether the current `ensureDefaultRoles()` calls in `listRoles()` and `addMember()` should be removed or replaced with a non-creating reconciliation routine.

This code change is a separate prerequisite and must be reviewed/tested before relying on the deferred-role policy. Do not change production data as a substitute for fixing this behavior.

## 5. Migration and ledger handling

Migration `202611060005_inventory_role_matrix_alignment` is absent from the live Control DB `_prisma_migrations` ledger. The prior review found partial effects that can also be explained by Workspace provisioning.

- Do not insert a synthetic `_prisma_migrations` row.
- Do not mark the migration applied merely because selected effects are manually reconciled.
- Do not blindly run the current migration SQL: its role-key query would grant the three permissions to every existing `admin`, `manager`, and `inventory_staff` role across the database, not only `pos-local`; it also would not create the missing Inventory Staff role.
- Decide separately whether 005 should be revised into a properly scoped, deployable migration or whether its intended catalog/role effects should be delivered through an auditable forward-only remediation. The chosen path must have a single source of truth and clear ledger semantics.

## 6. Execution gates

Before any production change:

1. Recover and reconcile the historical Candidate SQL artifact mismatch recorded in the migration review.
2. Resolve the 003/004 execution-provenance gap; do not fabricate ledger history.
3. Confirm the latest Control and Tenant backups and restore verification. Current local backups passed restore checks, but they are not encrypted off-host backups; the off-host backup gate remains open.
4. Capture fresh read-only snapshots of the exact target Workspace ID, role IDs, permission IDs, current role-permission links, and catalog descriptions.
5. Produce an exact before/after diff limited to the changes in sections 2 and 3.
6. Review the execution SQL/script for transactionality, idempotency, workspace scoping, audit logging, and rollback/compensation.
7. Obtain explicit approval for the exact production change set and execution window.

If any precondition differs from the reviewed state, stop and re-plan.

## 7. Post-change verification (only after separate authorization)

- Confirm the three descriptions match the Thai source strings.
- Confirm Admin has the three inventory grants.
- Confirm Manager retains its existing grants, including movement reversal.
- Confirm Inventory Staff remains absent until explicitly provisioned.
- Confirm Member and Viewer have no new inventory grants.
- Confirm no unrelated role-permission links changed.
- Confirm audit evidence identifies the actor, target Workspace, change set, and timestamp.
- Re-run relevant RBAC service and HTTP authorization tests.
- Keep Production Activation Sign-off blocked until all independent migration, backup, and activation gates are resolved.

## 8. Current decision

This document is a forward-only plan, not an execution record. No database changes, migrations, permission grants/revokes, role creation, ledger repair, module lifecycle operation, deployment, commit, or push were performed while preparing it.
