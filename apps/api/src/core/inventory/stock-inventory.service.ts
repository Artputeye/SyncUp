import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { WorkspaceDatabaseRegistry } from "../../database/workspace-database.registry";

type Tx = Prisma.TransactionClient;
type ReservationRow = {
  id: string;
  warehouse_id: string;
  variant_id: string;
  quantity: string;
  status: string;
  expires_at: Date | null;
  reference_type?: string;
  reference_id?: string | null;
  is_expired?: boolean;
};
type BalanceRow = { on_hand: string; reserved: string; available: string };
type CostRow = { quantity: string; average_unit_cost: string; inventory_value: string };
type MovementRow = {
  id: string;
  warehouse_id: string;
  variant_id: string;
  movement_type: string;
  quantity_delta: string;
  unit_cost: string | null;
  total_cost: string | null;
  reference_type: string;
  reference_id: string | null;
  reversal_of_id: string | null;
  idempotency_key: string | null;
  reason?: string | null;
  counted_quantity?: string | null;
};

const REFERENCE_TYPES = new Set([
  "OPENING_STOCK", "DIRECT_RECEIVING", "ORDER", "RETURN",
  "ADJUSTMENT", "TRANSFER", "MANUAL", "STOCKTAKE",
]);

function quantity(value: unknown): string {
  if (typeof value !== "string" ||
      !/^(?:0|[1-9]\d{0,16})(?:\.\d{1,3})?$/.test(value) ||
      !/[1-9]/.test(value)) {
    throw new BadRequestException("Quantity must be a positive Decimal string with at most 3 decimal places");
  }
  const [whole, fraction = ""] = value.split(".");
  return whole + "." + fraction.padEnd(3, "0");
}

function countedQuantity(value: unknown): string {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,16})(?:\.\d{1,3})?$/.test(value)) {
    throw new BadRequestException("Counted quantity must be a non-negative Decimal string with at most 3 decimal places");
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

function idempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 140) {
    throw new BadRequestException("Idempotency key is required and must not exceed 140 characters");
  }
  return value.trim();
}

function referenceType(value: unknown): string {
  const result = typeof value === "string" ? value : "ORDER";
  if (!REFERENCE_TYPES.has(result)) throw new BadRequestException("Unsupported stock reference type");
  return result;
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadRequestException(field + " must be a valid UUID");
  }
  return value;
}

function optionalReason(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 500) {
    throw new BadRequestException("Reason must not exceed 500 characters");
  }
  return value.trim() || null;
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; meta?: { code?: string; message?: string } };
  return e?.code === "P2002" || e?.meta?.code === "23505" ||
    (typeof e?.meta?.message === "string" && e.meta.message.includes("23505"));
}

@Injectable()
export class StockInventoryService {
  constructor(private readonly databases: WorkspaceDatabaseRegistry) {}

  private db(userId: string, workspaceId: string): Promise<PrismaClient> {
    return this.databases.forMembership(userId, workspaceId);
  }

  private async audit(
    tx: Tx, actorId: string, action: string, resourceType: string, resourceId: string, metadata: unknown,
  ) {
    await tx.$executeRawUnsafe(
      "INSERT INTO audit_events (id,actor_id,action,resource_type,resource_id,metadata) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6::jsonb)",
      randomUUID(), actorId, action, resourceType, resourceId, JSON.stringify(metadata ?? {}),
    );
  }

  private async lockBalance(tx: Tx, warehouseId: string, variantId: string): Promise<BalanceRow> {
    const rows = await tx.$queryRawUnsafe<BalanceRow[]>(
      `SELECT b.on_hand::text, b.reserved::text, b.available::text
       FROM stock_balances b
       JOIN warehouses w ON w.id=b.warehouse_id
       JOIN product_variants v ON v.id=b.variant_id
       WHERE b.warehouse_id=$1::uuid AND b.variant_id=$2::uuid
         AND w.status='ACTIVE' AND v.status='ACTIVE'
       FOR UPDATE OF b`,
      warehouseId, variantId,
    );
    if (!rows.length) throw new NotFoundException("Active stock balance, warehouse or product variant not found");
    return rows[0];
  }

  private async lockCost(tx: Tx, warehouseId: string, variantId: string, onHand: string): Promise<CostRow> {
    const rows = await tx.$queryRawUnsafe<CostRow[]>(
      "SELECT quantity::text, average_unit_cost::text, inventory_value::text FROM inventory_costs WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid FOR UPDATE",
      warehouseId, variantId,
    );
    if (!rows.length) throw new ConflictException("Inventory cost record is missing; reconcile stock before posting");
    const cost = rows[0];
    const checks = await tx.$queryRawUnsafe<Array<{ valid: boolean }>>(
      "SELECT ($1::numeric=$4::numeric AND abs($3::numeric-ROUND($1::numeric*$2::numeric,6))<=GREATEST(0.000001,ABS($1::numeric)*0.0000005)) AS valid",
      cost.quantity, cost.average_unit_cost, cost.inventory_value, onHand,
    );
    if (cost.quantity !== onHand || !checks[0]?.valid) {
      throw new ConflictException("InventoryCost does not reconcile with StockBalance; posting was stopped");
    }
    return cost;
  }

  private async applyIssueCost(tx: Tx, warehouseId: string, variantId: string, onHand: string, qty: string) {
    const cost = await this.lockCost(tx, warehouseId, variantId, onHand);
    const amounts = await tx.$queryRawUnsafe<Array<{ total_cost: string }>>(
      "SELECT ROUND($1::numeric*$2::numeric,6)::text AS total_cost",
      qty, cost.average_unit_cost,
    );
    const totalCost = amounts[0].total_cost;
    const updated = await tx.$queryRawUnsafe<CostRow[]>(
      `UPDATE inventory_costs
       SET quantity=quantity-$3::numeric,
           inventory_value=CASE WHEN quantity-$3::numeric=0 THEN 0 ELSE ROUND((quantity-$3::numeric)*average_unit_cost,6) END,
           average_unit_cost=CASE WHEN quantity-$3::numeric=0 THEN 0 ELSE average_unit_cost END,
           updated_at=NOW()
       WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid AND quantity >= $3::numeric AND inventory_value >= $4::numeric
       RETURNING quantity::text, average_unit_cost::text, inventory_value::text`,
      warehouseId, variantId, qty, totalCost,
    );
    if (!updated.length) throw new ConflictException("Insufficient inventory cost quantity/value");
    return { unitCost: cost.average_unit_cost, totalCost };
  }

  async getBalance(userId: string, workspaceId: string, warehouseId: string, variantId: string) {
    warehouseId = uuid(warehouseId, "warehouseId");
    variantId = uuid(variantId, "variantId");
    const db = await this.db(userId, workspaceId);
    const rows = await db.$queryRawUnsafe<Array<BalanceRow & { warehouse_id: string; variant_id: string }>>(
      `SELECT b.warehouse_id::text, b.variant_id::text,
              b.on_hand::text, b.reserved::text, b.available::text
       FROM stock_balances b
       JOIN warehouses w ON w.id=b.warehouse_id AND w.status='ACTIVE'
       WHERE b.warehouse_id=$1::uuid AND b.variant_id=$2::uuid`,
      warehouseId, variantId,
    );
    if (!rows.length) throw new NotFoundException("Stock balance not found");
    return rows[0];
  }

  private async existingReservation(db: PrismaClient, key: string) {
    const rows = await db.$queryRawUnsafe<ReservationRow[]>(
      "SELECT id::text,warehouse_id::text,variant_id::text,quantity::text,status,expires_at FROM stock_reservations WHERE idempotency_key=$1",
      key,
    );
    return rows[0] ?? null;
  }

  private reservationReplay(row: ReservationRow, input: { warehouseId: string; variantId: string; quantity: string }) {
    if (row.warehouse_id !== input.warehouseId || row.variant_id !== input.variantId || row.quantity !== input.quantity) {
      throw new ConflictException("Idempotency key was already used with a different reservation payload");
    }
    return {
      id: row.id, status: row.status, warehouseId: row.warehouse_id, variantId: row.variant_id,
      quantity: row.quantity, expiresAt: row.expires_at, idempotentReplay: true,
    };
  }

