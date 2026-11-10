const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { Client } = require("pg");
const { decryptWorkspaceCredential } = require("../dist/database/workspace-credential.crypto");

const prisma = new PrismaClient();
const base = "http://127.0.0.1:" + (process.env.API_PORT || "4000") + "/api";
const suffix = Date.now().toString();
const productId = randomUUID();
const variantId = randomUUID();
const uomId = randomUUID();
let tenant;
let warehouseId;
let destinationWarehouseId;
let stocktakeId;
let staleStocktakeId;

async function request(path, { method = "GET", cookie, body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { "content-type": "application/json", origin: process.env.WEB_ORIGIN } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}
async function readState() {
  const result = await tenant.query(
    "SELECT b.on_hand::text,b.reserved::text,b.available::text,ic.quantity::text,ic.average_unit_cost::text,ic.inventory_value::text FROM stock_balances b JOIN inventory_costs ic ON ic.warehouse_id=b.warehouse_id AND ic.variant_id=b.variant_id WHERE b.warehouse_id=$1 AND b.variant_id=$2",
    [warehouseId, variantId],
  );
  assert.equal(result.rowCount, 1);
  return result.rows[0];
}
async function cleanup() {
  if (!tenant) return;
  await tenant.query("BEGIN");
  try {
    await tenant.query(
      "DELETE FROM audit_events WHERE (resource_type='StockMovement' AND resource_id IN (SELECT id::text FROM stock_movements WHERE variant_id=$1)) OR (resource_type='StockTransfer' AND resource_id IN (SELECT reference_id::text FROM stock_movements WHERE variant_id=$1 AND reference_type='TRANSFER' AND reference_id IS NOT NULL))",
      [variantId],
    );
    for (const id of [stocktakeId, staleStocktakeId].filter(Boolean)) {
      await tenant.query("DELETE FROM audit_events WHERE (resource_type='StocktakeSession' AND resource_id=$1) OR (resource_type='StocktakeLine' AND resource_id IN (SELECT id::text FROM stocktake_lines WHERE session_id=$1::uuid))", [id]);
      await tenant.query("DELETE FROM stocktake_lines WHERE session_id=$1::uuid", [id]);
      await tenant.query("DELETE FROM stocktake_sessions WHERE id=$1::uuid", [id]);
    }
    await tenant.query("DELETE FROM stock_movements WHERE variant_id=$1", [variantId]);
    await tenant.query("DELETE FROM inventory_costs WHERE variant_id=$1", [variantId]);
    await tenant.query("DELETE FROM stock_balances WHERE variant_id=$1", [variantId]);
    if (destinationWarehouseId) await tenant.query("DELETE FROM warehouses WHERE id=$1", [destinationWarehouseId]);
    await tenant.query("DELETE FROM product_variants WHERE id=$1", [variantId]);
    await tenant.query("DELETE FROM products WHERE id=$1", [productId]);
    await tenant.query("DELETE FROM unit_of_measures WHERE id=$1", [uomId]);
    await tenant.query("COMMIT");
  } catch (error) {
    await tenant.query("ROLLBACK");
    throw error;
  }
}
async function main() {
  try {
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { slug: "pos-local" },
      include: { database: true },
    });
    assert.equal(workspace.id, "c0130bf3-c1c0-4dfa-a915-7ca5155cacfd", "pos-local workspace identity mismatch");
    assert.equal(workspace.status, "ACTIVE");
    const database = workspace.database;
    assert.ok(database?.secretCipher, "E2E tenant credential missing");
    assert.ok(["127.0.0.1", "localhost", "::1"].includes(database.host), "Safety stop: tenant DB is not local");
    tenant = new Client({
      host: database.host, port: database.port, database: database.databaseName,
      user: database.username, password: decryptWorkspaceCredential(database.secretCipher),
    });
    await tenant.connect();

    const warehouse = await tenant.query("SELECT id::text,branch_id::text FROM warehouses WHERE status='ACTIVE' ORDER BY created_at LIMIT 1");
    assert.equal(warehouse.rowCount, 1, "No active E2E warehouse");
    warehouseId = warehouse.rows[0].id;
    destinationWarehouseId = randomUUID();
    await tenant.query("INSERT INTO warehouses (id,branch_id,code,name,status,is_default,created_at,updated_at) VALUES ($1,$2,$3,$4,'ACTIVE',false,NOW(),NOW())", [destinationWarehouseId, warehouse.rows[0].branch_id, "E2E-" + suffix, "E2E Transfer Warehouse " + suffix]);

    const uomCode = "E" + suffix.slice(-9);
    await tenant.query(
      "INSERT INTO unit_of_measures (id,code,normalized_code,name,symbol,dimension,updated_at) VALUES ($1,$2,$3,$4,$5,'COUNT',NOW())",
      [uomId, uomCode, uomCode.toLowerCase(), "E2E Each " + suffix, "e" + suffix.slice(-4)],
    );
    await tenant.query(
      "INSERT INTO products (id,name,normalized_name,updated_at) VALUES ($1,$2,$3,NOW())",
      [productId, "E2E HTTP Stock " + suffix, ("e2e http stock " + suffix).toLowerCase()],
    );
    await tenant.query(
      "INSERT INTO product_variants (id,product_id,base_uom_id,sku,normalized_sku,title,status,updated_at) VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',NOW())",
      [variantId, productId, uomId, "E2E-" + suffix, ("e2e-" + suffix).toLowerCase(), "E2E HTTP Variant " + suffix],
    );
    await tenant.query(
      "INSERT INTO stock_balances (warehouse_id,variant_id,on_hand,reserved,available,updated_at) VALUES ($1,$2,10,0,10,NOW())",
      [warehouseId, variantId],
    );
    await tenant.query(
      "INSERT INTO inventory_costs (warehouse_id,variant_id,quantity,average_unit_cost,inventory_value,updated_at) VALUES ($1,$2,10,5,50,NOW())",
      [warehouseId, variantId],
    );
    console.log("FIXTURE_CREATED=YES");

    const rawLogin = await fetch(base + "/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: process.env.LOCAL_TEST_MANAGER_EMAIL, password: process.env.LOCAL_TEST_MANAGER_PASSWORD }),
    });
    assert.equal(rawLogin.status, 201, "pos-local Manager login failed: " + rawLogin.status);
    const cookie = (rawLogin.headers.get("set-cookie") || "").split(";")[0];
    assert.ok(cookie, "Inventory Staff session cookie missing");
    console.log("POS_LOCAL_MANAGER_LOGIN=PASS");

    const route = "/tenant/" + workspace.id + "/inventory";
    const before = await request(route + "/warehouses/" + warehouseId + "/variants/" + variantId + "/balance", { cookie });
    assert.equal(before.status, 200);
    assert.equal(before.data.on_hand, "10.000");
    console.log("INITIAL_BALANCE=10.000");

    const receiptBody = {
      warehouseId, variantId, quantity: "5", unitCost: "8",
      idempotencyKey: "e2e-http-receive-" + suffix, reason: "E2E HTTP receipt",
    };
    const receipt = await request(route + "/receipts", { method: "POST", cookie, body: receiptBody });
    assert.equal(receipt.status, 201, "Receipt failed: " + JSON.stringify(receipt.data));
    assert.equal(receipt.data.totalCost, "40.000000");
    const receiptReplay = await request(route + "/receipts", { method: "POST", cookie, body: receiptBody });
    assert.equal(receiptReplay.status, 201);
    assert.equal(receiptReplay.data.idempotentReplay, true);
    let state = await readState();
    assert.deepEqual(state, {
      on_hand: "15.000", reserved: "0.000", available: "15.000",
      quantity: "15.000", average_unit_cost: "6.000000", inventory_value: "90.000000",
    });
    console.log("RECEIVE_HTTP=PASS; REPLAY=PASS; BALANCE_AND_WAC=15 / 6 / 90");

    const saleBody = {
      warehouseId, variantId, quantity: "4",
      idempotencyKey: "e2e-http-issue-" + suffix, reason: "E2E HTTP issue",
    };
    const sale = await request(route + "/sales", { method: "POST", cookie, body: saleBody });
    assert.equal(sale.status, 201, "Issue failed: " + JSON.stringify(sale.data));
    const saleReplay = await request(route + "/sales", { method: "POST", cookie, body: saleBody });
    assert.equal(saleReplay.status, 201);
    assert.equal(saleReplay.data.idempotentReplay, true);
    state = await readState();
    assert.deepEqual(state, {
      on_hand: "11.000", reserved: "0.000", available: "11.000",
      quantity: "11.000", average_unit_cost: "6.000000", inventory_value: "66.000000",
    });
    console.log("ISSUE_HTTP=PASS; REPLAY=PASS; BALANCE_AND_WAC=11 / 6 / 66");

    const adjustmentOutBody = { warehouseId, variantId, countedQuantity: "9.5", idempotencyKey: "e2e-http-adjust-out-" + suffix, reason: "E2E physical count decrease" };
    const adjustmentOut = await request(route + "/adjustments", { method: "POST", cookie, body: adjustmentOutBody });
    assert.equal(adjustmentOut.status, 201, "Negative adjustment failed: " + JSON.stringify(adjustmentOut.data));
    assert.equal(adjustmentOut.data.movementType, "ADJUSTMENT_OUT");
    const adjustmentOutReplay = await request(route + "/adjustments", { method: "POST", cookie, body: adjustmentOutBody });
    assert.equal(adjustmentOutReplay.status, 201);
    assert.equal(adjustmentOutReplay.data.idempotentReplay, true);
    state = await readState();
    assert.deepEqual(state, { on_hand: "9.500", reserved: "0.000", available: "9.500", quantity: "9.500", average_unit_cost: "6.000000", inventory_value: "57.000000" });
    console.log("ADJUSTMENT_OUT_HTTP=PASS; REPLAY=PASS; BALANCE_AND_WAC=9.5 / 6 / 57");

    const adjustmentInBody = { warehouseId, variantId, countedQuantity: "11.5", unitCost: "7", idempotencyKey: "e2e-http-adjust-in-" + suffix, reason: "E2E physical count increase" };
    const adjustmentIn = await request(route + "/adjustments", { method: "POST", cookie, body: adjustmentInBody });
    assert.equal(adjustmentIn.status, 201, "Positive adjustment failed: " + JSON.stringify(adjustmentIn.data));
    assert.equal(adjustmentIn.data.movementType, "ADJUSTMENT_IN");
    const adjustmentInReplay = await request(route + "/adjustments", { method: "POST", cookie, body: adjustmentInBody });
    assert.equal(adjustmentInReplay.status, 201);
    assert.equal(adjustmentInReplay.data.idempotentReplay, true);
    state = await readState();
    assert.equal(state.on_hand, "11.500");
    assert.equal(state.quantity, "11.500");
    assert.equal(state.inventory_value, "71.000000");
    console.log("ADJUSTMENT_IN_HTTP=PASS; REPLAY=PASS; BALANCE_AND_COST=11.5 / 71");

    const missingCost = await request(route + "/adjustments", { method: "POST", cookie, body: { warehouseId, variantId, countedQuantity: "13", idempotencyKey: "e2e-http-adjust-missing-cost-" + suffix, reason: "E2E missing unit cost" } });
    assert.equal(missingCost.status, 400, "Positive adjustment must require unitCost");
    assert.equal((await readState()).on_hand, "11.500");
    console.log("ADJUSTMENT_COST_VALIDATION=PASS (HTTP 400)");


    const transferBody = { sourceWarehouseId: warehouseId, destinationWarehouseId, variantId, quantity: "3", idempotencyKey: "e2e-http-transfer-" + suffix, reason: "E2E warehouse transfer" };
    const transfer = await request(route + "/transfers", { method: "POST", cookie, body: transferBody });
    assert.equal(transfer.status, 201, "Transfer failed: " + JSON.stringify(transfer.data));
    assert.equal(transfer.data.movementType, "TRANSFER");
    assert.equal(transfer.data.totalCost, "18.521739");
    const transferReplay = await request(route + "/transfers", { method: "POST", cookie, body: transferBody });
    assert.equal(transferReplay.status, 201);
    assert.equal(transferReplay.data.idempotentReplay, true);
    const sourceAfterTransfer = await readState();
    state = sourceAfterTransfer;
    const destinationAfterTransfer = await tenant.query("SELECT b.on_hand::text,b.reserved::text,b.available::text,ic.quantity::text,ic.average_unit_cost::text,ic.inventory_value::text FROM stock_balances b JOIN inventory_costs ic ON ic.warehouse_id=b.warehouse_id AND ic.variant_id=b.variant_id WHERE b.warehouse_id=$1 AND b.variant_id=$2", [destinationWarehouseId, variantId]);
    assert.deepEqual(sourceAfterTransfer, { on_hand: "8.500", reserved: "0.000", available: "8.500", quantity: "8.500", average_unit_cost: "6.173913", inventory_value: "52.478261" });
    assert.deepEqual(destinationAfterTransfer.rows[0], { on_hand: "3.000", reserved: "0.000", available: "3.000", quantity: "3.000", average_unit_cost: "6.173913", inventory_value: "18.521739" });
    const transferCounts = await tenant.query("SELECT movement_type,COUNT(*)::int AS count FROM stock_movements WHERE reference_id=$1 GROUP BY movement_type ORDER BY movement_type", [transfer.data.transferId]);
    assert.deepEqual(transferCounts.rows, [{ movement_type: "TRANSFER_IN", count: 1 }, { movement_type: "TRANSFER_OUT", count: 1 }]);
    const history = await request(route + `/movements?variantId=${variantId}&page=1&pageSize=50`, { cookie });
    assert.equal(history.status, 200, "Movement history read failed: " + JSON.stringify(history.data));
    assert.equal(history.data.items.length, 6, "Expected receipt, issue, two adjustments and paired transfer movements");
    assert.equal(history.data.pagination.total, 6);
    assert.ok(history.data.items.some(item => item.movementType === "TRANSFER_IN"));
    assert.ok(history.data.items.some(item => item.movementType === "TRANSFER_OUT"));
    const filteredHistory = await request(route + `/movements?variantId=${variantId}&movementType=RECEIVING&search=${encodeURIComponent("E2E HTTP Stock")}`, { cookie });
    assert.equal(filteredHistory.status, 200);
    assert.equal(filteredHistory.data.items.length, 1);
    console.log("MOVEMENT_HISTORY_HTTP=PASS; FILTERS=PASS; PAGINATION=PASS");
    console.log("TRANSFER_HTTP=PASS; REPLAY=PASS; SOURCE=8.5/52.478261; DESTINATION=3/18.521739; PAIRED_MOVEMENTS=PASS");

    const sameWarehouse = await request(route + "/transfers", { method: "POST", cookie, body: { ...transferBody, destinationWarehouseId: warehouseId, idempotencyKey: "e2e-http-transfer-same-" + suffix } });
    assert.equal(sameWarehouse.status, 400);
    const insufficientTransfer = await request(route + "/transfers", { method: "POST", cookie, body: { ...transferBody, quantity: "100", idempotencyKey: "e2e-http-transfer-insufficient-" + suffix } });
    assert.equal(insufficientTransfer.status, 409);
    assert.deepEqual(await readState(), sourceAfterTransfer);
    const destinationUnchanged = await tenant.query("SELECT on_hand::text FROM stock_balances WHERE warehouse_id=$1 AND variant_id=$2", [destinationWarehouseId, variantId]);
    assert.equal(destinationUnchanged.rows[0].on_hand, "3.000");
    console.log("TRANSFER_VALIDATION=PASS (same warehouse 400; insufficient stock 409; rollback PASS)");

    const stocktakeBody = {
      warehouseId, reference: "ST-" + suffix, notes: "E2E stocktake reconciliation",
      idempotencyKey: "e2e-http-stocktake-" + suffix,
    };
    const stocktake = await request(route + "/stocktakes", { method: "POST", cookie, body: stocktakeBody });
    assert.equal(stocktake.status, 201, "Stocktake create failed: " + JSON.stringify(stocktake.data));
    stocktakeId = stocktake.data.stocktakeId;
    const stocktakeReplay = await request(route + "/stocktakes", { method: "POST", cookie, body: stocktakeBody });
    assert.equal(stocktakeReplay.status, 201);
    assert.equal(stocktakeReplay.data.stocktakeId, stocktakeId);
    assert.equal(stocktakeReplay.data.idempotentReplay, true);
    let stocktakeDetail = await request(route + "/stocktakes/" + stocktakeId, { cookie });
    assert.equal(stocktakeDetail.status, 200);
    assert.equal(stocktakeDetail.data.status, "DRAFT");
    assert.equal(stocktakeDetail.data.lines.length, 1);
    assert.equal(stocktakeDetail.data.lines[0].systemQuantity, "8.500");
    const uncountedFinalize = await request(route + "/stocktakes/" + stocktakeId + "/finalize", { method: "POST", cookie, body: { reason: "E2E uncounted guard" } });
    assert.equal(uncountedFinalize.status, 409, "Uncounted lines must block finalization");
    const stocktakeLineId = stocktakeDetail.data.lines[0].id;
    const countWithoutCost = await request(route + "/stocktakes/" + stocktakeId + "/lines/" + stocktakeLineId, {
      method: "PATCH", cookie, body: { countedQuantity: "9.500", note: "E2E counted; missing cost check" },
    });
    assert.equal(countWithoutCost.status, 200);
    const positiveWithoutCost = await request(route + "/stocktakes/" + stocktakeId + "/finalize", { method: "POST", cookie, body: { reason: "E2E missing cost guard" } });
    assert.equal(positiveWithoutCost.status, 400, "Positive variance must require unit cost");
    const savedCount = await request(route + "/stocktakes/" + stocktakeId + "/lines/" + stocktakeLineId, {
      method: "PATCH", cookie, body: { countedQuantity: "9.500", unitCost: "7", note: "E2E final physical count" },
    });
    assert.equal(savedCount.status, 200);
    stocktakeDetail = await request(route + "/stocktakes/" + stocktakeId, { cookie });
    assert.equal(stocktakeDetail.data.status, "IN_PROGRESS");
    assert.equal(stocktakeDetail.data.lines[0].countedQuantity, "9.500");
    assert.equal(stocktakeDetail.data.lines[0].variance, "1.000");
    const finalized = await request(route + "/stocktakes/" + stocktakeId + "/finalize", { method: "POST", cookie, body: { reason: "E2E stocktake finalize" } });
    assert.equal(finalized.status, 201, "Stocktake finalize failed: " + JSON.stringify(finalized.data));
    assert.equal(finalized.data.status, "FINALIZED");
    assert.equal(finalized.data.movements.length, 1);
    const finalizedReplay = await request(route + "/stocktakes/" + stocktakeId + "/finalize", { method: "POST", cookie, body: { reason: "E2E replay" } });
    assert.equal(finalizedReplay.status, 201);
    assert.equal(finalizedReplay.data.idempotentReplay, true);
    assert.equal(finalizedReplay.data.movements.length, 0);
    state = await readState();
    assert.deepEqual(state, {
      on_hand: "9.500", reserved: "0.000", available: "9.500",
      quantity: "9.500", average_unit_cost: "6.260870", inventory_value: "59.478261",
    });
    const stocktakeMovements = await tenant.query(
      "SELECT movement_type,quantity_delta::text,reference_type::text FROM stock_movements WHERE reference_id=$1",
      [stocktakeId],
    );
    assert.deepEqual(stocktakeMovements.rows, [{ movement_type: "ADJUSTMENT_IN", quantity_delta: "1.000", reference_type: "STOCKTAKE" }]);
    console.log("STOCKTAKE_HTTP=PASS; CREATE_REPLAY=PASS; UNCOUNTED_GUARD=PASS; POSITIVE_COST_GUARD=PASS; FINALIZE_REPLAY=PASS; WAC=PASS");

    const staleCreate = await request(route + "/stocktakes", { method: "POST", cookie, body: {
      warehouseId, reference: "STALE-" + suffix, idempotencyKey: "e2e-http-stocktake-stale-" + suffix,
    } });
    assert.equal(staleCreate.status, 201);
    const staleId = staleCreate.data.stocktakeId;
    staleStocktakeId = staleId;
    const staleDetail = await request(route + "/stocktakes/" + staleId, { cookie });
    assert.equal(staleDetail.status, 200);
    const staleLineId = staleDetail.data.lines[0].id;
    const staleCount = await request(route + "/stocktakes/" + staleId + "/lines/" + staleLineId, {
      method: "PATCH", cookie, body: { countedQuantity: "9.500" },
    });
    assert.equal(staleCount.status, 200);
    const concurrentSale = await request(route + "/sales", { method: "POST", cookie, body: {
      warehouseId, variantId, quantity: "1", idempotencyKey: "e2e-http-stocktake-concurrent-sale-" + suffix,
      reason: "E2E movement after stocktake snapshot",
    } });
    assert.equal(concurrentSale.status, 201);
    const staleFinalize = await request(route + "/stocktakes/" + staleId + "/finalize", { method: "POST", cookie, body: { reason: "E2E stale snapshot guard" } });
    assert.equal(staleFinalize.status, 409, "Finalization must reject stock changed after snapshot");
    assert.equal((await readState()).on_hand, "8.500");
    const staleCancel = await request(route + "/stocktakes/" + staleId + "/cancel", { method: "POST", cookie, body: { reason: "E2E stale snapshot cleanup" } });
    assert.equal(staleCancel.status, 201);
    assert.equal(staleCancel.data.status, "CANCELLED");
    state = await readState();
    console.log("STOCKTAKE_STALE_SNAPSHOT_GUARD=PASS; CANCEL=PASS");

    const insufficient = await request(route + "/sales", {
      method: "POST", cookie,
      body: { warehouseId, variantId, quantity: "100", idempotencyKey: "e2e-http-insufficient-" + suffix },
    });
    assert.equal(insufficient.status, 409, "Expected insufficient-stock 409, got " + insufficient.status);
    assert.deepEqual(await readState(), state);
    console.log("INSUFFICIENT_STOCK_ROLLBACK=PASS (HTTP 409)");

    const invalid = await request(route + "/sales", {
      method: "POST", cookie,
      body: { warehouseId, variantId, quantity: 1.5, idempotencyKey: "e2e-http-invalid-" + suffix },
    });
    assert.equal(invalid.status, 400, "Expected numeric quantity contract 400");
    assert.deepEqual(await readState(), state);
    console.log("DECIMAL_INPUT_VALIDATION=PASS (HTTP 400)");

    // Reverse-movement RBAC is excluded: pos-local Manager has an explicit reverse grant.

    const concurrentTransferBody = {
      sourceWarehouseId: warehouseId, destinationWarehouseId, variantId, quantity: "1",
      idempotencyKey: "e2e-http-transfer-concurrent-" + suffix, reason: "E2E concurrent transfer idempotency",
    };
    const concurrentTransfers = await Promise.all([
      request(route + "/transfers", { method: "POST", cookie, body: concurrentTransferBody }),
      request(route + "/transfers", { method: "POST", cookie, body: concurrentTransferBody }),
    ]);
    assert.deepEqual(concurrentTransfers.map(result => result.status), [201, 201]);
    assert.deepEqual(concurrentTransfers.map(result => result.data.idempotentReplay).sort(), [false, true]);
    assert.equal(concurrentTransfers[0].data.transferId, concurrentTransfers[1].data.transferId);
    const concurrentTransferId = concurrentTransfers[0].data.transferId;
    const concurrentMovementCount = await tenant.query(
      "SELECT movement_type,COUNT(*)::int AS count FROM stock_movements WHERE reference_id=$1 GROUP BY movement_type ORDER BY movement_type",
      [concurrentTransferId],
    );
    assert.deepEqual(concurrentMovementCount.rows, [
      { movement_type: "TRANSFER_IN", count: 1 }, { movement_type: "TRANSFER_OUT", count: 1 },
    ]);
    const concurrentSourceState = await readState();
    assert.equal(concurrentSourceState.on_hand, "7.500");
    const concurrentDestinationState = await tenant.query(
      "SELECT on_hand::text FROM stock_balances WHERE warehouse_id=$1 AND variant_id=$2",
      [destinationWarehouseId, variantId],
    );
    assert.equal(concurrentDestinationState.rows[0].on_hand, "4.000");
    console.log("TRANSFER_CONCURRENCY=PASS; SAME_KEY_PARALLEL_REQUESTS=2; ONE_TRANSFER_PAIR=PASS");

    const conflictingTransfer = await request(route + "/transfers", {
      method: "POST", cookie,
      body: { ...concurrentTransferBody, quantity: "2", reason: "Different payload with reused key" },
    });
    assert.equal(conflictingTransfer.status, 409, "Reusing a transfer idempotency key with a different payload must conflict");
    assert.equal((await readState()).on_hand, "7.500");
    const conflictMovementCount = await tenant.query(
      "SELECT COUNT(*)::int AS count FROM stock_movements WHERE idempotency_key=$1",
      [concurrentTransferBody.idempotencyKey],
    );
    assert.equal(conflictMovementCount.rows[0].count, 1, "Conflicting replay must not create another movement");
    console.log("TRANSFER_IDEMPOTENCY_PAYLOAD_CONFLICT=PASS (HTTP 409; no extra movement)");

    const independentTransfers = await Promise.all([
      request(route + "/transfers", { method: "POST", cookie, body: {
        ...concurrentTransferBody, quantity: "1", idempotencyKey: "e2e-http-transfer-parallel-a-" + suffix,
        reason: "E2E independent concurrent transfer A",
      } }),
      request(route + "/transfers", { method: "POST", cookie, body: {
        ...concurrentTransferBody, quantity: "2", idempotencyKey: "e2e-http-transfer-parallel-b-" + suffix,
        reason: "E2E independent concurrent transfer B",
      } }),
    ]);
    assert.deepEqual(independentTransfers.map(result => result.status), [201, 201]);
    assert.ok(independentTransfers.every(result => result.data.idempotentReplay === false));
    assert.notEqual(independentTransfers[0].data.transferId, independentTransfers[1].data.transferId);
    assert.equal((await readState()).on_hand, "4.500");
    const parallelDestination = await tenant.query(
      "SELECT on_hand::text FROM stock_balances WHERE warehouse_id=$1 AND variant_id=$2",
      [destinationWarehouseId, variantId],
    );
    assert.equal(parallelDestination.rows[0].on_hand, "7.000");
    const parallelPairs = await tenant.query(
      "SELECT reference_id::text,COUNT(*)::int AS count FROM stock_movements WHERE idempotency_key IN ($1,$2) OR reference_id IN ($3::uuid,$4::uuid) GROUP BY reference_id",
      ["e2e-http-transfer-parallel-a-" + suffix, "e2e-http-transfer-parallel-b-" + suffix,
        independentTransfers[0].data.transferId, independentTransfers[1].data.transferId],
    );
    assert.equal(parallelPairs.rowCount, 2);
    assert.ok(parallelPairs.rows.every(row => row.count === 2));
    console.log("TRANSFER_CONCURRENCY_DISTINCT_KEYS=PASS; PARALLEL_TRANSFERS=2; SOURCE=4.5; DESTINATION=7");

    const movementCount = await tenant.query(
      "SELECT movement_type,COUNT(*)::int AS count FROM stock_movements WHERE variant_id=$1 GROUP BY movement_type ORDER BY movement_type",
      [variantId],
    );
    console.log("MOVEMENT_COUNTS=" + JSON.stringify(movementCount.rows));
    console.log("HTTP_INVENTORY_E2E=PASS");
  } finally {
    if (tenant) {
      await cleanup();
      const remaining = await tenant.query(
        "SELECT (SELECT COUNT(*) FROM products WHERE id=$1)::int AS products,(SELECT COUNT(*) FROM product_variants WHERE id=$2)::int AS variants,(SELECT COUNT(*) FROM stock_balances WHERE variant_id=$2)::int AS balances,(SELECT COUNT(*) FROM inventory_costs WHERE variant_id=$2)::int AS costs,(SELECT COUNT(*) FROM stock_movements WHERE variant_id=$2)::int AS movements",
        [productId, variantId],
      );
      assert.deepEqual(remaining.rows[0], { products: 0, variants: 0, balances: 0, costs: 0, movements: 0 });
      console.log("FIXTURE_CLEANUP=PASS");
      await tenant.end();
    }
    await prisma.$disconnect();
  }
}
main().catch(error => {
  console.error("HTTP_INVENTORY_E2E_FAILED=" + error.message);
  process.exitCode = 1;
});
