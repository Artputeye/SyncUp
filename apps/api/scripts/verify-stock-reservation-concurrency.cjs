const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Client } = require("pg");
const { PrismaClient } = require("@prisma/client");
const { StoreLifecycleService } = require("../dist/core/tenant/store-lifecycle.service");
const { StockInventoryService } = require("../dist/core/inventory/stock-inventory.service");
const { Module } = require("@nestjs/common");
const { NestFactory } = require("@nestjs/core");
const { StockInventoryController } = require("../dist/core/inventory/stock-inventory.controller");
const { AuthService } = require("../dist/core/auth/auth.service");
const { RbacService } = require("../dist/core/rbac/rbac.service");

const root = path.resolve(__dirname, "../../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const adminUrl = process.env.TEST_POSTGRES_ADMIN_URL;
if (!adminUrl) throw new Error("Set TEST_POSTGRES_ADMIN_URL to localhost disposable PostgreSQL.");
const parsed = new URL(adminUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
  throw new Error("Safety stop: TEST_POSTGRES_ADMIN_URL must point to localhost only.");
}

const migrations = [
  "apps/api/prisma/tenant/migrations/20261031000100_tenant_baseline.sql",
  "docs/architecture/tenant-commerce-clean-install.candidate.sql",
  "docs/architecture/tenant-commerce-custom-constraints.candidate.sql",
  "docs/architecture/tenant-canonicalization-constraints.candidate.sql",
  "docs/architecture/tenant-branch-warehouse-lifecycle.candidate.sql",
].map(read);

async function connect(url) {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  await client.connect();
  return client;
}
function tenantUrl(base, database) {
  const url = new URL(base);
  url.pathname = "/" + database;
  return url.toString();
}
async function seedStock(client, warehouseId, uomId, productId, suffix, quantity) {
  const variantId = randomUUID();
  await client.query(
    "INSERT INTO product_variants (id,product_id,base_uom_id,sku,normalized_sku,title,status,updated_at) VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',NOW())",
    [variantId, productId, uomId, "INV-" + suffix, ("inv-" + suffix).toLowerCase(), "Inventory " + suffix],
  );
  await client.query(
    "INSERT INTO stock_balances (warehouse_id,variant_id,on_hand,reserved,available,updated_at) VALUES ($1,$2,$3,0,$3,NOW())",
    [warehouseId, variantId, quantity],
  );
  await client.query(
    "INSERT INTO inventory_costs (warehouse_id,variant_id,quantity,average_unit_cost,inventory_value,updated_at) VALUES ($1,$2,$3,1,$3,NOW())",
    [warehouseId, variantId, quantity],
  );
  return variantId;
}
async function balance(client, warehouseId, variantId) {
  const result = await client.query(
    "SELECT on_hand::text,reserved::text,available::text FROM stock_balances WHERE warehouse_id=$1 AND variant_id=$2",
    [warehouseId, variantId],
  );
  assert.equal(result.rowCount, 1);
  return result.rows[0];
}
async function main() {
  const admin = await connect(adminUrl);
  const database = "syncup_stock_concurrency_" + process.pid + "_" + Date.now();
  let sql;
  let prisma;
  const peers = [];
  try {
    await admin.query('CREATE DATABASE "' + database + '"');
    const url = tenantUrl(adminUrl, database);
    sql = await connect(url);
    for (const migration of migrations) await sql.query(migration);

    prisma = new PrismaClient({ datasources: { db: { url } } });
    await prisma.$connect();
    const lifecycle = new StoreLifecycleService({ forMembership: async () => prisma });
    const actorId = randomUUID();
    const stock = new StockInventoryService({ forMembership: async () => prisma });
    const store = await lifecycle.createStore(actorId, "stock-test", { name: "Stock Test", slug: "stock-test" });
    const uomId = randomUUID();
    const productId = randomUUID();
    await sql.query(
      "INSERT INTO unit_of_measures (id,code,normalized_code,name,symbol,dimension,updated_at) VALUES ($1,'EA','ea','Each','ea','COUNT',NOW())",
      [uomId],
    );
    await sql.query(
      "INSERT INTO products (id,name,normalized_name,updated_at) VALUES ($1,'Concurrency Product','concurrency product',NOW())",
      [productId],
    );

    for (let i = 0; i < 4; i++) peers.push(await connect(url));
    const [a, b, c, d] = peers;
    const warehouseId = store.defaultWarehouseId;

    // API quantity contracts reject JSON floating point and precision beyond NUMERIC(20,3).
    await assert.rejects(() => stock.reserve(actorId, "stock-test", {
      warehouseId, variantId: randomUUID(), quantity: 1, idempotencyKey: "invalid-float",
    }), error => error.status === 400);
    await assert.rejects(() => stock.reserve(actorId, "stock-test", {
      warehouseId, variantId: randomUUID(), quantity: "1.0001", idempotencyKey: "invalid-precision",
    }), error => error.status === 400);
    await assert.rejects(() => stock.receive(actorId, "stock-test", {
      warehouseId, variantId: randomUUID(), quantity: "1", unitCost: 1, idempotencyKey: "invalid-cost-float",
    }), error => error.status === 400);
    console.log("PASS Decimal API contract: quantity/cost reject JSON numbers and excess precision");

    // Two simultaneous reservations compete for the same ten available units.
    const reserveVariant = await seedStock(sql, warehouseId, uomId, productId, "reserve-race", 10);
    const reservedRace = await Promise.allSettled([
      stock.reserve(actorId, "stock-test", { warehouseId, variantId: reserveVariant, quantity: "7", idempotencyKey: "reserve-race-a" }),
      stock.reserve(actorId, "stock-test", { warehouseId, variantId: reserveVariant, quantity: "7", idempotencyKey: "reserve-race-b" }),
    ]);
    assert.equal(reservedRace.filter(result => result.status === "fulfilled").length, 1, "only one competing reservation may succeed");
    assert.equal(reservedRace.filter(result => result.status === "rejected" && result.reason.status === 409).length, 1);
    let state = await balance(sql, warehouseId, reserveVariant);
    assert.deepEqual(state, { on_hand: "10.000", reserved: "7.000", available: "3.000" });
    const activeReservations = await sql.query(
      "SELECT count(*)::int AS n FROM stock_reservations WHERE warehouse_id=$1 AND variant_id=$2 AND status='ACTIVE'",
      [warehouseId, reserveVariant],
    );
    assert.equal(activeReservations.rows[0].n, 1);
    const reserveAudit = await sql.query("SELECT count(*)::int AS n FROM audit_events WHERE action='STOCK_RESERVED' AND resource_type='StockReservation'");
    assert.equal(reserveAudit.rows[0].n, 1);
    console.log("PASS Reservation concurrency: competing 7+7 reservations against 10 units cannot oversubscribe");

    // Repeating the same idempotency key returns the original reservation without mutating balances.
    const winningReservation = await sql.query("SELECT id,idempotency_key FROM stock_reservations WHERE warehouse_id=$1 AND variant_id=$2 AND status='ACTIVE'", [warehouseId, reserveVariant]);
    const reservationReplay = await stock.reserve(actorId, "stock-test", { warehouseId, variantId: reserveVariant, quantity: "7", idempotencyKey: winningReservation.rows[0].idempotency_key });
    assert.equal(reservationReplay.id, winningReservation.rows[0].id);
    assert.equal(reservationReplay.idempotentReplay, true);
    state = await balance(sql, warehouseId, reserveVariant);
    assert.deepEqual(state, { on_hand: "10.000", reserved: "7.000", available: "3.000" });
    console.log("PASS Reservation idempotency: retry returns the same reservation without a second balance mutation");

    // Concurrent release requests may transition one reservation only once.
    const reservation = await sql.query(
      "SELECT id FROM stock_reservations WHERE warehouse_id=$1 AND variant_id=$2 AND status='ACTIVE'",
      [warehouseId, reserveVariant],
    );
    const releases = await Promise.all([stock.release(actorId, "stock-test", reservation.rows[0].id), stock.release(actorId, "stock-test", reservation.rows[0].id)]);
    assert.equal(releases.filter(result => result.changed).length, 1);
    state = await balance(sql, warehouseId, reserveVariant);
    assert.deepEqual(state, { on_hand: "10.000", reserved: "0.000", available: "10.000" });
    const releaseMovements = await sql.query(
      "SELECT count(*)::int AS n FROM stock_movements WHERE reference_id=$1",
      [reservation.rows[0].id],
    );
    assert.equal(releaseMovements.rows[0].n, 0);
    const releaseAudit = await sql.query("SELECT count(*)::int AS n FROM audit_events WHERE action='STOCK_RESERVATION_RELEASED' AND resource_id=$1", [reservation.rows[0].id]);
    assert.equal(releaseAudit.rows[0].n, 1);
    console.log("PASS Reservation release concurrency: double release restores availability without creating a physical ledger row");

    // A reservation is consumed once; on_hand and reserved fall together, available is unchanged.
    const consumeVariant = await seedStock(sql, warehouseId, uomId, productId, "consume", 12);
    const consumeId = (await stock.reserve(actorId, "stock-test", { warehouseId, variantId: consumeVariant, quantity: "4", idempotencyKey: "consume-once" })).id;
    assert.ok(consumeId);
    assert.deepEqual(await stock.consume(actorId, "stock-test", consumeId), { id: consumeId, changed: true, status: "CONSUMED" });
    assert.deepEqual(await stock.consume(actorId, "stock-test", consumeId), { id: consumeId, changed: false, status: "CONSUMED" });
    state = await balance(sql, warehouseId, consumeVariant);
    assert.deepEqual(state, { on_hand: "8.000", reserved: "0.000", available: "8.000" });
    const saleMovements = await sql.query(
      "SELECT count(*)::int AS n FROM stock_movements WHERE reference_id=$1 AND movement_type='SALE'",
      [consumeId],
    );
    assert.equal(saleMovements.rows[0].n, 1);
    const consumeCost = await sql.query("SELECT quantity::text,average_unit_cost::text,inventory_value::text FROM inventory_costs WHERE warehouse_id=$1 AND variant_id=$2", [warehouseId, consumeVariant]);
    assert.deepEqual(consumeCost.rows[0], { quantity: "8.000", average_unit_cost: "1.000000", inventory_value: "8.000000" });
    const consumeAudit = await sql.query("SELECT count(*)::int AS n FROM audit_events WHERE action='STOCK_RESERVATION_CONSUMED' AND resource_id=$1", [consumeId]);
    assert.equal(consumeAudit.rows[0].n, 1);
    console.log("PASS Reservation consumption: exactly-once consume decreases on-hand and reserved without changing available");

    // Simultaneous sales use the same row lock and cannot drive stock below zero.
    const saleVariant = await seedStock(sql, warehouseId, uomId, productId, "sale-race", 10);
    const sales = await Promise.allSettled([
      stock.issue(actorId, "stock-test", { warehouseId, variantId: saleVariant, quantity: "7", idempotencyKey: "sale-race-a" }),
      stock.issue(actorId, "stock-test", { warehouseId, variantId: saleVariant, quantity: "7", idempotencyKey: "sale-race-b" }),
    ]);
    assert.equal(sales.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(sales.filter(result => result.status === "rejected" && result.reason.status === 409).length, 1);
    state = await balance(sql, warehouseId, saleVariant);
    assert.deepEqual(state, { on_hand: "3.000", reserved: "0.000", available: "3.000" });
    const saleCount = await sql.query(
      "SELECT count(*)::int AS n FROM stock_movements WHERE warehouse_id=$1 AND variant_id=$2 AND movement_type='SALE'",
      [warehouseId, saleVariant],
    );
    assert.equal(saleCount.rows[0].n, 1);
    const saleCost = await sql.query("SELECT quantity::text,average_unit_cost::text,inventory_value::text FROM inventory_costs WHERE warehouse_id=$1 AND variant_id=$2", [warehouseId, saleVariant]);
    assert.deepEqual(saleCost.rows[0], { quantity: "3.000", average_unit_cost: "1.000000", inventory_value: "3.000000" });
    const winningSaleReplay = await stock.issue(actorId, "stock-test", { warehouseId, variantId: saleVariant, quantity: "7", idempotencyKey: (await sql.query("SELECT idempotency_key FROM stock_movements WHERE warehouse_id=$1 AND variant_id=$2 AND movement_type='SALE'", [warehouseId, saleVariant])).rows[0].idempotency_key });
    assert.equal(winningSaleReplay.idempotentReplay, true);
    const issueAudit = await sql.query("SELECT count(*)::int AS n FROM audit_events WHERE action='STOCK_ISSUED' AND resource_id=$1", [winningSaleReplay.movementId]);
    assert.equal(issueAudit.rows[0].n, 1);
    console.log("PASS Inventory concurrency: competing sales cannot oversell or create duplicate sale movements");

    // Deliberately fail after the balance update: transaction must roll back the balance change.
    const rollbackVariant = await seedStock(sql, warehouseId, uomId, productId, "rollback", 5);
    const winningSale = await sql.query("SELECT idempotency_key FROM stock_movements WHERE warehouse_id=$1 AND variant_id=$2 AND movement_type='SALE'", [warehouseId, saleVariant]);
    await assert.rejects(() => stock.issue(actorId, "stock-test", { warehouseId, variantId: rollbackVariant, quantity: "2", idempotencyKey: "rollback-ledger-failure", reason: "x".repeat(501) }));
    state = await balance(sql, warehouseId, rollbackVariant);
    assert.deepEqual(state, { on_hand: "5.000", reserved: "0.000", available: "5.000" });
    const rollbackCost = await sql.query("SELECT quantity::text,average_unit_cost::text,inventory_value::text FROM inventory_costs WHERE warehouse_id=$1 AND variant_id=$2", [warehouseId, rollbackVariant]);
    assert.deepEqual(rollbackCost.rows[0], { quantity: "5.000", average_unit_cost: "1.000000", inventory_value: "5.000000" });
    console.log("PASS Inventory transaction rollback: failed ledger insert restores the previous balance");

    // Expired ACTIVE reservations are released by the bounded expiry worker.
    const expiryVariant = await seedStock(sql, warehouseId, uomId, productId, "expiry", 4);
    const expiredReservation = await stock.reserve(actorId, "stock-test", {
      warehouseId, variantId: expiryVariant, quantity: "2", idempotencyKey: "expiry-reservation",
      expiresAt: "2000-01-01T00:00:00.000Z",
    });
    const expiryResult = await stock.releaseExpired(actorId, "stock-test", 100);
    assert.ok(expiryResult.released >= 1);
    state = await balance(sql, warehouseId, expiryVariant);
    assert.deepEqual(state, { on_hand: "4.000", reserved: "0.000", available: "4.000" });
    const expiredState = await sql.query("SELECT status FROM stock_reservations WHERE id=$1", [expiredReservation.id]);
    assert.equal(expiredState.rows[0].status, "RELEASED");
    console.log("PASS Reservation expiry: expired ACTIVE reservations release reserved quantity without physical ledger rows");

    const consumeExpired = await stock.reserve(actorId, "stock-test", {
      warehouseId, variantId: expiryVariant, quantity: "1", idempotencyKey: "consume-expired-reservation",
      expiresAt: "2000-01-01T00:00:00.000Z",
    });
    assert.deepEqual(await stock.consume(actorId, "stock-test", consumeExpired.id), {
      id: consumeExpired.id, changed: false, status: "RELEASED", reason: "EXPIRED",
    });
    state = await balance(sql, warehouseId, expiryVariant);
    assert.deepEqual(state, { on_hand: "4.000", reserved: "0.000", available: "4.000" });
    const expiredSale = await sql.query("SELECT count(*)::int AS n FROM stock_movements WHERE reference_id=$1 AND movement_type='SALE'", [consumeExpired.id]);
    assert.equal(expiredSale.rows[0].n, 0);
    console.log("PASS Consume expiry guard: expired reservation is released and never posts a SALE movement");

    // Receipt and reversal use NUMERIC WAC and an immutable, exactly-opposite physical ledger entry.
    const receiveVariant = await seedStock(sql, warehouseId, uomId, productId, "receive-reversal", 10);
    const receipt = await stock.receive(actorId, "stock-test", {
      warehouseId, variantId: receiveVariant, quantity: "5", unitCost: "2.000000",
      idempotencyKey: "receipt-wac-1",
    });
    assert.equal(receipt.totalCost, "10.000000");
    const receiptReplay = await stock.receive(actorId, "stock-test", {
      warehouseId, variantId: receiveVariant, quantity: "5", unitCost: "2.000000",
      idempotencyKey: "receipt-wac-1",
    });
    assert.equal(receiptReplay.movementId, receipt.movementId);
    assert.equal(receiptReplay.idempotentReplay, true);
    state = await balance(sql, warehouseId, receiveVariant);
    assert.deepEqual(state, { on_hand: "15.000", reserved: "0.000", available: "15.000" });
    let wac = await sql.query("SELECT quantity::text,average_unit_cost::text,inventory_value::text FROM inventory_costs WHERE warehouse_id=$1 AND variant_id=$2", [warehouseId, receiveVariant]);
    assert.deepEqual(wac.rows[0], { quantity: "15.000", average_unit_cost: "1.333333", inventory_value: "19.999995" });
    const reversal = await stock.reverseMovement(actorId, "stock-test", receipt.movementId, {
      idempotencyKey: "receipt-reversal-1", reason: "Correct duplicate receipt",
    });
    assert.equal(reversal.quantityDelta, "-5.000");
    const reversalReplay = await stock.reverseMovement(actorId, "stock-test", receipt.movementId, {
      idempotencyKey: "receipt-reversal-1", reason: "Correct duplicate receipt",
    });
    assert.equal(reversalReplay.movementId, reversal.movementId);
    assert.equal(reversalReplay.idempotentReplay, true);
    const reversalAudit = await sql.query("SELECT count(*)::int AS n FROM audit_events WHERE action='STOCK_MOVEMENT_REVERSED' AND resource_id=$1", [reversal.movementId]);
    assert.equal(reversalAudit.rows[0].n, 1);
    state = await balance(sql, warehouseId, receiveVariant);
    assert.deepEqual(state, { on_hand: "10.000", reserved: "0.000", available: "10.000" });
    wac = await sql.query("SELECT quantity::text,average_unit_cost::text,inventory_value::text FROM inventory_costs WHERE warehouse_id=$1 AND variant_id=$2", [warehouseId, receiveVariant]);
    assert.deepEqual(wac.rows[0], { quantity: "10.000", average_unit_cost: "1.000000", inventory_value: "10.000000" });
    console.log("PASS Inventory WAC: receipt updates quantity/value/average cost using NUMERIC HALF_UP");
    console.log("PASS Movement reversal: exact opposite quantity/cost, idempotent and linked to original movement");

    // Database checks independently reject impossible balance states and non-positive reservations.
    await assert.rejects(
      () => sql.query(
        "UPDATE stock_balances SET reserved=11,available=-1 WHERE warehouse_id=$1 AND variant_id=$2",
        [warehouseId, rollbackVariant],
      ),
      error => error.code === "23514",
    );
    await assert.rejects(
      () => sql.query(
        "INSERT INTO stock_reservations (id,warehouse_id,variant_id,quantity,reference_type,updated_at) VALUES ($1,$2,$3,0,'ORDER',NOW())",
        [randomUUID(), warehouseId, rollbackVariant],
      ),
      error => error.code === "23514",
    );
    console.log("PASS Inventory constraints: negative/over-reserved balances and zero-quantity reservations are rejected");

    // Exercise the real HTTP controller and production Auth/RBAC guards against the same Disposable DB service.
    const httpVariant = await seedStock(sql, warehouseId, uomId, productId, "http-smoke", 2);
    class StockInventoryHttpTestModule {}
    Module({
      controllers: [StockInventoryController],
      providers: [
        { provide: StockInventoryService, useValue: stock },
        { provide: AuthService, useValue: { resolveSession: async token => {
          if (token !== actorId && token !== "no-permission") throw new Error("invalid session");
          return { userId: token };
        } } },
        { provide: RbacService, useValue: { hasPermission: async (userId, workspaceId, permission) =>
          userId === actorId && workspaceId === "stock-test" && ["commerce.inventory.reservation.manage", "commerce.inventory.view"].includes(permission) } },
      ],
    })(StockInventoryHttpTestModule);
    delete process.env.WEB_ORIGIN;
    const httpApp = await NestFactory.create(StockInventoryHttpTestModule, { logger: ["error", "warn"] });
    try {
      httpApp.setGlobalPrefix("api");
      await httpApp.listen(0, "127.0.0.1");
      const base = "http://127.0.0.1:" + httpApp.getHttpServer().address().port;
      const route = "/api/tenant/stock-test/inventory";
      const send = (path, options = {}) => fetch(base + path, {
        method: options.method || "GET",
        headers: {
          ...(options.auth ? { cookie: (process.env.AUTH_COOKIE_NAME ?? "syncup_session") + "=" + encodeURIComponent(options.auth) } : {}),
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      assert.equal((await send("/api/tenant/stock-test/inventory/warehouses/" + warehouseId + "/variants/" + httpVariant + "/balance")).status, 401);
      assert.equal((await send(route + "/reservations", { method: "POST", auth: "no-permission", body: {
        warehouseId, variantId: httpVariant, quantity: "1", idempotencyKey: "http-denied",
      } })).status, 403);
      const createdResponse = await send(route + "/reservations", { method: "POST", auth: actorId, body: {
        warehouseId, variantId: httpVariant, quantity: "1", idempotencyKey: "http-smoke-reserve",
      } });
      assert.equal(createdResponse.status, 201);
      const created = await createdResponse.json();
      const balanceResponse = await send("/api/tenant/stock-test/inventory/warehouses/" + warehouseId + "/variants/" + httpVariant + "/balance", { auth: actorId });
      assert.equal(balanceResponse.status, 200);
      const httpBalance = await balanceResponse.json();
      assert.equal(httpBalance.reserved, "1.000");
      const releasedResponse = await send(route + "/reservations/" + created.id + "/release", { method: "POST", auth: actorId });
      assert.equal(releasedResponse.status, 201);
      assert.equal((await releasedResponse.json()).changed, true);
      console.log("PASS HTTP integration: production Auth/RBAC guards, controller routes and StockInventoryService operate on Disposable PostgreSQL");
    } finally {
      await httpApp.close();
    }

    console.log("PASS Disposable PostgreSQL Stock Reservation and Inventory service contract tests completed.");
    console.log("NOTE Six service transaction scenarios invoke the production StockInventoryService; PostgreSQL CHECK constraints are verified directly; expiry, WAC, reversal and HTTP route checks also run on the Disposable DB. No real Tenant was changed.");
  } finally {
    for (const peer of peers) await peer.end().catch(() => undefined);
    if (prisma) await prisma.$disconnect().catch(() => undefined);
    if (sql) await sql.end().catch(() => undefined);
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1", [database]).catch(() => undefined);
    await admin.query('DROP DATABASE IF EXISTS "' + database + '"').catch(() => undefined);
    await admin.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