  async reserve(
    userId: string,
    workspaceId: string,
    input: { warehouseId: string; variantId: string; quantity: unknown; idempotencyKey: unknown; referenceId?: string; referenceType?: string; expiresAt?: string },
  ) {
    const warehouseId = uuid(input.warehouseId, "warehouseId");
    const variantId = uuid(input.variantId, "variantId");
    const referenceId = input.referenceId ? uuid(input.referenceId, "referenceId") : null;
    const qty = quantity(input.quantity);
    const key = idempotencyKey(input.idempotencyKey);
    const refType = referenceType(input.referenceType);
    if (input.expiresAt && !/(Z|[+-]\d{2}:\d{2})$/i.test(input.expiresAt)) throw new BadRequestException("expiresAt must include a timezone offset");
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new BadRequestException("Invalid expiresAt");
    const db = await this.db(userId, workspaceId);
    const existing = await this.existingReservation(db, key);
    if (existing) return this.reservationReplay(existing, { warehouseId, variantId, quantity: qty });
    try {
      const created = await db.$transaction(async tx => {
        const balance = await this.lockBalance(tx, warehouseId, variantId);
        const changed = await tx.$executeRawUnsafe(
          `UPDATE stock_balances
           SET reserved=reserved+$3::numeric, available=available-$3::numeric, updated_at=NOW()
           WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid AND available >= $3::numeric`,
          input.warehouseId, input.variantId, qty,
        );
        if (changed !== 1) throw new ConflictException("Insufficient available stock");
        const reservationId = randomUUID();
        await tx.$executeRawUnsafe(
          `INSERT INTO stock_reservations
           (id,warehouse_id,variant_id,quantity,status,reference_type,reference_id,idempotency_key,expires_at,actor_user_id,updated_at)
           VALUES ($1::uuid,$2::uuid,$3::uuid,$4::numeric,'ACTIVE',$5,$6::uuid,$7,$8,$9::uuid,NOW())`,
          reservationId, warehouseId, variantId, qty, refType,
          referenceId, key, expiresAt, userId,
        );
        await this.audit(tx, userId, "STOCK_RESERVED", "StockReservation", reservationId, {
          warehouseId, variantId, quantity: qty, referenceType: refType,
          referenceId, expiresAt,
        });
        return { id: reservationId, status: "ACTIVE", warehouseId: input.warehouseId, variantId: input.variantId, quantity: qty, expiresAt, idempotentReplay: false };
      });
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) {
        const replay = await this.existingReservation(db, key);
        if (replay) return this.reservationReplay(replay, { warehouseId: input.warehouseId, variantId: input.variantId, quantity: qty });
        throw new ConflictException("Reservation idempotency key has already been used");
      }
      throw error;
    }
  }

  private async releaseInTransaction(tx: Tx, reservation: ReservationRow, actorId: string) {
    if (reservation.status !== "ACTIVE") return { changed: false, status: reservation.status };
    const changed = await tx.$executeRawUnsafe(
      `UPDATE stock_balances SET reserved=reserved-$3::numeric, available=available+$3::numeric,
       updated_at=NOW() WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid AND reserved >= $3::numeric`,
      reservation.warehouse_id, reservation.variant_id, reservation.quantity,
    );
    if (changed !== 1) throw new ConflictException("Reserved balance is inconsistent; release was not applied");
    await tx.$executeRawUnsafe(
      "UPDATE stock_reservations SET status='RELEASED', released_at=NOW(), updated_at=NOW() WHERE id=$1::uuid AND status='ACTIVE'",
      reservation.id,
    );
    await this.audit(tx, actorId, "STOCK_RESERVATION_RELEASED", "StockReservation", reservation.id, {
      warehouseId: reservation.warehouse_id, variantId: reservation.variant_id, quantity: reservation.quantity,
    });
    return { changed: true, status: "RELEASED" };
  }

  async release(userId: string, workspaceId: string, reservationId: string) {
    reservationId = uuid(reservationId, "reservationId");
    const db = await this.db(userId, workspaceId);
    return db.$transaction(async tx => {
      const rows = await tx.$queryRawUnsafe<ReservationRow[]>(
        "SELECT id::text,warehouse_id::text,variant_id::text,quantity::text,status,expires_at,(expires_at IS NOT NULL AND expires_at <= clock_timestamp()) AS is_expired FROM stock_reservations WHERE id=$1::uuid FOR UPDATE",
        reservationId,
      );
      if (!rows.length) throw new NotFoundException("Reservation not found");
      const result = await this.releaseInTransaction(tx, rows[0], userId);
      return { id: reservationId, ...result };
    });
  }

  async consume(userId: string, workspaceId: string, reservationId: string) {
    reservationId = uuid(reservationId, "reservationId");
    const db = await this.db(userId, workspaceId);
    return db.$transaction(async tx => {
      const rows = await tx.$queryRawUnsafe<ReservationRow[]>(
        "SELECT id::text,warehouse_id::text,variant_id::text,quantity::text,status,expires_at,reference_type,reference_id::text,(expires_at IS NOT NULL AND expires_at <= clock_timestamp()) AS is_expired FROM stock_reservations WHERE id=$1::uuid FOR UPDATE",
        reservationId,
      );
      if (!rows.length) throw new NotFoundException("Reservation not found");
      const reservation = rows[0];
      if (reservation.status !== "ACTIVE") return { id: reservationId, changed: false, status: reservation.status };
      if (reservation.is_expired) {
        const expired = await this.releaseInTransaction(tx, reservation, userId);
        return { id: reservationId, changed: false, status: expired.status, reason: "EXPIRED" };
      }
      const balance = await this.lockBalance(tx, reservation.warehouse_id, reservation.variant_id);
      const cost = await this.applyIssueCost(tx, reservation.warehouse_id, reservation.variant_id, balance.on_hand, reservation.quantity);
      const changed = await tx.$executeRawUnsafe(
        `UPDATE stock_balances SET on_hand=on_hand-$3::numeric, reserved=reserved-$3::numeric,
         updated_at=NOW() WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid AND on_hand >= $3::numeric AND reserved >= $3::numeric`,
        reservation.warehouse_id, reservation.variant_id, reservation.quantity,
      );
      if (changed !== 1) throw new ConflictException("Stock balance is inconsistent; consumption was not applied");
      await tx.$executeRawUnsafe(
        "UPDATE stock_reservations SET status='CONSUMED', updated_at=NOW() WHERE id=$1::uuid",
        reservationId,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO stock_movements
         (id,warehouse_id,variant_id,movement_type,quantity_delta,unit_cost,total_cost,reference_type,reference_id,actor_user_id)
         VALUES ($1::uuid,$2::uuid,$3::uuid,'SALE',-$4::numeric,$5::numeric,$6::numeric,$7::"StockReferenceType",$8::uuid,$9::uuid)`,
        randomUUID(), reservation.warehouse_id, reservation.variant_id, reservation.quantity,
        cost.unitCost, cost.totalCost, reservation.reference_type ?? "ORDER", reservation.reference_id ?? reservationId, userId,
      );
      await this.audit(tx, userId, "STOCK_RESERVATION_CONSUMED", "StockReservation", reservationId, {
        warehouseId: reservation.warehouse_id, variantId: reservation.variant_id, quantity: reservation.quantity,
        movementType: "SALE",
      });
      return { id: reservationId, changed: true, status: "CONSUMED" };
    });
  }

  async issue(
    userId: string,
    workspaceId: string,
    input: { warehouseId: string; variantId: string; quantity: unknown; idempotencyKey: unknown; referenceId?: string; reason?: string },
  ) {
    const warehouseId = uuid(input.warehouseId, "warehouseId");
    const variantId = uuid(input.variantId, "variantId");
    const referenceId = input.referenceId ? uuid(input.referenceId, "referenceId") : null;
    const reason = optionalReason(input.reason);
    const qty = quantity(input.quantity);
    const key = idempotencyKey(input.idempotencyKey);
    const db = await this.db(userId, workspaceId);
    const existing = await db.$queryRawUnsafe<MovementRow[]>(
      "SELECT id::text,warehouse_id::text,variant_id::text,movement_type,quantity_delta::text,unit_cost::text,total_cost::text,reference_type,reference_id::text,reversal_of_id::text,idempotency_key FROM stock_movements WHERE idempotency_key=$1",
      key,
    );
    if (existing.length) {
      const row = existing[0];
      if (row.movement_type !== "SALE" || row.warehouse_id !== warehouseId || row.variant_id !== variantId || row.quantity_delta !== "-" + qty) {
        throw new ConflictException("Idempotency key was already used with a different inventory issue payload");
      }
      return { movementId: row.id, movementType: row.movement_type, quantityDelta: row.quantity_delta, idempotentReplay: true };
    }
    try {
      return await db.$transaction(async tx => {
        const balance = await this.lockBalance(tx, warehouseId, variantId);
        const cost = await this.applyIssueCost(tx, warehouseId, variantId, balance.on_hand, qty);
        const changed = await tx.$executeRawUnsafe(
          `UPDATE stock_balances SET on_hand=on_hand-$3::numeric, available=available-$3::numeric,
           updated_at=NOW() WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid AND available >= $3::numeric AND on_hand >= $3::numeric`,
          input.warehouseId, input.variantId, qty,
        );
        if (changed !== 1) throw new ConflictException("Insufficient available stock");
        const movementId = randomUUID();
        await tx.$executeRawUnsafe(
          `INSERT INTO stock_movements
           (id,warehouse_id,variant_id,movement_type,quantity_delta,unit_cost,total_cost,reference_type,reference_id,idempotency_key,reason,actor_user_id)
           VALUES ($1::uuid,$2::uuid,$3::uuid,'SALE',-$4::numeric,$5::numeric,$6::numeric,'ORDER',$7::uuid,$8,$9,$10::uuid)`,
          movementId, warehouseId, variantId, qty, cost.unitCost, cost.totalCost,
          referenceId, key, reason, userId,
        );
        await this.audit(tx, userId, "STOCK_ISSUED", "StockMovement", movementId, {
          warehouseId, variantId, quantity: qty, movementType: "SALE",
          totalCost: cost.totalCost, reason,
        });
        return { movementId, movementType: "SALE", quantityDelta: "-" + qty, idempotentReplay: false };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const replay = await db.$queryRawUnsafe<MovementRow[]>(
          "SELECT id::text,warehouse_id::text,variant_id::text,movement_type,quantity_delta::text,unit_cost::text,total_cost::text,reference_type,reference_id::text,reversal_of_id::text,idempotency_key FROM stock_movements WHERE idempotency_key=$1",
          key,
        );
        if (replay.length && replay[0].movement_type === "SALE" && replay[0].warehouse_id === input.warehouseId &&
            replay[0].variant_id === input.variantId && replay[0].quantity_delta === "-" + qty) {
          return { movementId: replay[0].id, movementType: replay[0].movement_type, quantityDelta: replay[0].quantity_delta, idempotentReplay: true };
        }
        throw new ConflictException("Inventory issue idempotency key has already been used");
      }
      throw error;
    }
  }

  async receive(
    userId: string,
    workspaceId: string,
    input: { warehouseId: string; variantId: string; quantity: unknown; unitCost: unknown; idempotencyKey: unknown; referenceId?: string; reason?: string },
  ) {
    const warehouseId = uuid(input.warehouseId, "warehouseId");
    const variantId = uuid(input.variantId, "variantId");
    const referenceId = input.referenceId ? uuid(input.referenceId, "referenceId") : null;
    const reason = optionalReason(input.reason);
    const qty = quantity(input.quantity);
    const costInput = unitCost(input.unitCost);
    const key = idempotencyKey(input.idempotencyKey);
    const db = await this.db(userId, workspaceId);
    const replay = await db.$queryRawUnsafe<MovementRow[]>(
      "SELECT id::text,warehouse_id::text,variant_id::text,movement_type,quantity_delta::text,unit_cost::text,total_cost::text,reference_type,reference_id::text,reversal_of_id::text,idempotency_key FROM stock_movements WHERE idempotency_key=$1",
      key,
    );
    if (replay.length) {
      const row = replay[0];
      if (row.movement_type !== "RECEIVING" || row.warehouse_id !== input.warehouseId || row.variant_id !== input.variantId ||
          row.quantity_delta !== qty || row.unit_cost !== costInput) {
        throw new ConflictException("Idempotency key was already used with a different receiving payload");
      }
      return { movementId: row.id, movementType: row.movement_type, quantityDelta: row.quantity_delta, totalCost: row.total_cost, idempotentReplay: true };
    }
    try {
      return await db.$transaction(async tx => {
        await tx.$executeRawUnsafe(
          `INSERT INTO stock_balances (warehouse_id,variant_id,on_hand,reserved,available,updated_at)
           SELECT $1::uuid,$2::uuid,0,0,0,NOW()
           WHERE EXISTS (SELECT 1 FROM warehouses WHERE id=$1::uuid AND status='ACTIVE')
             AND EXISTS (SELECT 1 FROM product_variants WHERE id=$2::uuid AND status='ACTIVE')
           ON CONFLICT (warehouse_id,variant_id) DO NOTHING`,
          warehouseId, variantId,
        );
        const balance = await this.lockBalance(tx, warehouseId, variantId);
        await tx.$executeRawUnsafe(
          `INSERT INTO inventory_costs (warehouse_id,variant_id,quantity,average_unit_cost,inventory_value,updated_at)
           VALUES ($1::uuid,$2::uuid,0,0,0,NOW()) ON CONFLICT (warehouse_id,variant_id) DO NOTHING`,
          input.warehouseId, input.variantId,
        );
        await this.lockCost(tx, warehouseId, variantId, balance.on_hand);
        const totals = await tx.$queryRawUnsafe<Array<{ total_cost: string }>>(
          "SELECT ROUND($1::numeric*$2::numeric,6)::text AS total_cost",
          qty, costInput,
        );
        const totalCost = totals[0].total_cost;
        await tx.$executeRawUnsafe(
          `UPDATE inventory_costs
           SET quantity=quantity+$3::numeric,
               average_unit_cost=ROUND((inventory_value+$4::numeric)/(quantity+$3::numeric),6),
               inventory_value=ROUND((quantity+$3::numeric)*ROUND((inventory_value+$4::numeric)/(quantity+$3::numeric),6),6),
               updated_at=NOW()
           WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid`,
          warehouseId, variantId, qty, totalCost,
        );
        await tx.$executeRawUnsafe(
          `UPDATE stock_balances SET on_hand=on_hand+$3::numeric, available=available+$3::numeric, updated_at=NOW()
           WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid`,
          input.warehouseId, input.variantId, qty,
        );
        const movementId = randomUUID();
        await tx.$executeRawUnsafe(
          `INSERT INTO stock_movements
           (id,warehouse_id,variant_id,movement_type,quantity_delta,unit_cost,total_cost,reference_type,reference_id,idempotency_key,reason,actor_user_id)
           VALUES ($1::uuid,$2::uuid,$3::uuid,'RECEIVING',$4::numeric,$5::numeric,$6::numeric,'DIRECT_RECEIVING',$7::uuid,$8,$9,$10::uuid)`,
          movementId, warehouseId, variantId, qty, costInput, totalCost,
          referenceId, key, reason, userId,
        );
        await this.audit(tx, userId, "STOCK_RECEIVED", "StockMovement", movementId, {
          warehouseId, variantId, quantity: qty, unitCost: costInput,
          totalCost, reason,
        });
        return { movementId, movementType: "RECEIVING", quantityDelta: qty, unitCost: costInput, totalCost, idempotentReplay: false };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const found = await db.$queryRawUnsafe<MovementRow[]>(
          "SELECT id::text,warehouse_id::text,variant_id::text,movement_type,quantity_delta::text,unit_cost::text,total_cost::text,reference_type,reference_id::text,reversal_of_id::text,idempotency_key FROM stock_movements WHERE idempotency_key=$1",
          key,
        );
        if (found.length && found[0].movement_type === "RECEIVING" && found[0].warehouse_id === input.warehouseId &&
            found[0].variant_id === input.variantId && found[0].quantity_delta === qty && found[0].unit_cost === costInput) {
          return { movementId: found[0].id, movementType: found[0].movement_type, quantityDelta: found[0].quantity_delta, totalCost: found[0].total_cost, idempotentReplay: true };
        }
        throw new ConflictException("Inventory receiving idempotency key has already been used");
      }
      throw error;
    }
  }

  async transfer(
    userId: string, workspaceId: string,
    input: { sourceWarehouseId: string; destinationWarehouseId: string; variantId: string; quantity: unknown; idempotencyKey: unknown; reason: unknown },
  ) {
    const sourceWarehouseId = uuid(input.sourceWarehouseId, "sourceWarehouseId");
    const destinationWarehouseId = uuid(input.destinationWarehouseId, "destinationWarehouseId");
    const variantId = uuid(input.variantId, "variantId");
    if (sourceWarehouseId === destinationWarehouseId) throw new BadRequestException("Source and destination warehouses must be different");
    const qty = quantity(input.quantity);
    const key = idempotencyKey(input.idempotencyKey);
    if (typeof input.reason !== "string" || !input.reason.trim() || input.reason.trim().length > 500) throw new BadRequestException("A transfer reason of 1 to 500 characters is required");
    const reason = input.reason.trim();
    const db = await this.db(userId, workspaceId);
    const findReplay = async () => {
      const rows = await db.$queryRawUnsafe<MovementRow[]>("SELECT id::text,warehouse_id::text,variant_id::text,movement_type,quantity_delta::text,unit_cost::text,total_cost::text,reference_type,reference_id::text,reversal_of_id::text,idempotency_key,reason FROM stock_movements WHERE idempotency_key=$1", key);
      if (!rows.length) return null;
      const row = rows[0];
      const paired = row.reference_id ? await db.$queryRawUnsafe<Array<{ warehouse_id: string }>>("SELECT warehouse_id::text FROM stock_movements WHERE reference_id=$1::uuid AND movement_type='TRANSFER_IN'", row.reference_id) : [];
      if (row.movement_type !== "TRANSFER_OUT" || row.reference_type !== "TRANSFER" || row.warehouse_id !== sourceWarehouseId || row.variant_id !== variantId || row.quantity_delta !== "-" + qty || row.reason !== reason || paired.length !== 1 || paired[0].warehouse_id !== destinationWarehouseId) throw new ConflictException("Idempotency key was already used with a different transfer payload");
      return { transferId: row.reference_id, movementId: row.id, movementType: "TRANSFER", sourceWarehouseId, destinationWarehouseId, variantId, quantity: qty, unitCost: row.unit_cost, totalCost: row.total_cost, idempotentReplay: true };
    };
    const replay = await findReplay();
    if (replay) return replay;
    try {
      return await db.$transaction(async tx => {
        await tx.$executeRawUnsafe(`INSERT INTO stock_balances (warehouse_id,variant_id,on_hand,reserved,available,updated_at)
          SELECT $1::uuid,$2::uuid,0,0,0,NOW()
          WHERE EXISTS (SELECT 1 FROM warehouses WHERE id=$1::uuid AND status='ACTIVE')
            AND EXISTS (SELECT 1 FROM product_variants WHERE id=$2::uuid AND status='ACTIVE')
          ON CONFLICT (warehouse_id,variant_id) DO NOTHING`, destinationWarehouseId, variantId);
        await tx.$executeRawUnsafe("INSERT INTO inventory_costs (warehouse_id,variant_id,quantity,average_unit_cost,inventory_value,updated_at) VALUES ($1::uuid,$2::uuid,0,0,0,NOW()) ON CONFLICT (warehouse_id,variant_id) DO NOTHING", destinationWarehouseId, variantId);
        const warehouseIds = [sourceWarehouseId, destinationWarehouseId].sort();
        const balances = new Map<string, BalanceRow>();
        for (const warehouseId of warehouseIds) balances.set(warehouseId, await this.lockBalance(tx, warehouseId, variantId));
        const sourceBalance = balances.get(sourceWarehouseId)!;
        if (Number(sourceBalance.available) < Number(qty)) throw new ConflictException("Insufficient available stock in source warehouse");
        const costs = new Map<string, CostRow>();
        for (const warehouseId of warehouseIds) costs.set(warehouseId, await this.lockCost(tx, warehouseId, variantId, balances.get(warehouseId)!.on_hand));
        const sourceCost = costs.get(sourceWarehouseId)!;
        const totals = await tx.$queryRawUnsafe<Array<{ total_cost: string }>>("SELECT ROUND($1::numeric*$2::numeric,6)::text AS total_cost", qty, sourceCost.average_unit_cost);
        const totalCost = totals[0].total_cost;
        const sourceChanged = await tx.$executeRawUnsafe("UPDATE stock_balances SET on_hand=on_hand-$3::numeric,available=available-$3::numeric,updated_at=NOW() WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid AND available >= $3::numeric AND on_hand >= $3::numeric", sourceWarehouseId, variantId, qty);
        if (sourceChanged !== 1) throw new ConflictException("Insufficient available stock in source warehouse");
        const sourceCostChanged = await tx.$executeRawUnsafe(`UPDATE inventory_costs SET quantity=quantity-$3::numeric,
          average_unit_cost=CASE WHEN quantity-$3::numeric=0 THEN 0 ELSE average_unit_cost END,
          inventory_value=CASE WHEN quantity-$3::numeric=0 THEN 0 ELSE ROUND((quantity-$3::numeric)*average_unit_cost,6) END,
          updated_at=NOW() WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid AND quantity >= $3::numeric AND inventory_value >= $4::numeric`, sourceWarehouseId, variantId, qty, totalCost);
        if (sourceCostChanged !== 1) throw new ConflictException("Insufficient inventory cost quantity/value");
        await tx.$executeRawUnsafe(`UPDATE inventory_costs SET quantity=quantity+$3::numeric,
          average_unit_cost=ROUND((inventory_value+$4::numeric)/(quantity+$3::numeric),6),
          inventory_value=ROUND((quantity+$3::numeric)*ROUND((inventory_value+$4::numeric)/(quantity+$3::numeric),6),6),
          updated_at=NOW() WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid`, destinationWarehouseId, variantId, qty, totalCost);
        await tx.$executeRawUnsafe("UPDATE stock_balances SET on_hand=on_hand+$3::numeric,available=available+$3::numeric,updated_at=NOW() WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid", destinationWarehouseId, variantId, qty);
        const transferId = randomUUID(), outMovementId = randomUUID(), inMovementId = randomUUID();
        await tx.$executeRawUnsafe(`INSERT INTO stock_movements (id,warehouse_id,variant_id,movement_type,quantity_delta,unit_cost,total_cost,reference_type,reference_id,idempotency_key,reason,actor_user_id)
          VALUES ($1::uuid,$2::uuid,$3::uuid,'TRANSFER_OUT',$4::numeric,$5::numeric,$6::numeric,'TRANSFER',$7::uuid,$8,$9,$10::uuid)`, outMovementId, sourceWarehouseId, variantId, "-" + qty, sourceCost.average_unit_cost, totalCost, transferId, key, reason, userId);
        await tx.$executeRawUnsafe(`INSERT INTO stock_movements (id,warehouse_id,variant_id,movement_type,quantity_delta,unit_cost,total_cost,reference_type,reference_id,reason,actor_user_id)
          VALUES ($1::uuid,$2::uuid,$3::uuid,'TRANSFER_IN',$4::numeric,$5::numeric,$6::numeric,'TRANSFER',$7::uuid,$8,$9::uuid)`, inMovementId, destinationWarehouseId, variantId, qty, sourceCost.average_unit_cost, totalCost, transferId, reason, userId);
        await this.audit(tx, userId, "STOCK_TRANSFERRED", "StockTransfer", transferId, { sourceWarehouseId, destinationWarehouseId, variantId, quantity: qty, unitCost: sourceCost.average_unit_cost, totalCost, reason, outgoingMovementId: outMovementId, incomingMovementId: inMovementId });
        return { transferId, movementId: outMovementId, incomingMovementId: inMovementId, movementType: "TRANSFER", sourceWarehouseId, destinationWarehouseId, variantId, quantity: qty, unitCost: sourceCost.average_unit_cost, totalCost, idempotentReplay: false };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const found = await findReplay();
        if (found) return found;
        throw new ConflictException("Transfer idempotency key has already been used");
      }
      throw error;
    }
  }

  async adjust(
    userId: string, workspaceId: string,
    input: { warehouseId: string; variantId: string; countedQuantity: unknown; unitCost?: unknown; idempotencyKey: unknown; reason: unknown },
  ) {
    const warehouseId = uuid(input.warehouseId, "warehouseId");
    const variantId = uuid(input.variantId, "variantId");
    const counted = countedQuantity(input.countedQuantity);
    const key = idempotencyKey(input.idempotencyKey);
    if (typeof input.reason !== "string" || !input.reason.trim() || input.reason.trim().length > 500) throw new BadRequestException("An adjustment reason of 1 to 500 characters is required");
    const reason = input.reason.trim();
    const addedUnitCost = input.unitCost == null ? null : unitCost(input.unitCost);
    const db = await this.db(userId, workspaceId);
    const findReplay = () => db.$queryRawUnsafe<MovementRow[]>("SELECT id::text,warehouse_id::text,variant_id::text,movement_type,quantity_delta::text,unit_cost::text,total_cost::text,reference_type,reference_id::text,reversal_of_id::text,idempotency_key,reason,(SELECT metadata->>'countedQuantity' FROM audit_events WHERE resource_type='StockMovement' AND resource_id=stock_movements.id::text AND action='STOCK_ADJUSTED' LIMIT 1) AS counted_quantity FROM stock_movements WHERE idempotency_key=$1", key);
    const replay = await findReplay();
    if (replay.length) {
      const row = replay[0];
      if (row.reference_type !== "ADJUSTMENT" || row.warehouse_id !== warehouseId || row.variant_id !== variantId || row.reason !== reason || row.counted_quantity !== counted || !["ADJUSTMENT_IN", "ADJUSTMENT_OUT"].includes(row.movement_type) || (row.movement_type === "ADJUSTMENT_IN" && row.unit_cost !== addedUnitCost)) throw new ConflictException("Idempotency key was already used with a different adjustment payload");
      return { movementId: row.id, movementType: row.movement_type, quantityDelta: row.quantity_delta, totalCost: row.total_cost, idempotentReplay: true };
    }
    try {
      return await db.$transaction(async tx => {
        const balance = await this.lockBalance(tx, warehouseId, variantId);
        const result = await tx.$queryRawUnsafe<Array<{ delta: string }>>("SELECT ($1::numeric-$2::numeric)::text AS delta", counted, balance.on_hand);
        const delta = result[0].delta;
        if (Number(delta) === 0) return { movementId: null, movementType: null, quantityDelta: "0.000", totalCost: "0.000000", noOp: true, idempotentReplay: false };
        const increase = !delta.startsWith("-");
        const qty = increase ? delta : delta.slice(1);
        let cost: { unitCost: string; totalCost: string };
        if (increase) {
          if (addedUnitCost === null) throw new BadRequestException("unitCost is required when counted quantity exceeds current stock");
          await this.lockCost(tx, warehouseId, variantId, balance.on_hand);
          const total = await tx.$queryRawUnsafe<Array<{ total_cost: string }>>("SELECT ROUND($1::numeric*$2::numeric,6)::text AS total_cost", qty, addedUnitCost);
          const totalCost = total[0].total_cost;
          await tx.$executeRawUnsafe("UPDATE inventory_costs SET quantity=quantity+$3::numeric, average_unit_cost=ROUND((inventory_value+$4::numeric)/(quantity+$3::numeric),6), inventory_value=ROUND((quantity+$3::numeric)*ROUND((inventory_value+$4::numeric)/(quantity+$3::numeric),6),6), updated_at=NOW() WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid", warehouseId, variantId, qty, totalCost);
          await tx.$executeRawUnsafe("UPDATE stock_balances SET on_hand=on_hand+$3::numeric,available=available+$3::numeric,updated_at=NOW() WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid", warehouseId, variantId, qty);
          cost = { unitCost: addedUnitCost, totalCost };
        } else {
          const enough = await tx.$queryRawUnsafe<Array<{ enough: boolean }>>("SELECT available >= $1::numeric AS enough FROM stock_balances WHERE warehouse_id=$2::uuid AND variant_id=$3::uuid", qty, warehouseId, variantId);
          if (!enough[0]?.enough) throw new ConflictException("Adjustment would reduce stock below reserved quantity");
          cost = await this.applyIssueCost(tx, warehouseId, variantId, balance.on_hand, qty);
          const changed = await tx.$executeRawUnsafe("UPDATE stock_balances SET on_hand=on_hand-$3::numeric,available=available-$3::numeric,updated_at=NOW() WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid AND available >= $3::numeric", warehouseId, variantId, qty);
          if (changed !== 1) throw new ConflictException("Adjustment would reduce stock below reserved quantity");
        }
        const movementId = randomUUID();
        const movementType = increase ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT";
        await tx.$executeRawUnsafe("INSERT INTO stock_movements (id,warehouse_id,variant_id,movement_type,quantity_delta,unit_cost,total_cost,reference_type,idempotency_key,reason,actor_user_id) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::\"StockMovementType\",$5::numeric,$6::numeric,$7::numeric,'ADJUSTMENT',$8,$9,$10::uuid)", movementId, warehouseId, variantId, movementType, delta, cost.unitCost, cost.totalCost, key, reason, userId);
        await this.audit(tx, userId, "STOCK_ADJUSTED", "StockMovement", movementId, { warehouseId, variantId, countedQuantity: counted, quantityDelta: delta, movementType, unitCost: cost.unitCost, totalCost: cost.totalCost, reason });
        return { movementId, movementType, quantityDelta: delta, unitCost: cost.unitCost, totalCost: cost.totalCost, noOp: false, idempotentReplay: false };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const found = await findReplay();
        if (found.length && found[0].reference_type === "ADJUSTMENT" && found[0].warehouse_id === warehouseId && found[0].variant_id === variantId && found[0].reason === reason && found[0].counted_quantity === counted) return { movementId: found[0].id, movementType: found[0].movement_type, quantityDelta: found[0].quantity_delta, totalCost: found[0].total_cost, idempotentReplay: true };
        throw new ConflictException("Adjustment idempotency key has already been used");
      }
      throw error;
    }
  }
  async reverseMovement(
    userId: string,
    workspaceId: string,
    movementId: string,
    input: { idempotencyKey: unknown; reason: string },
  ) {
    movementId = uuid(movementId, "movementId");
    const key = idempotencyKey(input.idempotencyKey);
    if (typeof input.reason !== "string" || !input.reason.trim() || input.reason.trim().length > 500) {
      throw new BadRequestException("A reversal reason of 1 to 500 characters is required");
    }
    const db = await this.db(userId, workspaceId);
    const replay = await db.$queryRawUnsafe<MovementRow[]>(
      "SELECT id::text,warehouse_id::text,variant_id::text,movement_type,quantity_delta::text,unit_cost::text,total_cost::text,reference_type,reference_id::text,reversal_of_id::text,idempotency_key FROM stock_movements WHERE idempotency_key=$1",
      key,
    );
    if (replay.length) {
      if (replay[0].movement_type !== "REVERSAL" || replay[0].reversal_of_id !== movementId) {
        throw new ConflictException("Idempotency key was already used for a different movement");
      }
      return { movementId: replay[0].id, movementType: "REVERSAL", quantityDelta: replay[0].quantity_delta, idempotentReplay: true };
    }
    try {
      return await db.$transaction(async tx => {
        const originals = await tx.$queryRawUnsafe<MovementRow[]>(
          "SELECT id::text,warehouse_id::text,variant_id::text,movement_type,quantity_delta::text,unit_cost::text,total_cost::text,reference_type,reference_id::text,reversal_of_id::text,idempotency_key FROM stock_movements WHERE id=$1::uuid FOR UPDATE",
          movementId,
        );
        if (!originals.length) throw new NotFoundException("Stock movement not found");
        const original = originals[0];
        if (original.movement_type === "REVERSAL") {
          throw new ConflictException("This movement type cannot be reversed");
        }
        if (!original.unit_cost || !original.total_cost) throw new ConflictException("Movement has no cost snapshot and cannot be reversed safely");
        const positiveOriginal = !original.quantity_delta.startsWith("-");
        const reverseQty = original.quantity_delta.startsWith("-") ? original.quantity_delta.slice(1) : original.quantity_delta;
        const balance = await this.lockBalance(tx, original.warehouse_id, original.variant_id);
        const cost = await this.lockCost(tx, original.warehouse_id, original.variant_id, balance.on_hand);
        if (positiveOriginal) {
          const changed = await tx.$executeRawUnsafe(
            `UPDATE stock_balances SET on_hand=on_hand-$3::numeric,available=available-$3::numeric,updated_at=NOW()
             WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid AND available >= $3::numeric`,
            original.warehouse_id, original.variant_id, reverseQty,
          );
          if (changed !== 1) throw new ConflictException("Reversal would create negative available stock");
          const costUpdated = await tx.$executeRawUnsafe(
            `UPDATE inventory_costs
             SET quantity=quantity-$3::numeric,
                 average_unit_cost=CASE WHEN quantity-$3::numeric=0 THEN 0 ELSE ROUND((inventory_value-$4::numeric)/(quantity-$3::numeric),6) END,
                 inventory_value=CASE WHEN quantity-$3::numeric=0 THEN 0 ELSE ROUND((quantity-$3::numeric)*ROUND((inventory_value-$4::numeric)/(quantity-$3::numeric),6),6) END,
                 updated_at=NOW()
             WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid AND quantity >= $3::numeric AND inventory_value >= $4::numeric`,
            original.warehouse_id, original.variant_id, reverseQty, original.total_cost,
          );
          if (costUpdated !== 1) throw new ConflictException("Reversal would make inventory cost negative");
        } else {
          await tx.$executeRawUnsafe(
            `UPDATE stock_balances SET on_hand=on_hand+$3::numeric,available=available+$3::numeric,updated_at=NOW()
             WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid`,
            original.warehouse_id, original.variant_id, reverseQty,
          );
          await tx.$executeRawUnsafe(
            `UPDATE inventory_costs
             SET quantity=quantity+$3::numeric,
                 average_unit_cost=ROUND((inventory_value+$4::numeric)/(quantity+$3::numeric),6),
                 inventory_value=ROUND((quantity+$3::numeric)*ROUND((inventory_value+$4::numeric)/(quantity+$3::numeric),6),6),updated_at=NOW()
             WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid`,
            original.warehouse_id, original.variant_id, reverseQty, original.total_cost,
          );
        }
        const reversalId = randomUUID();
        await tx.$executeRawUnsafe(
          `INSERT INTO stock_movements
           (id,warehouse_id,variant_id,movement_type,quantity_delta,unit_cost,total_cost,reference_type,reference_id,idempotency_key,reversal_of_id,reason,actor_user_id)
           VALUES ($1::uuid,$2::uuid,$3::uuid,'REVERSAL',-$4::numeric,$5::numeric,$6::numeric,$7::"StockReferenceType",$8::uuid,$9,$10::uuid,$11,$12::uuid)`,
          reversalId, original.warehouse_id, original.variant_id, original.quantity_delta,
          original.unit_cost, original.total_cost, original.reference_type, original.reference_id,
          key, original.id, input.reason.trim(), userId,
        );
        await this.audit(tx, userId, "STOCK_MOVEMENT_REVERSED", "StockMovement", reversalId, {
          reversalOfId: original.id, warehouseId: original.warehouse_id, variantId: original.variant_id,
          quantityDelta: original.quantity_delta.startsWith("-") ? reverseQty : "-" + reverseQty,
          reason: input.reason.trim(),
        });
        return { movementId: reversalId, movementType: "REVERSAL", quantityDelta: original.quantity_delta.startsWith("-") ? reverseQty : "-" + reverseQty, reversalOfId: original.id, idempotentReplay: false };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const found = await db.$queryRawUnsafe<MovementRow[]>(
          "SELECT id::text,warehouse_id::text,variant_id::text,movement_type,quantity_delta::text,unit_cost::text,total_cost::text,reference_type,reference_id::text,reversal_of_id::text,idempotency_key FROM stock_movements WHERE idempotency_key=$1 OR reversal_of_id=$2::uuid",
          key, movementId,
        );
        if (found.length && found[0].movement_type === "REVERSAL" && found[0].reversal_of_id === movementId) {
          return { movementId: found[0].id, movementType: "REVERSAL", quantityDelta: found[0].quantity_delta, reversalOfId: movementId, idempotentReplay: true };
        }
        throw new ConflictException("Movement has already been reversed or idempotency key is in use");
      }
      throw error;
    }
  }

  async listMovements(userId: string, workspaceId: string, filters: {
    warehouseId?: string; variantId?: string; movementType?: string;
    from?: string; to?: string; search?: string; page?: string; pageSize?: string;
  }) {
    const db = await this.db(userId, workspaceId);
    const page = filters.page === undefined ? 1 : Number(filters.page);
    const pageSize = filters.pageSize === undefined ? 20 : Number(filters.pageSize);
    if (!Number.isInteger(page) || page < 1 || page > 100000) throw new BadRequestException("page must be a positive integer");
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new BadRequestException("pageSize must be between 1 and 100");
    const allowedTypes = new Set(["OPENING_STOCK", "RECEIVING", "SALE", "RETURN", "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "TRANSFER_IN", "TRANSFER_OUT", "REVERSAL"]);
    if (filters.movementType && !allowedTypes.has(filters.movementType)) throw new BadRequestException("Unsupported movementType");
    const params: unknown[] = [];
    const conditions: string[] = [];
    const add = (value: unknown) => { params.push(value); return "$" + params.length; };
    if (filters.warehouseId) conditions.push("sm.warehouse_id = " + add(uuid(filters.warehouseId, "warehouseId")) + "::uuid");
    if (filters.variantId) conditions.push("sm.variant_id = " + add(uuid(filters.variantId, "variantId")) + "::uuid");
    if (filters.movementType) conditions.push("sm.movement_type::text = " + add(filters.movementType));
    if (filters.from) { const date = new Date(filters.from); if (!Number.isFinite(date.getTime())) throw new BadRequestException("from must be a valid date"); conditions.push("sm.occurred_at >= " + add(date.toISOString()) + "::timestamptz"); }
    if (filters.to) { const date = new Date(filters.to); if (!Number.isFinite(date.getTime())) throw new BadRequestException("to must be a valid date"); conditions.push("sm.occurred_at < " + add(date.toISOString()) + "::timestamptz"); }
    if (filters.from && filters.to && new Date(filters.from) > new Date(filters.to)) throw new BadRequestException("from must be earlier than to");
    if (filters.search?.trim()) { const search = add("%" + filters.search.trim().slice(0, 100) + "%"); conditions.push("(p.name ILIKE " + search + " OR pv.sku ILIKE " + search + " OR pv.title ILIKE " + search + " OR COALESCE(sm.reason, '') ILIKE " + search + ")"); }
    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
    const joins = " FROM stock_movements sm JOIN warehouses w ON w.id=sm.warehouse_id JOIN product_variants pv ON pv.id=sm.variant_id JOIN products p ON p.id=pv.product_id ";
    const count = await db.$queryRawUnsafe<Array<{ total: bigint }>>("SELECT COUNT(*)::bigint AS total" + joins + where, ...params);
    const limit = add(pageSize); const offset = add((page - 1) * pageSize);
    const rows = await db.$queryRawUnsafe<Array<{ id: string; movement_type: string; quantity_delta: string; unit_cost: string | null; total_cost: string | null; reference_type: string; reference_id: string | null; reversal_of_id: string | null; reason: string | null; actor_user_id: string | null; occurred_at: Date; warehouse_id: string; warehouse_name: string; warehouse_code: string; variant_id: string; sku: string; variant_title: string; product_name: string }>>(
      "SELECT sm.id::text, sm.movement_type::text, sm.quantity_delta::text, sm.unit_cost::text, sm.total_cost::text, sm.reference_type::text, sm.reference_id::text, sm.reversal_of_id::text, sm.reason, sm.actor_user_id::text, sm.occurred_at, w.id::text AS warehouse_id, w.name AS warehouse_name, w.code AS warehouse_code, pv.id::text AS variant_id, pv.sku, pv.title AS variant_title, p.name AS product_name" + joins + where + " ORDER BY sm.occurred_at DESC, sm.id DESC LIMIT " + limit + " OFFSET " + offset, ...params,
    );
    const total = Number(count[0]?.total ?? 0n);
    return { items: rows.map(row => ({ id: row.id, movementType: row.movement_type, quantityDelta: row.quantity_delta, unitCost: row.unit_cost, totalCost: row.total_cost, referenceType: row.reference_type, referenceId: row.reference_id, reversalOfId: row.reversal_of_id, reason: row.reason, actorUserId: row.actor_user_id, occurredAt: row.occurred_at, warehouse: { id: row.warehouse_id, name: row.warehouse_name, code: row.warehouse_code }, variant: { id: row.variant_id, sku: row.sku, title: row.variant_title, productName: row.product_name } })), pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async listStocktakes(userId: string, workspaceId: string, filters: { warehouseId?: string; status?: string; page?: string; pageSize?: string }) {
    const db = await this.db(userId, workspaceId);
    const page = filters.page === undefined ? 1 : Number(filters.page);
    const pageSize = filters.pageSize === undefined ? 20 : Number(filters.pageSize);
    if (!Number.isInteger(page) || page < 1 || page > 100000) throw new BadRequestException("page must be a positive integer");
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new BadRequestException("pageSize must be between 1 and 100");
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (filters.warehouseId) { params.push(uuid(filters.warehouseId, "warehouseId")); conditions.push("s.warehouse_id=$" + params.length + "::uuid"); }
    if (filters.status) {
      if (!["DRAFT", "IN_PROGRESS", "FINALIZED", "CANCELLED"].includes(filters.status)) throw new BadRequestException("Unsupported stocktake status");
      params.push(filters.status); conditions.push("s.status::text=$" + params.length);
    }
    const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
    const joins = " FROM stocktake_sessions s JOIN warehouses w ON w.id=s.warehouse_id";
    const count = await db.$queryRawUnsafe<Array<{ total: bigint }>>("SELECT COUNT(*)::bigint AS total" + joins + where, ...params);
    const limitParam = params.length + 1; const offsetParam = params.length + 2;
    const rows = await db.$queryRawUnsafe<Array<{ id: string; warehouse_id: string; warehouse_name: string; warehouse_code: string; status: string; reference: string | null; notes: string | null; snapshot_at: Date; created_at: Date; finalized_at: Date | null; line_count: bigint; counted_count: bigint }>>(
      "SELECT s.id::text,s.warehouse_id::text,w.name AS warehouse_name,w.code AS warehouse_code,s.status::text,s.reference,s.notes,s.snapshot_at,s.created_at,s.finalized_at,COUNT(l.id)::bigint AS line_count,COUNT(l.counted_quantity)::bigint AS counted_count" +
      joins + " LEFT JOIN stocktake_lines l ON l.session_id=s.id" + where +
      " GROUP BY s.id,w.id ORDER BY s.created_at DESC,s.id DESC LIMIT $" + limitParam + " OFFSET $" + offsetParam,
      ...params, pageSize, (page - 1) * pageSize,
    );
    const total = Number(count[0]?.total ?? 0n);
    return { items: rows.map(row => ({ id: row.id, status: row.status, reference: row.reference, notes: row.notes,
      snapshotAt: row.snapshot_at, createdAt: row.created_at, finalizedAt: row.finalized_at,
      warehouse: { id: row.warehouse_id, name: row.warehouse_name, code: row.warehouse_code },
      lineCount: Number(row.line_count), countedCount: Number(row.counted_count) })),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async createStocktake(userId: string, workspaceId: string, input: { warehouseId: unknown; reference?: unknown; notes?: unknown; idempotencyKey: unknown }) {
    const warehouseId = uuid(input.warehouseId, "warehouseId");
    const key = idempotencyKey(input.idempotencyKey);
    const reference = typeof input.reference === "string" ? input.reference.trim().slice(0, 100) || null : null;
    const notes = typeof input.notes === "string" ? input.notes.trim().slice(0, 1000) || null : null;
    const db = await this.db(userId, workspaceId);
    const replay = await db.$queryRawUnsafe<Array<{ id: string; warehouse_id: string; status: string }>>(
      "SELECT id::text,warehouse_id::text,status::text FROM stocktake_sessions WHERE idempotency_key=$1", key,
    );
    if (replay.length) {
      if (replay[0].warehouse_id !== warehouseId) throw new ConflictException("Stocktake idempotency key was used for another warehouse");
      return { stocktakeId: replay[0].id, status: replay[0].status, idempotentReplay: true };
    }
    const stocktakeId = randomUUID();
    try {
      await db.$transaction(async tx => {
        const warehouse = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          "SELECT id::text FROM warehouses WHERE id=$1::uuid AND status='ACTIVE' FOR UPDATE", warehouseId,
        );
        if (!warehouse.length) throw new NotFoundException("Active warehouse not found");
        await tx.$executeRawUnsafe(
          "INSERT INTO stocktake_sessions (id,warehouse_id,status,reference,notes,idempotency_key,created_by,updated_at) VALUES ($1::uuid,$2::uuid,'DRAFT',$3,$4,$5,$6::uuid,NOW())",
          stocktakeId, warehouseId, reference, notes, key, userId,
        );
        await tx.$executeRawUnsafe(
          "INSERT INTO stocktake_lines (id,session_id,variant_id,system_quantity,updated_at) " +
          "SELECT gen_random_uuid(),$1::uuid,b.variant_id,b.on_hand,NOW() " +
          "FROM stock_balances b JOIN product_variants pv ON pv.id=b.variant_id AND pv.status='ACTIVE' " +
          "WHERE b.warehouse_id=$2::uuid ORDER BY b.variant_id",
          stocktakeId, warehouseId,
        );
        await this.audit(tx, userId, "STOCKTAKE_CREATED", "StocktakeSession", stocktakeId, { warehouseId, reference, notes });
      });
      return { stocktakeId, status: "DRAFT", idempotentReplay: false };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const found = await db.$queryRawUnsafe<Array<{ id: string; warehouse_id: string; status: string }>>(
          "SELECT id::text,warehouse_id::text,status::text FROM stocktake_sessions WHERE idempotency_key=$1", key,
        );
        if (found.length && found[0].warehouse_id === warehouseId) return { stocktakeId: found[0].id, status: found[0].status, idempotentReplay: true };
      }
      throw error;
    }
  }

  async getStocktake(userId: string, workspaceId: string, stocktakeId: string) {
    stocktakeId = uuid(stocktakeId, "stocktakeId");
    const db = await this.db(userId, workspaceId);
    const sessions = await db.$queryRawUnsafe<Array<{ id: string; warehouse_id: string; warehouse_name: string; warehouse_code: string; status: string; reference: string | null; notes: string | null; snapshot_at: Date; created_at: Date; finalized_at: Date | null }>>(
      "SELECT s.id::text,s.warehouse_id::text,w.name AS warehouse_name,w.code AS warehouse_code,s.status::text,s.reference,s.notes,s.snapshot_at,s.created_at,s.finalized_at " +
      "FROM stocktake_sessions s JOIN warehouses w ON w.id=s.warehouse_id WHERE s.id=$1::uuid", stocktakeId,
    );
    if (!sessions.length) throw new NotFoundException("Stocktake session not found");
    const lines = await db.$queryRawUnsafe<Array<{ id: string; variant_id: string; sku: string; variant_title: string; product_name: string; system_quantity: string; counted_quantity: string | null; unit_cost: string | null; note: string | null }>>(
      "SELECT l.id::text,l.variant_id::text,pv.sku,pv.title AS variant_title,p.name AS product_name," +
      "l.system_quantity::text,l.counted_quantity::text,l.unit_cost::text,l.note " +
      "FROM stocktake_lines l JOIN product_variants pv ON pv.id=l.variant_id JOIN products p ON p.id=pv.product_id " +
      "WHERE l.session_id=$1::uuid ORDER BY p.name,pv.sku", stocktakeId,
    );
    const session = sessions[0];
    return { id: session.id, status: session.status, reference: session.reference, notes: session.notes,
      snapshotAt: session.snapshot_at, createdAt: session.created_at, finalizedAt: session.finalized_at,
      warehouse: { id: session.warehouse_id, name: session.warehouse_name, code: session.warehouse_code },
      lines: lines.map(line => ({ id: line.id, variantId: line.variant_id, sku: line.sku,
        variantTitle: line.variant_title, productName: line.product_name,
        systemQuantity: line.system_quantity, countedQuantity: line.counted_quantity,
        variance: line.counted_quantity === null ? null :
          (Number(line.counted_quantity) - Number(line.system_quantity)).toFixed(3),
        unitCost: line.unit_cost, note: line.note })) };
  }

  async recordStocktakeCount(userId: string, workspaceId: string, stocktakeId: string, lineId: string,
    input: { countedQuantity: unknown; unitCost?: unknown; note?: unknown }) {
    stocktakeId = uuid(stocktakeId, "stocktakeId");
    lineId = uuid(lineId, "lineId");
    const counted = countedQuantity(input.countedQuantity);
    const addedUnitCost = input.unitCost === undefined || input.unitCost === null || input.unitCost === ""
      ? null : unitCost(input.unitCost);
    const note = typeof input.note === "string" ? input.note.trim().slice(0, 500) || null : null;
    const db = await this.db(userId, workspaceId);
    return db.$transaction(async tx => {
      const sessions = await tx.$queryRawUnsafe<Array<{ status: string }>>(
        "SELECT status::text FROM stocktake_sessions WHERE id=$1::uuid FOR UPDATE", stocktakeId,
      );
      if (!sessions.length) throw new NotFoundException("Stocktake session not found");
      if (!["DRAFT", "IN_PROGRESS"].includes(sessions[0].status)) throw new ConflictException("Stocktake session is not editable");
      const changed = await tx.$queryRawUnsafe<Array<{ id: string; counted_quantity: string; unit_cost: string | null }>>(
        "UPDATE stocktake_lines SET counted_quantity=$3::numeric," +
        "unit_cost=COALESCE($4::numeric,unit_cost),note=$5,updated_at=NOW() " +
        "WHERE id=$1::uuid AND session_id=$2::uuid RETURNING id::text,counted_quantity::text,unit_cost::text",
        lineId, stocktakeId, counted, addedUnitCost, note,
      );
      if (!changed.length) throw new NotFoundException("Stocktake line not found");
      await tx.$executeRawUnsafe("UPDATE stocktake_sessions SET status='IN_PROGRESS',updated_at=NOW() WHERE id=$1::uuid", stocktakeId);
      await this.audit(tx, userId, "STOCKTAKE_LINE_COUNTED", "StocktakeLine", lineId,
        { stocktakeId, countedQuantity: counted, unitCost: addedUnitCost, note });
      return { lineId, countedQuantity: changed[0].counted_quantity, unitCost: changed[0].unit_cost };
    });
  }

  async finalizeStocktake(userId: string, workspaceId: string, stocktakeId: string, input: { reason?: unknown }) {
    stocktakeId = uuid(stocktakeId, "stocktakeId");
    const reason = typeof input.reason === "string" && input.reason.trim()
      ? input.reason.trim().slice(0, 500) : "Stocktake reconciliation";
    const db = await this.db(userId, workspaceId);
    return db.$transaction(async tx => {
      const sessions = await tx.$queryRawUnsafe<Array<{ id: string; warehouse_id: string; status: string }>>(
        "SELECT id::text,warehouse_id::text,status::text FROM stocktake_sessions WHERE id=$1::uuid FOR UPDATE", stocktakeId,
      );
      if (!sessions.length) throw new NotFoundException("Stocktake session not found");
      const session = sessions[0];
      if (session.status === "FINALIZED") return { stocktakeId, status: "FINALIZED", idempotentReplay: true, movements: [] };
      if (!["DRAFT", "IN_PROGRESS"].includes(session.status)) throw new ConflictException("Stocktake session cannot be finalized");
      const lines = await tx.$queryRawUnsafe<Array<{ id: string; variant_id: string; system_quantity: string; counted_quantity: string | null; unit_cost: string | null }>>(
        "SELECT id::text,variant_id::text,system_quantity::text,counted_quantity::text,unit_cost::text " +
        "FROM stocktake_lines WHERE session_id=$1::uuid ORDER BY variant_id FOR UPDATE", stocktakeId,
      );
      if (!lines.length) throw new ConflictException("Stocktake has no stock lines");
      if (lines.some(line => line.counted_quantity === null)) throw new ConflictException("Every stocktake line must be counted before finalization");
      const movements: Array<{ movementId: string; variantId: string; movementType: string; quantityDelta: string }> = [];
      for (const line of lines) {
        const balance = await this.lockBalance(tx, session.warehouse_id, line.variant_id);
        if (balance.on_hand !== line.system_quantity) {
          throw new ConflictException("Stock changed after this stocktake snapshot; create a new stocktake before finalizing");
        }
        const deltaRows = await tx.$queryRawUnsafe<Array<{ delta: string }>>(
          "SELECT ($1::numeric-$2::numeric)::text AS delta", line.counted_quantity, line.system_quantity,
        );
        const delta = deltaRows[0].delta;
        if (Number(delta) === 0) continue;
        const increase = !delta.startsWith("-");
        const qty = increase ? delta : delta.slice(1);
        let cost: { unitCost: string; totalCost: string };
        if (increase) {
          if (line.unit_cost === null) throw new BadRequestException("unitCost is required for a positive stocktake variance");
          await this.lockCost(tx, session.warehouse_id, line.variant_id, balance.on_hand);
          const totalRows = await tx.$queryRawUnsafe<Array<{ total_cost: string }>>(
            "SELECT ROUND($1::numeric*$2::numeric,6)::text AS total_cost", qty, line.unit_cost,
          );
          const totalCost = totalRows[0].total_cost;
          await tx.$executeRawUnsafe(
            "UPDATE inventory_costs SET quantity=quantity+$3::numeric," +
            "average_unit_cost=ROUND((inventory_value+$4::numeric)/(quantity+$3::numeric),6)," +
            "inventory_value=ROUND(inventory_value+$4::numeric,6)," +
            "updated_at=NOW() WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid",
            session.warehouse_id, line.variant_id, qty, totalCost,
          );
          await tx.$executeRawUnsafe(
            "UPDATE stock_balances SET on_hand=on_hand+$3::numeric,available=available+$3::numeric,updated_at=NOW() " +
            "WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid",
            session.warehouse_id, line.variant_id, qty,
          );
          cost = { unitCost: line.unit_cost, totalCost };
        } else {
          const enough = await tx.$queryRawUnsafe<Array<{ enough: boolean }>>(
            "SELECT available >= $1::numeric AS enough FROM stock_balances WHERE warehouse_id=$2::uuid AND variant_id=$3::uuid",
            qty, session.warehouse_id, line.variant_id,
          );
          if (!enough[0]?.enough) throw new ConflictException("Stocktake variance would reduce stock below reserved quantity");
          cost = await this.applyIssueCost(tx, session.warehouse_id, line.variant_id, balance.on_hand, qty);
          const updated = await tx.$executeRawUnsafe(
            "UPDATE stock_balances SET on_hand=on_hand-$3::numeric,available=available-$3::numeric,updated_at=NOW() " +
            "WHERE warehouse_id=$1::uuid AND variant_id=$2::uuid AND available >= $3::numeric",
            session.warehouse_id, line.variant_id, qty,
          );
          if (updated !== 1) throw new ConflictException("Stocktake variance would reduce stock below reserved quantity");
        }
        const movementId = randomUUID();
        await tx.$executeRawUnsafe(
          "INSERT INTO stock_movements (id,warehouse_id,variant_id,movement_type,quantity_delta,unit_cost,total_cost,reference_type,reference_id,idempotency_key,reason,actor_user_id) " +
          "VALUES ($1::uuid,$2::uuid,$3::uuid,$4::\"StockMovementType\",$5::numeric,$6::numeric,$7::numeric,'STOCKTAKE',$8::uuid,$9,$10,$11::uuid)",
          movementId, session.warehouse_id, line.variant_id,
          increase ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", delta, cost.unitCost, cost.totalCost,
          stocktakeId, "stocktake:" + stocktakeId + ":" + line.variant_id, reason, userId,
        );
        await this.audit(tx, userId, "STOCKTAKE_VARIANCE_POSTED", "StockMovement", movementId,
          { stocktakeId, lineId: line.id, variantId: line.variant_id, systemQuantity: line.system_quantity,
            countedQuantity: line.counted_quantity, quantityDelta: delta, unitCost: cost.unitCost, totalCost: cost.totalCost });
        movements.push({ movementId, variantId: line.variant_id,
          movementType: increase ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", quantityDelta: delta });
      }
      await tx.$executeRawUnsafe(
        "UPDATE stocktake_sessions SET status='FINALIZED',finalized_by=$2::uuid,finalized_at=NOW(),updated_at=NOW() WHERE id=$1::uuid",
        stocktakeId, userId,
      );
      await this.audit(tx, userId, "STOCKTAKE_FINALIZED", "StocktakeSession", stocktakeId,
        { warehouseId: session.warehouse_id, movementCount: movements.length });
      return { stocktakeId, status: "FINALIZED", idempotentReplay: false, movements };
    });
  }

  async cancelStocktake(userId: string, workspaceId: string, stocktakeId: string, reason?: unknown) {
    stocktakeId = uuid(stocktakeId, "stocktakeId");
    const note = typeof reason === "string" ? reason.trim().slice(0, 500) : "";
    const db = await this.db(userId, workspaceId);
    return db.$transaction(async tx => {
      const rows = await tx.$queryRawUnsafe<Array<{ status: string }>>(
        "SELECT status::text FROM stocktake_sessions WHERE id=$1::uuid FOR UPDATE", stocktakeId,
      );
      if (!rows.length) throw new NotFoundException("Stocktake session not found");
      if (rows[0].status === "CANCELLED") return { stocktakeId, status: "CANCELLED", idempotentReplay: true };
      if (!["DRAFT", "IN_PROGRESS"].includes(rows[0].status)) throw new ConflictException("Only an open stocktake can be cancelled");
      await tx.$executeRawUnsafe("UPDATE stocktake_sessions SET status='CANCELLED',updated_at=NOW() WHERE id=$1::uuid", stocktakeId);
      await this.audit(tx, userId, "STOCKTAKE_CANCELLED", "StocktakeSession", stocktakeId, { reason: note || null });
      return { stocktakeId, status: "CANCELLED", idempotentReplay: false };
    });
  }

  async releaseExpired(userId: string, workspaceId: string, limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new BadRequestException("limit must be between 1 and 500");
    const db = await this.db(userId, workspaceId);
    return db.$transaction(async tx => {
      const due = await tx.$queryRawUnsafe<ReservationRow[]>(
        `SELECT id::text,warehouse_id::text,variant_id::text,quantity::text,status,expires_at
         FROM stock_reservations
         WHERE status='ACTIVE' AND expires_at <= NOW()
         ORDER BY expires_at
         LIMIT $1 FOR UPDATE SKIP LOCKED`,
        limit,
      );
      let released = 0;
      for (const reservation of due) {
        const result = await this.releaseInTransaction(tx, reservation, userId);
        if (result.changed) released++;
      }
      return { processed: due.length, released };
    });
  }
}
