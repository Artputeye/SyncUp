# Architecture decisions

## ADR-001: Modular monolith
The platform ships as a web app and API with explicit module boundaries. Business modules are independently versioned packages but execute within the platform deployment initially. This avoids premature microservice operations.

## ADR-002: Multi-workspace
A platform identity can belong to multiple workspaces through explicit memberships. Workspace context must be resolved from an authenticated session and membership check.

## ADR-003: Database per workspace
- A central control-plane database stores platform users, workspaces, memberships, module catalog/activation metadata, and platform audit events.
- Each workspace has its own PostgreSQL database for workspace-owned business data.
- Workspace database connection details are encrypted or secret-managed server-side and never returned to browsers.
- A server-side connection registry resolves a workspace database only after authentication and membership authorization.
- Provisioning and migrations are orchestrated, retryable operations with explicit lifecycle states.
- Database-per-workspace improves isolation and backup/restore boundaries but increases connection-pool, migration, monitoring and operational costs. Use bounded pools and idle connection eviction.

## ADR-004: Module installation modes
Support bundled modules and separately packaged modules. The platform catalog records module identity, version, compatibility, dependencies and activation state per workspace. Module code is trusted server-side code: installation requires signature/trust validation, compatibility checks, controlled migrations and deployment/restart orchestration. Do not execute arbitrary uploaded code dynamically in the API process.

## Core invariants
1. Core contains no module-specific business rules.
2. Backend authorization is mandatory; frontend navigation visibility is not security.
3. Workspace IDs from clients are selectors only, never proof of access.
4. Cross-workspace access is denied by default.
5. Workspace database credentials never enter client-visible payloads.
6. Module-to-module communication uses public contracts/events, not internal imports.
