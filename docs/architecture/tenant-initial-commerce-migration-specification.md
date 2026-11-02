# Tenant Initial Commerce Migration Specification

Status: **Draft for review — NOT approved for execution**
Inspection date: 2026-11-02
Scope: Tenant PostgreSQL Baseline verification and Initial Commerce Schema rollout
Execution policy: Read-only inspection completed. No migration was applied, no database object or row was changed, and no Prisma Client was generated.

## 1. Executive summary

The live PostgreSQL instance is PostgreSQL 18.6 on Windows. The Control Database is `syncup_control`. Two ACTIVE Workspaces point to Tenant databases:

| Workspace slug | Tenant database | Recorded schema version |
|---|---|---|
| `workspace-a-local` | `syncup_ws_2a4577ace43c` | `20261031000100_tenant_baseline` |
| `workspace-b-local` | `syncup_ws_e4199e58d35b` | `20261031000100_tenant_baseline` |

Both Tenant databases contain the same three baseline tables only: `tenant_settings`, `audit_events`, and `tenant_migrations`. No Commerce, catalog, inventory, media, derivative, or import tables were found. No Media/Image enums were found. The two Tenant databases each have one `tenant_migrations` row for `20261031000100_tenant_baseline`; `tenant_settings` and `audit_events` are empty in both databases.

**Conclusion:** this is an Initial Commerce Schema deployment on top of an existing Tenant Baseline, not a legacy Commerce data migration. Do not treat the clean-install Prisma SQL candidate as an upgrade migration without the reconciliation and preflight described below.

## 2. Inspection method and safety

- Connection path: Serena Project Terminal on the project host, Node.js `pg` driver.
- Tenant reads used `syncup_runtime`; Control reads used `syncup`.
- Only SELECT/catalog queries were issued.
- The supplied `WORKSPACE_DATABASE_ADMIN_URL` / provisioner credential was not used.
- No password, encryption key, secret_cipher, user password hash, session token hash, or object-store credential was selected or emitted.
- The runtime role is not a true read-only role: it has INSERT, UPDATE, and DELETE privileges on `public.tenant_settings`, although it is not superuser, cannot create databases/roles, cannot create schemas, has no role memberships, and has no CREATE privilege on the database/public schema. All inspection statements in this run were SELECT only.
- The Control role was also used only for SELECT; its privileges were not exhaustively audited.

For future inspections, create a dedicated database role with SELECT-only privileges and execute inspection sessions inside `BEGIN READ ONLY; ... COMMIT;`. Do not reuse application runtime or provisioning credentials as inspection credentials.

## 3. Verified Tenant Baseline — exact live definitions

The following definitions were read from live Workspace A. Workspace B reports the same applied baseline version and the same three-table inventory; its baseline object set is consistent.

### 3.1 `public.tenant_settings`

| Ordinal | Column | PostgreSQL type | Null | Default |
|---:|---|---|---|---|
| 1 | `key` | varchar(120) | NO | — |
| 2 | `value` | jsonb | NO | `'{}'::jsonb` |
| 3 | `updated_at` | timestamptz | NO | `now()` |

- Primary key: `tenant_settings_pkey (key)`.
- No additional indexes, foreign keys, or enum dependencies found.
- Live row count: 0.

### 3.2 `public.audit_events`

| Ordinal | Column | PostgreSQL type | Null | Default |
|---:|---|---|---|---|
| 1 | `id` | uuid | NO | `gen_random_uuid()` |
| 2 | `actor_id` | uuid | YES | — |
| 3 | `action` | varchar(160) | NO | — |
| 4 | `resource_type` | varchar(120) | YES | — |
| 5 | `resource_id` | varchar(160) | YES | — |
| 6 | `metadata` | jsonb | NO | `'{}'::jsonb` |
| 7 | `created_at` | timestamptz | NO | `now()` |

- Primary key: `audit_events_pkey (id)`.
- Index: `audit_events_created_at_idx (created_at DESC)`.
- Index: `audit_events_actor_id_idx (actor_id)`.
- No foreign key on `actor_id`; actor identity is not relationally enforced by this Tenant baseline.
- Live row count: 0.

### 3.3 `public.tenant_migrations`

