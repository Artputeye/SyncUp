import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { WorkspaceDatabaseRegistry } from "../../database/workspace-database.registry";

type Tx = Prisma.TransactionClient;

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadRequestException(field + " must be a valid UUID");
  }
  return value;
}
function positiveQuantity(value: unknown): string {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,16})(?:\.\d{1,3})?$/.test(value) || !/[1-9]/.test(value)) {
    throw new BadRequestException("Quantity must be a positive Decimal string with at most 3 decimal places");
  }
  const [whole, fraction = ""] = value.split(".");
  return whole + "." + fraction.padEnd(3, "0");
}
function unitCost(value: unknown): string {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$/.test(value)) {
    throw new BadRequestException("Unit cost must be a non-negative Decimal string with at most 6 decimal places");
  }
  const [whole, fraction = ""] = value.split(".");
  return whole + "." + fraction.padEnd(6, "0");
}
function key(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 140) {
    throw new BadRequestException("Idempotency key is required and must not exceed 140 characters");
  }
  return value.trim();
}
function uniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; meta?: { code?: string; message?: string } };
  return e?.code === "P2002" || e?.meta?.code === "23505" ||
    (typeof e?.meta?.message === "string" && e.meta.message.includes("23505"));
}

type OpeningItemInput = { variantId: string; quantity: string; unitCost: string };

@Injectable()
export class OpeningStockService {
  constructor(private readonly databases: WorkspaceDatabaseRegistry) {}

  private db(userId: string, workspaceId: string) {
    return this.databases.forMembership(userId, workspaceId);
  }

  private async audit(tx: Tx, actorId: string, action: string, resourceType: string, resourceId: string, metadata: unknown) {
    await tx.$executeRawUnsafe(
      "INSERT INTO audit_events (id,actor_id,action,resource_type,resource_id,metadata) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6::jsonb)",
      randomUUID(), actorId, action, resourceType, resourceId, JSON.stringify(metadata ?? {}),
    );
  }

