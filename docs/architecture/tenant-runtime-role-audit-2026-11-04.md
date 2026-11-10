# PostgreSQL Runtime Privilege Audit ‚Äî 2026-11-04

Status: **Local hardening implemented and disposable regression suites passed; production privilege audit/sign-off remains open.**

## Scope

Reviewed `TenantMigrationRunner` and `WorkspaceProvisioningService` after the disposable Runtime Grants harness passed. No real Tenant database was connected to or modified.

## Findings and changes

1. Runtime roles are now created/altered with `NOINHERIT`.
2. Provisioning queries `pg_auth_members` for memberships where the runtime role is the member and revokes each inherited role membership before storing/activating the workspace database. If the provisioner lacks authority to revoke a membership, provisioning fails closed rather than silently accepting the inherited privilege.
3. `TenantMigrationRunner` revokes PUBLIC privileges at database and schema level, and now also revokes existing PUBLIC grants on tables, sequences, and functions in `public`.
4. Default privileges for objects created by the migration owner are hardened: PUBLIC table/sequence grants and function EXECUTE are revoked. The tenant runtime role receives DML on tenant tables, SELECT-only on `tenant_migrations`, and sequence usage/select.
5. The runtime grant defaults are owner-scoped in PostgreSQL. All future Tenant DDL must therefore run under the designated provisioner/migration owner, or explicitly apply equivalent default ACLs for any additional object owner. A production DBA audit must verify this invariant.

## Verification

On local PostgreSQL 18.6, using disposable databases only:

- `npm run test:runtime-grants`: PASS (role flags, tenant DML, migration ledger SELECT-only, denied DDL/role creation, future object grants).
- `npm run test:tenant-migrations`: PASS (clean install and incremental candidate; lifecycle/default replacement and migration ledger guards).
- `npm run test:control-backup-restore`: PASS (Control permission migration and isolated Tenant backup/restore rehearsal).
- `npm run build`: PASS.

The local migration candidate run exercised `btree_gist` creation and dependent exclusion constraints on PostgreSQL 18.6.

## Remaining production checks

- Confirm the actual production PostgreSQL major/minor version is 18.x and hosting permits `btree_gist` installation by the migration owner.
- On each production Tenant, inspect `pg_roles`, `pg_auth_members`, `pg_database.datacl`, `pg_namespace.nspacl`, `pg_class.relacl`, `pg_proc.proacl, and `pg_default_acl`; confirm no unexpected PUBLIC grants, runtime membership, runtime ownership, or owner-specific default ACL gaps.
- Confirm the provisioner owns each Tenant database and all migration DDL objects, and that the runtime role is not owner/member of any privileged role.
- Confirm backups/restore, application compatibility, maintenance window, free disk, and target Tenant identity before any rollout.

## Decision

**Migration Sign-off: NOT GRANTED.** No production Tenant migration, Prisma Client generation, or workspace status change was performed. Workspace A/B remain preserved and suspended; POS remains active as last recorded, subject to rechecking immediately before any future rollout.

## Provisioning integration test addendum

Added `apps/api/scripts/verify-provisioning-role-isolation.cjs` and `test:provisioning-role-isolation`. The test creates a disposable localhost database, pre-creates the expected Runtime Role, grants it membership in a NOLOGIN group, creates an existing table with a PUBLIC SELECT ACL, then invokes the real `WorkspaceProvisioningService` with a mocked Control DB and real TenantMigrationRunner. It verifies membership removal, `NOINHERIT`, PUBLIC ACL revocation, encrypted credential persistence, and a successful runtime health check. The test passed on the local PostgreSQL 18.6 instance. The script drops only its uniquely named disposable database and roles.

This is application-level integration coverage using a mocked Control DB, not a test against the live Control DB or production cluster. Production role/ACL inventory and provider extension/version confirmation remain outstanding.


## Read-only audit utility+ßuÁ‚ùÁT 2026-11-04

Added `apps/api/scripts/postgres-privilege-audit.cjs` and `apps/api/scripts/verify-postgres-privilege-audit.cjs`, exposed as `npm run test:postgres-privilege-audit`.

The audit utility connects with PostgreSQL `default_transaction_read_only=on` and wraps its catalog reads in `BEGIN READ ONLY`. It inventories server/version metadata, the selected Runtime Role attributes and memberships, database/schema/relation/function ACLs, default ACL entries, and database/schema/object ownership. It reports high-risk findings such as elevated Runtime Role attributes, inherited role memberships, Runtime Role ownership, and PUBLIC grants. Optional `TENANT_AUDIT_MIGRATION_OWNER` enables a migration-owner consistency warning.

The disposable test creates a uniquely named localhost-only database and roles, injects a role membership and PUBLIC table grant, then asserts that the audit detects those conditions while running read-only. It drops only the resources it created.

Local verification in this session: `npm run build` PASS; both audit scripts pass `node --check`; `git diff --check` PASS. The PostgreSQL integration harness could not be run because `TEST_POSTGRES_ADMIN_URL` is not configured in the Serena shell or `.env`. No live or existing workspace database was queried or modified. Configure that variable locally to run the disposable integration test; configure `TENANT_AUDIT_DATABASE_URL` and `TENANT_AUDIT_RUNTIME_ROLE` only when explicitly ready to run the read-only inventory against a target Tenant.


### PostgreSQL 18 disposable audit integration ‚Äî PASS

Executed the disposable audit integration using the existing local WORKSPACE_DATABASE_ADMIN_URL from .env, after verifying its host was localhost. The test created and removed only uniquely named disposable resources.

Results:
- PASS Audit executes in a read-only transaction.
- PASS Database, schema, relation, function and default ACL inventory.
- PASS Detection of Runtime Role memberships and PUBLIC grants.
- PASS Ownership and PostgreSQL version metadata.
- PASS npm run build, both script syntax checks, and git diff --check.
- PASS Cleanup verification: zero syncup_audit_% databases and zero test roles remain.

Fixed the PostgreSQL 18 sequence ACL expression, deferred environment validation so the audit module can be imported by its test harness, and aligned the test with the report field name. No existing workspace or production database was queried or modified.
