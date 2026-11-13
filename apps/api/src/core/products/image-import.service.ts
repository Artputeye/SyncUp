import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { readWorkspaceStagingFile, removeWorkspaceStagingFile, removeWorkspaceStagingTree, writeWorkspaceStagingFile } from "./workspace-media-storage";
import * as path from "node:path";
import sharp from "sharp";
import yauzl from "yauzl";
import { PrismaService } from "../../database/prisma.service";
import { WorkspaceDatabaseRegistry } from "../../database/workspace-database.registry";
import { MediaService } from "./media.service";

type ArchiveFile = { name: string; bytes: Buffer };
type ManifestRow = { filename: string; targetType?: string; targetId?: string; sku?: string; role?: string; sortOrder?: number; altText?: string };

const MAX_ZIP_BYTES = 25 * 1024 * 1024;
const MAX_ARCHIVE_FILES = 500;
const MAX_TOTAL_UNCOMPRESSED = 100 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;

@Injectable()
export class ImageImportService {
  private readonly root = path.resolve(process.env.MEDIA_STORAGE_ROOT || path.join(process.cwd(), ".data", "media"));

  constructor(
    private readonly controlDb: PrismaService,
    private readonly databases: WorkspaceDatabaseRegistry,
    private readonly media: MediaService,
  ) {}

  private async assertAdmin(userId: string, workspaceId: string) {
    const membership = await this.controlDb.membership.findFirst({
      where: { userId, workspaceId },
      include: { roles: { include: { role: { select: { key: true } } } } },
    });
    if (!membership || (!membership.isOwner && !membership.roles.some((item) => item.role.key === "admin"))) {
      throw new ForbiddenException("Bulk image import is available to Workspace OWNER and ADMIN only");
    }
  }


