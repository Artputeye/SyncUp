# Tenant Schema — Approved Decisions

Decision status: **Approved by user**
Decision date: 2026-11-02
Approval scope: Baseline policy for the seven Open Decision groups. This is not Migration Sign-off.

The approved details are maintained in:
- `docs/architecture/tenant-schema-final-plan.md` — policy, schema alignment, constraints and rollout plan.
- `docs/architecture/tenant-schema-prisma-diff-candidate.sql` — Prisma-generated clean-install SQL candidate from the current Tenant Prisma schema.
- `docs/architecture/tenant-schema-final-constraints-candidate.sql` — custom constraint/index/trigger candidate, review-only.

## Seven approvals
1. Default Branch/Warehouse: Store and every new Branch receive defaults transactionally; default switching is atomic and audited.
2. Price History: zero allowed, negative prohibited, no ordinary backdating, future prices allowed, half-open non-overlapping periods, Store currency, append-only history.
3. Reservation/Movement: ACTIVE -> RELEASED/CONSUMED; expiry releases; physical movement sign convention; reversal is exact opposite; reservation events are not physical ledger rows.
4. WAC: Decimal only; quantity 3 decimals; cost/value 6 decimals; HALF_UP; no negative stock; zero stock resets value/cost; reconciliation tolerance 0.000001.
5. Images: staging, content validation, promote-before-READY, retry-safe cleanup, duplicate relation prevention and explicit primary-image replacement. Approved outputs: main WebP 800 × 800 px (1:1), target 100–200 KB and max 200 KB; thumbnail WebP 150 × 150 px, target 20–30 KB and max 30 KB. The 200 KB ceiling applies to optimized derivatives, not source uploads; source ingress limits remain separately configurable. All physical files use MediaAssetDerivative kinds ORIGINAL, MAIN and THUMBNAIL. MediaAsset is the logical image; ProductImage/VariantImage continue referencing it once, with no duplicate gallery rows for derivatives.
6. Provisioning: separate Workspace/Store state machines, idempotent bounded retry, route enabled only after Tenant readiness, compensation/reconciliation, per-Tenant migration registry.
7. DB enforcement: composite/unique/check constraints, partial default indexes, price exclusion via btree_gist, append-only StockMovement trigger, transaction/locking for cross-row invariants.

## Execution status
- Prisma schema SQL candidate generated from empty schema for clean-install review; it is not an upgrade migration and was not applied.
- Custom constraints candidate is separate and must be reconciled with generated DDL.
- The current generated SQL confirms ProductPrice effective-time columns are TIMESTAMP(3), so the candidate overlap operator must use tsrange unless the Prisma native types are changed.
- Docker Desktop engine is unavailable and host psql/pg_isready are absent. Isolated PostgreSQL verification is blocked.
- Existing Tenant baseline SQL `apps/api/prisma/tenant/migrations/20261031000100_tenant_baseline.sql` must be preserved and reconciled for upgrade testing.
- No migration directory/file was created by this approval, no SQL was executed, no Prisma Client was generated, and no Tenant database was modified.
- Separate Migration Sign-off is still required after isolated tests and final review.
