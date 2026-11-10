import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { WorkspaceDatabaseRegistry } from "../../database/workspace-database.registry";

const PRODUCT_STATUSES = new Set(["DRAFT", "ACTIVE", "ARCHIVED"]);

type ProductVariantSummary = {
  id: string;
  sku: string;
  title: string;
  barcode: string | null;
  status: string;
  baseUom: { id: string; code: string; name: string; symbol: string };
  barcodes: Array<{ barcode: string; symbology: string }>;
};

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  variantCount: number;
  variants: ProductVariantSummary[];
};

type ProductDetailRow = Omit<ProductRow, "variantCount"> & {
  variants: ProductVariantSummary[];
};

type ProductLookupRow = {
  product: {
    id: string;
    name: string;
    description: string | null;
    status: string;
  };
  variant: ProductVariantSummary;
};

export type ProductListQuery = {
  search?: string;
  status?: string;
  storeId?: string;
  page?: string;
  pageSize?: string;
};

@Injectable()
export class ProductQueryService {
  constructor(private readonly databases: WorkspaceDatabaseRegistry) {}

  private db(userId: string, workspaceId: string): Promise<PrismaClient> {
    return this.databases.forMembership(userId, workspaceId);
  }

  private uuid(value: string, field: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException(`${field} must be a valid UUID`);
    }
    return value;
  }

  private pagination(value: string | undefined, fallback: number, maximum: number, field: string): number {
    if (value === undefined || value === "") return fallback;
    if (!/^\d+$/.test(value)) throw new BadRequestException(`${field} must be a positive integer`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
      throw new BadRequestException(`${field} must be between 1 and ${maximum}`);
    }
    return parsed;
  }

  async listProducts(userId: string, workspaceId: string, query: ProductListQuery) {
    const page = this.pagination(query.page, 1, 1_000_000, "page");
    const pageSize = this.pagination(query.pageSize, 25, 100, "pageSize");
    const search = query.search?.trim();
    if (search && search.length > 160) {
      throw new BadRequestException("search must not exceed 160 characters");
    }

    const filters: Prisma.Sql[] = [];
    if (query.status) {
      const status = query.status.trim().toUpperCase();
      if (!PRODUCT_STATUSES.has(status)) {
        throw new BadRequestException("status must be DRAFT, ACTIVE or ARCHIVED");
      }
      filters.push(Prisma.sql`p.status = ${status}::"ProductStatus"`);
    }
    if (query.storeId) {
      const storeId = this.uuid(query.storeId, "storeId");
      filters.push(Prisma.sql`EXISTS (
        SELECT 1 FROM store_products sp
        WHERE sp.product_id = p.id AND sp.store_id = ${storeId}::uuid
          AND sp.archived_at IS NULL
      )`);
    }
    if (search) {
      const pattern = `%${search}%`;
      filters.push(Prisma.sql`(
        p.name ILIKE ${pattern}
        OR COALESCE(p.description, '') ILIKE ${pattern}
        OR EXISTS (
          SELECT 1 FROM product_variants v
          WHERE v.product_id = p.id
            AND (v.sku ILIKE ${pattern} OR v.title ILIKE ${pattern}
              OR COALESCE(v.barcode, '') ILIKE ${pattern}
              OR EXISTS (
                SELECT 1 FROM variant_barcodes vb
                WHERE vb.variant_id = v.id AND vb.barcode ILIKE ${pattern}
              ))
        )
      )`);
    }

    const where = filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}` : Prisma.empty;
    const offset = (page - 1) * pageSize;
    const db = await this.db(userId, workspaceId);

    const [rows, countRows] = await Promise.all([
      db.$queryRaw<ProductRow[]>(Prisma.sql`
        SELECT p.id, p.name, p.description, p.status,
          p.created_at AS "createdAt", p.updated_at AS "updatedAt",
          p.archived_at AS "archivedAt",
          (SELECT COUNT(*)::int FROM product_variants vc WHERE vc.product_id = p.id) AS "variantCount",
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', v.id, 'sku', v.sku, 'title', v.title, 'barcode', v.barcode,
              'status', v.status,
              'baseUom', jsonb_build_object('id', u.id, 'code', u.code, 'name', u.name, 'symbol', u.symbol),
              'barcodes', COALESCE((
                SELECT jsonb_agg(jsonb_build_object('barcode', vb.barcode, 'symbology', vb.symbology) ORDER BY vb.created_at)
                FROM variant_barcodes vb WHERE vb.variant_id = v.id
              ), '[]'::jsonb)
            ) ORDER BY v.created_at, v.sku)
            FROM product_variants v
            JOIN unit_of_measures u ON u.id = v.base_uom_id
            WHERE v.product_id = p.id
          ), '[]'::jsonb) AS variants
        FROM products p
        ${where}
        ORDER BY p.created_at DESC, p.name ASC, p.id ASC
        LIMIT ${pageSize} OFFSET ${offset}
      `),
      db.$queryRaw<Array<{ total: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS total FROM products p ${where}
      `),
    ]);

    const total = countRows[0]?.total ?? 0;
    return {
      items: rows,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async getProduct(userId: string, workspaceId: string, productId: string): Promise<ProductDetailRow> {
    const id = this.uuid(productId, "productId");
    const db = await this.db(userId, workspaceId);
    const rows = await db.$queryRaw<ProductDetailRow[]>(Prisma.sql`
      SELECT p.id, p.name, p.description, p.status,
        p.created_at AS "createdAt", p.updated_at AS "updatedAt",
        p.archived_at AS "archivedAt",
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', v.id, 'sku', v.sku, 'title', v.title, 'barcode', v.barcode,
            'status', v.status, 'attributes', v.attributes,
            'baseUom', jsonb_build_object('id', u.id, 'code', u.code, 'name', u.name, 'symbol', u.symbol),
            'barcodes', COALESCE((
              SELECT jsonb_agg(jsonb_build_object('barcode', vb.barcode, 'symbology', vb.symbology) ORDER BY vb.created_at)
              FROM variant_barcodes vb WHERE vb.variant_id = v.id
            ), '[]'::jsonb)
          ) ORDER BY v.created_at, v.sku)
          FROM product_variants v
          JOIN unit_of_measures u ON u.id = v.base_uom_id
          WHERE v.product_id = p.id
        ), '[]'::jsonb) AS variants
      FROM products p
      WHERE p.id = ${id}::uuid
      LIMIT 1
    `);
    if (!rows.length) throw new NotFoundException("Product not found");
    return rows[0];
  }

  async lookupProduct(userId: string, workspaceId: string, codeValue: string): Promise<ProductLookupRow> {
    const code = codeValue?.trim();
    if (!code || code.length > 128) {
      throw new BadRequestException("code is required and must not exceed 128 characters");
    }
    const db = await this.db(userId, workspaceId);
    const rows = await db.$queryRaw<ProductLookupRow[]>(Prisma.sql`
      SELECT jsonb_build_object(
          'id', p.id, 'name', p.name, 'description', p.description, 'status', p.status
        ) AS product,
        jsonb_build_object(
          'id', v.id, 'sku', v.sku, 'title', v.title, 'barcode', v.barcode,
          'status', v.status,
          'baseUom', jsonb_build_object('id', u.id, 'code', u.code, 'name', u.name, 'symbol', u.symbol),
          'barcodes', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('barcode', vb.barcode, 'symbology', vb.symbology) ORDER BY vb.created_at)
            FROM variant_barcodes vb WHERE vb.variant_id = v.id
          ), '[]'::jsonb)
        ) AS variant
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      JOIN unit_of_measures u ON u.id = v.base_uom_id
      WHERE UPPER(v.sku) = UPPER(${code})
        OR UPPER(v.normalized_sku) = UPPER(${code})
        OR UPPER(COALESCE(v.barcode, '')) = UPPER(${code})
        OR EXISTS (
          SELECT 1 FROM variant_barcodes vb
          WHERE vb.variant_id = v.id
            AND (UPPER(vb.barcode) = UPPER(${code}) OR UPPER(vb.normalized) = UPPER(${code}))
        )
      ORDER BY
        CASE WHEN UPPER(v.sku) = UPPER(${code}) OR UPPER(v.normalized_sku) = UPPER(${code}) THEN 0 ELSE 1 END,
        p.name ASC, v.sku ASC
      LIMIT 1
    `);
    if (!rows.length) throw new NotFoundException("No product variant matches this SKU or barcode");
    return rows[0];
  }

  async listUnits(userId: string, workspaceId: string) {
    const db = await this.db(userId, workspaceId);
    return db.$queryRaw<Array<{
      id: string; code: string; name: string; symbol: string; dimension: string; decimalPlaces: number; status: string;
    }>>`
      SELECT id, code, name, symbol, dimension, decimal_places AS "decimalPlaces", status::text AS status
      FROM unit_of_measures
      WHERE status = 'ACTIVE'
      ORDER BY code ASC, name ASC
    `;
  }
}
