import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { WorkspaceDatabaseRegistry } from "../../database/workspace-database.registry";

type OrderStatus = "RESERVED" | "CANCELLED" | "POSTED";
type ItemInput = { variantId: string; variantUomId: string; quantity: string };
type Payload = { storeId: string; branchId: string; warehouseId: string; items: ItemInput[] };
type ExistingOrder = { id: string; status: OrderStatus; idempotency_payload: Payload };
type StoreContext = { store_id: string; currency: string; timezone: string; branch_id: string; branch_code: string; warehouse_id: string };
type TaxProfile = { id: string; tax_mode: "VAT" | "NO_VAT"; price_tax_mode: "INCLUSIVE" | "EXCLUSIVE"; currency_minor_units: number };
type ProductRow = {
  product_name: string; variant_title: string; sku: string; variant_id: string; variant_uom_id: string;
  uom_code: string; uom_name: string; conversion_to_base: string; price_id: string; unit_price: string;
  currency: string; tax_category_id: string | null; tax_category_code: string | null; tax_category_status: string | null;
};
type ReservationRow = { id: string; warehouse_id: string; variant_id: string; quantity: string; status: string };

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadRequestException(field + " must be a valid UUID");
  }
  return value.toLowerCase();
}
function quantity(value: unknown): string {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,12})(?:\.\d{1,3})?$/.test(value) || !/[1-9]/.test(value)) {
    throw new BadRequestException("Quantity must be a positive Decimal string with at most 3 decimal places");
  }
  const parts = value.split(".");
  return parts[0] + "." + (parts[1] ?? "").padEnd(3, "0");
}
function keyValue(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 140) {
    throw new BadRequestException("Idempotency-Key is required and must not exceed 140 characters");
  }
  return value.trim();
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") + "}";
  }
  return JSON.stringify(value);
}
function uniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; meta?: { code?: string; message?: string } };
  return e?.code === "P2002" || e?.meta?.code === "23505" ||
    (typeof e?.meta?.message === "string" && e.meta.message.includes("23505"));
}

@Injectable()
export class SalesOrdersService {
  constructor(private readonly databases: WorkspaceDatabaseRegistry) {}
  private db(userId: string, workspaceId: string): Promise<PrismaClient> {
    return this.databases.forMembership(userId, workspaceId);
  }
  private normalize(input: { storeId: unknown; branchId: unknown; warehouseId: unknown; items: unknown }): Payload {
    const storeId = uuid(input?.storeId, "storeId");
    const branchId = uuid(input?.branchId, "branchId");
    const warehouseId = uuid(input?.warehouseId, "warehouseId");
    if (!Array.isArray(input?.items) || input.items.length < 1 || input.items.length > 100) {
      throw new BadRequestException("Order must contain between 1 and 100 items");
    }
    const items = input.items.map((raw: unknown, index: number) => {
      if (!raw || typeof raw !== "object") throw new BadRequestException("Invalid item at line " + (index + 1));
      const item = raw as Record<string, unknown>;
      return {
        variantId: uuid(item.variantId, "items[" + index + "].variantId"),
        variantUomId: uuid(item.variantUomId, "items[" + index + "].variantUomId"),
        quantity: quantity(item.quantity),
      };
    });
    const seen = new Set<string>();
    for (const item of items) {
      const identity = item.variantId + ":" + item.variantUomId;
      if (seen.has(identity)) throw new BadRequestException("Duplicate variant and UOM lines are not allowed");
      seen.add(identity);
    }
    return { storeId, branchId, warehouseId, items };
  }
  private async findByKey(db: PrismaClient, key: string): Promise<ExistingOrder | null> {
    const rows = await db.$queryRawUnsafe<ExistingOrder[]>(
      "SELECT id::text, status::text AS status, idempotency_payload FROM sales_orders WHERE idempotency_key=$1",
      key,
    );
    return rows[0] ?? null;
  }
  private async replay(db: PrismaClient, row: ExistingOrder, payload: Payload) {
    if (canonical(row.idempotency_payload) !== canonical(payload)) {
      throw new ConflictException("Idempotency key was already used with a different order payload");
    }
    return { ...(await this.orderDetail(db, row.id)), idempotentReplay: true };
  }

