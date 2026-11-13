import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { WorkspaceDatabaseRegistry } from "../../database/workspace-database.registry";

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadRequestException(field + " must be a valid UUID");
  }
  return value.toLowerCase();
}
function keyValue(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 140) {
    throw new BadRequestException("Idempotency-Key is required and must not exceed 140 characters");
  }
  return value.trim();
}
function positiveQuantity(value: unknown): string {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,12})(?:\.\d{1,3})?$/.test(value) || !/[1-9]/.test(value)) {
    throw new BadRequestException("Return quantity must be a positive Decimal string with at most 3 decimal places");
  }
  const [whole, fraction = ""] = value.split(".");
  return whole + "." + fraction.padEnd(3, "0");
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
type ReturnLine = { orderItemId: string; quantity: string };

@Injectable()
export class SalesReturnsService {
  constructor(private readonly databases: WorkspaceDatabaseRegistry) {}
  private db(userId: string, workspaceId: string): Promise<PrismaClient> {
    return this.databases.forMembership(userId, workspaceId);
  }

  async createReturn(userId: string, workspaceId: string, orderIdValue: unknown, input: {
    items: unknown; idempotencyKey: unknown; reason?: unknown;
  }) {
    const orderId = uuid(orderIdValue, "orderId");
    const key = keyValue(input?.idempotencyKey);
    if (input?.reason != null && typeof input.reason !== "string") throw new BadRequestException("reason must be a string");
    const reason = typeof input.reason === "string" ? input.reason.trim() || null : null;
    if (reason && reason.length > 500) throw new BadRequestException("reason must not exceed 500 characters");
    if (!Array.isArray(input?.items) || input.items.length < 1 || input.items.length > 100) {
      throw new BadRequestException("Return must contain between 1 and 100 items");
    }
    const lines: ReturnLine[] = input.items.map((raw: unknown, index: number) => {
      if (!raw || typeof raw !== "object") throw new BadRequestException("Invalid return item at line " + (index + 1));
      const row = raw as Record<string, unknown>;
      return { orderItemId: uuid(row.orderItemId, "items[" + index + "].orderItemId"), quantity: positiveQuantity(row.quantity) };
    });
    if (new Set(lines.map(x => x.orderItemId)).size !== lines.length) throw new BadRequestException("Duplicate order items are not allowed");

    const db = await this.db(userId, workspaceId);
    const payload = { orderId, items: lines, reason };
    const existing = await db.$queryRawUnsafe<Array<{ id: string; order_id: string; idempotency_payload: unknown }>>(
      "SELECT id::text,order_id::text,idempotency_payload FROM sales_returns WHERE idempotency_key=$1", key,
    );
    if (existing.length) {
      if (existing[0].order_id !== orderId || canonical(existing[0].idempotency_payload) !== canonical(payload)) {
        throw new ConflictException("Idempotency key was already used with a different Return payload");
      }
      return { ...(await this.returnDetail(db, existing[0].id)), idempotentReplay: true };
    }

    const returnId = randomUUID();
    try {
      await db.$transaction(async tx => {
        const orders = await tx.$queryRawUnsafe<Array<{
          id: string; status: string; warehouse_id: string; currency: string; rounding_minor_units: number;
        }>>(
          "SELECT id::text,status::text AS status,warehouse_id::text,currency,rounding_minor_units " +
          "FROM sales_orders WHERE id=$1::uuid FOR UPDATE", orderId,
        );
        if (!orders.length) throw new NotFoundException("Sales Order not found");
        const order = orders[0];
        if (order.status !== "POSTED") throw new ConflictException("Only a POSTED Sales Order can be returned");

        const lockedItems = await tx.$queryRawUnsafe<Array<{
          id: string; variant_id: string; base_quantity: string; unit_cost_snapshot: string | null;
          subtotal: string; tax_amount: string; total_amount: string; sale_movement_id: string;
          returned_quantity: string; returned_subtotal: string; returned_tax: string; returned_total: string;
        }>>(
          "SELECT i.id::text,i.variant_id::text,i.base_quantity::text,i.unit_cost_snapshot::text," +
          "i.net_amount::text AS subtotal,i.tax_amount::text,i.total_amount::text," +
          "m.id::text AS sale_movement_id," +
          "COALESCE((SELECT SUM(ri.quantity) FROM sales_return_items ri WHERE ri.order_item_id=i.id),0)::text AS returned_quantity," +
          "COALESCE((SELECT SUM(ri.subtotal) FROM sales_return_items ri WHERE ri.order_item_id=i.id),0)::text AS returned_subtotal," +
          "COALESCE((SELECT SUM(ri.tax_amount) FROM sales_return_items ri WHERE ri.order_item_id=i.id),0)::text AS returned_tax," +
          "COALESCE((SELECT SUM(ri.total_amount) FROM sales_return_items ri WHERE ri.order_item_id=i.id),0)::text AS returned_total " +
          "FROM sales_order_items i JOIN stock_movements m ON m.reference_type='ORDER' AND m.reference_id=i.order_id " +
          "AND m.variant_id=i.variant_id AND m.movement_type='SALE' AND m.idempotency_key=('order-post:' || i.order_id::text || ':' || i.id::text) " +
          "WHERE i.order_id=$1::uuid AND i.id=ANY($2::uuid[]) ORDER BY i.variant_id,i.id FOR UPDATE OF i",
          orderId, lines.map(x => x.orderItemId),
        );
        if (lockedItems.length !== lines.length) throw new BadRequestException("One or more order items do not belong to this Order");
        const byId = new Map(lockedItems.map(x => [x.id, x]));
        const variantIds = [...new Set(lockedItems.map(x => x.variant_id))].sort();
        const balances = new Map<string, { on_hand: string; reserved: string; available: string }>();
        const costs = new Map<string, { quantity: string; average_unit_cost: string; inventory_value: string }>();
        for (const variantId of variantIds) {
          const balanceRows = await tx.$queryRawUnsafe<Array<{ on_hand: string; reserved: string; available: string }>>(
            "SELECT on_hand::text,reserved::text,available::text FROM stock_balances " +
            "WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid FOR UPDATE", order.warehouse_id, variantId,
          );
          const costRows = await tx.$queryRawUnsafe<Array<{ quantity: string; average_unit_cost: string; inventory_value: string }>>(
            "SELECT quantity::text,average_unit_cost::text,inventory_value::text FROM inventory_costs " +
            "WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid FOR UPDATE", order.warehouse_id, variantId,
          );
          if (!balanceRows.length || !costRows.length) throw new ConflictException("Stock or InventoryCost record is missing");
          const b = balanceRows[0], c = costRows[0];
          const reconciled = await tx.$queryRawUnsafe<Array<{ valid: boolean }>>(
            "SELECT ($1::numeric=$4::numeric AND abs($3::numeric-ROUND($1::numeric*$2::numeric,6))<=GREATEST(0.000001,ABS($1::numeric)*0.0000005)) AS valid",
            c.quantity, c.average_unit_cost, c.inventory_value, b.on_hand,
          );
          if (!reconciled[0]?.valid) throw new ConflictException("InventoryCost does not reconcile with StockBalance");
          balances.set(variantId, b); costs.set(variantId, c);
        }

        let subtotal = "0", taxAmount = "0", totalAmount = "0";
        const prepared: Array<{ line: ReturnLine; item: typeof lockedItems[number]; cost: string; totalCost: string; net: string; tax: string; total: string }> = [];
        for (const line of lines) {
          const item = byId.get(line.orderItemId)!;
          if (!item.unit_cost_snapshot) throw new ConflictException("Original sale has no unit cost snapshot");
          const amounts = await tx.$queryRawUnsafe<Array<{ valid: boolean; total_cost: string; net: string; tax: string; total: string }>>(
            "SELECT ($1::numeric+$2::numeric<=$3::numeric) AS valid," +
            "ROUND($2::numeric*$4::numeric,6)::text AS total_cost," +
            "CASE WHEN $1::numeric+$2::numeric=$3::numeric THEN $5::numeric-$10::numeric ELSE ROUND($2::numeric*$5::numeric/$6::numeric,$7::int) END::text AS net," +
            "CASE WHEN $1::numeric+$2::numeric=$3::numeric THEN $8::numeric-$11::numeric ELSE ROUND($2::numeric*$8::numeric/$6::numeric,$7::int) END::text AS tax," +
            "CASE WHEN $1::numeric+$2::numeric=$3::numeric THEN $9::numeric-$12::numeric ELSE ROUND($2::numeric*$9::numeric/$6::numeric,$7::int) END::text AS total",
            item.returned_quantity, line.quantity, item.base_quantity, item.unit_cost_snapshot,
            item.subtotal, item.base_quantity, order.rounding_minor_units, item.tax_amount, item.total_amount,
            item.returned_subtotal, item.returned_tax, item.returned_total,
          );
          if (!amounts[0]?.valid) throw new ConflictException("Return quantity exceeds the remaining sold quantity for an Order item");
          prepared.push({ line, item, cost: item.unit_cost_snapshot, totalCost: amounts[0].total_cost, net: amounts[0].net, tax: amounts[0].tax, total: amounts[0].total });
          const sum = await tx.$queryRawUnsafe<Array<{ subtotal: string; tax: string; total: string }>>(
            "SELECT ($1::numeric+$4::numeric)::text AS subtotal,($2::numeric+$5::numeric)::text AS tax,($3::numeric+$6::numeric)::text AS total",
            subtotal, taxAmount, totalAmount, amounts[0].net, amounts[0].tax, amounts[0].total,
          );
          subtotal = sum[0].subtotal; taxAmount = sum[0].tax; totalAmount = sum[0].total;
        }

        const sequence = await tx.$queryRawUnsafe<Array<{ next_value: string }>>(
          "SELECT COALESCE(MAX(split_part(return_number,'-',3)::bigint),0)+1 AS next_value " +
          "FROM sales_returns WHERE order_id=$1::uuid", orderId,
        );
        const returnNumber = "RET-" + orderId.slice(0, 8).toUpperCase() + "-" + String(sequence[0].next_value).padStart(4, "0");
        await tx.$executeRawUnsafe(
          "INSERT INTO sales_returns (id,order_id,warehouse_id,return_number,status,currency,subtotal,tax_amount,total_amount,idempotency_key,idempotency_payload,reason,created_by) " +
          "VALUES ($1::uuid,$2::uuid,$3::uuid,$4,'POSTED',$5,$6::numeric,$7::numeric,$8::numeric,$9,$10::jsonb,$11,$12::uuid)",
          returnId, orderId, order.warehouse_id, returnNumber, order.currency, subtotal, taxAmount, totalAmount, key, JSON.stringify(payload), reason, userId,
        );

        for (const entry of prepared) {
          const { line, item, cost, totalCost, net, tax, total } = entry;
          const balanceChanged = await tx.$executeRawUnsafe(
            "UPDATE stock_balances SET on_hand=on_hand+$3::numeric,available=available+$3::numeric,updated_at=NOW() " +
            "WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid", order.warehouse_id, item.variant_id, line.quantity,
          );
          if (balanceChanged !== 1) throw new ConflictException("Stock balance changed while posting Return");
          const costChanged = await tx.$executeRawUnsafe(
            "UPDATE inventory_costs SET quantity=quantity+$3::numeric," +
            "inventory_value=inventory_value+$4::numeric," +
            "average_unit_cost=CASE WHEN quantity+$3::numeric=0 THEN 0 ELSE ROUND((inventory_value+$4::numeric)/(quantity+$3::numeric),6) END," +
            "updated_at=NOW() WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid",
            order.warehouse_id, item.variant_id, line.quantity, totalCost,
          );
          if (costChanged !== 1) throw new ConflictException("Inventory cost changed while posting Return");
          const returnItemId = randomUUID();
          await tx.$executeRawUnsafe(
            "INSERT INTO sales_return_items (id,return_id,order_item_id,original_movement_id,variant_id,quantity,unit_cost_snapshot,total_cost_snapshot,subtotal,tax_amount,total_amount) " +
            "VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::numeric,$7::numeric,$8::numeric,$9::numeric,$10::numeric,$11::numeric)",
            returnItemId, returnId, item.id, item.sale_movement_id, item.variant_id, line.quantity, cost, totalCost, net, tax, total,
          );
          await tx.$executeRawUnsafe(
            "INSERT INTO stock_movements (id,warehouse_id,variant_id,movement_type,quantity_delta,unit_cost,total_cost,reference_type,reference_id,idempotency_key,actor_user_id,reason,metadata) " +
            "VALUES ($1::uuid,$2::uuid,$3::uuid,'SALE_RETURN',$4::numeric,$5::numeric,$6::numeric,'RETURN',$7::uuid,$8,$9::uuid,$10,$11::jsonb)",
            randomUUID(), order.warehouse_id, item.variant_id, line.quantity, cost, totalCost, returnId,
            "sales-return:" + returnId + ":" + item.id, userId, reason,
            JSON.stringify({ orderId, orderItemId: item.id, originalSaleMovementId: item.sale_movement_id }),
          );
        }
        await tx.$executeRawUnsafe(
          "INSERT INTO audit_events (id,actor_id,action,resource_type,resource_id,metadata) VALUES ($1::uuid,$2::uuid,'SALES_RETURN_POSTED','SalesReturn',$3,$4::jsonb)",
          randomUUID(), userId, returnId, JSON.stringify({ orderId, returnNumber, itemCount: prepared.length, subtotal, taxAmount, totalAmount, reason }),
        );
      });
    } catch (error) {
      if (uniqueViolation(error)) {
        const raced = await db.$queryRawUnsafe<Array<{ id: string; order_id: string; idempotency_payload: unknown }>>(
          "SELECT id::text,order_id::text,idempotency_payload FROM sales_returns WHERE idempotency_key=$1", key,
        );
        if (raced.length && raced[0].order_id === orderId &&
            canonical(raced[0].idempotency_payload) === canonical(payload)) {
          return { ...(await this.returnDetail(db, raced[0].id)), idempotentReplay: true };
        }
        throw new ConflictException("Return idempotency key or return movement has already been used");
      }
      throw error;
    }
    return { ...(await this.returnDetail(db, returnId)), idempotentReplay: false };
  }

