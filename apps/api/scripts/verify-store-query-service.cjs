const assert = require("node:assert/strict");
const { StoreQueryService } = require("../dist/core/tenant/store-query.service");

async function main() {
  let membershipCall;
  let queryText = "";
  const rows = [{
    id: "store-1", name: "ARTTECH", slug: "arttech", status: "ACTIVE",
    storeType: "OMNICHANNEL", currency: "THB", timezone: "Asia/Bangkok",
    createdAt: new Date("2026-11-05T00:00:00.000Z"),
    activeBranchCount: 1, defaultBranchName: "สำนักงานใหญ่"
  }];
  const service = new StoreQueryService({
    async forMembership(userId, workspaceId) {
      membershipCall = [userId, workspaceId];
      return {
        async $queryRaw(strings) {
          queryText = Array.from(strings).join("?");
          return rows;
        }
      };
    }
  });
  const result = await service.listStores("user-1", "workspace-1");
  assert.deepEqual(membershipCall, ["user-1", "workspace-1"]);
  assert.match(queryText, /FROM stores s/);
  assert.match(queryText, /FROM branches b/);
  assert.match(queryText, /is_default = TRUE/);
  assert.equal(result[0].slug, "arttech");
  assert.equal(result[0].activeBranchCount, 1);
  console.log("PASS StoreQueryService: membership-scoped lookup, branch summary and default Branch projection");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
