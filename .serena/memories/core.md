# SyncUp — project core
- New greenfield project at `D:\\@Project\\SyncUp`; Windows development environment.
- Product intent: team-oriented, self-hosted business web application.
- Architecture direction: modular monolith; independently bounded business modules over shared platform services.
- Access model: RBAC with permissions scoped to modules and actions.
- Extension invariant: adding a business module should require module implementation/registration, not edits to core platform code.
- Architecture and stack are proposed baseline pending user confirmation; no application source files created yet.
- Planned domains: platform core (identity, tenants/workspaces, RBAC, module catalog, audit, settings) and business modules.
- See `mem:tech_stack` for proposed technologies, `mem:conventions` for module boundaries, `mem:suggested_commands` for planned workflows, and `mem:task_completion` for validation gates.