| Ordinal | Column | PostgreSQL type | Null | Default |
|---:|---|---|---|---|
| 1 | `version` | varchar(80) | NO | — |
| 2 | `applied_at` | timestamptz | NO | `now()` |

- Primary key: `tenant_migrations_pkey (version)`.
- Live row count: 1 in each Tenant DB.
- The single row in each database is `20261031000100_tenant_baseline`.

### 3.4 Baseline source reconciliation

The live columns, types, defaults, and indexes match the checked-in file:

`apps/api/prisma/tenant/migrations/20261031000100_tenant_baseline.sql`

That historical baseline file must remain immutable. The migration runner has already recorded it as applied in both ACTIVE Tenant databases. Do not re-run it as part of the Commerce migration.

## 4. Verified absence of legacy Commerce / media schema

In both ACTIVE Tenant databases, catalog queries returned no matching tables or enums for:

- `media_assets`
- `media_asset_derivatives`
- `product_images`
- `variant_images`
- `image_import_items`

The broader table inventory contained only the three baseline tables. Therefore no existing Commerce columns, media provider/bucket/object-key metadata, image association rows, or legacy import records are available to backfill or rename.

This is evidence only about these two local Tenant databases. It does not prove that no external object bucket or files exist. Object Storage has not yet been connected or inventoried; provider, bucket, object key conventions, versioning, retention, and existing object population remain unverified.

## 5. Control Database — verified structure

Control Database: `syncup_control`, schema `public`, PostgreSQL 18.6.

### 5.1 Tables and important columns

| Table | Columns (type) |
|---|---|
| `workspaces` | `id uuid`, `slug varchar`, `name varchar`, `status WorkspaceStatus`, `created_at timestamp without time zone`, `updated_at timestamp without time zone` |
| `workspace_databases` | `id uuid`, `workspace_id uuid`, `provider varchar`, `database_name varchar`, `host varchar`, `port integer`, `username varchar`, `secret_cipher text NULL`, `schema_version varchar NULL`, `created_at timestamp without time zone` |
| `users` | `id uuid`, `email varchar`, `password_hash text`, `display_name varchar`, `status UserStatus`, `created_at timestamp without time zone`, `updated_at timestamp without time zone`, `is_platform_admin boolean` |
| `memberships` | `id uuid`, `user_id uuid`, `workspace_id uuid`, `is_owner boolean`, `created_at timestamp without time zone` |
| `membership_roles` | `membership_id uuid`, `role_id uuid` |
| `roles` | `id uuid`, `workspace_id uuid NULL`, `key varchar`, `name varchar`, `is_system boolean` |
| `permissions` | `id uuid`, `key varchar`, `description varchar NULL` |
| `role_permissions` | `role_id uuid`, `permission_id uuid` |
| `sessions` | `id uuid`, `user_id uuid`, `token_hash varchar`, `expires_at timestamp without time zone`, `revoked_at timestamp without time zone NULL`, `user_agent varchar NULL`, `ip_address varchar NULL`, `created_at timestamp without time zone` |
| `module_installations` | `id uuid`, `workspace_id uuid`, `module_id varchar`, `version varchar`, `enabled boolean`, `source varchar`, `installed_at timestamp without time zone` |

The Control database also contains Prisma's `_prisma_migrations` bookkeeping table. Sensitive values in `users.password_hash`, `sessions.token_hash`, and `workspace_databases.secret_cipher` were not read.

### 5.2 Control enums

- `WorkspaceStatus`: `PROVISIONING`, `ACTIVE`, `SUSPENDED`, `FAILED`.
- `UserStatus`: `ACTIVE`, `DISABLED`.

### 5.3 Control primary/unique indexes

