import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { readWorkspaceMediaFile, removeWorkspaceMediaFile, writeWorkspaceMediaFile } from "./workspace-media-storage";
import * as path from "node:path";
import sharp, { type Metadata } from "sharp";
import { WorkspaceDatabaseRegistry } from "../../database/workspace-database.registry";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const IMAGE_KINDS = ["ORIGINAL", "MAIN", "THUMBNAIL"] as const;
type ImageKind = (typeof IMAGE_KINDS)[number];
type ImageOptions = { altText?: string; isPrimary?: boolean; sortOrder?: number };
type StoredImage = { kind: ImageKind; key: string; mime: string; bytes: Buffer; width: number; height: number };

@Injectable()
export class MediaService {
  private readonly root = path.resolve(process.env.MEDIA_STORAGE_ROOT || path.join(process.cwd(), ".data", "media"));

  constructor(private readonly databases: WorkspaceDatabaseRegistry) {}

  private uuid(value: string, field: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException(`${field} must be a valid UUID`);
    }
    return value;
  }

  private async prepare(file: Express.Multer.File, workspaceId: string, mediaId: string): Promise<StoredImage[]> {
    if (!file?.buffer?.length) throw new BadRequestException("Image file is required");
    if (file.size > MAX_IMAGE_BYTES || file.buffer.length > MAX_IMAGE_BYTES) {
      throw new BadRequestException("Image must not exceed 5 MB");
    }
    let metadata: Metadata;
    try {
      metadata = await sharp(file.buffer, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error" }).metadata();
    } catch {
      throw new BadRequestException("Image file is invalid or cannot be decoded");
    }
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
      throw new BadRequestException("Image dimensions exceed the allowed limit");
    }
    if (!["jpeg", "png", "webp"].includes(metadata.format || "")) {
      throw new BadRequestException("Only JPEG, PNG and WebP images are allowed");
    }

    const base = path.posix.join(workspaceId, mediaId);
    const originalExt = metadata.format === "jpeg" ? "jpg" : metadata.format;
    const main = await sharp(file.buffer, { limitInputPixels: MAX_IMAGE_PIXELS })
      .rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 88 }).toBuffer({ resolveWithObject: true });
    const thumbnail = await sharp(file.buffer, { limitInputPixels: MAX_IMAGE_PIXELS })
      .rotate().resize(480, 480, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 }).toBuffer({ resolveWithObject: true });

    return [
      { kind: "ORIGINAL", key: path.posix.join(base, `original.${originalExt}`), mime: metadata.format === "jpeg" ? "image/jpeg" : `image/${metadata.format}`, bytes: file.buffer, width: metadata.width, height: metadata.height },
      { kind: "MAIN", key: path.posix.join(base, "main.webp"), mime: "image/webp", bytes: main.data, width: main.info.width, height: main.info.height },
      { kind: "THUMBNAIL", key: path.posix.join(base, "thumbnail.webp"), mime: "image/webp", bytes: thumbnail.data, width: thumbnail.info.width, height: thumbnail.info.height },
    ];
  }

  private async persistFiles(images: StoredImage[]) {
    const written: StoredImage[] = [];
    try {
      for (const image of images) {
        const workspaceId = image.key.split("/")[0];
        await writeWorkspaceMediaFile(this.root, image.key, workspaceId, image.bytes);
        written.push(image);
      }
    } catch (error) {
      await this.cleanupFiles(written);
      throw error;
    }
  }
  private async cleanupFiles(images: StoredImage[]) {
    await Promise.all(images.map((image) => removeWorkspaceMediaFile(this.root, image.key, image.key.split("/")[0]).catch(() => undefined)));
  }

  async uploadProductImage(userId: string, workspaceId: string, productId: string, file: Express.Multer.File, options: ImageOptions = {}) {
    const product = this.uuid(productId, "productId");
    const db = await this.databases.forMembership(userId, workspaceId);
    const exists = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM products WHERE id = ${product}::uuid AND archived_at IS NULL LIMIT 1`);
    if (!exists.length) throw new NotFoundException("Product not found");
    return this.createAndAttach(db, userId, workspaceId, file, options, { type: "PRODUCT", id: product });
  }

  async uploadVariantImage(userId: string, workspaceId: string, variantId: string, file: Express.Multer.File, options: ImageOptions = {}) {
    const variant = this.uuid(variantId, "variantId");
    const db = await this.databases.forMembership(userId, workspaceId);
    const exists = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM product_variants WHERE id = ${variant}::uuid AND archived_at IS NULL LIMIT 1`);
    if (!exists.length) throw new NotFoundException("Variant not found");
    return this.createAndAttach(db, userId, workspaceId, file, options, { type: "VARIANT", id: variant });
  }

  private async createAndAttach(
    db: PrismaClient,
    userId: string,
    workspaceId: string,
    file: Express.Multer.File,
    options: ImageOptions,
    target: { type: "PRODUCT" | "VARIANT"; id: string },
  ) {
    if (options.altText !== undefined && options.altText.length > 255) throw new BadRequestException("altText must not exceed 255 characters");
    const sortOrder = options.sortOrder ?? 0;
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100_000) throw new BadRequestException("sortOrder is invalid");

    const mediaId = randomUUID();
    const images = await this.prepare(file, workspaceId, mediaId);
    await this.persistFiles(images);
    const checksum = createHash("sha256").update(file.buffer).digest("hex");
    const primary = options.isPrimary ?? false;
    try {
      await db.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO media_assets (id, purpose, status, alt_text, uploaded_by, verified_at, created_at, updated_at)
          VALUES (${mediaId}::uuid, ${target.type}::"MediaPurpose", 'READY'::"MediaStatus", ${options.altText?.trim() || null}, ${userId}::uuid, NOW(), NOW(), NOW())
        `);
        for (const image of images) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO media_asset_derivatives
              (id, media_asset_id, kind, status, storage_provider, bucket, object_key, original_filename, mime_type, extension, size_bytes, checksum_sha256, width, height, created_at, updated_at)
            VALUES
              (${randomUUID()}::uuid, ${mediaId}::uuid, ${image.kind}::"MediaDerivativeKind", 'READY'::"MediaDerivativeStatus",
               'local-filesystem', 'local', ${image.key}, ${file.originalname.slice(0, 255)}, ${image.mime},
               ${path.extname(image.key).slice(1)}, ${BigInt(image.bytes.length)}, ${createHash("sha256").update(image.bytes).digest("hex")},
               ${image.width}, ${image.height}, NOW(), NOW())
          `);
        }
        const table = target.type === "PRODUCT" ? Prisma.sql`product_images` : Prisma.sql`variant_images`;
        const targetColumn = target.type === "PRODUCT" ? Prisma.sql`product_id` : Prisma.sql`variant_id`;
        if (primary) {
          await tx.$executeRaw(Prisma.sql`UPDATE ${table} SET is_primary = FALSE WHERE ${targetColumn} = ${target.id}::uuid`);
        }
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO ${table} (id, ${targetColumn}, media_asset_id, is_primary, sort_order, created_at)
          VALUES (${randomUUID()}::uuid, ${target.id}::uuid, ${mediaId}::uuid, ${primary}, ${sortOrder}, NOW())
        `);
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO audit_events (actor_id, action, resource_type, resource_id, metadata)
          VALUES (${userId}::uuid, 'media.image.uploaded', ${target.type}, ${target.id}, ${JSON.stringify({ mediaAssetId: mediaId, checksum, filename: file.originalname.slice(0, 255) })}::jsonb)
        `);
      });
    } catch (error) {
      await this.cleanupFiles(images);
      throw error;
    }
    return this.getAsset(db, workspaceId, mediaId);
  }

  async listCatalogPrimaryImages(userId: string, workspaceId: string) {
    const db = await this.databases.forMembership(userId, workspaceId);
    return db.$queryRaw(Prisma.sql`
      SELECT DISTINCT ON (pi.product_id)
        pi.product_id AS "productId", ma.id AS "mediaAssetId",
        '/api/tenant/' || ${workspaceId} || '/media/' || ma.id::text || '/THUMBNAIL' AS "thumbnailUrl",
        '/api/tenant/' || ${workspaceId} || '/media/' || ma.id::text || '/MAIN' AS url
      FROM product_images pi JOIN media_assets ma ON ma.id = pi.media_asset_id
      WHERE ma.status = 'READY'
      ORDER BY pi.product_id, pi.is_primary DESC, pi.sort_order, pi.created_at
    `);
  }
  async listProductImages(userId: string, workspaceId: string, productId: string) {
    const id = this.uuid(productId, "productId");
    const db = await this.databases.forMembership(userId, workspaceId);
    return db.$queryRaw(Prisma.sql`
      SELECT pi.id, pi.media_asset_id AS "mediaAssetId", pi.is_primary AS "isPrimary", pi.sort_order AS "sortOrder",
        ma.alt_text AS "altText", ma.status,
        '/api/tenant/' || ${workspaceId} || '/media/' || ma.id || '/MAIN' AS url,
        '/api/tenant/' || ${workspaceId} || '/media/' || ma.id || '/THUMBNAIL' AS "thumbnailUrl"
      FROM product_images pi JOIN media_assets ma ON ma.id = pi.media_asset_id
      WHERE pi.product_id = ${id}::uuid AND ma.status = 'READY'
      ORDER BY pi.is_primary DESC, pi.sort_order, pi.created_at
    `);
  }

  async listVariantImages(userId: string, workspaceId: string, variantId: string) {
    const id = this.uuid(variantId, "variantId");
    const db = await this.databases.forMembership(userId, workspaceId);
    return db.$queryRaw(Prisma.sql`
      SELECT vi.id, vi.media_asset_id AS "mediaAssetId", vi.is_primary AS "isPrimary", vi.sort_order AS "sortOrder",
        ma.alt_text AS "altText",
        '/api/tenant/' || ${workspaceId} || '/media/' || ma.id::text || '/MAIN' AS url,
        '/api/tenant/' || ${workspaceId} || '/media/' || ma.id::text || '/THUMBNAIL' AS "thumbnailUrl"
      FROM variant_images vi JOIN media_assets ma ON ma.id = vi.media_asset_id
      WHERE vi.variant_id = ${id}::uuid AND ma.status = 'READY'
      ORDER BY vi.is_primary DESC, vi.sort_order, vi.created_at
    `);
  }
  async updateProductImage(userId: string, workspaceId: string, productId: string, imageId: string, input: ImageOptions) {
    const product = this.uuid(productId, "productId");
    const image = this.uuid(imageId, "imageId");
    const db = await this.databases.forMembership(userId, workspaceId);
    const exists = await db.$queryRaw<Array<{ media_asset_id: string }>>(Prisma.sql`
      SELECT media_asset_id FROM product_images WHERE id = ${image}::uuid AND product_id = ${product}::uuid
    `);
    if (!exists.length) throw new NotFoundException("Product image not found");
    if (input.altText !== undefined && input.altText.length > 255) throw new BadRequestException("altText must not exceed 255 characters");
    if (input.sortOrder !== undefined && (!Number.isInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > 100_000)) throw new BadRequestException("sortOrder is invalid");
    await db.$transaction(async (tx) => {
      if (input.isPrimary === true) await tx.$executeRaw(Prisma.sql`UPDATE product_images SET is_primary = FALSE WHERE product_id = ${product}::uuid`);
      if (input.sortOrder !== undefined || input.isPrimary !== undefined) {
        await tx.$executeRaw(Prisma.sql`UPDATE product_images SET sort_order = COALESCE(${input.sortOrder ?? null}, sort_order), is_primary = COALESCE(${input.isPrimary ?? null}, is_primary) WHERE id = ${image}::uuid AND product_id = ${product}::uuid`);
      }
      if (input.altText !== undefined) await tx.$executeRaw(Prisma.sql`UPDATE media_assets SET alt_text = ${input.altText.trim() || null}, updated_at = NOW() WHERE id = ${exists[0].media_asset_id}::uuid`);
    });
    return this.listProductImages(userId, workspaceId, product);
  }

  async deleteProductImage(userId: string, workspaceId: string, productId: string, imageId: string) {
    const product = this.uuid(productId, "productId");
    const image = this.uuid(imageId, "imageId");
    const db = await this.databases.forMembership(userId, workspaceId);
    const rows = await db.$queryRaw<Array<{ media_asset_id: string }>>(Prisma.sql`SELECT media_asset_id FROM product_images WHERE id = ${image}::uuid AND product_id = ${product}::uuid`);
    if (!rows.length) throw new NotFoundException("Product image not found");
    await db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`DELETE FROM product_images WHERE id = ${image}::uuid AND product_id = ${product}::uuid`);
      await tx.$executeRaw(Prisma.sql`UPDATE media_assets SET status = 'DELETED', updated_at = NOW() WHERE id = ${rows[0].media_asset_id}::uuid AND NOT EXISTS (SELECT 1 FROM product_images WHERE media_asset_id = ${rows[0].media_asset_id}::uuid) AND NOT EXISTS (SELECT 1 FROM variant_images WHERE media_asset_id = ${rows[0].media_asset_id}::uuid)`);
      await tx.$executeRaw(Prisma.sql`INSERT INTO audit_events (actor_id, action, resource_type, resource_id, metadata) VALUES (${userId}::uuid, 'media.image.deleted', 'PRODUCT', ${product}, ${JSON.stringify({ imageId: image, mediaAssetId: rows[0].media_asset_id })}::jsonb)`);
    });
    return { success: true };
  }

  async updateVariantImage(userId: string, workspaceId: string, variantId: string, imageId: string, input: ImageOptions) {
    const variant = this.uuid(variantId, "variantId");
    const image = this.uuid(imageId, "imageId");
    const db = await this.databases.forMembership(userId, workspaceId);
    const exists = await db.$queryRaw<Array<{ media_asset_id: string }>>(Prisma.sql`SELECT media_asset_id FROM variant_images WHERE id = ${image}::uuid AND variant_id = ${variant}::uuid`);
    if (!exists.length) throw new NotFoundException("Variant image not found");
    if (input.altText !== undefined && input.altText.length > 255) throw new BadRequestException("altText must not exceed 255 characters");
    if (input.sortOrder !== undefined && (!Number.isInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > 100_000)) throw new BadRequestException("sortOrder is invalid");
    await db.$transaction(async (tx) => {
      if (input.isPrimary === true) await tx.$executeRaw(Prisma.sql`UPDATE variant_images SET is_primary = FALSE WHERE variant_id = ${variant}::uuid`);
      if (input.sortOrder !== undefined || input.isPrimary !== undefined) await tx.$executeRaw(Prisma.sql`UPDATE variant_images SET sort_order = COALESCE(${input.sortOrder ?? null}, sort_order), is_primary = COALESCE(${input.isPrimary ?? null}, is_primary) WHERE id = ${image}::uuid AND variant_id = ${variant}::uuid`);
      if (input.altText !== undefined) await tx.$executeRaw(Prisma.sql`UPDATE media_assets SET alt_text = ${input.altText.trim() || null}, updated_at = NOW() WHERE id = ${exists[0].media_asset_id}::uuid`);
    });
    return this.listVariantImages(userId, workspaceId, variant);
  }

  async deleteVariantImage(userId: string, workspaceId: string, variantId: string, imageId: string) {
    const variant = this.uuid(variantId, "variantId");
    const image = this.uuid(imageId, "imageId");
    const db = await this.databases.forMembership(userId, workspaceId);
    const rows = await db.$queryRaw<Array<{ media_asset_id: string }>>(Prisma.sql`SELECT media_asset_id FROM variant_images WHERE id = ${image}::uuid AND variant_id = ${variant}::uuid`);
    if (!rows.length) throw new NotFoundException("Variant image not found");
    await db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`DELETE FROM variant_images WHERE id = ${image}::uuid AND variant_id = ${variant}::uuid`);
      await tx.$executeRaw(Prisma.sql`UPDATE media_assets SET status = 'DELETED', updated_at = NOW() WHERE id = ${rows[0].media_asset_id}::uuid AND NOT EXISTS (SELECT 1 FROM product_images WHERE media_asset_id = ${rows[0].media_asset_id}::uuid) AND NOT EXISTS (SELECT 1 FROM variant_images WHERE media_asset_id = ${rows[0].media_asset_id}::uuid)`);
      await tx.$executeRaw(Prisma.sql`INSERT INTO audit_events (actor_id, action, resource_type, resource_id, metadata) VALUES (${userId}::uuid, 'media.image.deleted', 'VARIANT', ${variant}, ${JSON.stringify({ imageId: image, mediaAssetId: rows[0].media_asset_id })}::jsonb)`);
    });
    return { success: true };
  }
  async getMediaFile(userId: string, workspaceId: string, mediaAssetId: string, kind: string) {
    const mediaId = this.uuid(mediaAssetId, "mediaAssetId");
    if (!IMAGE_KINDS.includes(kind as ImageKind)) throw new BadRequestException("Invalid image derivative kind");
    const db = await this.databases.forMembership(userId, workspaceId);
    const rows = await db.$queryRaw<Array<{ object_key: string; mime_type: string; size_bytes: bigint }>>(Prisma.sql`
      SELECT d.object_key, d.mime_type, d.size_bytes FROM media_asset_derivatives d
      JOIN media_assets m ON m.id = d.media_asset_id
      WHERE d.media_asset_id = ${mediaId}::uuid AND d.kind = ${kind}::"MediaDerivativeKind"
        AND d.status = 'READY' AND m.status = 'READY'
      LIMIT 1
    `);
    if (!rows.length) throw new NotFoundException("Media not found");

    const bytes = await readWorkspaceMediaFile(this.root, rows[0].object_key, workspaceId).catch(() => { throw new NotFoundException("Media file is missing"); });
    return { bytes, mimeType: rows[0].mime_type, size: Number(rows[0].size_bytes) };
  }

  private async getAsset(db: PrismaClient, workspaceId: string, mediaId: string) {
    const rows = await db.$queryRaw<Array<{ id: string; status: string; altText: string | null }>>(Prisma.sql`
      SELECT id, status, alt_text AS "altText" FROM media_assets WHERE id = ${mediaId}::uuid
    `);
    if (!rows.length) throw new NotFoundException("Media not found");
    return { ...rows[0], url: `/api/tenant/${workspaceId}/media/${mediaId}/MAIN` };
  }
}
