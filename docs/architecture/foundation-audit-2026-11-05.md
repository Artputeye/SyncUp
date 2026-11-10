# Foundation Audit — Auth, Workspace Provisioning, Tenant Registry and RBAC

Date: 2026-11-05
Scope: Read-only source/documentation review for roadmap item 0.1.
Safety: No database connection, migration, Prisma generation, credential change, deployment or runtime configuration change was performed as part of this audit.

## Summary

**Disposition: PARTIAL PASS.** The core foundations exist and enforce important isolation boundaries, but the authentication and operational hardening work is not production-complete. This audit closes the *inspection* task only; it does not mark the identified implementation gaps as complete.

## Findings

### Authentication

**Implemented**
- Password login normalizes email and checks ACTIVE user status.
- Password verification uses bcryptjs.
- Sessions use 32 random bytes; only SHA-256 token hashes are persisted.
- Session expiry, revocation and user ACTIVE status are checked on authenticated requests.
- Session cookie is HttpOnly, SameSite=Strict, path=/, and Secure in production.
- Logout revokes the session and clears the cookie.

**Gaps / risks**
- Login endpoint has no visible rate limit or brute-force protection.
- No Forgot Password / Password Reset workflow is implemented.
- No Google OAuth 2.0 / OpenID Connect workflow is implemented.
- CSRF protection is not implemented as a dedicated token mechanism. AuthGuard has an Origin comparison for mutating requests only when WEB_ORIGIN is configured; deployment must ensure this variable is mandatory and exact.
- Request DTO validation and login payload size/format limits should be confirmed and hardened before production exposure.
- Authentication and session security tests need explicit coverage for replay, expiry, revocation, cookie flags and origin/CSRF cases.

### Workspace provisioning

**Implemented**
- Workspace creation is authenticated and initial owner membership is created with the Workspace.
- Tenant database and runtime role names are derived from immutable Workspace UUID material, not the user-supplied slug.
- Provisioning uses a separate privileged database connection; runtime role is explicitly created without superuser, CREATEDB, CREATEROLE, replication or bypass-RLS privileges and with NOINHERIT.
- Runtime role memberships are revoked during provisioning.
- Tenant credentials are encrypted before persistence.
- Workspace is marked ACTIVE only after migration runner and runtime health check succeed; provisioning errors mark it FAILED.
- Default workspace roles and permissions are created by the Workspace service after provisioning.

**Gaps / risks**
- A controlled retry/recovery workflow for FAILED provisioning should be verified end-to-end, including partial resources left by failures.
- Role/permission bootstrap occurs after provisioning returns ACTIVE; failure in this final step could leave an ACTIVE Workspace without complete default-role bootstrap. Make this sequence atomic or add a guarded repair path before production.
- Workspace creation input validation, duplicate-slug handling and rate limiting should be hardened and tested.

### Tenant database registry

**Implemented**
- Each lookup checks active membership for the authenticated user and requires an ACTIVE Workspace with registered database metadata before returning a Tenant client.
- Database and runtime-role names are format-validated.
- Tenant credential is decrypted server-side and never returned by this service.
- Prisma clients are disconnected on module shutdown; explicit eviction is available.

**Gaps / risks**
- Client cache is unbounded and has no idle eviction or pool-size policy.
- Cached clients are keyed only by Workspace ID; credential/host/database rotation can leave a stale client until explicit eviction or process restart.
- Add bounded cache/idle eviction, connection and query timeouts, pool limits, and explicit invalidation when routing metadata changes.
- Add tests proving membership revocation and Workspace suspension deny access even when a client is already cached. Membership is currently rechecked before cached client return, which is the correct baseline.

### RBAC

**Implemented**
- Workspace roles and role-permission assignments are scoped to a Workspace.
- Permission keys are stable strings and default roles are provisioned.
- Owner bypass is based on the authenticated membership's isOwner flag.
- RbacGuard resolves Workspace context from route parameter or x-workspace-id and delegates the decision to RbacService, which verifies active membership and permission assignment.
- Workspace member-management service methods perform server-side permission checks and protect owner membership / admin assignment.

