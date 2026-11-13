import {
  BadRequestException,
  ConflictException,
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
  taxCategoryId: string | null;
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
    const taxCategoryExpression = await this.taxCategoryExpression(db);

    const [rows, countRows] = await Promise.all([
      db.$queryRaw<ProductRow[]>(Prisma.sql`
        SELECT p.id, p.name, p.description, p.status,
          p.created_at AS "createdAt", p.updated_at AS "updatedAt",
          p.archived_at AS "archivedAt",
          (SELECT COUNT(*)::int FROM product_variants vc WHERE vc.product_id = p.id) AS "variantCount",
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', v.id, 'sku', v.sku, 'title', v.title, 'barcode', v.barcode,
              'status', v.status, 'taxCategoryId', ${taxCategoryExpression},
              'baseUom', jsonb_build_object('id', u.id, 'code', u.code, 'name', u.name, 'symbol', u.symbol),
              'sellUoms', COALESCE((
                SELECT jsonb_agg(jsonb_build_object('id', vu.id, 'uomId', vu.uom_id, 'code', su.code, 'name', su.name, 'usage', vu.usage, 'conversionToBase', vu.conversion_to_base::text) ORDER BY CASE vu.usage WHEN 'BASE' THEN 0 ELSE 1 END, su.code)
                FROM variant_uoms vu JOIN unit_of_measures su ON su.id = vu.uom_id
                WHERE vu.variant_id = v.id AND vu.status = 'ACTIVE' AND su.status = 'ACTIVE'
                  AND vu.usage IN ('BASE', 'SELL', 'SELL_AND_PURCHASE')
              ), '[]'::jsonb),
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
    const taxCategoryExpression = await this.taxCategoryExpression(db);
    const rows = await db.$queryRaw<ProductDetailRow[]>(Prisma.sql`
      SELECT p.id, p.name, p.description, p.status,
        p.created_at AS "createdAt", p.updated_at AS "updatedAt",
        p.archived_at AS "archivedAt",
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', v.id, 'sku', v.sku, 'title', v.title, 'barcode', v.barcode,
            'status', v.status, 'attributes', v.attributes, 'taxCategoryId', ${taxCategoryExpression},
            'baseUom', jsonb_build_object('id', u.id, 'code', u.code, 'name', u.name, 'symbol', u.symbol),
              'sellUoms', COALESCE((
                SELECT jsonb_agg(jsonb_build_object('id', vu.id, 'uomId', vu.uom_id, 'code', su.code, 'name', su.name, 'usage', vu.usage, 'conversionToBase', vu.conversion_to_base::text) ORDER BY CASE vu.usage WHEN 'BASE' THEN 0 ELSE 1 END, su.code)
                FROM variant_uoms vu JOIN unit_of_measures su ON su.id = vu.uom_id
                WHERE vu.variant_id = v.id AND vu.status = 'ACTIVE' AND su.status = 'ACTIVE'
                  AND vu.usage IN ('BASE', 'SELL', 'SELL_AND_PURCHASE')
              ), '[]'::jsonb),
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
    const taxCategoryExpression = await this.taxCategoryExpression(db);
    const rows = await db.$queryRaw<ProductLookupRow[]>(Prisma.sql`
      SELECT jsonb_build_object(
          'id', p.id, 'name', p.name, 'description', p.description, 'status', p.status
        ) AS product,
        jsonb_build_object(
          'id', v.id, 'sku', v.sku, 'title', v.title, 'barcode', v.barcode,
          'status', v.status, 'taxCategoryId', ${taxCategoryExpression},
          'baseUom', jsonb_build_object('id', u.id, 'code', u.code, 'name', u.name, 'symbol', u.symbol),
              'sellUoms', COALESCE((
                SELECT jsonb_agg(jsonb_build_object('id', vu.id, 'uomId', vu.uom_id, 'code', su.code, 'name', su.name, 'usage', vu.usage, 'conversionToBase', vu.conversion_to_base::text) ORDER BY CASE vu.usage WHEN 'BASE' THEN 0 ELSE 1 END, su.code)
                FROM variant_uoms vu JOIN unit_of_measures su ON su.id = vu.uom_id
                WHERE vu.variant_id = v.id AND vu.status = 'ACTIVE' AND su.status = 'ACTIVE'
                  AND vu.usage IN ('BASE', 'SELL', 'SELL_AND_PURCHASE')
              ), '[]'::jsonb),
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

  private async taxCategoryExpression(db: PrismaClient): Promise<Prisma.Sql> {
    const rows = await db.$queryRaw<Array<{ available: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'product_variants' AND column_name = 'tax_category_id'
      ) AS available
    `;
    return rows[0]?.available ? Prisma.raw("v.tax_category_id") : Prisma.raw("NULL::uuid");
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

  async listPosProducts(
    userId: string,
    workspaceId: string,
    input: { storeId?: string; branchId?: string; warehouseId?: string; search?: string },
  ) {
    const storeId = this.uuid(input.storeId ?? "", "storeId");
    const branchId = this.uuid(input.branchId ?? "", "branchId");
    const warehouseId = this.uuid(input.warehouseId ?? "", "warehouseId");
    const search = input.search?.trim() ?? "";
    if (search.length > 128) throw new BadRequestException("search must not exceed 128 characters");
    const db = await this.db(userId, workspaceId);
    const contexts = await db.$queryRaw<Array<{ currency: string; taxMode: string; priceTaxMode: string; currencyMinorUnits: number }>>`
      SELECT s.currency, tp.tax_mode::text AS "taxMode", tp.price_tax_mode::text AS "priceTaxMode",
        tp.currency_minor_units AS "currencyMinorUnits"
      FROM stores s JOIN branches b ON b.store_id=s.id JOIN warehouses w ON w.branch_id=b.id
      JOIN LATERAL (
        SELECT id,tax_mode,price_tax_mode,currency_minor_units FROM tax_profiles
        WHERE store_id=s.id AND valid_from<=NOW() AND (valid_to IS NULL OR valid_to>NOW())
        ORDER BY valid_from DESC,created_at DESC LIMIT 1
      ) tp ON TRUE
      WHERE s.id=${storeId}::uuid AND b.id=${branchId}::uuid AND w.id=${warehouseId}::uuid
        AND s.status='ACTIVE' AND b.status='ACTIVE' AND w.status='ACTIVE'
    `;
    if (!contexts.length) throw new ConflictException("An active Store, Branch, Warehouse and Tax Profile are required");
    const context = contexts[0];
    const pattern = search ? `%${search}%` : null;
    const items = await db.$queryRaw<Array<{
      productId: string; productName: string; variantId: string; variantTitle: string; sku: string;
      barcode: string | null; variantUomId: string; uomCode: string; uomName: string;
      conversionToBase: string; unitPrice: string; currency: string; taxRate: string; available: string;
    }>>`
      SELECT p.id::text AS "productId",p.name AS "productName",v.id::text AS "variantId",
        v.title AS "variantTitle",v.sku,v.barcode,vu.id::text AS "variantUomId",
        u.code AS "uomCode",u.name AS "uomName",vu.conversion_to_base::text AS "conversionToBase",
        price.amount::text AS "unitPrice",price.currency,
        CASE WHEN ${context.taxMode}='NO_VAT' THEN '0' ELSE tr.rate::text END AS "taxRate",
        TRUNC(COALESCE(sb.available,0) / vu.conversion_to_base,3)::text AS available
      FROM product_variants v JOIN products p ON p.id=v.product_id
      JOIN variant_uoms vu ON vu.variant_id=v.id AND vu.status='ACTIVE'
        AND vu.usage IN ('BASE','SELL','SELL_AND_PURCHASE')
      JOIN unit_of_measures u ON u.id=vu.uom_id AND u.status='ACTIVE'
      JOIN store_product_variants spv ON spv.variant_id=v.id AND spv.store_id=${storeId}::uuid
        AND spv.publish_status='PUBLISHED'
      JOIN store_products sp ON sp.id=spv.store_product_id AND sp.store_id=spv.store_id
        AND sp.publish_status='PUBLISHED' AND sp.archived_at IS NULL
      JOIN LATERAL (
        SELECT pp.amount,pp.currency FROM product_prices pp
        WHERE pp.store_product_variant_id=spv.id AND pp.variant_id=v.id
          AND pp.variant_uom_id=vu.id AND pp.currency=${context.currency}
          AND pp.valid_from<=NOW() AND (pp.valid_to IS NULL OR pp.valid_to>NOW())
        ORDER BY pp.valid_from DESC,pp.created_at DESC LIMIT 1
      ) price ON TRUE
      LEFT JOIN tax_categories tc ON tc.id=v.tax_category_id
      LEFT JOIN LATERAL (
        SELECT rate FROM tax_rates
        WHERE tax_profile_id=(SELECT id FROM tax_profiles WHERE store_id=${storeId}::uuid
          AND valid_from<=NOW() AND (valid_to IS NULL OR valid_to>NOW())
          ORDER BY valid_from DESC,created_at DESC LIMIT 1)
          AND tax_category_id=tc.id AND valid_from<=NOW() AND (valid_to IS NULL OR valid_to>NOW())
        ORDER BY valid_from DESC,created_at DESC LIMIT 1
      ) tr ON TRUE
      LEFT JOIN stock_balances sb ON sb.variant_id=v.id AND sb.warehouse_id=${warehouseId}::uuid
      WHERE p.status='ACTIVE' AND v.status='ACTIVE'
        AND (${pattern}::text IS NULL OR p.name ILIKE ${pattern} OR v.sku ILIKE ${pattern}
          OR v.title ILIKE ${pattern} OR COALESCE(v.barcode,'') ILIKE ${pattern}
          OR EXISTS (SELECT 1 FROM variant_barcodes vb WHERE vb.variant_id=v.id AND vb.barcode ILIKE ${pattern}))
        AND (${context.taxMode}='NO_VAT' OR (tc.status='ACTIVE' AND tr.rate IS NOT NULL))
      ORDER BY p.name ASC,v.sku ASC,u.code ASC LIMIT 100
    `;
    return {
      context: { storeId, branchId, warehouseId, currency: context.currency, taxMode: context.taxMode,
        priceTaxMode: context.priceTaxMode, currencyMinorUnits: context.currencyMinorUnits },
      items,
    };
  }

}
