import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { WorkspaceDatabaseRegistry } from "../../database/workspace-database.registry";
import { ProductQueryService } from "./product-query.service";

const WRITABLE_STATUSES = new Set(["DRAFT", "ACTIVE"]);

export type CreateProductInput = {
  name?: string;
  description?: string | null;
  status?: string;
  variant?: { sku?: string; title?: string; barcode?: string | null; uomCode?: string };
};

export type UpdateProductInput = {
  name?: string;
  description?: string | null;
  status?: string;
  variant?: { id?: string; sku?: string; title?: string; barcode?: string | null };
};

type VariantRow = {
  id: string;
  sku: string;
  title: string;
  barcode: string | null;
  status: string;
};

@Injectable()
export class ProductCommandService {
  constructor(
    private readonly databases: WorkspaceDatabaseRegistry,
    private readonly queries: ProductQueryService,
  ) {}

  async createProduct(userId: string, workspaceId: string, input: CreateProductInput) {
    const name = this.name(input?.name);
    const description = this.description(input?.description);
    const status = this.writableStatus(input?.status, "DRAFT");
    const variant = input?.variant;
    if (!variant || typeof variant !== "object") throw new BadRequestException("ต้องระบุ Variant เริ่มต้น");
    const sku = this.sku(variant.sku);
    const title = this.title(variant.title, name);
    const barcode = this.barcode(variant.barcode);
    const uomCode = this.requiredCode(variant.uomCode, "หน่วยนับ");
    const db = await this.databases.forMembership(userId, workspaceId);
    const productId = await this.write(db, async (tx) => {
      const uom = await this.activeUom(tx, uomCode);
      const inserted = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO products (id, name, description, status, normalized_name, updated_at)
        VALUES (gen_random_uuid(), ${name}, ${description}, ${status}::"ProductStatus", ${name.toLowerCase()}, NOW())
        RETURNING id
      `;
      const id = inserted[0].id;
      const variantRows = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO product_variants
          (id, product_id, base_uom_id, sku, normalized_sku, title, barcode, status, updated_at)
        VALUES (
          gen_random_uuid(), ${id}::uuid, ${uom.id}::uuid, ${sku.value}, ${sku.normalized},
          ${title}, ${barcode?.value ?? null}, ${status}::"ProductStatus", NOW()
        )
        RETURNING id
      `;
      const variantId = variantRows[0].id;
      await tx.$executeRaw`
        INSERT INTO variant_uoms (id, variant_id, uom_id, usage, conversion_to_base, status, updated_at)
        VALUES (gen_random_uuid(), ${variantId}::uuid, ${uom.id}::uuid, 'BASE', 1, 'ACTIVE', NOW())
      `;
      if (barcode) await this.insertBarcode(tx, variantId, barcode);
      await this.audit(tx, userId, "PRODUCT_CREATED", id, null, { name, description, status, sku: sku.value, barcode: barcode?.value ?? null, uomCode: uom.code });
      return id;
    });
    return this.queries.getProduct(userId, workspaceId, productId);
  }