  private async readArchive(buffer: Buffer): Promise<ArchiveFile[]> {
    return new Promise((resolve, reject) => {
      yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
        if (error || !zip) return reject(new BadRequestException("ZIP archive is invalid"));
        const files: ArchiveFile[] = [];
        let total = 0;
        let settled = false;
        const fail = (reason: Error) => {
          if (settled) return;
          settled = true;
          zip.close();
          reject(reason);
        };
        zip.on("error", (reason) => fail(new BadRequestException(reason.message)));
        zip.on("end", () => {
          if (settled) return;
          settled = true;
          resolve(files);
        });
        zip.on("entry", (entry) => {
          if (/\/$/.test(entry.fileName)) { zip.readEntry(); return; }
          const name = entry.fileName.replace(/\\/g, "/");
          const parts: string[] = name.split("/");
          const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
          if (name.startsWith("/") || /^[a-zA-Z]:/.test(name) || parts.some((part) => part === ".." || part === "." || !part) || mode === 0xa000) {
            fail(new BadRequestException("ZIP contains an unsafe path or symbolic link"));
            return;
          }
          if ((entry.generalPurposeBitFlag & 1) !== 0) { fail(new BadRequestException("Encrypted ZIP entries are not supported")); return; }
          if (entry.uncompressedSize > MAX_IMAGE_BYTES || entry.uncompressedSize < 1) {
            fail(new BadRequestException("Each image in ZIP must be between 1 byte and 5 MB"));
            return;
          }
          if (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > 100) {
            fail(new BadRequestException("ZIP compression ratio exceeds the safety limit"));
            return;
          }
          total += entry.uncompressedSize;
          if (files.length >= MAX_ARCHIVE_FILES || total > MAX_TOTAL_UNCOMPRESSED) {
            fail(new BadRequestException("ZIP exceeds the file-count or expanded-size limit"));
            return;
          }
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) { fail(new BadRequestException("Unable to read ZIP entry")); return; }
            const chunks: Buffer[] = [];
            let length = 0;
            stream.on("data", (chunk: Buffer) => {
              length += chunk.length;
              if (length > MAX_IMAGE_BYTES) { stream.destroy(new Error("entry-too-large")); return; }
              chunks.push(chunk);
            });
            stream.on("error", () => fail(new BadRequestException("ZIP entry could not be decompressed safely")));
            stream.on("end", () => {
              files.push({ name, bytes: Buffer.concat(chunks) });
              zip.readEntry();
            });
          });
        });
        zip.readEntry();
      });
    });
  }

  private parseCsv(text: string): ManifestRow[] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted && char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = !quoted;
      else if (!quoted && char === ",") { row.push(cell); cell = ""; }
      else if (!quoted && (char === "\n" || char === "\r")) {
        if (char === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        if (row.some((value) => value.trim())) rows.push(row);
        row = [];
      } else cell += char;
    }
    if (quoted) throw new BadRequestException("Manifest CSV contains an unclosed quoted field");
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    if (!rows.length) return [];
    const headers = rows.shift()!.map((value) => value.trim().toLowerCase());
    const allowed = new Set(["filename", "targettype", "targetid", "sku", "role", "sortorder", "alttext"]);
    if (!headers.includes("filename") || headers.some((header) => !allowed.has(header))) {
      throw new BadRequestException("Manifest headers must include filename and may include targetType,targetId,sku,role,sortOrder,altText");
    }
    return rows.map((values) => {
      const record: Record<string, string> = {};
      headers.forEach((header, index) => { record[header] = (values[index] ?? "").trim(); });
      return {
        filename: record.filename,
        targetType: record.targettype?.toUpperCase(),
        targetId: record.targetid,
        sku: record.sku,
        role: record.role?.toUpperCase(),
        sortOrder: record.sortorder ? Number(record.sortorder) : 0,
        altText: record.alttext,
      };
    });
  }

  async preview(userId: string, workspaceId: string, archive: Express.Multer.File, manifestFile?: Express.Multer.File) {
    await this.assertAdmin(userId, workspaceId);
    if (!archive?.buffer?.length || archive.size > MAX_ZIP_BYTES) throw new BadRequestException("ZIP file is required and must not exceed 25 MB");
    if (!archive.originalname.toLowerCase().endsWith(".zip")) throw new BadRequestException("Archive must be a .zip file");
    const db = await this.databases.forMembership(userId, workspaceId);
    const files = await this.readArchive(archive.buffer);
    if (!files.length) throw new BadRequestException("ZIP does not contain image files");
    const manifestText = manifestFile?.buffer.toString("utf8").replace(/^\uFEFF/, "");
    const manifest = manifestText ? this.parseCsv(manifestText) : [];
    const manifestByName = new Map(manifest.map((row) => [row.filename.replace(/\\/g, "/"), row]));
    const batchId = randomUUID();
    const stagePrefix = path.posix.join("staging", workspaceId, batchId);
    const preparedRows: Array<{ id: string; file: ArchiveFile; mapping: ManifestRow; status: "VALID" | "INVALID"; error?: string; targetId?: string; targetType?: string; checksum?: string }> = [];
    let valid = 0;
    for (const file of files) {
      const mapping = manifestByName.get(file.name) ?? manifestByName.get(path.posix.basename(file.name)) ?? this.filenameMapping(file.name);
      let status: "VALID" | "INVALID" = "VALID";
      let error: string | undefined;
      let targetId: string | undefined;
      let targetType: string | undefined;
      let checksum: string | undefined;
      try {
        if (!["jpg", "jpeg", "png", "webp"].includes(path.extname(file.name).slice(1).toLowerCase())) throw new Error("UNSUPPORTED_EXTENSION");
        const image = await sharp(file.bytes, { limitInputPixels: MAX_PIXELS, failOn: "error" }).metadata();
        if (!image.width || !image.height || image.width * image.height > MAX_PIXELS || !["jpeg", "png", "webp"].includes(image.format || "")) throw new Error("INVALID_IMAGE");
        if (mapping.sortOrder !== undefined && (!Number.isInteger(mapping.sortOrder) || mapping.sortOrder < 0 || mapping.sortOrder > 100_000)) throw new Error("INVALID_SORT_ORDER");
        const role = mapping.role ?? "GALLERY";
        if (!["PRIMARY", "GALLERY"].includes(role)) throw new Error("INVALID_IMAGE_ROLE");
        if (mapping.targetType && !["PRODUCT", "VARIANT"].includes(mapping.targetType)) throw new Error("INVALID_TARGET_TYPE");
        if (mapping.targetId) {
          const rows = mapping.targetType === "VARIANT"
            ? await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM product_variants WHERE id = ${mapping.targetId}::uuid`)
            : await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM products WHERE id = ${mapping.targetId}::uuid`);
          if (!rows.length) throw new Error("TARGET_NOT_FOUND");
          targetId = rows[0].id;
          targetType = mapping.targetType || "PRODUCT";
        } else if (mapping.sku) {
          const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM product_variants WHERE UPPER(sku) = UPPER(${mapping.sku}) OR UPPER(normalized_sku) = UPPER(${mapping.sku}) LIMIT 1`);
          if (!rows.length) throw new Error("SKU_NOT_FOUND");
          targetId = rows[0].id;
          targetType = "VARIANT";
        } else throw new Error("MAPPING_REQUIRED");
        if (mapping.altText && mapping.altText.length > 255) throw new Error("ALT_TEXT_TOO_LONG");
        checksum = createHash("sha256").update(file.bytes).digest("hex");
        valid++;
      } catch (reason) {
        status = "INVALID";
        error = reason instanceof Error ? reason.message : "VALIDATION_FAILED";
      }
      const id = randomUUID();
      const stageKey = path.posix.join(stagePrefix, id + path.extname(file.name).toLowerCase());
      if (status === "VALID") {
        await writeWorkspaceStagingFile(this.root, stageKey, workspaceId, file.bytes);


      }
      preparedRows.push({ id, file, mapping, status, error, targetId, targetType, checksum });
      (preparedRows[preparedRows.length - 1] as typeof preparedRows[number] & { stageKey?: string }).stageKey = stageKey;
    }

    try {
      await db.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO image_import_batches (id, status, source_filename, source_checksum, manifest_checksum, total_files, processed_files, valid_files, invalid_files, uploaded_by, created_at, updated_at)
          VALUES (${batchId}::uuid, 'PREVIEW_READY'::"ImportStatus", ${archive.originalname.slice(0,255)}, ${createHash("sha256").update(archive.buffer).digest("hex")},
            ${manifestFile ? createHash("sha256").update(manifestFile.buffer).digest("hex") : null}, ${files.length}, ${files.length}, ${valid}, ${files.length-valid}, ${userId}::uuid, NOW(), NOW())
        `);
        for (const row of preparedRows) {
          const stageKey = (row as typeof row & { stageKey?: string }).stageKey ?? null;
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO image_import_items (id, batch_id, relative_path, original_filename, checksum_sha256, target_type, target_id, mapping_key, image_role, sort_order, status, error_code, error_message, metadata, created_at, updated_at)
            VALUES (${row.id}::uuid, ${batchId}::uuid, ${row.file.name}, ${path.posix.basename(row.file.name)}, ${row.checksum ?? null},
              ${row.targetType ?? row.mapping.targetType ?? null}, ${row.targetId ?? null}::uuid, ${row.mapping.sku ?? null}, ${row.mapping.role ?? "GALLERY"},
              ${row.mapping.sortOrder ?? 0}, ${row.status}::"ImportRowStatus", ${row.error ?? null}, ${row.error ?? null},
              ${JSON.stringify({ stageKey, altText: row.mapping.altText ?? null })}::jsonb, NOW(), NOW())
          `);
        }
      });
    } catch (error) {
      await removeWorkspaceStagingTree(this.root, stagePrefix, workspaceId).catch(() => undefined);
      throw error;
    }
    return {
      batchId,
      status: "PREVIEW_READY",
      totalFiles: files.length,
      validFiles: valid,
      invalidFiles: files.length - valid,
      items: preparedRows.map((row) => ({ id: row.id, filename: row.file.name, targetType: row.targetType ?? null, targetId: row.targetId ?? null, sku: row.mapping.sku ?? null, role: row.mapping.role ?? "GALLERY", status: row.status, error: row.error ?? null })),
    };
  }

  private filenameMapping(filename: string): ManifestRow {
    const base = path.posix.basename(filename, path.posix.extname(filename));
    const [sku, suffix] = base.split("__", 2);
    return { filename, sku, role: suffix?.toLowerCase() === "main" || !suffix ? "PRIMARY" : "GALLERY", sortOrder: suffix && /^\d+$/.test(suffix) ? Number(suffix) : 0 };
  }

  async commit(userId: string, workspaceId: string, batchId: string) {
    await this.assertAdmin(userId, workspaceId);
    const db = await this.databases.forMembership(userId, workspaceId);
    const id = batchId;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new BadRequestException("batchId must be a UUID");
    const batches = await db.$queryRaw<Array<{ status: string }>>(Prisma.sql`SELECT status FROM image_import_batches WHERE id = ${id}::uuid AND uploaded_by = ${userId}::uuid`);
    if (!batches.length) throw new NotFoundException("Image import batch not found");
    if (batches[0].status !== "PREVIEW_READY" && batches[0].status !== "FAILED") throw new BadRequestException("Image import batch is not ready to commit");
    await db.$executeRaw(Prisma.sql`UPDATE image_import_batches SET status = 'COMMITTING'::"ImportStatus", started_at = NOW(), updated_at = NOW() WHERE id = ${id}::uuid`);
    const rows = await db.$queryRaw<Array<{ id: string; target_type: string; target_id: string; status: string; metadata: { stageKey?: string; altText?: string | null }; original_filename: string; sort_order: number; image_role: string }>>(Prisma.sql`
      SELECT id, target_type, target_id, status, metadata, original_filename, sort_order, image_role
      FROM image_import_items WHERE batch_id = ${id}::uuid ORDER BY created_at, id
    `);
    let applied = 0;
    let failed = 0;
    for (const row of rows) {
      if (row.status === "INVALID" || row.status === "APPLIED") continue;
      try {
        if (!row.metadata?.stageKey || !row.target_id || !["PRODUCT", "VARIANT"].includes(row.target_type)) throw new Error("STAGED_IMAGE_OR_TARGET_MISSING");
        const bytes = await readWorkspaceStagingFile(this.root, row.metadata.stageKey, workspaceId);
        const file = { buffer: bytes, size: bytes.length, originalname: row.original_filename, mimetype: "application/octet-stream" } as Express.Multer.File;
        const options = { altText: row.metadata.altText ?? undefined, isPrimary: row.image_role === "PRIMARY", sortOrder: row.sort_order };
        const mediaAsset = row.target_type === "PRODUCT"
          ? await this.media.uploadProductImage(userId, workspaceId, row.target_id, file, options)
          : await this.media.uploadVariantImage(userId, workspaceId, row.target_id, file, options);
        await db.$executeRaw(Prisma.sql`UPDATE image_import_items SET media_asset_id = ${mediaAsset.id}::uuid, status = 'APPLIED'::"ImportRowStatus", updated_at = NOW() WHERE id = ${row.id}::uuid`);
        applied++;
        await removeWorkspaceStagingFile(this.root, row.metadata.stageKey, workspaceId).catch(() => undefined);
      } catch (error) {
        failed++;
        const message = error instanceof Error ? error.message.slice(0, 900) : "IMPORT_FAILED";
        await db.$executeRaw(Prisma.sql`UPDATE image_import_items SET status = 'FAILED'::"ImportRowStatus", error_code = 'COMMIT_FAILED', error_message = ${message}, updated_at = NOW() WHERE id = ${row.id}::uuid`);
      }
    }
    const status = failed === 0 ? "COMMITTED" : "FAILED";
    await db.$executeRaw(Prisma.sql`UPDATE image_import_batches SET status = ${status}::"ImportStatus", completed_at = NOW(), updated_at = NOW() WHERE id = ${id}::uuid`);
    await db.$executeRaw(Prisma.sql`INSERT INTO audit_events (actor_id, action, resource_type, resource_id, metadata) VALUES (${userId}::uuid, 'media.image_import.committed', 'IMAGE_IMPORT_BATCH', ${id}, ${JSON.stringify({ applied, failed, total: rows.length })}::jsonb)`);
    return { batchId: id, status, applied, failed, total: rows.length };
  }
}
