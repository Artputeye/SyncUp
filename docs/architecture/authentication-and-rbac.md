# Authentication and RBAC baseline

## Authentication
- Password hashes use bcrypt; plaintext passwords are never persisted.
- Sessions use cryptographically random opaque tokens. Only SHA-256 token hashes are stored in the control database.
- Session expiry and revocation are checked on every authenticated request.
- Production delivery should use an HttpOnly, Secure, SameSite cookie, CSRF protection for state-changing cookie-authenticated requests, rate limits and generic login errors.
- Workspace selection must be validated against the authenticated user's active membership on every request.

## RBAC
- Permission keys are stable strings, normally namespaced as module.resource.action.
- Roles are workspace-scoped. Membership-role assignments are the only source of workspace role grants.
- Authorization checks must verify that the selected membership belongs to the authenticated user and the requested workspace before evaluating role permissions.
- Platform administration and workspace RBAC are separate authorization domains.
- Deny by default. UI visibility never substitutes for backend enforcement.

## Current implementation status
The schema and service foundations are present. HTTP authentication guards, secure cookie transport, CSRF/rate limiting, role management endpoints, bootstrap-owner workflow and comprehensive authorization tests remain to be implemented before production exposure.
