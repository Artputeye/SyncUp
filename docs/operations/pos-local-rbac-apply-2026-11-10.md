# pos-local RBAC Candidate Apply — 2026-11-10

## Approval and target

Applied after explicit user approval for the RBAC Candidate only.

- Control database: `syncup_control`
- Workspace: `pos-local`
- Workspace ID: `c0130bf3-c1c0-4dfa-a915-7ca5155cacfd`
- Tenant database: not accessed or modified
- Candidate: `docs/operations/pos-local-rbac-remediation-candidate-2026-11-10.sql`
- Executor: `apps/api/scripts/apply-pos-local-rbac-candidate.cjs`

## Precondition checks

- Connected database identity matched `syncup_control`.
- Session was writable.
- Workspace ID, slug, and ACTIVE status matched the approved target.
- Admin baseline: 12 grants.
- Manager baseline: 27 grants.
- Cashier role absent.

## Apply result

Executor completed with `status: PASS`.

- Admin: 30 current catalog grants plus preserved legacy `commerce.inventory.manage` (31 total).
- Manager: unchanged at 27 grants.
- Cashier: created as a system role with exactly 7 grants.
- Inventory Staff: remains absent.
- Membership-role assignments: unchanged (5 rows; pre/post hash matched).
- Global permission catalog: unchanged (count and hash matched).
- Prisma migration ledger: unchanged (count matched).
- Legacy Admin `commerce.inventory.manage`: preserved.
- Tenant database: not accessed.

## Scope

No membership assignments, Tenant DB changes, migration execution, deployment, commit, or push were performed. This execution does not constitute approval for Stocktake migration or any other database mutation.

## Validation command

```powershell
node --check scripts\apply-pos-local-rbac-candidate.cjs
node scripts\apply-pos-local-rbac-candidate.cjs
```