  async list(userId: string, workspaceId: string, filters: { warehouseId?: string; status?: string; page?: string; pageSize?: string }) {
    const db = await this.db(userId, workspaceId);
    const page = filters.page === undefined ? 1 : Number(filters.page);
    const pageSize = filters.pageSize === undefined ? 20 : Number(filters.pageSize);
    if (!Number.isInteger(page) || page < 1 || page > 100000) throw new BadRequestException("page must be a positive integer");
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new BadRequestException("pageSize must be between 1 and 100");
    if (filters.status && !["DRAFT", "POSTED", "CANCELLED"].includes(filters.status)) throw new BadRequestException("Unsupported opening stock status");
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (filters.warehouseId) { params.push(uuid(filters.warehouseId, "warehouseId")); conditions.push("s.warehouse_id=$" + params.length + "::uuid"); }
    if (filters.status) { params.push(filters.status); conditions.push("s.status::text=$" + params.length); }
    const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
    const joins = " FROM opening_stock_sessions s JOIN warehouses w ON w.id=s.warehouse_id";
    const count = await db.$queryRawUnsafe<Array<{ total: bigint }>>("SELECT COUNT(*)::bigint AS total" + joins + where, ...params);
    const rows = await db.$queryRawUnsafe<Array<{ id: string; warehouse_id: string; warehouse_name: string; warehouse_code: string; status: string; reference: string | null; notes: string | null; created_at: Date; posted_at: Date | null; item_count: bigint; total_quantity: string; total_cost: string }>>(
      "SELECT s.id::text,s.warehouse_id::text,w.name AS warehouse_name,w.code AS warehouse_code,s.status::text,s.reference,s.notes,s.created_at,s.posted_at,COUNT(i.id)::bigint AS item_count,COALESCE(SUM(i.quantity),0)::text AS total_quantity,COALESCE(SUM(i.total_cost),0)::text AS total_cost" +
      joins + " LEFT JOIN opening_stock_items i ON i.session_id=s.id" + where +
      " GROUP BY s.id,w.id ORDER BY s.created_at DESC,s.id DESC LIMIT $" + (params.length + 1) + " OFFSET $" + (params.length + 2),
      ...params, pageSize, (page - 1) * pageSize,
    );
    const total = Number(count[0]?.total ?? 0n);
    return {
      items: rows.map(row => ({
        id: row.id, status: row.status, reference: row.reference, notes: row.notes,
        createdAt: row.created_at, postedAt: row.posted_at,
        warehouse: { id: row.warehouse_id, name: row.warehouse_name, code: row.warehouse_code },
        itemCount: Number(row.item_count), totalQuantity: row.total_quantity, totalCost: row.total_cost,
      })),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async get(userId: string, workspaceId: string, openingStockId: string) {
    openingStockId = uuid(openingStockId, "openingStockId");
    const db = await this.db(userId, workspaceId);
    const sessions = await db.$queryRawUnsafe<Array<{ id: string; warehouse_id: string; warehouse_name: string; warehouse_code: string; status: string; reference: string | null; notes: string | null; created_by: string; posted_by: string | null; created_at: Date; posted_at: Date | null }>>(
      "SELECT s.id::text,s.warehouse_id::text,w.name AS warehouse_name,w.code AS warehouse_code,s.status::text,s.reference,s.notes,s.created_by::text,s.posted_by::text,s.created_at,s.posted_at FROM opening_stock_sessions s JOIN warehouses w ON w.id=s.warehouse_id WHERE s.id=$1::uuid",
      openingStockId,
    );
    if (!sessions.length) throw new NotFoundException("Opening stock session not found");
    const lines = await db.$queryRawUnsafe<Array<{ id: string; variant_id: string; quantity: string; unit_cost: string; total_cost: string; sku: string; variant_title: string; product_name: string; uom_code: string | null }>>(
      "SELECT i.id::text,i.variant_id::text,i.quantity::text,i.unit_cost::text,i.total_cost::text,pv.sku,pv.title AS variant_title,p.name AS product_name,u.code AS uom_code FROM opening_stock_items i JOIN product_variants pv ON pv.id=i.variant_id JOIN products p ON p.id=pv.product_id LEFT JOIN unit_of_measures u ON u.id=pv.base_uom_id WHERE i.session_id=$1::uuid ORDER BY p.name,pv.sku,i.id",
      openingStockId,
    );
    const row = sessions[0];
    return {
      id: row.id, status: row.status, reference: row.reference, notes: row.notes,
      createdBy: row.created_by, postedBy: row.posted_by, createdAt: row.created_at, postedAt: row.posted_at,
      warehouse: { id: row.warehouse_id, name: row.warehouse_name, code: row.warehouse_code },
      items: lines.map(line => ({
        id: line.id, variantId: line.variant_id, sku: line.sku, variantTitle: line.variant_title,
        productName: line.product_name, uomCode: line.uom_code, quantity: line.quantity,
        unitCost: line.unit_cost, totalCost: line.total_cost,
      })),
    };
  }

  async create(userId: string, workspaceId: string, input: { warehouseId: unknown; reference?: unknown; notes?: unknown; idempotencyKey: unknown; items: unknown }) {
    const warehouseId = uuid(input.warehouseId, "warehouseId");
    const idempotencyKey = key(input.idempotencyKey);
    const reference = typeof input.reference === "string" ? input.reference.trim().slice(0, 100) || null : null;
    const notes = typeof input.notes === "string" ? input.notes.trim().slice(0, 1000) || null : null;
    if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 500) {
      throw new BadRequestException("Opening stock requires between 1 and 500 items");
    }
    const items: OpeningItemInput[] = input.items.map((value, index) => {
      if (!value || typeof value !== "object") throw new BadRequestException("Each opening stock item must be an object");
      const item = value as { variantId?: unknown; quantity?: unknown; unitCost?: unknown };
      return {
        variantId: uuid(item.variantId, "items[" + index + "].variantId"),
        quantity: positiveQuantity(item.quantity),
        unitCost: unitCost(item.unitCost),
      };
    }).sort((a, b) => a.variantId.localeCompare(b.variantId));
    if (new Set(items.map(item => item.variantId)).size !== items.length) {
      throw new BadRequestException("Duplicate product variants are not allowed in an opening stock session");
    }
    const db = await this.db(userId, workspaceId);
    const findReplay = async () => {
      const rows = await db.$queryRawUnsafe<Array<{ id: string; warehouse_id: string; status: string; reference: string | null; notes: string | null }>>(
        "SELECT id::text,warehouse_id::text,status::text,reference,notes FROM opening_stock_sessions WHERE idempotency_key=$1",
        idempotencyKey,
      );
      if (!rows.length) return null;
      const snapshots = await db.$queryRawUnsafe<Array<{ payload: { warehouseId: string; reference: string | null; notes: string | null; items: OpeningItemInput[] } | null }>>(
        "SELECT metadata->($2) AS payload FROM audit_events WHERE action=$3 AND resource_type=$4 AND resource_id=$1 ORDER BY created_at LIMIT 1",
        rows[0].id, "idempotencyPayload", "OPENING_STOCK_CREATED", "OpeningStockSession",
      );
      const snapshot = snapshots[0]?.payload ?? null;
      let sameItems = false;
      if (snapshot) {
        sameItems = snapshot.items.length === items.length && snapshot.items.every((line, index) =>
          line.variantId === items[index].variantId && line.quantity === items[index].quantity && line.unitCost === items[index].unitCost);
      } else {
        const saved = await db.$queryRawUnsafe<Array<{ variant_id: string; quantity: string; unit_cost: string }>>(
          "SELECT variant_id::text,quantity::text,unit_cost::text FROM opening_stock_items WHERE session_id=$1::uuid ORDER BY variant_id",
          rows[0].id,
        );
        sameItems = saved.length === items.length && saved.every((line, index) =>
          line.variant_id === items[index].variantId && line.quantity === items[index].quantity && line.unit_cost === items[index].unitCost);
      }
      const originalReference = snapshot ? snapshot.reference : rows[0].reference;
      const originalNotes = snapshot ? snapshot.notes : rows[0].notes;
      const originalWarehouseId = snapshot ? snapshot.warehouseId : rows[0].warehouse_id;
      if (originalWarehouseId !== warehouseId || originalReference !== reference || originalNotes !== notes || !sameItems) {
        throw new ConflictException("Opening stock idempotency key was already used with a different payload");
      }
      return { openingStockId: rows[0].id, status: rows[0].status, idempotentReplay: true };
    };
    const replay = await findReplay();
    if (replay) return replay;
    const variantIds = items.map(item => item.variantId);
    try {
      const openingStockId = randomUUID();
      await db.$transaction(async tx => {
        const warehouses = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          "SELECT id::text FROM warehouses WHERE id=$1::uuid AND status='ACTIVE' FOR UPDATE", warehouseId,
        );
        if (!warehouses.length) throw new NotFoundException("Active warehouse not found");
        const posted = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          "SELECT id::text FROM opening_stock_sessions WHERE posted_warehouse_id=$1::uuid LIMIT 1", warehouseId,
        );
        if (posted.length) throw new ConflictException("Opening stock has already been posted for this warehouse");
        const variants = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          "SELECT id::text FROM product_variants WHERE id=ANY($1::uuid[]) AND status='ACTIVE' ORDER BY id", variantIds,
        );
        if (variants.length !== items.length) throw new BadRequestException("One or more product variants are missing or inactive");
        await tx.$executeRawUnsafe(
          "INSERT INTO opening_stock_sessions (id,warehouse_id,status,reference,notes,idempotency_key,created_by,updated_at) VALUES ($1::uuid,$2::uuid,'DRAFT',$3,$4,$5,$6::uuid,NOW())",
          openingStockId, warehouseId, reference, notes, idempotencyKey, userId,
        );
        for (const item of items) {
          const totals = await tx.$queryRawUnsafe<Array<{ total_cost: string }>>(
            "SELECT ROUND($1::numeric*$2::numeric,6)::text AS total_cost", item.quantity, item.unitCost,
          );
          await tx.$executeRawUnsafe(
            "INSERT INTO opening_stock_items (id,session_id,variant_id,quantity,unit_cost,total_cost) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::numeric,$5::numeric,$6::numeric)",
            randomUUID(), openingStockId, item.variantId, item.quantity, item.unitCost, totals[0].total_cost,
          );
        }
        await this.audit(tx, userId, "OPENING_STOCK_CREATED", "OpeningStockSession", openingStockId, {
          warehouseId, reference, itemCount: items.length,
          idempotencyPayload: { warehouseId, reference, notes, items },
        });
      });
      return { openingStockId, status: "DRAFT", idempotentReplay: false };
    } catch (error) {
      if (uniqueViolation(error)) {
        const found = await findReplay();
        if (found) return found;
        throw new ConflictException("Opening stock idempotency key has already been used or this warehouse already has an opening stock");
      }
      throw error;
    }
  }

  async updateDraft(userId: string, workspaceId: string, openingStockId: string, input: { reference?: unknown; notes?: unknown; items: unknown }) {
    openingStockId = uuid(openingStockId, "openingStockId");
    const reference = typeof input.reference === "string" ? input.reference.trim().slice(0, 100) || null : null;
    const notes = typeof input.notes === "string" ? input.notes.trim().slice(0, 1000) || null : null;
    if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 500) throw new BadRequestException("Opening stock requires between 1 and 500 items");
    const items: OpeningItemInput[] = input.items.map((value, index) => {
      if (!value || typeof value !== "object") throw new BadRequestException("Each opening stock item must be an object");
      const item = value as { variantId?: unknown; quantity?: unknown; unitCost?: unknown };
      return { variantId: uuid(item.variantId, "items[" + index + "].variantId"), quantity: positiveQuantity(item.quantity), unitCost: unitCost(item.unitCost) };
    }).sort((a, b) => a.variantId.localeCompare(b.variantId));
    if (new Set(items.map(item => item.variantId)).size !== items.length) throw new BadRequestException("Duplicate product variants are not allowed in an opening stock session");
    const db = await this.db(userId, workspaceId);
    return db.$transaction(async tx => {
      const sessions = await tx.$queryRawUnsafe<Array<{ id: string; status: string; warehouse_id: string; reference: string | null; notes: string | null }>>(
        "SELECT id::text,status::text,warehouse_id::text,reference,notes FROM opening_stock_sessions WHERE id=$1::uuid FOR UPDATE",
        openingStockId,
      );
      if (!sessions.length) throw new NotFoundException("Opening stock session not found");
      if (sessions[0].status !== "DRAFT") throw new ConflictException("Only a DRAFT opening stock session can be edited");
      const variants = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        "SELECT id::text FROM product_variants WHERE id=ANY($1::uuid[]) AND status='ACTIVE' ORDER BY id", items.map(item => item.variantId),
      );
      if (variants.length !== items.length) throw new BadRequestException("One or more product variants are missing or inactive");
      const creationEvents = await tx.$queryRawUnsafe<Array<{ id: string; metadata: Record<string, unknown> }>>(
        "SELECT id::text,metadata FROM audit_events WHERE action=$2 AND resource_type=$3 AND resource_id=$1 ORDER BY created_at LIMIT 1 FOR UPDATE",
        openingStockId, "OPENING_STOCK_CREATED", "OpeningStockSession",
      );
      if (creationEvents.length && !creationEvents[0].metadata?.idempotencyPayload) {
        const originalItems = await tx.$queryRawUnsafe<Array<{ variantId: string; quantity: string; unitCost: string }>>(
          "SELECT variant_id::text AS \"variantId\",quantity::text,unit_cost::text AS \"unitCost\" FROM opening_stock_items WHERE session_id=$1::uuid ORDER BY variant_id",
          openingStockId,
        );
        await tx.$executeRawUnsafe(
          "UPDATE audit_events SET metadata=metadata || jsonb_build_object($3,$2::jsonb) WHERE id=$1::uuid",
          creationEvents[0].id,
          JSON.stringify({ warehouseId: sessions[0].warehouse_id, reference: sessions[0].reference, notes: sessions[0].notes, items: originalItems }),
          "idempotencyPayload",
        );
      }
      await tx.$executeRawUnsafe("DELETE FROM opening_stock_items WHERE session_id=$1::uuid", openingStockId);
      for (const item of items) {
        const totals = await tx.$queryRawUnsafe<Array<{ total_cost: string }>>("SELECT ROUND($1::numeric*$2::numeric,6)::text AS total_cost", item.quantity, item.unitCost);
        await tx.$executeRawUnsafe(
          "INSERT INTO opening_stock_items (id,session_id,variant_id,quantity,unit_cost,total_cost) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::numeric,$5::numeric,$6::numeric)",
          randomUUID(), openingStockId, item.variantId, item.quantity, item.unitCost, totals[0].total_cost,
        );
      }
      await tx.$executeRawUnsafe("UPDATE opening_stock_sessions SET reference=$2,notes=$3,updated_at=NOW() WHERE id=$1::uuid", openingStockId, reference, notes);
      await this.audit(tx, userId, "OPENING_STOCK_DRAFT_UPDATED", "OpeningStockSession", openingStockId, { warehouseId: sessions[0].warehouse_id, reference, itemCount: items.length });
      return { openingStockId, status: "DRAFT", itemCount: items.length };
    });
  }

  async post(userId: string, workspaceId: string, openingStockId: string) {
    openingStockId = uuid(openingStockId, "openingStockId");
    const db = await this.db(userId, workspaceId);
    try {
      return await db.$transaction(async tx => {
        const sessions = await tx.$queryRawUnsafe<Array<{ id: string; warehouse_id: string; status: string; reference: string | null }>>(
          "SELECT id::text,warehouse_id::text,status::text,reference FROM opening_stock_sessions WHERE id=$1::uuid FOR UPDATE",
          openingStockId,
        );
        if (!sessions.length) throw new NotFoundException("Opening stock session not found");
        const session = sessions[0];
        if (session.status === "POSTED") return { openingStockId, status: "POSTED", idempotentReplay: true, movementCount: 0 };
        if (session.status !== "DRAFT") throw new ConflictException("Only a draft opening stock session can be posted");
        const warehouses = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          "SELECT id::text FROM warehouses WHERE id=$1::uuid AND status='ACTIVE' FOR UPDATE", session.warehouse_id,
        );
        if (!warehouses.length) throw new ConflictException("Warehouse is no longer active");
        const alreadyPosted = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          "SELECT id::text FROM opening_stock_sessions WHERE posted_warehouse_id=$1::uuid AND id<>$2::uuid LIMIT 1",
          session.warehouse_id, openingStockId,
        );
        if (alreadyPosted.length) throw new ConflictException("Opening stock has already been posted for this warehouse");
        const lines = await tx.$queryRawUnsafe<Array<{ variant_id: string; quantity: string; unit_cost: string; total_cost: string }>>(
          "SELECT variant_id::text,quantity::text,unit_cost::text,total_cost::text FROM opening_stock_items WHERE session_id=$1::uuid ORDER BY variant_id FOR UPDATE",
          openingStockId,
        );
        if (!lines.length) throw new ConflictException("Opening stock has no items");
        const movements: Array<{ movementId: string; variantId: string; quantity: string; totalCost: string }> = [];
        for (const line of lines) {
          await tx.$executeRawUnsafe(
            "INSERT INTO stock_balances (warehouse_id,variant_id,on_hand,reserved,available,updated_at) VALUES ($1::uuid,$2::uuid,0,0,0,NOW()) ON CONFLICT (warehouse_id,variant_id) DO NOTHING",
            session.warehouse_id, line.variant_id,
          );
          const balances = await tx.$queryRawUnsafe<Array<{ on_hand: string; reserved: string; available: string }>>(
            "SELECT on_hand::text,reserved::text,available::text FROM stock_balances WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid FOR UPDATE",
            session.warehouse_id, line.variant_id,
          );
          if (!balances.length || Number(balances[0].on_hand) !== 0 || Number(balances[0].reserved) !== 0 || Number(balances[0].available) !== 0) {
            throw new ConflictException("Opening stock can only be posted before stock movements or reservations for each item");
          }
          const history = await tx.$queryRawUnsafe<Array<{ exists: boolean }>>(
            "SELECT EXISTS(SELECT 1 FROM stock_movements WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid) AS exists",
            session.warehouse_id, line.variant_id,
          );
          if (history[0]?.exists) throw new ConflictException("Opening stock cannot be posted for an item that already has movement history");
          await tx.$executeRawUnsafe(
            "INSERT INTO inventory_costs (warehouse_id,variant_id,quantity,average_unit_cost,inventory_value,updated_at) VALUES ($1::uuid,$2::uuid,0,0,0,NOW()) ON CONFLICT (warehouse_id,variant_id) DO NOTHING",
            session.warehouse_id, line.variant_id,
          );
          const costs = await tx.$queryRawUnsafe<Array<{ quantity: string; average_unit_cost: string; inventory_value: string }>>(
            "SELECT quantity::text,average_unit_cost::text,inventory_value::text FROM inventory_costs WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid FOR UPDATE",
            session.warehouse_id, line.variant_id,
          );
          if (!costs.length || Number(costs[0].quantity) !== 0 || Number(costs[0].average_unit_cost) !== 0 || Number(costs[0].inventory_value) !== 0) {
            throw new ConflictException("Opening stock can only initialize an empty inventory cost balance");
          }
          await tx.$executeRawUnsafe(
            "UPDATE inventory_costs SET quantity=$3::numeric,average_unit_cost=$4::numeric,inventory_value=$5::numeric,updated_at=NOW() WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid",
            session.warehouse_id, line.variant_id, line.quantity, line.unit_cost, line.total_cost,
          );
          await tx.$executeRawUnsafe(
            "UPDATE stock_balances SET on_hand=$3::numeric,available=$3::numeric,updated_at=NOW() WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid",
            session.warehouse_id, line.variant_id, line.quantity,
          );
          const movementId = randomUUID();
          await tx.$executeRawUnsafe(
            "INSERT INTO stock_movements (id,warehouse_id,variant_id,movement_type,quantity_delta,unit_cost,total_cost,reference_type,reference_id,idempotency_key,reason,actor_user_id) VALUES ($1::uuid,$2::uuid,$3::uuid,'OPENING',$4::numeric,$5::numeric,$6::numeric,'OPENING_STOCK',$7::uuid,$8,$9,$10::uuid)",
            movementId, session.warehouse_id, line.variant_id, line.quantity, line.unit_cost, line.total_cost,
            openingStockId, "opening:" + openingStockId + ":" + line.variant_id,
            session.reference ? "Opening stock " + session.reference : "Opening stock", userId,
          );
          await this.audit(tx, userId, "OPENING_STOCK_ITEM_POSTED", "StockMovement", movementId, {
            openingStockId, warehouseId: session.warehouse_id, variantId: line.variant_id,
            quantity: line.quantity, unitCost: line.unit_cost, totalCost: line.total_cost,
          });
          movements.push({ movementId, variantId: line.variant_id, quantity: line.quantity, totalCost: line.total_cost });
        }
        await tx.$executeRawUnsafe(
          "UPDATE opening_stock_sessions SET status='POSTED',posted_warehouse_id=warehouse_id,posted_by=$2::uuid,posted_at=NOW(),updated_at=NOW() WHERE id=$1::uuid",
          openingStockId, userId,
        );
        await this.audit(tx, userId, "OPENING_STOCK_POSTED", "OpeningStockSession", openingStockId, {
          warehouseId: session.warehouse_id, movementCount: movements.length,
        });
        return { openingStockId, status: "POSTED", idempotentReplay: false, movementCount: movements.length, movements };
      });
    } catch (error) {
      if (uniqueViolation(error)) throw new ConflictException("Opening stock has already been posted for this warehouse");
      throw error;
    }
  }

  async cancel(userId: string, workspaceId: string, openingStockId: string, reason?: unknown) {
    openingStockId = uuid(openingStockId, "openingStockId");
    const note = typeof reason === "string" ? reason.trim().slice(0, 500) : "";
    const db = await this.db(userId, workspaceId);
    return db.$transaction(async tx => {
      const rows = await tx.$queryRawUnsafe<Array<{ status: string }>>(
        "SELECT status::text FROM opening_stock_sessions WHERE id=$1::uuid FOR UPDATE", openingStockId,
      );
      if (!rows.length) throw new NotFoundException("Opening stock session not found");
      if (rows[0].status === "CANCELLED") return { openingStockId, status: "CANCELLED", idempotentReplay: true };
      if (rows[0].status !== "DRAFT") throw new ConflictException("A posted opening stock session cannot be cancelled");
      await tx.$executeRawUnsafe(
        "UPDATE opening_stock_sessions SET status='CANCELLED',notes=CASE WHEN $2='' THEN notes ELSE CONCAT(COALESCE(notes || E'\\n',''),$2) END,updated_at=NOW() WHERE id=$1::uuid",
        openingStockId, note,
      );
      await this.audit(tx, userId, "OPENING_STOCK_CANCELLED", "OpeningStockSession", openingStockId, { reason: note || null });
      return { openingStockId, status: "CANCELLED", idempotentReplay: false };
    });
  }
}
