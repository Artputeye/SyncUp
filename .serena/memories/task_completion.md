# SyncUp task completion gates (to configure during bootstrap)
- Run formatting/lint checks for changed workspaces.
- Run TypeScript type checking across affected workspaces.
- Run unit tests for affected module/core packages.
- Run backend integration tests for API, RBAC, and workspace isolation when those capabilities change.
- Run production build for web and API before declaring a release-ready change.
- Validate Docker Compose deployment and persistent volumes for deployment-related changes.
- Do not claim browser, deployment, or database integration tests unless actually executed.