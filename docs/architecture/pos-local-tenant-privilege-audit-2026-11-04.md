# pos-local Tenant PostgreSQL Privilege Audit — 2026-11-04

## Scope and safety

- Workspace: `pos-local` (Control DB status: `ACTIVE`)
- Tenant database: `syncup_ws_c0130bf3c1c0`
- Runtime role: `syncup_rt_c0130bf3c1c0`
- PostgreSQL: 18.6 (Windows x86_64)
- Audit connected as the registered Tenant Runtime Role.
- Control DB registry lookup ran in a `BEGIN READ ONLY` transaction.
- Tenant audit ran with `default_transaction_read_only=on` and `BEGIN READ ONLY`.
- No DDL, DML, role changes, grants/revokes, migration, or credential writes were performed. Runtime credential was decrypted in process memory and was not printed or persisted.

## Findings

### Role attributes

| Attribute | Observed | Expected |
|---|---:|---:|
| LOGIN | true | true |
| SUPERUSER | false | false |
| INHERIT | **true** | **false (NOINHERIT)** |
| CREATEROLE | false | false |
| CREATEDB | false | false |
| REPLICATION | false | false |
| BYPASSRLS | false | false |
| Role memberships | 0 | 0 |

Finding: Runtime role has `INHERIT=true`, contrary to the NOINHERIT provisioning policy. No memberships were found, so no inherited role grants were identified in this audit; nevertheless the role attribute is a policy deviation.

### Database, schema and object ownership

- Database owner: `syncup_provisioner`.
- `public` schema owner: `pg_database_owner`.
- All three relations are owned by `syncup_provisioner`: `tenant_migrations`, `tenant_settings`, `audit_events`.
- No relation/database ownership by the Runtime Role was found.
- Runtime Role has database CONNECT and schema USAGE.
- PUBLIC does not have database CONNECT.

### PUBLIC grants

Finding: `PUBLIC` retains `USAGE` on schema `public`. No other PUBLIC database/schema/relation/function/default-ACL grants were returned by the audit. This violates the repository's strict policy to revoke PUBLIC schema privileges.

### Effective table privileges

A follow-up read-only query checked effective privileges as the Runtime Role:

| Table | SELECT | INSERT | UPDATE | DELETE | Expected |
|---|---:|---:|---:|---:|---|
| `audit_events` | yes | yes | yes | yes | DML |
| `tenant_settings` | yes | yes | yes | yes | DML |
| `tenant_migrations` | yes | **yes** | **yes** | **yes** | **SELECT only** |

Finding: Runtime Role can INSERT, UPDATE and DELETE `tenant_migrations`, despite the intended SELECT-only policy and the current migration-runner implementation. This is a concrete privilege mismatch requiring remediation review.

### Default privileges and functions

- Default ACLs owned by `syncup_provisioner` grant Runtime Role SELECT/INSERT/UPDATE/DELETE on future tables and USAGE/SELECT on future sequences.
- No PUBLIC default grants were returned.
- No public functions were found in the function ACL inventory.

## Audit result

**NOT PASS — remediation required.** The audit found three policy deviations:
1. Runtime Role has `INHERIT=true` instead of `NOINHERIT`.
2. PUBLIC has `USAGE` on schema `public`.
3. Runtime Role has INSERT/UPDATE/DELETE on `tenant_migrations` instead of SELECT-only.

The audit utility also reported the first two findings. The third was confirmed by an additional effective-privilege query.

## Required next actions (not performed)

1. Review why the existing `pos-local` role was not normalized to NOINHERIT during provisioning.
2. Reconcile existing and default ACLs so `tenant_migrations` is SELECT-only for Runtime Role.
3. Revoke PUBLIC schema USAGE in accordance with the approved policy while retaining required Runtime Role schema USAGE.
4. Re-run this read-only audit and verify effective privileges after any separately approved remediation.

**Remediation applied and independently verified — 2026-11-04.** See the execution record below. No Tenant schema migration or business-data mutation was performed.


## Remediation execution record — 2026-11-04

The three findings above were remediated in the named Tenant database only, using the local provisioner connection configured for the project. The session verified the target database, actor, database owner, object owners, runtime role, role memberships and required privileges before applying changes. The operation ran in one transaction under a transaction-scoped advisory lock; failed postconditions would have rolled the transaction back.

Changes committed:
1. Altered role syncup_rt_c0130bf3c1c0 to NOINHERIT.
2. Revoked USAGE on schema public from PUBLIC. Runtime Role schema USAGE was retained.
3. Revoked INSERT, UPDATE and DELETE on public.tenant_migrations from the Runtime Role. SELECT was retained.

Post-remediation verification:
- Read-only privilege audit: PASS; zero ERROR findings.
- Runtime role attributes: LOGIN true; SUPERUSER, INHERIT, CREATEROLE, CREATEDB, REPLICATION and BYPASSRLS all false.
- Role memberships: zero.
- PUBLIC schema USAGE: absent.
- Runtime Role schema USAGE: present.
- tenant_migrations: Runtime Role SELECT only; INSERT, UPDATE and DELETE absent.
- Ownership unchanged: database and relations remain owned by syncup_provisioner; public schema remains owned by pg_database_owner.
- Actual registered Runtime Role connection smoke test: PASS. Connected to pos-local database, read migration ledger and tenant_settings in a read-only transaction, and confirmed the expected schema/ledger privileges.

Scope and safety:
- Only database syncup_ws_c0130bf3c1c0 and role syncup_rt_c0130bf3c1c0 were changed.
- No application data, table definitions, migration ledger rows, other roles, other workspaces or Control DB records were changed.
- No Tenant or Control DB migration was applied; no Prisma Client was generated.
- This closes the three recorded pos-local privilege deviations. It does not grant Migration Sign-off or authorize any schema migration or rollout.