**Gaps / risks**
- A formal role-permission matrix was added on 2026-11-05 in `docs/architecture/workspace-permission-matrix.md`; implementation seeds Admin, Manager, Cashier and Inventory Staff while retaining member/viewer compatibility roles.
- Some read endpoints intentionally require membership but not a specific permission (for example role listing and tenant settings); decide and document whether these should require workspace.view or a dedicated permission.
- Add endpoint-level negative tests for cross-Workspace IDs, missing membership, suspended Workspace, role escalation, owner protection and permission revocation.
- Ensure every new business endpoint uses backend authorization; frontend navigation visibility is not sufficient.

## Recommended next steps (no real database migration required)

1. Define and approve the role-permission matrix (Owner, Admin, Manager, Cashier, Inventory Staff), keeping platform-admin permissions separate.
2. Add auth rate limiting, DTO validation and explicit CSRF/origin deployment requirements.
3. Fix Workspace bootstrap ordering or implement a safe idempotent repair path for default roles/permissions.
4. Add bounded Tenant Prisma client cache and routing-metadata invalidation.
5. Add focused integration tests for the gaps above.

## Files reviewed

- `apps/api/src/core/auth/auth.service.ts`
- `apps/api/src/core/auth/auth.guard.ts`
- `apps/api/src/core/auth/auth.controller.ts`
- `apps/api/src/core/auth/session-cookie.ts`
- `apps/api/src/core/workspaces/workspaces.service.ts`
- `apps/api/src/core/workspaces/workspaces.controller.ts`
- `apps/api/src/core/tenant/tenant.service.ts`
- `apps/api/src/core/tenant/tenant.controller.ts`
- `apps/api/src/core/rbac/rbac.guard.ts`
- `apps/api/src/core/rbac/rbac.service.ts`
- `apps/api/src/database/workspace-provisioning.service.ts`
- `apps/api/src/database/workspace-database.registry.ts`
- `docs/architecture/authentication-and-rbac.md`
- `docs/architecture/database-tenancy.md`



## Remediation completed — 2026-11-05

- Workspace default permissions and roles are now bootstrapped before Tenant provisioning can mark a Workspace ACTIVE.
- If default-role bootstrap fails while the Workspace is still PROVISIONING, the Workspace is moved to FAILED and Tenant provisioning is not started.
- The operation remains idempotent through permission `createMany(skipDuplicates)`, role lookup-before-create, and role-permission `createMany(skipDuplicates)`.
- Added `apps/api/scripts/verify-workspace-bootstrap.cjs` and `test:workspace-bootstrap`; the test proves role bootstrap precedes provisioning and bootstrap failure marks the Workspace FAILED without invoking Tenant provisioning.
- Validation: API build PASS; API typecheck PASS; workspace bootstrap test PASS.
- Remaining authentication, registry-cache, role-matrix and authorization-test gaps listed above are still open.


## Permission matrix implementation — 2026-11-05

- Added `docs/architecture/workspace-permission-matrix.md` with Owner/Admin/Manager/Cashier/Inventory Staff/Member/Viewer permissions and Store/Product Catalog API mapping.
- Added centralized permission catalog in `apps/api/src/core/rbac/permission-catalog.ts`.
- Default Workspace role bootstrap now seeds Admin, Manager, Cashier and Inventory Staff; legacy Member and Viewer remain for compatibility.
- Platform Admin remains outside Workspace roles and is still controlled by the existing Control Plane guard.
- No database schema change or migration was made. New permission rows and roles are provisioned through the existing Workspace bootstrap path when a Workspace is created or role list is initialized.
- Validation: API build PASS; API typecheck PASS; Workspace bootstrap test PASS; git diff --check PASS (only existing line-ending warnings).
- Deferred: branch/warehouse-level scopes, custom roles UI, sensitive cost/margin permissions, discount/refund approvals, audit-event requirements and migration of existing legacy role assignments.