- `workspaces_pkey (id)`; unique `workspaces_slug_key (slug)`.
- `workspace_databases_pkey (id)`; unique `workspace_databases_workspace_id_key (workspace_id)`; unique `workspace_databases_database_name_key (database_name)`.
- `users_pkey (id)`; unique `users_email_key (email)`.
- `memberships_pkey (id)`; unique `memberships_user_id_workspace_id_key (user_id, workspace_id)`; index `memberships_workspace_id_idx (workspace_id)`.
- `membership_roles_pkey (membership_id, role_id)`.
- `roles_pkey (id)`; unique `roles_workspace_id_key_key (workspace_id, key)`.
- `permissions_pkey (id)`; unique `permissions_key_key (key)`.
- `role_permissions_pkey (role_id, permission_id)`.
- `sessions_pkey (id)`; unique `sessions_token_hash_key (token_hash)`; index `sessions_user_id_expires_at_idx (user_id, expires_at)`.
- `module_installations_pkey (id)`; unique `module_installations_workspace_id_module_id_key (workspace_id, module_id)`.

### 5.4 Control foreign keys

All listed FKs use ON UPDATE CASCADE / ON DELETE CASCADE:

- `workspace_databases.workspace_id -> workspaces.id`
- `memberships.user_id -> users.id`
- `memberships.workspace_id -> workspaces.id`
- `sessions.user_id -> users.id`
- `membership_roles.membership_id -> memberships.id`
- `membership_roles.role_id -> roles.id`
- `role_permissions.role_id -> roles.id`
- `role_permissions.permission_id -> permissions.id`

Observed design gaps to keep visible (not silently alter in this Tenant migration):
- `roles.workspace_id` has no FK to `workspaces.id`.
- Control DB and Tenant DB are separate databases; Tenant `audit_events.actor_id` cannot have a normal FK to Control `users.id`.

### 5.5 Control migration ledger

Live `_prisma_migrations` contains:
- `20261031000100_control_init`: finished, not rolled back.
- `20261031000200_platform_admin`: one rolled-back ledger row and one finished ledger row; the finished row reports `applied_steps_count = 0`.

The live `users.is_platform_admin` column exists and is NOT NULL with default false. The checked-in migration `20261031000200_platform_admin/migration.sql` adds that column. Because the ledger contains a rolled-back and a finished record for the same migration name and the finished row reports zero applied steps, preserve this as a Control migration-history reconciliation item. Do not edit or delete Prisma migration ledger rows as part of the Tenant Commerce work.

## 6. Initial Commerce migration scope

The intended Tenant deployment sequence is:

1. Confirm the target database is one of the provisioned Workspace Tenant databases and its schema version is exactly `20261031000100_tenant_baseline`.
2. Confirm `tenant_settings`, `audit_events`, and `tenant_migrations` exist with the definitions in section 3.
3. Confirm no Commerce objects from the candidate already exist. Abort on unexpected collisions rather than dropping or replacing objects.
4. Preserve the existing Tenant baseline migration unchanged and do not recreate its tables.
5. Apply the Prisma-generated Commerce DDL candidate (reviewed and reconciled against the live baseline) as a new migration after the baseline. Proposed migration identifier: `20261102000100_tenant_commerce_initial` (provisional; final timestamp/name must be chosen at release time).
6. Apply custom constraints/indexes/triggers from the separate candidate only after confirming they are not duplicated by Prisma-generated DDL and that required PostgreSQL extensions are available.
7. Update the Tenant migration registry and Control `workspace_databases.schema_version` only through the approved migration runner/provisioning workflow, in the correct transaction/consistency boundary. Do not manually update either registry as an ad hoc step.
8. Verify schema and constraints on both Workspaces before marking either Tenant ready for Commerce traffic.

### 6.1 Candidate SQL sources

- `docs/architecture/tenant-schema-prisma-diff-candidate.sql`: generated from the current Tenant Prisma schema for clean-install review; it starts by creating Commerce enums and tables. It is NOT a ready-to-run upgrade migration.
- `docs/architecture/tenant-schema-final-constraints-candidate.sql`: custom DB constraints/indexes/triggers, review-only.
- `docs/architecture/tenant-schema-final-plan.md` and `docs/architecture/tenant-schema-approved-decisions.md`: approved design decisions.

The current clean-install candidate contains Commerce enums including `MediaDerivativeKind` (`ORIGINAL`, `MAIN`, `THUMBNAIL`) and `MediaDerivativeStatus` (`STAGED`, `PROCESSING`, `READY`, `FAILED`). MediaAsset is the logical asset; MediaAssetDerivative owns physical object metadata. ProductImage and VariantImage reference the logical MediaAsset, not derivative rows.

