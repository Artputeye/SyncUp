import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { WorkspaceDatabaseRegistry } from "../../database/workspace-database.registry";

type PaymentMethod = "CASH" | "CARD" | "BANK_TRANSFER" | "OTHER";
const METHODS = new Set<PaymentMethod>(["CASH", "CARD", "BANK_TRANSFER", "OTHER"]);
function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new BadRequestException(field + " must be a valid UUID");
  return value.toLowerCase();
}
function keyValue(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 140) throw new BadRequestException("Idempotency-Key is required and must not exceed 140 characters");
  return value.trim();
}
function money(value: unknown): string {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,17})(?:\.\d{1,4})?$/.test(value) || !/[1-9]/.test(value)) throw new BadRequestException("Amount must be a positive Decimal string with at most 4 decimal places");
  const [whole, fraction = ""] = value.split(".");
  return whole + "." + fraction.padEnd(4, "0");
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value as Record<string, unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+":"+canonical(v)).join(",") + "}";
  return JSON.stringify(value);
}
function uniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; meta?: { code?: string; message?: string } };
  return e?.code === "P2002" || e?.meta?.code === "23505" || (typeof e?.meta?.message === "string" && e.meta.message.includes("23505"));
}

@Injectable()
export class SalesPaymentsService {
  constructor(private readonly databases: WorkspaceDatabaseRegistry) {}
  private db(userId: string, workspaceId: string): Promise<PrismaClient> { return this.databases.forMembership(userId, workspaceId); }

  async recordPayment(userId: string, workspaceId: string, orderIdValue: unknown, input: {
    method: unknown; amount: unknown; idempotencyKey: unknown; externalReference?: unknown;
  }) {
    const orderId = uuid(orderIdValue, "orderId"), key = keyValue(input?.idempotencyKey), amount = money(input?.amount);
    if (typeof input?.method !== "string" || !METHODS.has(input.method as PaymentMethod)) throw new BadRequestException("Unsupported payment method");
    const method = input.method as PaymentMethod;
    if (input.externalReference != null && typeof input.externalReference !== "string") throw new BadRequestException("externalReference must be a string");
    const externalReference = typeof input.externalReference === "string" ? input.externalReference.trim() || null : null;
    if (externalReference && externalReference.length > 160) throw new BadRequestException("externalReference must not exceed 160 characters");
    const payload = { orderId, method, amount, externalReference };
    const db = await this.db(userId, workspaceId);
    const replay = await db.$queryRawUnsafe<Array<{ id: string; order_id: string; idempotency_payload: unknown }>>("SELECT id::text,order_id::text,idempotency_payload FROM sales_payments WHERE idempotency_key=$1", key);
    if (replay.length) {
      if (replay[0].order_id !== orderId || canonical(replay[0].idempotency_payload) !== canonical(payload)) throw new ConflictException("Payment idempotency key was used with a different payload");
      return { ...(await this.paymentDetail(db, replay[0].id)), idempotentReplay: true };
    }
    const id = randomUUID();
    try {
      await db.$transaction(async tx => {
        const orders = await tx.$queryRawUnsafe<Array<{ id: string; status: string; currency: string; total_amount: string }>>("SELECT id::text,status::text,currency,total_amount::text FROM sales_orders WHERE id=$1::uuid FOR UPDATE", orderId);
        if (!orders.length) throw new NotFoundException("Sales Order not found");
        const order = orders[0];
        if (order.status !== "POSTED") throw new ConflictException("Payment can only be recorded for a POSTED Order");
        const paid = await tx.$queryRawUnsafe<Array<{ amount: string }>>("SELECT COALESCE(SUM(amount),0)::text AS amount FROM sales_payments WHERE order_id=$1::uuid", orderId);
        const allowed = await tx.$queryRawUnsafe<Array<{ valid: boolean }>>("SELECT $1::numeric+$2::numeric<=$3::numeric AS valid", paid[0].amount, amount, order.total_amount);
        if (!allowed[0].valid) throw new ConflictException("Payment exceeds the remaining amount due on this Order");
        const sequence = await tx.$queryRawUnsafe<Array<{ n: string }>>("SELECT COUNT(*)+1 AS n FROM sales_payments WHERE order_id=$1::uuid", orderId);
        const number = "PAY-" + orderId.slice(0,8).toUpperCase() + "-" + String(sequence[0].n).padStart(4,"0");
        await tx.$executeRawUnsafe(
          `INSERT INTO sales_payments (id,order_id,payment_number,method,status,currency,amount,refunded_amount,external_reference,idempotency_key,idempotency_payload,received_by) VALUES ($1::uuid,$2::uuid,$3,$4::"SalesPaymentMethod",'CAPTURED',$5,$6::numeric,0,$7,$8,$9::jsonb,$10::uuid)`,
          id, orderId, number, method, order.currency, amount, externalReference, key, JSON.stringify(payload), userId,
        );
        await tx.$executeRawUnsafe("INSERT INTO audit_events (id,actor_id,action,resource_type,resource_id,metadata) VALUES ($1::uuid,$2::uuid,'SALES_PAYMENT_RECORDED','SalesPayment',$3,$4::jsonb)", randomUUID(), userId, id, JSON.stringify({ orderId, paymentNumber: number, method, amount, currency: order.currency }));
      });
    } catch (error) {
      if (uniqueViolation(error)) {
        const raced = await db.$queryRawUnsafe<Array<{ id: string; order_id: string; idempotency_payload: unknown }>>("SELECT id::text,order_id::text,idempotency_payload FROM sales_payments WHERE idempotency_key=$1", key);
        if (raced.length && raced[0].order_id === orderId && canonical(raced[0].idempotency_payload) === canonical(payload)) return { ...(await this.paymentDetail(db, raced[0].id)), idempotentReplay: true };
        throw new ConflictException("Payment idempotency key has already been used");
      }
      throw error;
    }
    return { ...(await this.paymentDetail(db, id)), idempotentReplay: false };
  }

