"use strict";

require("reflect-metadata");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Client } = require("pg");
const { PrismaClient } = require("@prisma/client");
const { StoreLifecycleService } = require("../dist/core/tenant/store-lifecycle.service");
const { SalesOrdersService } = require("../dist/core/orders/sales-orders.service");
const { SalesReturnsService } = require("../dist/core/orders/sales-returns.service");
const { SalesPaymentsService } = require("../dist/core/orders/sales-payments.service");
const { SalesOrdersController } = require("../dist/core/orders/sales-orders.controller");
const { REQUIRED_PERMISSION } = require("../dist/core/rbac/rbac.decorator");

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
  "apps/api/prisma/tenant/migrations/20261111000100_tenant_sales_orders.sql",
  "apps/api/prisma/tenant/migrations/20261111000200_tenant_sales_returns.sql",
  "apps/api/prisma/tenant/migrations/20261111000300_tenant_sales_payments_refunds.sql",
].map(read);

function tenantUrl(database) {
  const url = new URL(adminUrl);
  url.pathname = "/" + database;
  return url.toString();
}
async function connect(url) {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 10000 });
  await client.connect();
  return client;
}
function errorStatus(error) {
  return error?.status ?? error?.statusCode;
}

async function main() {
  const admin = await connect(adminUrl);
  const database = "syncup_orders_test_" + process.pid + "_" + Date.now();
  let sql;
  let prisma;
  try {
    await admin.query('CREATE DATABASE "' + database + '"');
    sql = await connect(tenantUrl(database));
    for (const migration of migrations) await sql.query(migration);

    prisma = new PrismaClient({ datasources: { db: { url: tenantUrl(database) } } });
    await prisma.$connect();
    const registry = { forMembership: async () => prisma };
    const lifecycle = new StoreLifecycleService(registry);
    const orders = new SalesOrdersService(registry);
    const returns = new SalesReturnsService(registry);
    const payments = new SalesPaymentsService(registry);
    const actorId = randomUUID();
    assert.equal(Reflect.getMetadata(REQUIRED_PERMISSION, SalesOrdersController.prototype.create), "commerce.sales.create");
    assert.equal(Reflect.getMetadata(REQUIRED_PERMISSION, SalesOrdersController.prototype.list), "commerce.orders.view");
    assert.equal(Reflect.getMetadata(REQUIRED_PERMISSION, SalesOrdersController.prototype.get), "commerce.orders.view");
    assert.equal(Reflect.getMetadata(REQUIRED_PERMISSION, SalesOrdersController.prototype.cancel), "commerce.sales.void");
    assert.equal(Reflect.getMetadata(REQUIRED_PERMISSION, SalesOrdersController.prototype.post), "commerce.sales.create");
    assert.equal(Reflect.getMetadata(REQUIRED_PERMISSION, SalesOrdersController.prototype.createReturn), "commerce.sales.void");
    assert.equal(Reflect.getMetadata(REQUIRED_PERMISSION, SalesOrdersController.prototype.listReturns), "commerce.orders.view");
    assert.equal(Reflect.getMetadata(REQUIRED_PERMISSION, SalesOrdersController.prototype.recordPayment), "commerce.sales.create");
    assert.equal(Reflect.getMetadata(REQUIRED_PERMISSION, SalesOrdersController.prototype.listPayments), "commerce.orders.view");
    assert.equal(Reflect.getMetadata(REQUIRED_PERMISSION, SalesOrdersController.prototype.createRefund), "commerce.sales.void");
    assert.equal(Reflect.getMetadata(REQUIRED_PERMISSION, SalesOrdersController.prototype.listRefunds), "commerce.orders.view");
    console.log("PASS Controller RBAC metadata: Orders, Returns, Payments and Refunds are permission-gated");
    const store = await lifecycle.createStore(actorId, "orders-test", {
      name: "Orders Integration Test",
      slug: "orders-integration-test",
      branchCode: "HQ",
      warehouseCode: "MAIN",
    });

    const uomId = randomUUID();
    const categoryId = randomUUID();
    const taxProfileId = randomUUID();
    await sql.query(
      "INSERT INTO unit_of_measures (id,code,normalized_code,name,symbol,dimension,updated_at) VALUES ($1,'EA','ea','Each','ea','COUNT',NOW())",
      [uomId],
    );
    await sql.query(
      "INSERT INTO tax_categories (id,code,name,status,created_at,updated_at) VALUES ($1,'STANDARD','Standard VAT','ACTIVE',NOW(),NOW())",
      [categoryId],
    );
    await sql.query(
      "INSERT INTO tax_profiles (id,store_id,name,tax_mode,price_tax_mode,rounding_level,rounding_method,currency_minor_units,valid_from,created_at,updated_at) " +
      "VALUES ($1,$2,'Default VAT','VAT','EXCLUSIVE','DOCUMENT','HALF_UP',2,NOW()-INTERVAL '1 day',NOW(),NOW())",
      [taxProfileId, store.id],
    );
    await sql.query(
      "INSERT INTO tax_rates (id,tax_profile_id,tax_category_id,rate,valid_from,created_at) VALUES ($1,$2,$3,0.07,NOW()-INTERVAL '1 day',NOW())",
      [randomUUID(), taxProfileId, categoryId],
    );

    const variantA = "00000000-0000-4000-8000-000000000001";
    const variantB = "00000000-0000-4000-8000-000000000002";
    const variantC = "00000000-0000-4000-8000-000000000003";
    const variants = [variantA, variantB, variantC];
    const productId = randomUUID();
    const storeProductId = randomUUID();
    await sql.query(
      "INSERT INTO products (id,name,status,normalized_name,updated_at) VALUES ($1,'Orders Product','ACTIVE','orders product',NOW())",
      [productId],
    );
    await sql.query(
      "INSERT INTO store_products (id,store_id,product_id,publish_status,sort_order,featured,created_at,updated_at) " +
      "VALUES ($1,$2,$3,'PUBLISHED',0,FALSE,NOW(),NOW())",
      [storeProductId, store.id, productId],
    );
    for (let i = 0; i < variants.length; i++) {
      const variantId = variants[i];
      const sku = "ORD-" + (i + 1);
      await sql.query(
        "INSERT INTO product_variants (id,product_id,base_uom_id,tax_category_id,sku,normalized_sku,title,status,updated_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE',NOW())",
        [variantId, productId, uomId, categoryId, sku, sku.toLowerCase(), "Variant " + (i + 1)],
      );
      await sql.query(
        "INSERT INTO variant_uoms (id,variant_id,uom_id,usage,conversion_to_base,status,updated_at) VALUES ($1,$2,$3,'BASE',1,'ACTIVE',NOW())",
        [randomUUID(), variantId, uomId],
      );
      const storeProductVariantId = randomUUID();
      await sql.query(
        "INSERT INTO store_product_variants (id,store_id,product_id,store_product_id,variant_id,publish_status,sort_order,created_at,updated_at) " +
        "VALUES ($1,$2,$3,$4,$5,'PUBLISHED',0,NOW(),NOW())",
        [storeProductVariantId, store.id, productId, storeProductId, variantId],
      );
      const variantUom = await sql.query("SELECT id FROM variant_uoms WHERE variant_id=$1", [variantId]);
      await sql.query(
        "INSERT INTO product_prices (id,store_product_variant_id,variant_id,variant_uom_id,amount,currency,valid_from,created_by) " +
        "VALUES ($1,$2,$3,$4,100.00,'THB',NOW()-INTERVAL '1 day',$5)",
        [randomUUID(), storeProductVariantId, variantId, variantUom.rows[0].id, actorId],
      );
    }

    const seedBalance = async (variantId, onHand) => {
      await sql.query(
        "INSERT INTO stock_balances (warehouse_id,variant_id,on_hand,reserved,available,updated_at) VALUES ($1,$2,$3,0,$3,NOW())",
        [store.defaultWarehouseId, variantId, onHand],
      );
      await sql.query(
        "INSERT INTO inventory_costs (warehouse_id,variant_id,quantity,average_unit_cost,inventory_value,updated_at) VALUES ($1,$2,$3,30,$4,NOW())",
        [store.defaultWarehouseId, variantId, onHand, String(Number(onHand) * 30)],
      );
    };
    const getBalance = async variantId => {
      const result = await sql.query(
        "SELECT on_hand::text,reserved::text,available::text FROM stock_balances WHERE warehouse_id=$1 AND variant_id=$2",
        [store.defaultWarehouseId, variantId],
      );
      return result.rows[0] ?? null;
    };
    await seedBalance(variantA, "20.000");
    await seedBalance(variantC, "10.000");

    const base = {
      storeId: store.id,
      branchId: store.defaultBranchId,
      warehouseId: store.defaultWarehouseId,
    };
    const input = { ...base, items: [{ variantId: variantA, variantUomId: (await sql.query("SELECT id FROM variant_uoms WHERE variant_id=$1", [variantA])).rows[0].id, quantity: "2" }], idempotencyKey: "order-create-main" };
    const created = await orders.createOrder(actorId, "orders-test", input);
    assert.equal(created.status, "RESERVED");
    assert.match(created.order_number, /^SO-HQ-\d{4}-\d{6}$/);
    assert.equal(created.subtotal, "200.0000");
    assert.equal(created.tax_amount, "14.0000");
    assert.equal(created.total_amount, "214.0000");
    assert.equal(created.items.length, 1);
    assert.equal(created.items[0].reservation_status, "ACTIVE");
    assert.deepEqual(await getBalance(variantA), { on_hand: "20.000", reserved: "2.000", available: "18.000" });
    console.log("PASS Order create: server price/tax snapshots, sequence number and atomic stock reservation");

    const replay = await orders.createOrder(actorId, "orders-test", input);
    assert.equal(replay.id, created.id);
    assert.equal(replay.idempotentReplay, true);
    await assert.rejects(
      () => orders.createOrder(actorId, "orders-test", { ...input, items: [{ ...input.items[0], quantity: "3" }] }),
      error => errorStatus(error) === 409,
    );
    console.log("PASS Order idempotency: exact replay returns same Order; changed payload conflicts");

    const variantBUom = (await sql.query("SELECT id FROM variant_uoms WHERE variant_id=$1", [variantB])).rows[0].id;
    await assert.rejects(
      () => orders.createOrder(actorId, "orders-test", {
        ...base,
        idempotencyKey: "order-atomic-failure",
        items: [
          { variantId: variantA, variantUomId: input.items[0].variantUomId, quantity: "3" },
          { variantId: variantB, variantUomId: variantBUom, quantity: "1" },
        ],
      }),
      error => errorStatus(error) === 409,
    );
    assert.deepEqual(await getBalance(variantA), { on_hand: "20.000", reserved: "2.000", available: "18.000" });
    const failedOrder = await sql.query("SELECT count(*)::int AS n FROM sales_orders WHERE idempotency_key='order-atomic-failure'");
    assert.equal(failedOrder.rows[0].n, 0);
    console.log("PASS Multi-line atomicity: a later unavailable line rolls back earlier reservations and Order header");

    const cancelled = await orders.cancelOrder(actorId, "orders-test", created.id);
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal(cancelled.items[0].reservation_status, "RELEASED");
    assert.deepEqual(await getBalance(variantA), { on_hand: "20.000", reserved: "0.000", available: "20.000" });
    const cancelledAgain = await orders.cancelOrder(actorId, "orders-test", created.id);
    assert.equal(cancelledAgain.status, "CANCELLED");
    console.log("PASS Order cancellation: releases all active reservations exactly once and is replay-safe");

    const saleOrder = await orders.createOrder(actorId, "orders-test", {
      ...base,
      idempotencyKey: "order-post-sale",
      items: [{ variantId: variantA, variantUomId: input.items[0].variantUomId, quantity: "2" }],
    });
    const postedSale = await orders.postOrder(actorId, "orders-test", saleOrder.id, "post-sale-idempotency");
    assert.equal(postedSale.status, "POSTED");
    assert.equal(postedSale.items[0].reservation_status, "CONSUMED");
    assert.equal(postedSale.items[0].unit_cost_snapshot, "30.000000");
    assert.equal(postedSale.items[0].total_cost_snapshot, "60.000000");
    assert.ok(postedSale.posted_at);
    assert.equal(postedSale.posted_by, actorId);
    assert.deepEqual(await getBalance(variantA), { on_hand: "18.000", reserved: "0.000", available: "18.000" });
    const costAfterSale = await sql.query(
      "SELECT quantity::text,average_unit_cost::text,inventory_value::text FROM inventory_costs WHERE warehouse_id=$1 AND variant_id=$2",
      [store.defaultWarehouseId, variantA],
    );
    assert.deepEqual(costAfterSale.rows[0], { quantity: "18.000", average_unit_cost: "30.000000", inventory_value: "540.000000" });
    const saleMovements = await sql.query(
      "SELECT movement_type,quantity_delta::text,unit_cost::text,total_cost::text,reference_type,reference_id::text,idempotency_key " +
      "FROM stock_movements WHERE reference_type='ORDER' AND reference_id=$1",
      [saleOrder.id],
    );
    assert.equal(saleMovements.rowCount, 1);
    assert.equal(saleMovements.rows[0].movement_type, "SALE");
    assert.equal(saleMovements.rows[0].quantity_delta, "-2.000");
    assert.equal(saleMovements.rows[0].unit_cost, "30.000000");
    assert.equal(saleMovements.rows[0].total_cost, "60.000000");
    assert.ok(saleMovements.rows[0].idempotency_key);
    const postedReplay = await orders.postOrder(actorId, "orders-test", saleOrder.id, "post-sale-idempotency");
    assert.equal(postedReplay.idempotentReplay, true);
    assert.equal((await sql.query("SELECT count(*)::int AS n FROM stock_movements WHERE reference_type='ORDER' AND reference_id=$1", [saleOrder.id])).rows[0].n, 1);
    await assert.rejects(
      () => orders.postOrder(actorId, "orders-test", saleOrder.id, "different-post-key"),
      error => errorStatus(error) === 409,
    );
    await assert.rejects(
      () => orders.cancelOrder(actorId, "orders-test", saleOrder.id),
      error => errorStatus(error) === 409,
    );
    console.log("PASS Order posting: consumes reservation, records SALE movement, snapshots WAC and replays idempotently");

    const returnItemId = postedSale.items[0].id;
    const firstReturn = await returns.createReturn(actorId, "orders-test", saleOrder.id, {
      idempotencyKey: "return-first-half",
      reason: "Customer returned part of the order",
      items: [{ orderItemId: returnItemId, quantity: "0.333" }],
    });
    assert.equal(firstReturn.status, "POSTED");
    assert.equal(firstReturn.items.length, 1);
    assert.equal(firstReturn.items[0].quantity, "0.333");
    assert.equal(firstReturn.items[0].unit_cost_snapshot, "30.000000");
    assert.equal(firstReturn.items[0].total_cost_snapshot, "9.990000");
    assert.equal(firstReturn.total_amount, "35.6300");
    assert.deepEqual(await getBalance(variantA), { on_hand: "18.333", reserved: "0.000", available: "18.333" });
    const costAfterFirstReturn = await sql.query(
      "SELECT quantity::text,average_unit_cost::text,inventory_value::text FROM inventory_costs WHERE warehouse_id=$1 AND variant_id=$2",
      [store.defaultWarehouseId, variantA],
    );
    assert.deepEqual(costAfterFirstReturn.rows[0], { quantity: "18.333", average_unit_cost: "30.000000", inventory_value: "549.990000" });
    const firstReturnReplay = await returns.createReturn(actorId, "orders-test", saleOrder.id, {
      idempotencyKey: "return-first-half",
      reason: "Customer returned part of the order",
      items: [{ orderItemId: returnItemId, quantity: "0.333" }],
    });
    assert.equal(firstReturnReplay.id, firstReturn.id);
    assert.equal(firstReturnReplay.idempotentReplay, true);
    await assert.rejects(
      () => returns.createReturn(actorId, "orders-test", saleOrder.id, {
        idempotencyKey: "return-first-half",
        reason: "Customer returned part of the order",
        items: [{ orderItemId: returnItemId, quantity: "0.334" }],
      }),
      error => errorStatus(error) === 409,
    );
    await assert.rejects(
      () => returns.createReturn(actorId, "orders-test", saleOrder.id, {
        idempotencyKey: "return-over-limit",
        items: [{ orderItemId: returnItemId, quantity: "1.668" }],
      }),
      error => errorStatus(error) === 409,
    );
    const secondReturn = await returns.createReturn(actorId, "orders-test", saleOrder.id, {
      idempotencyKey: "return-second-half",
      items: [{ orderItemId: returnItemId, quantity: "1.667" }],
    });
    assert.equal(secondReturn.items[0].quantity, "1.667");
    assert.equal(secondReturn.total_amount, "178.3700");
    assert.equal((await returns.listReturns(actorId, "orders-test", saleOrder.id)).items.length, 2);

    const paymentCash = await payments.recordPayment(actorId, "orders-test", saleOrder.id, {
      method: "CASH", amount: "100", idempotencyKey: "payment-cash-100", externalReference: "cash-drawer-01",
    });
    const paymentCard = await payments.recordPayment(actorId, "orders-test", saleOrder.id, {
      method: "CARD", amount: "114", idempotencyKey: "payment-card-114", externalReference: "terminal-txn-01",
    });
    assert.equal(paymentCash.status, "CAPTURED");
    assert.equal(paymentCash.amount, "100.0000");
    assert.equal(paymentCard.amount, "114.0000");
    await assert.rejects(
      () => payments.recordPayment(actorId, "orders-test", saleOrder.id, {
        method: "CASH", amount: "0.01", idempotencyKey: "payment-overpay",
      }),
      error => errorStatus(error) === 409,
    );
    const paymentReplay = await payments.recordPayment(actorId, "orders-test", saleOrder.id, {
      method: "CASH", amount: "100", idempotencyKey: "payment-cash-100", externalReference: "cash-drawer-01",
    });
    assert.equal(paymentReplay.id, paymentCash.id);
    assert.equal(paymentReplay.idempotentReplay, true);
    await assert.rejects(
      () => payments.recordPayment(actorId, "orders-test", saleOrder.id, {
        method: "CASH", amount: "99", idempotencyKey: "payment-cash-100", externalReference: "cash-drawer-01",
      }),
      error => errorStatus(error) === 409,
    );

    const refundA = await payments.createRefund(actorId, "orders-test", saleOrder.id, firstReturn.id, {
      paymentId: paymentCash.id, amount: "20", idempotencyKey: "refund-first-20", reason: "Partial customer refund",
    });
    assert.equal(refundA.amount, "20.0000");
    assert.equal((await payments.listPayments(actorId, "orders-test", saleOrder.id)).items.find(x => x.id === paymentCash.id).status, "PARTIALLY_REFUNDED");
    const refundReplay = await payments.createRefund(actorId, "orders-test", saleOrder.id, firstReturn.id, {
      paymentId: paymentCash.id, amount: "20", idempotencyKey: "refund-first-20", reason: "Partial customer refund",
    });
    assert.equal(refundReplay.id, refundA.id);
    assert.equal(refundReplay.idempotentReplay, true);
    await assert.rejects(
      () => payments.createRefund(actorId, "orders-test", saleOrder.id, firstReturn.id, {
        paymentId: paymentCash.id, amount: "20.01", idempotencyKey: "refund-changed-payload", reason: "Partial customer refund",
      }),
      error => errorStatus(error) === 409,
    );
    const refundB = await payments.createRefund(actorId, "orders-test", saleOrder.id, firstReturn.id, {
      paymentId: paymentCash.id, amount: "15.63", idempotencyKey: "refund-first-rest",
    });
    assert.equal(refundB.amount, "15.6300");
    await assert.rejects(
      () => payments.createRefund(actorId, "orders-test", saleOrder.id, firstReturn.id, {
        paymentId: paymentCash.id, amount: "0.01", idempotencyKey: "refund-return-over",
      }),
      error => errorStatus(error) === 409,
    );
    const refundC = await payments.createRefund(actorId, "orders-test", saleOrder.id, secondReturn.id, {
      paymentId: paymentCard.id, amount: "114", idempotencyKey: "refund-card-full",
    });
    assert.equal(refundC.amount, "114.0000");
    await assert.rejects(
      () => payments.createRefund(actorId, "orders-test", saleOrder.id, secondReturn.id, {
        paymentId: paymentCard.id, amount: "0.01", idempotencyKey: "refund-payment-over",
      }),
      error => errorStatus(error) === 409,
    );
    const refundD = await payments.createRefund(actorId, "orders-test", saleOrder.id, secondReturn.id, {
      paymentId: paymentCash.id, amount: "64.37", idempotencyKey: "refund-cash-rest",
    });
    assert.equal(refundD.amount, "64.3700");
    const paymentRows = await payments.listPayments(actorId, "orders-test", saleOrder.id);
    assert.equal(paymentRows.items.length, 2);
    assert.equal(paymentRows.items.find(x => x.id === paymentCash.id).status, "REFUNDED");
    assert.equal(paymentRows.items.find(x => x.id === paymentCash.id).refunded_amount, "100.0000");
    assert.equal(paymentRows.items.find(x => x.id === paymentCard.id).status, "REFUNDED");
    assert.equal(paymentRows.items.find(x => x.id === paymentCard.id).refunded_amount, "114.0000");
    assert.equal((await payments.listRefunds(actorId, "orders-test", saleOrder.id, firstReturn.id)).items.length, 2);
    assert.equal((await payments.listRefunds(actorId, "orders-test", saleOrder.id, secondReturn.id)).items.length, 2);
    const refundLedger = await sql.query("SELECT COUNT(*)::int AS n,COALESCE(SUM(amount),0)::text AS amount FROM sales_refunds WHERE payment_id IN ($1,$2)", [paymentCash.id, paymentCard.id]);
    assert.equal(refundLedger.rows[0].n, 4);
    assert.equal(refundLedger.rows[0].amount, "214.0000");
    console.log("PASS Payments/Refunds: split tenders, order balance cap, partial refunds, return/payment caps, payload-bound replay and refund ledger reconciliation");

    assert.deepEqual(await getBalance(variantA), { on_hand: "20.000", reserved: "0.000", available: "20.000" });
    const costAfterFullReturn = await sql.query(
      "SELECT quantity::text,average_unit_cost::text,inventory_value::text FROM inventory_costs WHERE warehouse_id=$1 AND variant_id=$2",
      [store.defaultWarehouseId, variantA],
    );
    assert.deepEqual(costAfterFullReturn.rows[0], { quantity: "20.000", average_unit_cost: "30.000000", inventory_value: "600.000000" });
    const returnMovements = await sql.query(
      "SELECT movement_type,quantity_delta::text,unit_cost::text,total_cost::text FROM stock_movements WHERE reference_type='RETURN' AND reference_id IN (SELECT id FROM sales_returns WHERE order_id=$1)",
      [saleOrder.id],
    );
    assert.equal(returnMovements.rowCount, 2);
    assert.equal(returnMovements.rows.reduce((sum, row) => sum + Number(row.quantity_delta), 0), 2);
    assert.ok(returnMovements.rows.every(row => row.movement_type === "SALE_RETURN" && row.unit_cost === "30.000000"));
    // Restore the isolated fixture baseline so the remaining Order regression assertions stay independent.
    await sql.query("UPDATE stock_balances SET on_hand=18,reserved=0,available=18,updated_at=NOW() WHERE warehouse_id=$1 AND variant_id=$2", [store.defaultWarehouseId, variantA]);
    await sql.query("UPDATE inventory_costs SET quantity=18,average_unit_cost=30,inventory_value=540,updated_at=NOW() WHERE warehouse_id=$1 AND variant_id=$2", [store.defaultWarehouseId, variantA]);
    console.log("PASS Sales Returns: partial/multiple returns, cumulative quantity cap, original WAC cost restoration and idempotent replay");

    const rollbackOrder = await orders.createOrder(actorId, "orders-test", {
      ...base,
      idempotencyKey: "order-post-rollback",
      items: [{ variantId: variantA, variantUomId: input.items[0].variantUomId, quantity: "1" }],
    });
    await sql.query(
      "UPDATE inventory_costs SET inventory_value=inventory_value+1 WHERE warehouse_id=$1 AND variant_id=$2",
      [store.defaultWarehouseId, variantA],
    );
    await assert.rejects(
      () => orders.postOrder(actorId, "orders-test", rollbackOrder.id, "post-rollback-key"),
      error => errorStatus(error) === 409,
    );
    const rollbackState = await sql.query(
      "SELECT o.status::text AS order_status,r.status AS reservation_status " +
      "FROM sales_orders o JOIN sales_order_items i ON i.order_id=o.id " +
      "JOIN stock_reservations r ON r.id=i.reservation_id WHERE o.id=$1",
      [rollbackOrder.id],
    );
    assert.deepEqual(rollbackState.rows[0], { order_status: "RESERVED", reservation_status: "ACTIVE" });
    assert.equal((await sql.query(
      "SELECT count(*)::int AS n FROM stock_movements WHERE reference_type='ORDER' AND reference_id=$1",
      [rollbackOrder.id],
    )).rows[0].n, 0);
    assert.deepEqual(await getBalance(variantA), { on_hand: "18.000", reserved: "1.000", available: "17.000" });
    await sql.query(
      "UPDATE inventory_costs SET inventory_value=ROUND(quantity*average_unit_cost,6) WHERE warehouse_id=$1 AND variant_id=$2",
      [store.defaultWarehouseId, variantA],
    );
    await orders.cancelOrder(actorId, "orders-test", rollbackOrder.id);
    console.log("PASS Order posting rollback: inconsistent WAC aborts every stock, reservation and movement write");

    const concurrentPostOrder = await orders.createOrder(actorId, "orders-test", {
      ...base,
      idempotencyKey: "order-post-concurrent",
      items: [{ variantId: variantA, variantUomId: input.items[0].variantUomId, quantity: "1" }],
    });
    const concurrentPosts = await Promise.all([
      orders.postOrder(actorId, "orders-test", concurrentPostOrder.id, "post-concurrent-key"),
      orders.postOrder(actorId, "orders-test", concurrentPostOrder.id, "post-concurrent-key"),
    ]);
    assert.equal(concurrentPosts.filter(result => result.idempotentReplay === true).length, 1);
    assert.equal(concurrentPosts.every(result => result.status === "POSTED"), true);
    assert.equal((await sql.query(
      "SELECT count(*)::int AS n FROM stock_movements WHERE reference_type='ORDER' AND reference_id=$1",
      [concurrentPostOrder.id],
    )).rows[0].n, 1);
    assert.deepEqual(await getBalance(variantA), { on_hand: "17.000", reserved: "0.000", available: "17.000" });
    console.log("PASS Concurrent Order posting: same-key parallel requests produce one SALE movement");

    await sql.query("UPDATE tax_profiles SET price_tax_mode='INCLUSIVE',updated_at=NOW() WHERE id=$1", [taxProfileId]);
    const inclusive = await orders.createOrder(actorId, "orders-test", {
      ...base, idempotencyKey: "order-inclusive-tax",
      items: [{ variantId: variantA, variantUomId: input.items[0].variantUomId, quantity: "1" }],
    });
    assert.equal(inclusive.subtotal, "93.4600");
    assert.equal(inclusive.tax_amount, "6.5400");
    assert.equal(inclusive.total_amount, "100.0000");
    await orders.cancelOrder(actorId, "orders-test", inclusive.id);
    await sql.query("UPDATE tax_profiles SET price_tax_mode='EXCLUSIVE',updated_at=NOW() WHERE id=$1", [taxProfileId]);
    console.log("PASS Tax inclusive calculation: document totals reconcile at currency precision");

    const sameKeyInput = {
      ...base, idempotencyKey: "order-concurrent-idempotency",
      items: [{ variantId: variantA, variantUomId: input.items[0].variantUomId, quantity: "1" }],
    };
    const sameKeyRace = await Promise.all([
      orders.createOrder(actorId, "orders-test", sameKeyInput),
      orders.createOrder(actorId, "orders-test", sameKeyInput),
    ]);
    assert.equal(sameKeyRace[0].id, sameKeyRace[1].id);
    assert.equal((await sql.query("SELECT count(*)::int AS n FROM sales_orders WHERE idempotency_key='order-concurrent-idempotency'")).rows[0].n, 1);
    await orders.cancelOrder(actorId, "orders-test", sameKeyRace[0].id);
    assert.deepEqual(await getBalance(variantA), { on_hand: "17.000", reserved: "0.000", available: "17.000" });
    console.log("PASS Concurrent idempotency: duplicate requests create one Order and one set of reservations");

    const concurrentInput = {
      ...base,
      items: [{ variantId: variantC, variantUomId: (await sql.query("SELECT id FROM variant_uoms WHERE variant_id=$1", [variantC])).rows[0].id, quantity: "7" }],
    };
    const races = await Promise.allSettled([
      orders.createOrder(actorId, "orders-test", { ...concurrentInput, idempotencyKey: "order-race-a" }),
      orders.createOrder(actorId, "orders-test", { ...concurrentInput, idempotencyKey: "order-race-b" }),
    ]);
    assert.equal(races.filter(x => x.status === "fulfilled").length, 1);
    assert.equal(races.filter(x => x.status === "rejected" && errorStatus(x.reason) === 409).length, 1);
    assert.deepEqual(await getBalance(variantC), { on_hand: "10.000", reserved: "7.000", available: "3.000" });
    console.log("PASS Order concurrency: competing Orders cannot reserve more than available stock");

    const list = await orders.listOrders(actorId, "orders-test", { storeId: store.id, page: "1", pageSize: "10" });
    assert.equal(list.pagination.total, 7);
    console.log("PASS Order list: filters and pagination return committed Orders");

    const posted = await sql.query("SELECT id FROM sales_orders WHERE idempotency_key='order-race-a' OR idempotency_key='order-race-b' LIMIT 1");
    await sql.query("UPDATE sales_orders SET status='POSTED' WHERE id=$1", [posted.rows[0].id]);
    await assert.rejects(
      () => orders.cancelOrder(actorId, "orders-test", posted.rows[0].id),
      error => errorStatus(error) === 409,
    );
    console.log("PASS State guard: a posted Order cannot be cancelled through the pre-post cancellation endpoint");

    console.log("SALES_ORDERS_SERVICE_E2E=PASS");
  } finally {
    if (prisma) await prisma.$disconnect().catch(() => undefined);
    if (sql) await sql.end().catch(() => undefined);
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1", [database]).catch(() => undefined);
    await admin.query('DROP DATABASE IF EXISTS "' + database + '"').catch(() => undefined);
    const cleanup = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [database]).catch(() => ({ rowCount: 1 }));
    assert.equal(cleanup.rowCount, 0, "Disposable database cleanup failed");
    console.log("DISPOSABLE_DATABASE_CLEANUP=PASS");
    await admin.end();
  }
}
main().catch(error => {
  console.error("SALES_ORDERS_SERVICE_E2E_FAILED", error.stack || error.message);
  process.exitCode = 1;
});