  async createOrder(userId: string, workspaceId: string, input: {
    storeId: unknown; branchId: unknown; warehouseId: unknown; items: unknown; idempotencyKey: unknown;
  }) {
    const payload = this.normalize(input);
    const key = keyValue(input.idempotencyKey);
    const db = await this.db(userId, workspaceId);
    const existing = await this.findByKey(db, key);
    if (existing) return this.replay(db, existing, payload);
    const orderId = randomUUID();

    try {
      await db.$transaction(async tx => {
        const contexts = await tx.$queryRawUnsafe<StoreContext[]>(
          "SELECT s.id::text AS store_id,s.currency,s.timezone,b.id::text AS branch_id,b.code AS branch_code,w.id::text AS warehouse_id " +
          "FROM stores s JOIN branches b ON b.store_id=s.id JOIN warehouses w ON w.branch_id=b.id " +
          "WHERE s.id=$1::uuid AND b.id=$2::uuid AND w.id=$3::uuid " +
          "AND s.status='ACTIVE' AND b.status='ACTIVE' AND w.status='ACTIVE' FOR SHARE OF s,b,w",
          payload.storeId, payload.branchId, payload.warehouseId,
        );
        if (!contexts.length) throw new BadRequestException("Store, Branch and Warehouse must be active and belong to the same hierarchy");
        const context = contexts[0];

        const profiles = await tx.$queryRawUnsafe<TaxProfile[]>(
          "SELECT id::text,tax_mode::text AS tax_mode,price_tax_mode::text AS price_tax_mode,currency_minor_units " +
          "FROM tax_profiles WHERE store_id=$1::uuid AND valid_from<=NOW() AND (valid_to IS NULL OR valid_to>NOW()) " +
          "ORDER BY valid_from DESC,created_at DESC LIMIT 1 FOR SHARE",
          context.store_id,
        );
        if (!profiles.length) throw new ConflictException("Store has no active Tax Profile; configure tax before creating Orders");
        const tax = profiles[0];

        const yearRows = await tx.$queryRawUnsafe<Array<{ sequence_year: number }>>(
          "SELECT EXTRACT(YEAR FROM (NOW() AT TIME ZONE $1))::int AS sequence_year", context.timezone,
        );
        const year = yearRows[0].sequence_year;
        const seqRows = await tx.$queryRawUnsafe<Array<{ last_value: string }>>(
          "INSERT INTO order_sequences (branch_id,document_type,sequence_year,last_value,updated_at) " +
          "VALUES ($1::uuid,'SO',$2,1,NOW()) ON CONFLICT (branch_id,document_type,sequence_year) " +
          "DO UPDATE SET last_value=order_sequences.last_value+1,updated_at=NOW() RETURNING last_value::text",
          context.branch_id, year,
        );
        const branchCode = context.branch_code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20) || "BR";
        const orderNumber = "SO-" + branchCode + "-" + year + "-" + seqRows[0].last_value.padStart(6, "0");

        await tx.$executeRawUnsafe(
          "INSERT INTO sales_orders (id,store_id,branch_id,warehouse_id,order_number,status,currency,tax_profile_id,tax_mode,price_tax_mode," +
          "rounding_minor_units,subtotal,tax_amount,total_amount,idempotency_key,idempotency_payload,created_by,created_at,updated_at) " +
          "VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'RESERVED',$6,$7::uuid,$8::\"TaxMode\",$9::\"PriceTaxMode\",$10,0,0,0,$11,$12::jsonb,$13::uuid,NOW(),NOW())",
          orderId, context.store_id, context.branch_id, context.warehouse_id, orderNumber, context.currency,
          tax.id, tax.tax_mode, tax.price_tax_mode, tax.currency_minor_units, key, JSON.stringify(payload), userId,
        );

        const resolved: Array<{
          lineNumber: number; variantId: string; variantUomId: string; quantity: string; baseQuantity: string;
          conversionFactor: string; productName: string; variantTitle: string; sku: string; uomCode: string;
          uomName: string; priceId: string; unitPrice: string; currency: string; taxCategoryId: string | null;
          taxCategoryCode: string | null; taxRate: string; netAmount: string; taxAmount: string; totalAmount: string;
        }> = [];

        for (let i = 0; i < payload.items.length; i++) {
          const item = payload.items[i];
          const products = await tx.$queryRawUnsafe<ProductRow[]>(
            "SELECT p.name AS product_name,v.title AS variant_title,v.sku,v.id::text AS variant_id,vu.id::text AS variant_uom_id," +
            "u.code AS uom_code,u.name AS uom_name,vu.conversion_to_base::text AS conversion_to_base," +
            "price.id::text AS price_id,price.amount::text AS unit_price,price.currency," +
            "tc.id::text AS tax_category_id,tc.code AS tax_category_code,tc.status::text AS tax_category_status " +
            "FROM product_variants v JOIN products p ON p.id=v.product_id " +
            "JOIN variant_uoms vu ON vu.variant_id=v.id AND vu.id=$2::uuid AND vu.status='ACTIVE' AND vu.usage IN ('BASE','SELL','SELL_AND_PURCHASE') " +
            "JOIN unit_of_measures u ON u.id=vu.uom_id AND u.status='ACTIVE' " +
            "JOIN store_product_variants spv ON spv.variant_id=v.id AND spv.store_id=$3::uuid AND spv.publish_status='PUBLISHED' " +
            "JOIN store_products sp ON sp.id=spv.store_product_id AND sp.store_id=spv.store_id AND sp.publish_status='PUBLISHED' AND sp.archived_at IS NULL " +
            "JOIN LATERAL (SELECT pp.id,pp.amount,pp.currency FROM product_prices pp " +
            "WHERE pp.store_product_variant_id=spv.id AND pp.variant_id=v.id AND pp.variant_uom_id=vu.id AND pp.currency=$4 " +
            "AND pp.valid_from<=NOW() AND (pp.valid_to IS NULL OR pp.valid_to>NOW()) " +
            "ORDER BY pp.valid_from DESC,pp.created_at DESC LIMIT 1) price ON TRUE " +
            "LEFT JOIN tax_categories tc ON tc.id=v.tax_category_id " +
            "WHERE v.id=$1::uuid AND v.status='ACTIVE' AND p.status='ACTIVE' LIMIT 1 FOR SHARE OF v,p,vu,u,spv,sp",
            item.variantId, item.variantUomId, context.store_id, context.currency,
          );
          if (!products.length) throw new NotFoundException("Sellable product, published store listing, active UOM or current price not found at line " + (i + 1));
          const product = products[0];
          const lockedPrices = await tx.$queryRawUnsafe<Array<{ id: string }>>(
            "SELECT id::text FROM product_prices WHERE id=$1::uuid AND valid_from<=NOW() AND (valid_to IS NULL OR valid_to>NOW()) FOR SHARE",
            product.price_id,
          );
          if (!lockedPrices.length) throw new ConflictException("Product price changed while creating the Order; retry the request");
          if (tax.tax_mode === "VAT" && (!product.tax_category_id || product.tax_category_status !== "ACTIVE")) {
            throw new ConflictException("Product Variant must have an active Tax Category before sale: " + product.sku);
          }
          let rate = "0";
          if (tax.tax_mode === "VAT") {
            const rates = await tx.$queryRawUnsafe<Array<{ rate: string }>>(
              "SELECT rate::text FROM tax_rates WHERE tax_profile_id=$1::uuid AND tax_category_id=$2::uuid " +
              "AND valid_from<=NOW() AND (valid_to IS NULL OR valid_to>NOW()) " +
              "ORDER BY valid_from DESC,created_at DESC LIMIT 1 FOR SHARE",
              tax.id, product.tax_category_id,
            );
            if (!rates.length) throw new ConflictException("No active Tax Rate for category " + product.tax_category_code);
            rate = rates[0].rate;
          }
          const conversion = await tx.$queryRawUnsafe<Array<{ base_quantity: string; exact: boolean }>>(
            "SELECT ROUND($1::numeric*$2::numeric,3)::text AS base_quantity," +
            "($1::numeric*$2::numeric=ROUND($1::numeric*$2::numeric,3)) AS exact",
            item.quantity, product.conversion_to_base,
          );
          if (!conversion[0]?.exact || Number(conversion[0].base_quantity) <= 0) {
            throw new BadRequestException("Quantity cannot be represented in base UOM to 3 decimal places for SKU " + product.sku);
          }
          const amounts = await tx.$queryRawUnsafe<Array<{ net_amount: string; tax_amount: string; total_amount: string }>>(
            "SELECT ROUND(CASE WHEN $1='NO_VAT' THEN $2::numeric*$3::numeric " +
            "WHEN $4='INCLUSIVE' THEN ($2::numeric*$3::numeric)/(1+$5::numeric) ELSE $2::numeric*$3::numeric END,4)::text AS net_amount," +
            "ROUND(CASE WHEN $1='NO_VAT' THEN 0 WHEN $4='INCLUSIVE' THEN ($2::numeric*$3::numeric)-(($2::numeric*$3::numeric)/(1+$5::numeric)) " +
            "ELSE ($2::numeric*$3::numeric)*$5::numeric END,4)::text AS tax_amount," +
            "ROUND(CASE WHEN $4='INCLUSIVE' OR $1='NO_VAT' THEN $2::numeric*$3::numeric " +
            "ELSE ($2::numeric*$3::numeric)*(1+$5::numeric) END,4)::text AS total_amount",
            tax.tax_mode, product.unit_price, item.quantity, tax.price_tax_mode, rate,
          );
          resolved.push({
            lineNumber: i + 1, variantId: product.variant_id, variantUomId: product.variant_uom_id,
            quantity: item.quantity, baseQuantity: conversion[0].base_quantity, conversionFactor: product.conversion_to_base,
            productName: product.product_name, variantTitle: product.variant_title, sku: product.sku,
            uomCode: product.uom_code, uomName: product.uom_name, priceId: product.price_id,
            unitPrice: product.unit_price, currency: product.currency, taxCategoryId: product.tax_category_id,
            taxCategoryCode: product.tax_category_code, taxRate: rate,
            netAmount: amounts[0].net_amount, taxAmount: amounts[0].tax_amount, totalAmount: amounts[0].total_amount,
          });
        }

        // Stable balance lock order makes concurrent multi-line orders deterministic.
        const lockOrder = [...resolved].sort((a, b) => a.variantId.localeCompare(b.variantId) || a.lineNumber - b.lineNumber);
        const reservationByLine = new Map<number, string>();
        for (const item of lockOrder) {
          const balances = await tx.$queryRawUnsafe<Array<{ available: string }>>(
            "SELECT available::text FROM stock_balances WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid FOR UPDATE",
            context.warehouse_id, item.variantId,
          );
          if (!balances.length || Number(balances[0].available) < Number(item.baseQuantity)) {
            throw new ConflictException("Insufficient available stock for SKU " + item.sku);
          }
          const changed = await tx.$executeRawUnsafe(
            "UPDATE stock_balances SET reserved=reserved+$3::numeric,available=available-$3::numeric,updated_at=NOW() " +
            "WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid AND available >= $3::numeric",
            context.warehouse_id, item.variantId, item.baseQuantity,
          );
          if (changed !== 1) throw new ConflictException("Insufficient available stock for SKU " + item.sku);
          const reservationId = randomUUID();
          await tx.$executeRawUnsafe(
            "INSERT INTO stock_reservations (id,warehouse_id,variant_id,quantity,status,reference_type,reference_id,idempotency_key,actor_user_id,created_at,updated_at) " +
            "VALUES ($1::uuid,$2::uuid,$3::uuid,$4::numeric,'ACTIVE','ORDER',$5::uuid,$6,$7::uuid,NOW(),NOW())",
            reservationId, context.warehouse_id, item.variantId, item.baseQuantity, orderId,
            "order:" + orderId + ":" + item.lineNumber, userId,
          );
          reservationByLine.set(item.lineNumber, reservationId);
        }
        for (const item of resolved) {
          const reservationId = reservationByLine.get(item.lineNumber);
          if (!reservationId) throw new ConflictException("Order reservation was not created");
          await tx.$executeRawUnsafe(
            "INSERT INTO sales_order_items (id,order_id,line_number,variant_id,variant_uom_id,reservation_id,product_name,variant_title,sku,uom_code,uom_name," +
            "quantity,base_quantity,conversion_factor,price_id,unit_price,currency,tax_category_id,tax_category_code,tax_rate,net_amount,tax_amount,total_amount) " +
            "VALUES ($1::uuid,$2::uuid,$3,$4::uuid,$5::uuid,$6::uuid,$7,$8,$9,$10,$11,$12::numeric,$13::numeric,$14::numeric,$15::uuid,$16::numeric,$17,$18::uuid,$19,$20::numeric,$21::numeric,$22::numeric,$23::numeric)",
            randomUUID(), orderId, item.lineNumber, item.variantId, item.variantUomId, reservationId,
            item.productName, item.variantTitle, item.sku, item.uomCode, item.uomName,
            item.quantity, item.baseQuantity, item.conversionFactor, item.priceId, item.unitPrice, item.currency,
            item.taxCategoryId, item.taxCategoryCode, item.taxRate, item.netAmount, item.taxAmount, item.totalAmount,
          );
        }
        const totals = await tx.$queryRawUnsafe<Array<{ subtotal: string; tax_amount: string; total_amount: string }>>(
          "SELECT ROUND(SUM(net_amount),$2::int)::text AS subtotal," +
          "CASE WHEN $3='INCLUSIVE' THEN (ROUND(SUM(total_amount),$2::int)-ROUND(SUM(net_amount),$2::int))::text " +
          "ELSE ROUND(SUM(tax_amount),$2::int)::text END AS tax_amount," +
          "CASE WHEN $3='INCLUSIVE' THEN ROUND(SUM(total_amount),$2::int)::text " +
          "ELSE (ROUND(SUM(net_amount),$2::int)+ROUND(SUM(tax_amount),$2::int))::text END AS total_amount " +
          "FROM sales_order_items WHERE order_id=$1::uuid",
          orderId, tax.currency_minor_units, tax.price_tax_mode,
        );
        await tx.$executeRawUnsafe(
          "UPDATE sales_orders SET subtotal=$2::numeric,tax_amount=$3::numeric,total_amount=$4::numeric,updated_at=NOW() WHERE id=$1::uuid",
          orderId, totals[0].subtotal, totals[0].tax_amount, totals[0].total_amount,
        );
        await tx.$executeRawUnsafe(
          "INSERT INTO audit_events (id,actor_id,action,resource_type,resource_id,metadata) VALUES ($1::uuid,$2::uuid,'ORDER_CREATED','SalesOrder',$3,$4::jsonb)",
          randomUUID(), userId, orderId,
          JSON.stringify({ orderNumber, itemCount: resolved.length, warehouseId: context.warehouse_id }),
        );
      });
    } catch (error) {
      if (uniqueViolation(error)) {
        const replayRow = await this.findByKey(db, key);
        if (replayRow) return this.replay(db, replayRow, payload);
      }
      throw error;
    }
    return { ...(await this.orderDetail(db, orderId)), idempotentReplay: false };
  }

  async listOrders(userId: string, workspaceId: string, query: {
    storeId?: string; branchId?: string; status?: string; search?: string; page?: string; pageSize?: string;
  }) {
    const page = this.pagination(query.page, 1, 1_000_000, "page");
    const pageSize = this.pagination(query.pageSize, 25, 100, "pageSize");
    const storeId = query.storeId ? uuid(query.storeId, "storeId") : null;
    const branchId = query.branchId ? uuid(query.branchId, "branchId") : null;
    const status = query.status?.trim().toUpperCase() || null;
    if (status && !["RESERVED", "CANCELLED", "POSTED"].includes(status)) throw new BadRequestException("Unsupported Order status");
    const search = query.search?.trim() || null;
    if (search && search.length > 100) throw new BadRequestException("search must not exceed 100 characters");
    const offset = (page - 1) * pageSize;
    const db = await this.db(userId, workspaceId);
    const args = [storeId, branchId, status, search ? "%" + search + "%" : null, pageSize, offset];
    const [items, count] = await Promise.all([
      db.$queryRawUnsafe<Array<Record<string, unknown>>>(
        "SELECT o.id::text,o.order_number,o.status::text AS status,o.store_id::text,o.branch_id::text,o.warehouse_id::text," +
        "o.currency,o.subtotal::text,o.tax_amount::text,o.total_amount::text,o.created_at,o.updated_at," +
        "(SELECT COUNT(*)::int FROM sales_order_items i WHERE i.order_id=o.id) AS item_count " +
        "FROM sales_orders o WHERE ($1::uuid IS NULL OR o.store_id=$1::uuid) AND ($2::uuid IS NULL OR o.branch_id=$2::uuid) " +
        "AND ($3::text IS NULL OR o.status=$3::\"SalesOrderStatus\") AND ($4::text IS NULL OR o.order_number ILIKE $4) " +
        "ORDER BY o.created_at DESC,o.id DESC LIMIT $5 OFFSET $6",
        ...args,
      ),
      db.$queryRawUnsafe<Array<{ total: number }>>(
        "SELECT COUNT(*)::int AS total FROM sales_orders o WHERE ($1::uuid IS NULL OR o.store_id=$1::uuid) " +
        "AND ($2::uuid IS NULL OR o.branch_id=$2::uuid) AND ($3::text IS NULL OR o.status=$3::\"SalesOrderStatus\") " +
        "AND ($4::text IS NULL OR o.order_number ILIKE $4)",
        storeId, branchId, status, search ? "%" + search + "%" : null,
      ),
    ]);
    const total = count[0]?.total ?? 0;
    return { items, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async getOrder(userId: string, workspaceId: string, orderId: string) {
    const id = uuid(orderId, "orderId");
    const db = await this.db(userId, workspaceId);
    return this.orderDetail(db, id);
  }

  private async orderDetail(db: PrismaClient, orderId: string) {
    const orders = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      "SELECT o.id::text,o.order_number,o.status::text AS status,o.store_id::text,s.name AS store_name," +
      "o.branch_id::text,b.code AS branch_code,b.name AS branch_name,o.warehouse_id::text,w.code AS warehouse_code,w.name AS warehouse_name," +
      "o.currency,o.tax_profile_id::text,o.tax_mode::text AS tax_mode,o.price_tax_mode::text AS price_tax_mode,o.rounding_minor_units," +
      "o.subtotal::text,o.tax_amount::text,o.total_amount::text,o.created_by::text,o.cancelled_by::text,o.cancelled_at,o.cancel_reason,o.posted_by::text,o.posted_at,o.created_at,o.updated_at " +
      "FROM sales_orders o JOIN stores s ON s.id=o.store_id JOIN branches b ON b.id=o.branch_id JOIN warehouses w ON w.id=o.warehouse_id " +
      "WHERE o.id=$1::uuid",
      orderId,
    );
    if (!orders.length) throw new NotFoundException("Order not found");
    const items = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      "SELECT i.id::text,i.line_number,i.variant_id::text,i.variant_uom_id::text,i.reservation_id::text,r.status AS reservation_status," +
      "i.product_name,i.variant_title,i.sku,i.uom_code,i.uom_name,i.quantity::text,i.base_quantity::text,i.conversion_factor::text," +
      "i.price_id::text,i.unit_price::text,i.currency,i.tax_category_id::text,i.tax_category_code,i.tax_rate::text," +
      "i.net_amount::text,i.tax_amount::text,i.total_amount::text,i.unit_cost_snapshot::text,i.total_cost_snapshot::text FROM sales_order_items i " +
      "JOIN stock_reservations r ON r.id=i.reservation_id WHERE i.order_id=$1::uuid ORDER BY i.line_number",
      orderId,
    );
    return { ...orders[0], items };
  }

  async postOrder(userId: string, workspaceId: string, orderId: string, idempotencyKeyValue: unknown) {
    const id = uuid(orderId, "orderId");
    const key = keyValue(idempotencyKeyValue);
    const db = await this.db(userId, workspaceId);
    let idempotentReplay = false;

    try {
      await db.$transaction(async tx => {
        const orders = await tx.$queryRawUnsafe<Array<{
          id: string; status: OrderStatus; warehouse_id: string; posting_idempotency_key: string | null;
        }>>(
          "SELECT id::text,status::text AS status,warehouse_id::text,posting_idempotency_key " +
          "FROM sales_orders WHERE id=$1::uuid FOR UPDATE",
          id,
        );
        if (!orders.length) throw new NotFoundException("Order not found");
        const order = orders[0];
        if (order.status === "POSTED") {
          if (order.posting_idempotency_key !== key) {
            throw new ConflictException("Order has already been posted with a different idempotency key");
          }
          idempotentReplay = true;
          return;
        }
        if (order.status !== "RESERVED") {
          throw new ConflictException("Only a reserved Order can be posted");
        }

        const items = await tx.$queryRawUnsafe<Array<{
          id: string; line_number: number; variant_id: string; reservation_id: string;
          base_quantity: string; reservation_quantity: string; reservation_status: string;
          reservation_warehouse_id: string; reference_type: string | null; reference_id: string | null;
        }>>(
          "SELECT i.id::text,i.line_number,i.variant_id::text,i.reservation_id::text,i.base_quantity::text," +
          "r.quantity::text AS reservation_quantity,r.status AS reservation_status,r.warehouse_id::text AS reservation_warehouse_id," +
          "r.reference_type,r.reference_id::text " +
          "FROM sales_order_items i JOIN stock_reservations r ON r.id=i.reservation_id " +
          "WHERE i.order_id=$1::uuid ORDER BY i.variant_id,i.line_number FOR UPDATE OF i,r",
          id,
        );
        if (!items.length) throw new ConflictException("Order has no items to post");

        const variantIds = [...new Set(items.map(item => item.variant_id))].sort();
        const balances = new Map<string, { on_hand: string; reserved: string; available: string }>();
        const costs = new Map<string, { quantity: string; average_unit_cost: string; inventory_value: string }>();

        // Lock balance and cost rows in the same stable variant order used by inventory operations.
        for (const variantId of variantIds) {
          const balanceRows = await tx.$queryRawUnsafe<Array<{ on_hand: string; reserved: string; available: string }>>(
            "SELECT on_hand::text,reserved::text,available::text FROM stock_balances " +
            "WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid FOR UPDATE",
            order.warehouse_id, variantId,
          );
          if (!balanceRows.length) throw new ConflictException("Stock balance is missing for an Order item");
          const costRows = await tx.$queryRawUnsafe<Array<{ quantity: string; average_unit_cost: string; inventory_value: string }>>(
            "SELECT quantity::text,average_unit_cost::text,inventory_value::text FROM inventory_costs " +
            "WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid FOR UPDATE",
            order.warehouse_id, variantId,
          );
          if (!costRows.length) throw new ConflictException("Inventory cost record is missing; reconcile stock before posting");
          const balance = balanceRows[0];
          const cost = costRows[0];
          const check = await tx.$queryRawUnsafe<Array<{ valid: boolean }>>(
            "SELECT ($1::numeric=$4::numeric AND abs($3::numeric-ROUND($1::numeric*$2::numeric,6))<=" +
            "GREATEST(0.000001,ABS($1::numeric)*0.0000005)) AS valid",
            cost.quantity, cost.average_unit_cost, cost.inventory_value, balance.on_hand,
          );
          if (!check[0]?.valid) {
            throw new ConflictException("InventoryCost does not reconcile with StockBalance; posting was stopped");
          }
          balances.set(variantId, balance);
          costs.set(variantId, cost);
        }

        const requestedByVariant = new Map<string, string>();
        for (const item of items) {
          if (item.reservation_status !== "ACTIVE" || item.reference_type !== "ORDER" ||
              item.reference_id !== id || item.reservation_warehouse_id !== order.warehouse_id) {
            throw new ConflictException("Order reservation is missing, inactive or linked to another document");
          }
          const quantityCheck = await tx.$queryRawUnsafe<Array<{ valid: boolean }>>(
            "SELECT ($1::numeric=$2::numeric AND $1::numeric>0) AS valid",
            item.reservation_quantity, item.base_quantity,
          );
          if (!quantityCheck[0]?.valid) {
            throw new ConflictException("Order reservation quantity does not match the Order item");
          }
          const previous = requestedByVariant.get(item.variant_id) ?? "0";
          const sum = await tx.$queryRawUnsafe<Array<{ quantity: string }>>(
            "SELECT ($1::numeric+$2::numeric)::text AS quantity",
            previous, item.reservation_quantity,
          );
          requestedByVariant.set(item.variant_id, sum[0].quantity);
        }
        for (const [variantId, requested] of requestedByVariant) {
          const balance = balances.get(variantId)!;
          const valid = await tx.$queryRawUnsafe<Array<{ valid: boolean }>>(
            "SELECT ($1::numeric >= $2::numeric AND $3::numeric >= $2::numeric " +
            "AND $4::numeric = $1::numeric-$3::numeric) AS valid",
            balance.on_hand, requested, balance.reserved, balance.available,
          );
          if (!valid[0]?.valid) {
            throw new ConflictException("Reserved stock balance is inconsistent; posting was stopped");
          }
        }

        let totalCostSnapshot = "0";
        for (const item of items) {
          const qty = item.reservation_quantity;
          const cost = costs.get(item.variant_id)!;
          const totalCostRows = await tx.$queryRawUnsafe<Array<{ total_cost: string }>>(
            "SELECT ROUND($1::numeric*$2::numeric,6)::text AS total_cost",
            qty, cost.average_unit_cost,
          );
          const totalCost = totalCostRows[0].total_cost;
          const costSum = await tx.$queryRawUnsafe<Array<{ total: string }>>(
            "SELECT ($1::numeric+$2::numeric)::text AS total",
            totalCostSnapshot, totalCost,
          );
          totalCostSnapshot = costSum[0].total;

          const balanceChanged = await tx.$executeRawUnsafe(
            "UPDATE stock_balances SET on_hand=on_hand-$3::numeric,reserved=reserved-$3::numeric," +
            "updated_at=NOW() WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid " +
            "AND on_hand >= $3::numeric AND reserved >= $3::numeric",
            order.warehouse_id, item.variant_id, qty,
          );
          if (balanceChanged !== 1) throw new ConflictException("Stock balance changed during Order posting");

          const costChanged = await tx.$executeRawUnsafe(
            "UPDATE inventory_costs SET quantity=quantity-$3::numeric," +
            "inventory_value=CASE WHEN quantity-$3::numeric=0 THEN 0 ELSE ROUND((quantity-$3::numeric)*average_unit_cost,6) END," +
            "average_unit_cost=CASE WHEN quantity-$3::numeric=0 THEN 0 ELSE average_unit_cost END,updated_at=NOW() " +
            "WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid AND quantity >= $3::numeric AND inventory_value >= $4::numeric",
            order.warehouse_id, item.variant_id, qty, totalCost,
          );
          if (costChanged !== 1) throw new ConflictException("Inventory cost quantity/value is insufficient");

          const reservationChanged = await tx.$executeRawUnsafe(
            "UPDATE stock_reservations SET status='CONSUMED',updated_at=NOW() WHERE id=$1::uuid AND status='ACTIVE'",
            item.reservation_id,
          );
          if (reservationChanged !== 1) throw new ConflictException("Order reservation was consumed concurrently");

          await tx.$executeRawUnsafe(
            "UPDATE sales_order_items SET unit_cost_snapshot=$2::numeric,total_cost_snapshot=$3::numeric WHERE id=$1::uuid",
            item.id, cost.average_unit_cost, totalCost,
          );

          await tx.$executeRawUnsafe(
            "INSERT INTO stock_movements (id,warehouse_id,variant_id,movement_type,quantity_delta,unit_cost,total_cost," +
            "reference_type,reference_id,idempotency_key,actor_user_id) " +
            "VALUES ($1::uuid,$2::uuid,$3::uuid,'SALE',-$4::numeric,$5::numeric,$6::numeric,'ORDER',$7::uuid,$8,$9::uuid)",
            randomUUID(), order.warehouse_id, item.variant_id, qty, cost.average_unit_cost, totalCost,
            id, "order-post:" + id + ":" + item.id, userId,
          );
        }

        await tx.$executeRawUnsafe(
          "UPDATE sales_orders SET status='POSTED',posted_by=$2::uuid,posted_at=NOW()," +
          "posting_idempotency_key=$3,updated_at=NOW() WHERE id=$1::uuid AND status='RESERVED'",
          id, userId, key,
        );
        await tx.$executeRawUnsafe(
          "INSERT INTO audit_events (id,actor_id,action,resource_type,resource_id,metadata) " +
          "VALUES ($1::uuid,$2::uuid,'ORDER_POSTED','SalesOrder',$3,$4::jsonb)",
          randomUUID(), userId, id,
          JSON.stringify({ itemCount: items.length, warehouseId: order.warehouse_id, totalCostSnapshot }),
        );
      });
    } catch (error) {
      if (uniqueViolation(error)) {
        throw new ConflictException("Order posting idempotency key or SALE movement has already been used");
      }
      throw error;
    }
    return { ...(await this.orderDetail(db, id)), idempotentReplay };
  }

  async cancelOrder(userId: string, workspaceId: string, orderId: string, reasonValue?: unknown) {
    const id = uuid(orderId, "orderId");
    if (reasonValue != null && typeof reasonValue !== "string") throw new BadRequestException("reason must be a string");
    const reason = typeof reasonValue === "string" ? reasonValue.trim() || null : null;
    if (reason && reason.length > 500) throw new BadRequestException("reason must not exceed 500 characters");
    const db = await this.db(userId, workspaceId);
    await db.$transaction(async tx => {
      const orders = await tx.$queryRawUnsafe<Array<{ id: string; status: OrderStatus }>>(
        "SELECT id::text,status::text AS status FROM sales_orders WHERE id=$1::uuid FOR UPDATE", id,
      );
      if (!orders.length) throw new NotFoundException("Order not found");
      if (orders[0].status === "CANCELLED") return;
      if (orders[0].status !== "RESERVED") throw new ConflictException("Only a reserved, unposted Order can be cancelled");
      const items = await tx.$queryRawUnsafe<Array<{ reservation_id: string; variant_id: string }>>(
        "SELECT reservation_id::text,variant_id::text FROM sales_order_items WHERE order_id=$1::uuid ORDER BY variant_id,line_number",
        id,
      );
      for (const item of items) {
        const reservations = await tx.$queryRawUnsafe<ReservationRow[]>(
          "SELECT id::text,warehouse_id::text,variant_id::text,quantity::text,status FROM stock_reservations WHERE id=$1::uuid FOR UPDATE",
          item.reservation_id,
        );
        if (!reservations.length) throw new ConflictException("Order reservation is missing");
        const reservation = reservations[0];
        if (reservation.status === "ACTIVE") {
          const changed = await tx.$executeRawUnsafe(
            "UPDATE stock_balances SET reserved=reserved-$3::numeric,available=available+$3::numeric,updated_at=NOW() " +
            "WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid AND reserved >= $3::numeric",
            reservation.warehouse_id, reservation.variant_id, reservation.quantity,
          );
          if (changed !== 1) throw new ConflictException("Reserved stock balance is inconsistent");
          await tx.$executeRawUnsafe(
            "UPDATE stock_reservations SET status='RELEASED',released_at=NOW(),updated_at=NOW() WHERE id=$1::uuid AND status='ACTIVE'",
            reservation.id,
          );
        } else if (reservation.status !== "RELEASED") {
          throw new ConflictException("Order has a non-releasable reservation; cancellation stopped");
        }
      }
      await tx.$executeRawUnsafe(
        "UPDATE sales_orders SET status='CANCELLED',cancelled_by=$2::uuid,cancelled_at=NOW(),cancel_reason=$3,updated_at=NOW() WHERE id=$1::uuid",
        id, userId, reason,
      );
      await tx.$executeRawUnsafe(
        "INSERT INTO audit_events (id,actor_id,action,resource_type,resource_id,metadata) VALUES ($1::uuid,$2::uuid,'ORDER_CANCELLED','SalesOrder',$3,$4::jsonb)",
        randomUUID(), userId, id, JSON.stringify({ reason, releasedReservationCount: items.length }),
      );
    });
    return this.orderDetail(db, id);
  }

  private pagination(value: string | undefined, fallback: number, maximum: number, field: string): number {
    if (value === undefined || value === "") return fallback;
    if (!/^\d+$/.test(value)) throw new BadRequestException(field + " must be a positive integer");
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
      throw new BadRequestException(field + " must be between 1 and " + maximum);
    }
    return parsed;
  }
}
