# Module contract (design baseline)

Every future module must expose a manifest with:
- Stable namespaced module ID.
- Name, semantic version and compatibility range for the SyncUp platform.
- Declared dependencies.
- Permission keys.
- Navigation contributions.
- Backend registration and frontend route entry points.
- Migration set and lifecycle hooks.

The core consumes the public manifest and registry interface only. Module packages may depend on approved platform contracts; they must not reach into another module's private implementation. Package installation is a trusted deployment operation, not arbitrary runtime code execution.
