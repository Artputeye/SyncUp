# Application Smoke Test — Commerce E2E
**Date:** 2026-11-06
**Result:** PASS — isolated E2E workspace, API RBAC and Browser E2E

## Scope and isolation
- Created dedicated Control workspace: `e2e-commerce-20261106`
- Workspace status: `ACTIVE`
- Isolated Tenant database: `syncup_ws_e65ca36b8068`
- Applied `docs/architecture/tenant-commerce-incremental-upgrade.candidate.sql` only to this newly provisioned E2E Tenant.
- Did not modify the production-like `pos-local` workspace, its users, its Tenant schema or business data.
- Dedicated E2E credentials are random and stored only in the ignored local file `apps/api/.env`; passwords are not included in this report.
- Existing `owner-a` and previous Manager test credentials were not overwritten. Dedicated E2E identities were provisioned instead.

## E2E fixture
- Owner: 1
- Admin: 1
- Manager: 1
- Inventory Staff: 1
- Cashier: 1
- Store: 1 (`E2E Main Store`)
- Branch: 1 (default)
- Warehouse: 1 (default)
- Lifecycle audit log: 1

## Browser E2E
Playwright Chromium:
- Owner login → Workspace picker → Store → Branch → Warehouse detail: PASS
- Manager login → Workspace picker → Store → Branch → Warehouse detail: PASS

**Result: 2/2 browser scenarios passed.**

## Inventory and Store RBAC
HTTP tests used real login sessions, production AuthGuard/RbacGuard and the E2E Tenant. Invalid request payloads were deliberately used for authorized write routes so requests stop at input validation before any business mutation.

| Permission / action | Admin | Manager | Inventory Staff | Cashier |
|---|---:|---:|---:|---:|
| Store view | Allow | Allow | Allow | Allow |
| Store manage | Allow | Allow | Deny | Deny |
| Inventory reservation | Allow | Allow | Allow | Deny |
| Inventory receive | Allow | Allow | Allow | Deny |
| Inventory issue | Allow | Allow | Allow | Deny |
| Inventory movement reverse | Allow | Allow | Deny | Deny |

- Direct RBAC service assertions: 19 PASS
- HTTP authorization assertions: 24 PASS
- HTTP checks did not create or alter Store/Branch/Warehouse/Inventory business records.

## Build and type validation
- API `npm run typecheck`: PASS
- API `npm run build`: PASS
- Web `npm run typecheck`: PASS
- Web `npm run build`: PASS

## Production-like workspace safety check
After the E2E run, read-only counts in `pos-local` remained:
- Stores: 0
- Branches: 0
- Warehouses: 0

No production Commerce activation, deployment, Git commit or push was performed. The temporary API process used by the smoke test was stopped after completion.

## Decision
The isolated Application Smoke Test gate is **PASS**. This verifies the current Store/Branch/Warehouse UI path and the tested RBAC rules. It does not by itself authorize enabling Commerce in `pos-local` or another live workspace. Before activation, confirm the intended live workspace, seed/ownership plan for its initial Store/Branch/Warehouse, and any remaining operational acceptance checks.
