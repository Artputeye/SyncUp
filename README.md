# SyncUp

Team-oriented, self-hosted business platform built as a modular monolith.

## Decisions
- Multi-workspace platform.
- Dedicated PostgreSQL database per workspace.
- Bundled and separately packaged modules are both supported by the module catalog design.
- Core owns identity, workspace membership, RBAC, module registry, audit and settings.
- No business modules are included in this Foundation bootstrap.

## Repository
- `apps/web`: Next.js frontend.
- `apps/api`: NestJS REST API.
- `packages/*`: shared contracts, types, config and utilities.
- `infrastructure/*`: self-hosted runtime assets.
- `docs/architecture`: architecture decisions and tenancy model.

## Prerequisites
- Node.js 24.
- pnpm 10: `corepack enable`, then `corepack prepare pnpm@10.18.3 --activate`.
- Docker Engine / Docker Desktop for PostgreSQL.

## Start
1. Copy `.env.example` to `.env` and set strong credentials.
2. Start database: `docker compose up -d postgres`.
3. Install: `pnpm install`.
4. Start apps: `pnpm dev`.

Authentication, workspace provisioning, migrations and module installation are not implemented yet.

## Database tenancy
The control database stores platform identity and workspace metadata. Each workspace receives a separate PostgreSQL database. API requests resolve workspace context from authenticated membership and use a server-side database registry; client-supplied workspace IDs are never authorization proof.