  async listReturns(userId: string, workspaceId: string, orderIdValue: unknown) {
    const orderId = uuid(orderIdValue, "orderId");
    const db = await this.db(userId, workspaceId);
    const orders = await db.$queryRawUnsafe<Array<{ id: string }>>("SELECT id::text FROM sales_orders WHERE id=$1::uuid", orderId);
    if (!orders.length) throw new NotFoundException("Sales Order not found");
    const rows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      "SELECT id::text,order_id::text,return_number,status::text,currency,subtotal::text,tax_amount::text,total_amount::text,reason,created_at " +
      "FROM sales_returns WHERE order_id=$1::uuid ORDER BY created_at DESC,id DESC", orderId,
    );
    return { items: rows };
  }

  private async returnDetail(db: PrismaClient, returnId: string) {
    const rows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      "SELECT id::text,order_id::text,warehouse_id::text,return_number,status::text,currency,subtotal::text,tax_amount::text,total_amount::text,reason,created_by::text,created_at " +
      "FROM sales_returns WHERE id=$1::uuid", returnId,
    );
    if (!rows.length) throw new NotFoundException("Sales Return not found");
    const items = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      "SELECT ri.id::text,ri.order_item_id::text,ri.original_movement_id::text,ri.variant_id::text,ri.quantity::text," +
      "ri.unit_cost_snapshot::text,ri.total_cost_snapshot::text,ri.subtotal::text,ri.tax_amount::text,ri.total_amount::text," +
      "oi.sku,oi.product_name,oi.variant_title,oi.uom_code " +
      "FROM sales_return_items ri JOIN sales_order_items oi ON oi.id=ri.order_item_id WHERE ri.return_id=$1::uuid ORDER BY oi.line_number",
      returnId,
    );
    return { ...rows[0], items };
  }
}