  async listPayments(userId: string, workspaceId: string, orderIdValue: unknown) {
    const orderId = uuid(orderIdValue, "orderId"), db = await this.db(userId, workspaceId);
    const order = await db.$queryRawUnsafe<Array<{ id: string }>>("SELECT id::text FROM sales_orders WHERE id=$1::uuid", orderId);
    if (!order.length) throw new NotFoundException("Sales Order not found");
    const items = await db.$queryRawUnsafe<Array<Record<string, unknown>>>("SELECT id::text,order_id::text,payment_number,method::text,status::text,currency,amount::text,refunded_amount::text,external_reference,received_at FROM sales_payments WHERE order_id=$1::uuid ORDER BY received_at,id", orderId);
    return { items };
  }

  async createRefund(userId: string, workspaceId: string, orderIdValue: unknown, returnIdValue: unknown, input: {
    paymentId: unknown; amount: unknown; idempotencyKey: unknown; reason?: unknown;
  }) {
    const orderId=uuid(orderIdValue,"orderId"), returnId=uuid(returnIdValue,"returnId"), paymentId=uuid(input?.paymentId,"paymentId"), key=keyValue(input?.idempotencyKey), amount=money(input?.amount);
    if (input.reason != null && typeof input.reason !== "string") throw new BadRequestException("reason must be a string");
    const reason=typeof input.reason==="string"?input.reason.trim()||null:null;
    if (reason && reason.length>500) throw new BadRequestException("reason must not exceed 500 characters");
    const payload={orderId,returnId,paymentId,amount,reason}, db=await this.db(userId,workspaceId);
    const replay=await db.$queryRawUnsafe<Array<{id:string;return_id:string;payment_id:string;idempotency_payload:unknown}>>("SELECT id::text,return_id::text,payment_id::text,idempotency_payload FROM sales_refunds WHERE idempotency_key=$1",key);
    if(replay.length){
      if(replay[0].return_id!==returnId||replay[0].payment_id!==paymentId||canonical(replay[0].idempotency_payload)!==canonical(payload))throw new ConflictException("Refund idempotency key was used with a different payload");
      return {...(await this.refundDetail(db,replay[0].id)),idempotentReplay:true};
    }
    const id=randomUUID();
    try{
      await db.$transaction(async tx=>{
        const orders=await tx.$queryRawUnsafe<Array<{id:string;status:string;currency:string}>>("SELECT id::text,status::text,currency FROM sales_orders WHERE id=$1::uuid FOR UPDATE",orderId);
        if(!orders.length)throw new NotFoundException("Sales Order not found");
        if(orders[0].status!=="POSTED")throw new ConflictException("Refund requires a POSTED Order");
        const returns=await tx.$queryRawUnsafe<Array<{id:string;status:string;currency:string;total_amount:string}>>("SELECT id::text,status,currency,total_amount::text FROM sales_returns WHERE id=$1::uuid AND order_id=$2::uuid FOR UPDATE",returnId,orderId);
        if(!returns.length)throw new NotFoundException("Sales Return not found for this Order");
        if(returns[0].status!=="POSTED")throw new ConflictException("Refund requires a POSTED Sales Return");
        const payments=await tx.$queryRawUnsafe<Array<{id:string;currency:string;amount:string;refunded_amount:string}>>("SELECT id::text,currency,amount::text,refunded_amount::text FROM sales_payments WHERE id=$1::uuid AND order_id=$2::uuid FOR UPDATE",paymentId,orderId);
        if(!payments.length)throw new NotFoundException("Payment not found for this Order");
        if(payments[0].currency!==returns[0].currency)throw new ConflictException("Payment and Return currencies do not match");
        const totals=await tx.$queryRawUnsafe<Array<{return_refunded:string;payment_refundable:string}>>(
          "SELECT COALESCE((SELECT SUM(amount) FROM sales_refunds WHERE return_id=$1::uuid),0)::text AS return_refunded,"+
          "($2::numeric-$3::numeric)::text AS payment_refundable",returnId,payments[0].amount,payments[0].refunded_amount);
        const checks=await tx.$queryRawUnsafe<Array<{return_valid:boolean;payment_valid:boolean}>>(
          "SELECT $1::numeric+$3::numeric<=$2::numeric AS return_valid,$3::numeric<=$4::numeric AS payment_valid",
          totals[0].return_refunded,returns[0].total_amount,amount,totals[0].payment_refundable);
        if(!checks[0].return_valid)throw new ConflictException("Refund exceeds the remaining refundable amount of this Return");
        if(!checks[0].payment_valid)throw new ConflictException("Refund exceeds the unrefunded balance of this Payment");
        const sequence=await tx.$queryRawUnsafe<Array<{n:string}>>("SELECT COUNT(*)+1 AS n FROM sales_refunds WHERE return_id=$1::uuid",returnId);
        const number="RFD-"+returnId.slice(0,8).toUpperCase()+"-"+String(sequence[0].n).padStart(4,"0");
        await tx.$executeRawUnsafe("INSERT INTO sales_refunds (id,payment_id,return_id,refund_number,status,currency,amount,idempotency_key,idempotency_payload,reason,refunded_by) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,'POSTED',$5,$6::numeric,$7,$8::jsonb,$9,$10::uuid)",
          id,paymentId,returnId,number,returns[0].currency,amount,key,JSON.stringify(payload),reason,userId);
        await tx.$executeRawUnsafe(`UPDATE sales_payments SET refunded_amount=refunded_amount+$2::numeric,status=CASE WHEN refunded_amount+$2::numeric=amount THEN 'REFUNDED'::"SalesPaymentStatus" ELSE 'PARTIALLY_REFUNDED'::"SalesPaymentStatus" END WHERE id=$1::uuid`,paymentId,amount);
        await tx.$executeRawUnsafe("INSERT INTO audit_events (id,actor_id,action,resource_type,resource_id,metadata) VALUES ($1::uuid,$2::uuid,'SALES_REFUND_POSTED','SalesRefund',$3,$4::jsonb)",randomUUID(),userId,id,JSON.stringify({orderId,returnId,paymentId,refundNumber:number,amount,currency:returns[0].currency,reason}));
      });
    }catch(error){
      if(uniqueViolation(error)){
        const raced=await db.$queryRawUnsafe<Array<{id:string;return_id:string;payment_id:string;idempotency_payload:unknown}>>("SELECT id::text,return_id::text,payment_id::text,idempotency_payload FROM sales_refunds WHERE idempotency_key=$1",key);
        if(raced.length&&raced[0].return_id===returnId&&raced[0].payment_id===paymentId&&canonical(raced[0].idempotency_payload)===canonical(payload))return {...(await this.refundDetail(db,raced[0].id)),idempotentReplay:true};
        throw new ConflictException("Refund idempotency key has already been used");
      }
      throw error;
    }
    return {...(await this.refundDetail(db,id)),idempotentReplay:false};
  }

