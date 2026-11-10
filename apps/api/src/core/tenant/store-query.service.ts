import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { WorkspaceDatabaseRegistry } from "../../database/workspace-database.registry";

export type StoreAddress = { line1?: string; line2?: string; subdistrict?: string; district?: string; province?: string; postalCode?: string; country?: string };
export type StoreDetail = {
  id: string; name: string; slug: string; status: string; storeType: string;
  description: string | null; contactEmail: string | null; contactPhone: string | null;
  address: StoreAddress | null; currency: string; timezone: string; createdAt: Date; updatedAt: Date;
};
export type UpdateStoreInput = {
  name: string; description: string | null; contactEmail: string | null; contactPhone: string | null;
  address: StoreAddress | null; currency: string; timezone: string;
};

@Injectable()
export class StoreQueryService {
  constructor(private readonly databases: WorkspaceDatabaseRegistry) {}

  async listStores(userId: string, workspaceId: string) {
    const db = await this.databases.forMembership(userId, workspaceId);
    return db.$queryRaw<Array<{
      id: string; name: string; slug: string; status: string; storeType: string;
      currency: string; timezone: string; createdAt: Date; activeBranchCount: number; defaultBranchName: string | null;
    }>>`
      SELECT s.id, s.name, s.slug, s.status, s.store_type AS "storeType",
        s.currency, s.timezone, s.created_at AS "createdAt",
        (SELECT COUNT(*)::int FROM branches b WHERE b.store_id = s.id AND b.status = 'ACTIVE') AS "activeBranchCount",
        (SELECT b.name FROM branches b WHERE b.store_id = s.id AND b.status = 'ACTIVE' AND b.is_default = TRUE LIMIT 1) AS "defaultBranchName"
      FROM stores s ORDER BY s.created_at DESC, s.name ASC
    `;
  }

  async getStore(userId: string, workspaceId: string, storeId: string): Promise<StoreDetail> {
    const db = await this.databases.forMembership(userId, workspaceId);
    const rows = await db.$queryRaw<StoreDetail[]>`
      SELECT id, name, slug, status, store_type AS "storeType", description,
        contact_email AS "contactEmail", contact_phone AS "contactPhone", address, currency, timezone,
        created_at AS "createdAt", updated_at AS "updatedAt"
      FROM stores WHERE id = ${storeId}::uuid
    `;
    if (!rows.length) throw new NotFoundException("Store not found");
    return rows[0];
  }

  async updateStore(userId: string, workspaceId: string, storeId: string, input: UpdateStoreInput): Promise<StoreDetail> {
    if (!input || typeof input.name !== "string" || !input.name.trim()) throw new BadRequestException("Store name is required");
    const name = input.name.trim();
    if (name.length > 160) throw new BadRequestException("Store name must not exceed 160 characters");
    const description = input.description?.trim() || null;
    if (description && description.length > 10000) throw new BadRequestException("Description is too long");
    const contactEmail = input.contactEmail?.trim().toLowerCase() || null;
    if (contactEmail && (contactEmail.length > 320 || contactEmail.indexOf(String.fromCharCode(64)) <= 0 || contactEmail.lastIndexOf(String.fromCharCode(46)) <= contactEmail.indexOf(String.fromCharCode(64)) + 1 || contactEmail.endsWith(String.fromCharCode(46)))) throw new BadRequestException(String.fromCharCode(67,111,110,116,97,99,116,32,101,109,97,105,108,32,105,115,32,105,110,118,97,108,105,100));
    const contactPhone = input.contactPhone?.trim() || null;
    if (contactPhone && contactPhone.length > 40) throw new BadRequestException("Contact phone is too long");
    const currency = input.currency?.trim().toUpperCase();
    if (!currency || !/^[A-Z]{3}$/.test(currency)) throw new BadRequestException("Currency must be a 3-letter ISO code");
    const timezone = input.timezone?.trim();
    if (!timezone || timezone.length > 64) throw new BadRequestException("Timezone is required");
    try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); } catch { throw new BadRequestException("Timezone is not a valid IANA timezone"); }
    let address: StoreAddress | null = null;
    if (input.address && typeof input.address === "object" && !Array.isArray(input.address)) {
      const allowed = ["line1", "line2", "subdistrict", "district", "province", "postalCode", "country"] as const;
      address = {};
      for (const key of allowed) {
        const value = input.address[key];
        if (value !== undefined && value !== null && String(value).trim()) {
          const normalized = String(value).trim();
          if (normalized.length > 160) throw new BadRequestException("Address field " + key + " is too long");
          address[key] = normalized;
        }
      }
      if (Object.keys(address).length === 0) address = null;
    }
    const db = await this.databases.forMembership(userId, workspaceId);
    return db.$transaction(async (tx) => {
      const beforeRows = await tx.$queryRaw<StoreDetail[]>`
        SELECT id, name, slug, status, store_type AS "storeType", description,
          contact_email AS "contactEmail", contact_phone AS "contactPhone", address, currency, timezone,
          created_at AS "createdAt", updated_at AS "updatedAt"
        FROM stores WHERE id = ${storeId}::uuid FOR UPDATE
      `;
      if (!beforeRows.length) throw new NotFoundException("Store not found");
      const before = beforeRows[0];
      const afterRows = await tx.$queryRaw<StoreDetail[]>`
        UPDATE stores SET name = ${name}, description = ${description}, contact_email = ${contactEmail},
          contact_phone = ${contactPhone}, address = ${address === null ? null : JSON.stringify(address)}::jsonb,
          currency = ${currency}, timezone = ${timezone}, updated_at = NOW()
        WHERE id = ${storeId}::uuid
        RETURNING id, name, slug, status, store_type AS "storeType", description,
          contact_email AS "contactEmail", contact_phone AS "contactPhone", address, currency, timezone,
          created_at AS "createdAt", updated_at AS "updatedAt"
      `;
      const after = afterRows[0];
      await tx.$executeRaw`
        INSERT INTO audit_logs (id, store_id, actor_user_id, action, entity_type, entity_id, reason, "before", "after")
        VALUES (gen_random_uuid(), ${storeId}::uuid, ${userId}::uuid, 'STORE_UPDATED', 'Store', ${storeId}::uuid,
          'Store details updated', ${JSON.stringify(before)}::jsonb, ${JSON.stringify(after)}::jsonb)
      `;
      return after;
    });
  }
}
