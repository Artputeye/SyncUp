"use strict";
const assert = require("node:assert/strict");
const { ImageImportService } = require("../dist/core/products/image-import.service");
const { NotFoundException } = require("@nestjs/common");

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BATCH_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const BATCH_A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function makeDb(ownedBatches) {
  const executed = [];
  return {
    executed,
    async $queryRaw(query) {
      if (query.text.includes("FROM image_import_items")) return [];
      assert.match(query.text, /image_import_batches/);
      if (query.text.includes("SELECT status")) {
        assert.match(query.text, /uploaded_by = \$2::uuid/, "commit lookup must bind uploader ownership");
        const [batchId, uploaderId] = query.values;
        const owner = ownedBatches.get(batchId);
        return owner === uploaderId ? [{ status: "PREVIEW_READY" }] : [];
      }
      throw new Error("Unexpected query: " + query.text);
    },
    async $executeRaw(query) {
      executed.push(query.text);
      return 1;
    },
  };
}

async function main() {
  const dbA = makeDb(new Map([[BATCH_A, USER_A]]));
  const dbB = makeDb(new Map([[BATCH_B, USER_A]]));
  const membershipLookups = [];
  const routedWorkspaces = [];
  const controlDb = {
    membership: {
      async findFirst({ where }) {
        membershipLookups.push(where);
        return { isOwner: true, roles: [] };
      },
    },
  };
  const databases = {
    async forMembership(userId, workspaceId) {
      routedWorkspaces.push({ userId, workspaceId });
      return workspaceId === WORKSPACE_A ? dbA : workspaceId === WORKSPACE_B ? dbB : null;
    },
  };
  const service = new ImageImportService(controlDb, databases, {});

  await assert.rejects(
    service.commit(USER_A, WORKSPACE_A, BATCH_B),
    (error) => error instanceof NotFoundException && error.getStatus() === 404,
    "a Batch ID from Workspace B must not resolve in Workspace A",
  );
  assert.deepEqual(routedWorkspaces.at(-1), { userId: USER_A, workspaceId: WORKSPACE_A });

  await assert.rejects(
    service.commit(USER_B, WORKSPACE_A, BATCH_A),
    (error) => error instanceof NotFoundException && error.getStatus() === 404,
    "a different uploader must not commit another user's Batch",
  );

  const ownResult = await service.commit(USER_A, WORKSPACE_B, BATCH_B);
  assert.deepEqual(ownResult, { batchId: BATCH_B, status: "COMMITTED", applied: 0, failed: 0, total: 0 });
  assert.ok(dbB.executed.some((sql) => sql.includes("UPDATE image_import_batches")));
  assert.ok(dbB.executed.some((sql) => sql.includes("INSERT INTO audit_events")));
  assert.equal(dbA.executed.length, 0, "cross-Workspace attempts must not mutate Workspace A");
  assert.ok(membershipLookups.some((where) => where.userId === USER_A && where.workspaceId === WORKSPACE_A));
  assert.ok(membershipLookups.some((where) => where.userId === USER_B && where.workspaceId === WORKSPACE_A));

  console.log("P0.7_IMAGE_IMPORT_WORKSPACE_ISOLATION PASS");
  console.log("PASS Batch IDs are resolved only through the requested Workspace Tenant DB");
  console.log("PASS commit query enforces uploaded_by ownership");
  console.log("PASS valid own-Workspace Batch commits without touching another Tenant DB");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
