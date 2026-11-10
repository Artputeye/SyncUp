const assert = require("node:assert/strict");
const { BadRequestException, NotFoundException } = require("@nestjs/common");
const { StoreQueryService } = require("../dist/core/tenant/store-query.service");

async function main() {
  const before = { id: "store-1", name: "Old Name", slug: "old-name", status: "ACTIVE", storeType: "OMNICHANNEL", description: null, contactEmail: null, contactPhone: null, address: null, currency: "THB", timezone: "Asia/Bangkok", createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z") };
  const after = { ...before, name: "New Name", description: "Description", contactEmail: "hello@example.com", currency: "USD", timezone: "Asia/Singapore" };
  const captured = [];
  const tx = {
    async $queryRaw(strings, ...values) {
      const sql = Array.from(strings).join("?");
      captured.push({ sql, values });
      if (sql.includes("UPDATE stores")) return [after];
      if (sql.includes("FROM stores WHERE id")) return [before];
      return [];
    },
    async $executeRaw(strings, ...values) { captured.push({ sql: Array.from(strings).join("?"), values }); return 1; }
  };
  const service = new StoreQueryService({
    async forMembership(userId, workspaceId) {
      return { $queryRaw: tx.$queryRaw.bind(tx), async $transaction(callback) { return callback(tx); } };
    }
  });
  const detail = await service.getStore("user-1", "workspace-1", "store-1");
  assert.equal(detail.id, "store-1");
  const updated = await service.updateStore("user-1", "workspace-1", "store-1", {
    name: " New Name ", description: " Description ", contactEmail: " HELLO@example.com ",
    contactPhone: "", address: { line1: " 1 Main Road ", province: "Bangkok" }, currency: "usd", timezone: "Asia/Singapore"
  });
  assert.equal(updated.name, "New Name");
  assert.equal(updated.currency, "USD");
  assert.equal(updated.timezone, "Asia/Singapore");
  assert.ok(captured.some((item) => item.sql.includes("FOR UPDATE")));
  assert.ok(captured.some((item) => item.sql.includes("UPDATE stores")));
  assert.ok(captured.some((item) => item.sql.includes("STORE_UPDATED")));
  assert.ok(captured.some((item) => item.values.includes("hello@example.com")));
  await assert.rejects(() => service.updateStore("user-1", "workspace-1", "store-1", { name: "Bad", description: null, contactEmail: "not-an-email", contactPhone: null, address: null, currency: "THB", timezone: "Asia/Bangkok" }), BadRequestException);
  await assert.rejects(() => service.updateStore("user-1", "workspace-1", "store-1", { name: "Bad", description: null, contactEmail: null, contactPhone: null, address: null, currency: "THB", timezone: "Not/AZone" }), BadRequestException);
  const missing = new StoreQueryService({ async forMembership() { return { async $queryRaw() { return []; } }; } });
  await assert.rejects(() => missing.getStore("user-1", "workspace-1", "missing"), NotFoundException);
  console.log("PASS Store detail/edit service: membership scope, normalization, validation, row lock, audit and not-found");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