## 7. SQL preflight and postflight specification

These are proposed verification queries only; they have not been executed as migration statements.

### 7.1 Preflight: identify the target and baseline

```sql
SELECT current_database() AS database_name,
       current_schema() AS current_schema,
       current_user AS connected_role,
       version() AS postgres_version,
       now() AS captured_at;

SELECT version, applied_at
FROM public.tenant_migrations
ORDER BY applied_at;

SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;
```

### 7.2 Preflight: collision guard

```sql
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'stores', 'branches', 'warehouses', 'products', 'product_variants',
    'media_assets', 'media_asset_derivatives', 'product_images',
    'variant_images', 'image_import_batches', 'image_import_items',
    'stock_balances', 'stock_movements', 'stock_reservations',
    'inventory_costs'
  )
ORDER BY table_name;
```

Expected result for the currently inspected two Tenant DBs: zero rows.

### 7.3 Postflight: Commerce objects and media derivatives

```sql
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

SELECT t.typname AS enum_name, e.enumsortorder, e.enumlabel
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typnamespace = 'public'::regnamespace
ORDER BY t.typname, e.enumsortorder;

SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
```

The release checklist must additionally compare all expected PK/FK/unique/check/exclusion constraints and triggers against the approved Prisma/custom-constraint candidates. Validate that `btree_gist` exists before adding any range exclusion constraint. Verify all stock and price invariants from the approved decision document.

## 8. Required migration design constraints

- Do not edit `apps/api/prisma/tenant/migrations/20261031000100_tenant_baseline.sql`.
- Do not re-run `CREATE TABLE IF NOT EXISTS` baseline SQL as a substitute for migration history.
- Do not apply the clean-install diff blindly; reconcile its statements against the live baseline and remove any baseline duplication if present.
- Keep `tenant_settings`, `audit_events`, and `tenant_migrations` intact.
- Keep all Commerce DDL in a new, separately named migration.
- Use explicit schema qualification (`public`) in reviewed final SQL.
- Use transactional DDL where supported; isolate extension creation and any non-transactional operation with a documented rollback/forward-recovery plan.
- Price period exclusion must match Prisma's actual timestamp type. Current approved design uses timestamp without time zone fields and therefore requires `tsrange`, unless the Prisma types are deliberately changed before migration.
- Keep MediaAssetDerivative ORIGINAL/MAIN/THUMBNAIL design and image upload policies as approved.
- Do not add a Control-to-Tenant cross-database FK.
- Migration runner must be idempotent at the orchestration level, verify expected prior version, serialize concurrent Tenant migrations, record success only after DDL verification, and stop on partial/unknown state.

## 9. Blockers before executable upgrade SQL

1. Object Storage inventory is still missing: provider, bucket, key layout, object count, versioning, retention, checksum availability, and any existing files. No object-storage credentials were inspected.
2. Dedicated SELECT-only inspection role is not yet configured; the current runtime role has DML on `tenant_settings`.
3. Control migration ledger contains the duplicate rolled-back/finished platform-admin migration records described in section 5.5; this needs a separate audit, not an opportunistic repair.
4. The custom constraints candidate must be reconciled against the generated Commerce DDL, especially duplicate indexes/unique constraints and extension dependencies.
5. Isolated PostgreSQL migration test and rollback/forward-recovery validation are still required.

## 10. Approval gates

This document is a Migration Specification draft based on live catalog inspection. It is not permission to execute SQL.

Required before Migration Sign-off:
- Review this specification and resolve blockers.
- Generate an incremental SQL candidate from the exact live baseline to the reviewed Tenant Prisma schema (not from empty schema).
- Reconcile the generated DDL with custom constraints and the preserved baseline.
- Run clean-install and upgrade tests against disposable PostgreSQL databases for both current-baseline and empty-install paths.
- Verify migrations against both Workspace A and B in a controlled staging environment.
- Obtain explicit, separate user approval named **Migration Sign-off**.

Until that sign-off, do not generate/apply a migration in the live Workspace databases, do not run `prisma migrate deploy`, do not update migration registries, and do not generate Prisma Client as part of deployment.
