# Database tenancy and provisioning

## Database layout
- Control plane: one shared database for users, sessions, workspaces, memberships, roles, permissions, module installation metadata and workspace database routing metadata.
- Tenant plane: one PostgreSQL database per workspace. Business-module tables live only in that workspace database.
- The control plane stores tenant database name and non-secret routing metadata. Credentials are supplied through server-side runtime configuration or a secret manager; never return them to browsers.

## Provisioning lifecycle
1. Create a workspace in PROVISIONING state and its initial owner membership in the control database.
2. Derive a database name from the immutable workspace UUID, not the user-provided slug.
3. Use a dedicated privileged provisioning connection to create the database with a safely quoted identifier.
4. Record database routing metadata in the control plane.
5. Apply the tenant baseline migration set.
6. Mark the workspace ACTIVE only after migrations and health checks succeed. On failure mark it FAILED and allow a controlled retry/cleanup operation.

## Connection registry
The registry requires an authenticated user ID and workspace ID, verifies active membership against the control database, and only then resolves the tenant database. It caches Prisma clients by workspace and disconnects them during shutdown. Production still needs bounded cache size, idle eviction and connection-pool limits.

## Operational requirements
- Provisioning and runtime database credentials are separate. The runtime role must not have CREATEDB or superuser privileges.
- Encrypt stored tenant secrets if per-tenant credentials are persisted; encryption keys belong outside the database.
- Run tenant migrations with an explicit migration coordinator and per-workspace migration status.
- Add connection limits, timeouts, retry policy and observability.
- Back up and restore each tenant database independently and test restore workflows.
