# Proposed technology stack (not yet implemented)
- Frontend: Next.js App Router, React, TypeScript; Tailwind CSS + shadcn/ui.
- Backend: NestJS, TypeScript, REST API with OpenAPI.
- Data: PostgreSQL + Prisma migrations/ORM.
- Monorepo: pnpm workspaces + Turborepo; apps and shared packages separated.
- Runtime/deployment: Docker Compose for self-hosted deployment; Redis/BullMQ optional when background jobs or distributed caching are needed.
- File storage: local persistent volume initially; keep storage behind an adapter so S3-compatible storage can be added later.
- Versions and package manager lockfile to be pinned during bootstrap after user approval.