  async updateProduct(userId: string, workspaceId: string, productId: string, input: UpdateProductInput) {
    const id = this.uuid(productId, "productId");
    const name = this.name(input?.name);
    const description = this.description(input?.description);
    const status = this.writableStatus(input?.status, "");
    const variant = input?.variant;
    if (!variant || typeof variant !== "object") throw new BadRequestException("ต้องระบุ Variant ที่จะแก้ไข");
    const variantId = this.uuid(variant.id, "variant.id");
    const sku = this.sku(variant.sku);
    const title = this.title(variant.title, name);
    const barcode = this.barcode(variant.barcode);
    const db = await this.databases.forMembership(userId, workspaceId);
    await this.write(db, async (tx) => {
      const before = await this.lockProduct(tx, id);
      if (before.status === "ARCHIVED") throw new ConflictException("สินค้าที่เก็บถาวรแล้วแก้ไขไม่ได้");
      const previous = await this.lockVariant(tx, id, variantId);
      await tx.$executeRaw`
        UPDATE products
        SET name = ${name}, description = ${description}, status = ${status}::"ProductStatus",
          normalized_name = ${name.toLowerCase()}, updated_at = NOW()
        WHERE id = ${id}::uuid
      `;
      await tx.$executeRaw`
        UPDATE product_variants
        SET sku = ${sku.value}, normalized_sku = ${sku.normalized}, title = ${title},
          barcode = ${barcode?.value ?? null}, status = ${status}::"ProductStatus", updated_at = NOW()
        WHERE id = ${variantId}::uuid AND product_id = ${id}::uuid
      `;
      if (previous.barcode && previous.barcode.trim().toLowerCase() !== (barcode?.normalized ?? "")) {
        await tx.$executeRaw`
          DELETE FROM variant_barcodes
          WHERE variant_id = ${variantId}::uuid
            AND normalized = ${previous.barcode.trim().toLowerCase()}
        `;
      }
      if (barcode) {
        const matches = await tx.$queryRaw<Array<{ variantId: string }>>`
          SELECT variant_id AS "variantId"
          FROM variant_barcodes
          WHERE normalized = ${barcode.normalized}
          FOR UPDATE
        `;
        if (matches.length && matches[0].variantId !== variantId) {
          throw new ConflictException("บาร์โค้ดนี้ถูกใช้แล้ว");
        }
        if (matches.length) {
          const symbology = /^\d{13}$/.test(barcode.value) ? "EAN13" : "CODE128";
          await tx.$executeRaw`
            UPDATE variant_barcodes
            SET barcode = ${barcode.value}, symbology = ${symbology}
            WHERE variant_id = ${variantId}::uuid
              AND normalized = ${barcode.normalized}
          `;
        } else {
          await this.insertBarcode(tx, variantId, barcode);
        }
      }
      await this.audit(tx, userId, "PRODUCT_UPDATED", id, {
        name: before.name, description: before.description, status: before.status,
        sku: previous.sku, title: previous.title, barcode: previous.barcode,
      }, { name, description, status, sku: sku.value, title, barcode: barcode?.value ?? null });
      return id;
    });
    return this.queries.getProduct(userId, workspaceId, id);
  }

  async archiveProduct(userId: string, workspaceId: string, productId: string, reason?: string) {
    const id = this.uuid(productId, "productId");
    const note = this.reason(reason);
    const db = await this.databases.forMembership(userId, workspaceId);
    await this.write(db, async (tx) => {
      const before = await this.lockProduct(tx, id);
      if (before.status === "ARCHIVED") return id;
      await tx.$executeRaw`
        UPDATE products
        SET status = 'ARCHIVED', archived_at = NOW(), updated_at = NOW()
        WHERE id = ${id}::uuid
      `;
      await tx.$executeRaw`
        UPDATE product_variants
        SET status = 'ARCHIVED', archived_at = NOW(), updated_at = NOW()
        WHERE product_id = ${id}::uuid AND status <> 'ARCHIVED'
      `;
      await this.audit(tx, userId, "PRODUCT_ARCHIVED", id, { status: before.status, name: before.name }, { status: "ARCHIVED" }, note);
      return id;
    });
    return this.queries.getProduct(userId, workspaceId, id);
  }

  private async write(db: PrismaClient, work: (tx: PrismaClient) => Promise<string>): Promise<string> {
    try {
      return await db.$transaction(work);
    } catch (error) {
      const text = JSON.stringify(error);
      if (text.includes("23505") || text.includes("Unique constraint")) {
        if (text.includes("normalized_sku") || text.includes("product_variants_sku")) {
          throw new ConflictException("SKU นี้มีอยู่ใน Workspace แล้ว");
        }
        if (text.includes("variant_barcodes") || text.includes("barcode") || text.includes("normalized")) {
          throw new ConflictException("บาร์โค้ดนี้ถูกใช้แล้ว");
        }
        throw new ConflictException("ข้อมูลซ้ำกับรายการที่มีอยู่");
      }
      throw error;
    }
  }

  private async activeUom(tx: PrismaClient, code: string) {
    const rows = await tx.$queryRaw<Array<{ id: string; code: string; status: string }>>`
      SELECT id, code, status::text AS status
      FROM unit_of_measures
      WHERE normalized_code = ${code.toLowerCase()}
      FOR SHARE
    `;
    if (!rows.length) throw new NotFoundException("ไม่พบหน่วยนับที่ระบุ");
    if (rows[0].status !== "ACTIVE") throw new ConflictException("หน่วยนับนี้ไม่พร้อมใช้งาน");
    return rows[0];
  }

