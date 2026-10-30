# SyncUp architecture conventions
- Prefer modular monolith over microservices until operational scale justifies separation.
- Core owns cross-cutting capabilities only: authentication/identity, workspace membership, RBAC, module catalog/activation, navigation composition, audit, settings, file-storage abstraction.
- Business modules own their domain entities, services, API routes, UI routes/components, migrations, and permission declarations.
- Modules must not import another module's internal implementation; communicate through explicit public contracts/events.
- Module metadata declares stable id, name, version, dependencies, navigation entries, and permission keys.
- Core discovers/registers modules through a registry/catalog; avoid hard-coded per-module conditionals in core.
- Enforce authorization on backend endpoints/services; hiding frontend navigation is not authorization.
- Use workspace-scoped data ownership for team data; derive workspace context from authenticated membership, not trusted client-supplied identifiers.
- Keep shared packages limited to reusable UI, types/contracts, config, and utilities; avoid putting business rules in shared packages.