  async listRefunds(userId:string,workspaceId:string,orderIdValue:unknown,returnIdValue:unknown){
    const orderId=uuid(orderIdValue,"orderId"),returnId=uuid(returnIdValue,"returnId"),db=await this.db(userId,workspaceId);
    const rows=await db.$queryRawUnsafe<Array<{id:string}>>("SELECT id::text FROM sales_returns WHERE id=$1::uuid AND order_id=$2::uuid",returnId,orderId);
    if(!rows.length)throw new NotFoundException("Sales Return not found for this Order");
    const items=await db.$queryRawUnsafe<Array<Record<string,unknown>>>("SELECT id::text,payment_id::text,return_id::text,refund_number,status,currency,amount::text,reason,refunded_at FROM sales_refunds WHERE return_id=$1::uuid ORDER BY refunded_at,id",returnId);
    return {items};
  }

  private async paymentDetail(db:PrismaClient,id:string){
    const rows=await db.$queryRawUnsafe<Array<Record<string,unknown>>>("SELECT id::text,order_id::text,payment_number,method::text,status::text,currency,amount::text,refunded_amount::text,external_reference,received_by::text,received_at FROM sales_payments WHERE id=$1::uuid",id);
    if(!rows.length)throw new NotFoundException("Payment not found");
    return rows[0];
  }
  private async refundDetail(db:PrismaClient,id:string){
    const rows=await db.$queryRawUnsafe<Array<Record<string,unknown>>>("SELECT id::text,payment_id::text,return_id::text,refund_number,status,currency,amount::text,reason,refunded_by::text,refunded_at FROM sales_refunds WHERE id=$1::uuid",id);
    if(!rows.length)throw new NotFoundException("Refund not found");
    return rows[0];
  }
}