  private async lockProduct(tx: PrismaClient, id: string) {
    const rows = await tx.$queryRaw<Array<{ id: string; name: string; description: string | null; status: string }>>`
      SELECT id, name, description, status::text AS status
      FROM products WHERE id = ${id}::uuid
      FOR UPDATE
    `;
    if (!rows.length) throw new NotFoundException("ไม่พบสินค้า");
    return rows[0];
  }

  private async lockVariant(tx: PrismaClient, productId: string, variantId: string): Promise<VariantRow> {
    const rows = await tx.$queryRaw<VariantRow[]>`
      SELECT id, sku, title, barcode, status::text AS status
      FROM product_variants
      WHERE id = ${variantId}::uuid AND product_id = ${productId}::uuid
      FOR UPDATE
    `;
    if (!rows.length) throw new NotFoundException("ไม่พบ Variant ของสินค้านี้");
    return rows[0];
  }

  private async insertBarcode(tx: PrismaClient, variantId: string, barcode: { value: string; normalized: string }) {
    const symbology = /^\d{13}$/.test(barcode.value) ? "EAN13" : "CODE128";
    await tx.$executeRaw`
      INSERT INTO variant_barcodes (id, variant_id, barcode, normalized, symbology)
      VALUES (gen_random_uuid(), ${variantId}::uuid, ${barcode.value}, ${barcode.normalized}, ${symbology})
    `;
  }

  private async audit(tx: PrismaClient, userId: string, action: string, productId: string, before: unknown, after: unknown, reason = "Catalog product change") {
    await tx.$executeRaw`
      INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, reason, "before", "after")
      VALUES (
        gen_random_uuid(), ${userId}::uuid, ${action}, 'Product', ${productId}::uuid, ${reason},
        ${before === null ? null : JSON.stringify(before)}::jsonb,
        ${JSON.stringify(after)}::jsonb
      )
    `;
  }

  private name(value: string | undefined): string {
    const name = value?.trim() ?? "";
    if (!name || name.length > 200) throw new BadRequestException("ชื่อสินค้าต้องมี 1–200 ตัวอักษร");
    return name;
  }

  private description(value: string | null | undefined): string | null {
    if (value === undefined || value === null) return null;
    const description = value.trim();
    if (!description) return null;
    if (description.length > 10000) throw new BadRequestException("รายละเอียดสินค้ายาวเกินไป");
    return description;
  }

  private writableStatus(value: string | undefined, fallback: string): string {
    const status = (value?.trim() || fallback).toUpperCase();
    if (!WRITABLE_STATUSES.has(status)) throw new BadRequestException("สถานะต้องเป็น DRAFT หรือ ACTIVE");
    return status;
  }

  private title(value: string | undefined, fallback: string): string {
    const title = (value?.trim() || fallback).slice(0, 160);
    if (!title) throw new BadRequestException("ต้องระบุชื่อ Variant");
    return title;
  }

  private sku(value: string | undefined): { value: string; normalized: string } {
    const sku = value?.trim() ?? "";
    if (!sku || sku.length > 100) throw new BadRequestException("SKU ต้องมี 1–100 ตัวอักษร");
    return { value: sku, normalized: sku.toLowerCase() };
  }

  private barcode(value: string | null | undefined): { value: string; normalized: string } | null {
    if (value === undefined || value === null) return null;
    const barcode = value.trim();
    if (!barcode) return null;
    if (barcode.length > 128 || !/^[0-9A-Za-z._-]+$/.test(barcode)) {
      throw new BadRequestException("บาร์โค้ดใช้ได้เฉพาะตัวอักษร ตัวเลข จุด ขีดล่าง และขีดกลาง ไม่เกิน 128 ตัว");
    }
    return { value: barcode, normalized: barcode.toLowerCase() };
  }

  private requiredCode(value: string | undefined, label: string): string {
    const code = value?.trim() ?? "";
    if (!code || code.length > 32) throw new BadRequestException(`${label}ไม่ถูกต้อง`);
    return code;
  }

  private reason(value: string | undefined): string {
    const reason = value?.trim() || "เก็บสินค้าเข้าคลัง";
    if (reason.length > 1000) throw new BadRequestException("เหตุผลยาวเกินไป");
    return reason;
  }

  private uuid(value: string | undefined, field: string): string {
    if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException(`${field} must be a valid UUID`);
    }
    return value;
  }
}
