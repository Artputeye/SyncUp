import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { WorkspaceDatabaseRegistry } from "../../database/workspace-database.registry";
import {
  canonicalizeBranchCode,
  canonicalizeStoreSlug,
  canonicalizeWarehouseCode,
} from "../../shared/canonicalization";

type SqlClient = Pick<PrismaClient, "$transaction">;
type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

@Injectable()
export class StoreLifecycleService {
  constructor(private readonly databases: WorkspaceDatabaseRegistry) {}

  private async db(userId: string, workspaceId: string) {
    return this.databases.forMembership(userId, workspaceId);
  }

  private async audit(
    tx: Tx,
    input: {
      storeId: string;
      actorId: string;
      action: string;
      entityType: string;
      entityId: string;
      reason?: string;
      before?: unknown;
      after?: unknown;
    },
  ) {
    await tx.$executeRaw`
      INSERT INTO audit_logs
        (id, store_id, actor_user_id, action, entity_type, entity_id, reason, "before", "after")
      VALUES
        (gen_random_uuid(), ${input.storeId}::uuid, ${input.actorId}::uuid, ${input.action},
         ${input.entityType}, ${input.entityId}::uuid, ${input.reason ?? null},
         ${input.before === undefined ? null : JSON.stringify(input.before)}::jsonb,
         ${input.after === undefined ? null : JSON.stringify(input.after)}::jsonb)
    `;
  }

  async createStore(
    userId: string,
    workspaceId: string,
    input: { name: string; slug: string; branchCode?: string; warehouseCode?: string },
  ) {
    if (!input?.name?.trim()) throw new BadRequestException("Store name is required");
    const slug = canonicalizeStoreSlug(input.slug ?? "");
    const branchCode = canonicalizeBranchCode(input.branchCode ?? "HQ");
    const warehouseCode = canonicalizeWarehouseCode(input.warehouseCode ?? "MAIN");
    const db = await this.db(userId, workspaceId);
    return db.$transaction(async (tx) => {
      const stores = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO stores (id, name, slug, normalized_slug, updated_at)
        VALUES (gen_random_uuid(), ${input.name.trim()}, ${slug}, ${slug}, NOW())
        RETURNING id
      `;
      const storeId = stores[0].id;
      const branches = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO branches (id, store_id, code, name, status, is_default, updated_at)
        VALUES (gen_random_uuid(), ${storeId}::uuid, ${branchCode}, 'สำนักงานใหญ่', 'ACTIVE', TRUE, NOW())
        RETURNING id
      `;
      const branchId = branches[0].id;
      const warehouses = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO warehouses (id, branch_id, code, name, status, is_default, updated_at)
        VALUES (gen_random_uuid(), ${branchId}::uuid, ${warehouseCode}, 'คลังหลัก', 'ACTIVE', TRUE, NOW())
        RETURNING id
      `;
      await this.audit(tx, {
        storeId, actorId: userId, action: "STORE_CREATED", entityType: "Store", entityId: storeId,
        after: { name: input.name.trim(), slug, defaultBranchId: branchId, defaultWarehouseId: warehouses[0].id },
      });
      return { id: storeId, defaultBranchId: branchId, defaultWarehouseId: warehouses[0].id };
    });
  }

  async createBranch(
    userId: string, workspaceId: string, storeId: string,
    input: { code: string; name: string },
  ) {
    if (!input?.name?.trim()) throw new BadRequestException("Branch name is required");
    const code = canonicalizeBranchCode(input.code ?? "");
    const db = await this.db(userId, workspaceId);
    return db.$transaction(async (tx) => {
      const stores = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM stores WHERE id = ${storeId}::uuid FOR UPDATE
      `;
      if (!stores.length) throw new NotFoundException("Store not found");
      if (stores[0].status !== "ACTIVE") throw new ConflictException("Store is not active");
      const branches = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO branches (id, store_id, code, name, status, is_default, updated_at)
        VALUES (gen_random_uuid(), ${storeId}::uuid, ${code}, ${input.name.trim()}, 'ACTIVE', FALSE, NOW())
        RETURNING id
      `;
      const branchId = branches[0].id;
      const warehouses = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO warehouses (id, branch_id, code, name, status, is_default, updated_at)
        VALUES (gen_random_uuid(), ${branchId}::uuid, 'MAIN', 'คลังหลัก', 'ACTIVE', TRUE, NOW())
        RETURNING id
      `;
      await this.audit(tx, {
        storeId, actorId: userId, action: "BRANCH_CREATED", entityType: "Branch", entityId: branchId,
        after: { code, name: input.name.trim(), defaultWarehouseId: warehouses[0].id },
      });
      return { id: branchId, defaultWarehouseId: warehouses[0].id };
    });
  }

  async updateBranch(
    userId: string, workspaceId: string, storeId: string, branchId: string,
    input: { code: string; name: string; phone?: string | null; address?: Record<string, unknown> | null },
  ) {
    if (!input?.name?.trim()) throw new BadRequestException("Branch name is required");
    const name = input.name.trim();
    if (name.length > 160) throw new BadRequestException("Branch name must not exceed 160 characters");
    const code = canonicalizeBranchCode(input.code ?? "");
    if (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(code)) throw new BadRequestException("Branch code must use 1-40 letters, numbers, hyphens or underscores");
    const phone = input.phone?.trim() || null;
    if (phone && phone.length > 40) throw new BadRequestException("Branch phone must not exceed 40 characters");
    const allowed = ["line1", "line2", "subdistrict", "district", "province", "postalCode", "country"];
    let address: Record<string, string> | null = null;
    if (input.address && typeof input.address === "object" && !Array.isArray(input.address)) {
      address = {};
      for (const key of allowed) {
        const value = input.address[key];
        if (value !== undefined && value !== null) {
          if (typeof value !== "string" || value.length > 240) throw new BadRequestException("Invalid Branch address field: " + key);
          if (value.trim()) address[key] = value.trim();
        }
      }
      if (Object.keys(address).length === 0) address = null;
    } else if (input.address !== undefined && input.address !== null) {
      throw new BadRequestException("Branch address must be an object");
    }
    const db = await this.db(userId, workspaceId);
    return db.$transaction(async (tx) => {
      await this.lockStore(tx, storeId);
      const rows = await tx.$queryRaw<Array<{
        id: string; store_id: string; code: string; name: string; status: string;
        is_default: boolean; phone: string | null; address: Record<string, unknown> | null;
      }>>`
        SELECT id, store_id, code, name, status, is_default, phone, address
        FROM branches WHERE id = ${branchId}::uuid AND store_id = ${storeId}::uuid FOR UPDATE
      `;
      if (!rows.length) throw new NotFoundException("Branch not found in Store");
      if (rows[0].status !== "ACTIVE") throw new ConflictException("Archived Branch cannot be edited");
      const updated = await tx.$queryRaw<Array<{ id: string; code: string; name: string; status: string; isDefault: boolean; phone: string | null; address: Record<string, unknown> | null }>>`
        UPDATE branches SET code = ${code}, name = ${name}, phone = ${phone},
          address = ${address === null ? null : JSON.stringify(address)}::jsonb, updated_at = NOW()
        WHERE id = ${branchId}::uuid AND store_id = ${storeId}::uuid
        RETURNING id, code, name, status, is_default AS "isDefault", phone, address
      `;
      await this.audit(tx, {
        storeId, actorId: userId, action: "BRANCH_UPDATED", entityType: "Branch", entityId: branchId,
        before: rows[0], after: updated[0],
      });
      return updated[0];
    });
  }

  async createWarehouse(
    userId: string, workspaceId: string, branchId: string,
    input: { code: string; name: string },
  ) {
    if (!input?.name?.trim()) throw new BadRequestException("Warehouse name is required");
    const code = canonicalizeWarehouseCode(input.code ?? "");
    const db = await this.db(userId, workspaceId);
    return db.$transaction(async (tx) => {
      const branches = await tx.$queryRaw<Array<{ id: string; store_id: string; status: string }>>`
        SELECT id, store_id, status FROM branches WHERE id = ${branchId}::uuid FOR UPDATE
      `;
      if (!branches.length) throw new NotFoundException("Branch not found");
      if (branches[0].status !== "ACTIVE") throw new ConflictException("Branch is not active");
      const warehouses = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO warehouses (id, branch_id, code, name, status, is_default, updated_at)
        VALUES (gen_random_uuid(), ${branchId}::uuid, ${code}, ${input.name.trim()}, 'ACTIVE', FALSE, NOW())
        RETURNING id
      `;
      await this.audit(tx, {
        storeId: branches[0].store_id, actorId: userId, action: "WAREHOUSE_CREATED",
        entityType: "Warehouse", entityId: warehouses[0].id,
        after: { branchId, code, name: input.name.trim() },
      });
      return warehouses[0];
    });
  }

  async setDefaultBranch(userId: string, workspaceId: string, storeId: string, branchId: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException("A reason is required for changing the default Branch");
    const db = await this.db(userId, workspaceId);
    return db.$transaction(async (tx) => {
      await this.lockStore(tx, storeId);
      const target = await tx.$queryRaw<Array<{ id: string; is_default: boolean; status: string }>>`
        SELECT id, is_default, status FROM branches WHERE id = ${branchId}::uuid AND store_id = ${storeId}::uuid
      `;
      if (!target.length) throw new NotFoundException("Branch not found in Store");
      if (target[0].status !== "ACTIVE") throw new ConflictException("Only an active Branch can be default");
      if (target[0].is_default) return { id: branchId, unchanged: true };
      const current = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM branches WHERE store_id = ${storeId}::uuid AND is_default = TRUE FOR UPDATE
      `;
      if (current[0]) await tx.$executeRaw`UPDATE branches SET is_default = FALSE, updated_at = NOW() WHERE id = ${current[0].id}::uuid`;
      await tx.$executeRaw`UPDATE branches SET is_default = TRUE, updated_at = NOW() WHERE id = ${branchId}::uuid`;
      await this.audit(tx, {
        storeId, actorId: userId, action: "BRANCH_DEFAULT_CHANGED", entityType: "Branch", entityId: branchId,
        reason: reason.trim(), before: { defaultBranchId: current[0]?.id ?? null }, after: { defaultBranchId: branchId },
      });
      return { id: branchId, isDefault: true };
    });
  }

  async updateWarehouse(
    userId: string, workspaceId: string, storeId: string, branchId: string, warehouseId: string,
    input: { code: string; name: string },
  ) {
    if (!input?.name?.trim()) throw new BadRequestException("Warehouse name is required");
    const name = input.name.trim();
    if (name.length > 160) throw new BadRequestException("Warehouse name must not exceed 160 characters");
    const code = canonicalizeWarehouseCode(input.code ?? "");
    if (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(code)) throw new BadRequestException("Warehouse code must use 1-40 letters, numbers, hyphens or underscores");
    const db = await this.db(userId, workspaceId);
    return db.$transaction(async (tx) => {
      const branch = await this.lockBranch(tx, branchId);
      if (branch.store_id !== storeId) throw new NotFoundException("Branch not found in Store");
      const rows = await tx.$queryRaw<Array<{ id: string; code: string; name: string; status: string; is_default: boolean }>>`
        SELECT id, code, name, status, is_default FROM warehouses
        WHERE id = ${warehouseId}::uuid AND branch_id = ${branchId}::uuid FOR UPDATE
      `;
      if (!rows.length) throw new NotFoundException("Warehouse not found in Branch");
      if (rows[0].status !== "ACTIVE") throw new ConflictException("Archived Warehouse cannot be edited");
      const updated = await tx.$queryRaw<Array<{ id: string; branchId: string; code: string; name: string; status: string; isDefault: boolean }>>`
        UPDATE warehouses SET code = ${code}, name = ${name}, updated_at = NOW()
        WHERE id = ${warehouseId}::uuid AND branch_id = ${branchId}::uuid
        RETURNING id, branch_id AS "branchId", code, name, status, is_default AS "isDefault"
      `;
      await this.audit(tx, {
        storeId, actorId: userId, action: "WAREHOUSE_UPDATED", entityType: "Warehouse", entityId: warehouseId,
        before: rows[0], after: updated[0],
      });
      return updated[0];
    });
  }

  async setDefaultWarehouse(userId: string, workspaceId: string, branchId: string, warehouseId: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException("A reason is required for changing the default Warehouse");
    const db = await this.db(userId, workspaceId);
    return db.$transaction(async (tx) => {
      const branch = await this.lockBranch(tx, branchId);
      const target = await tx.$queryRaw<Array<{ id: string; is_default: boolean; status: string }>>`
        SELECT id, is_default, status FROM warehouses WHERE id = ${warehouseId}::uuid AND branch_id = ${branchId}::uuid
      `;
      if (!target.length) throw new NotFoundException("Warehouse not found in Branch");
      if (target[0].status !== "ACTIVE") throw new ConflictException("Only an active Warehouse can be default");
      if (target[0].is_default) return { id: warehouseId, unchanged: true };
      const current = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM warehouses WHERE branch_id = ${branchId}::uuid AND is_default = TRUE FOR UPDATE
      `;
      if (current[0]) await tx.$executeRaw`UPDATE warehouses SET is_default = FALSE, updated_at = NOW() WHERE id = ${current[0].id}::uuid`;
      await tx.$executeRaw`UPDATE warehouses SET is_default = TRUE, updated_at = NOW() WHERE id = ${warehouseId}::uuid`;
      await this.audit(tx, {
        storeId: branch.store_id, actorId: userId, action: "WAREHOUSE_DEFAULT_CHANGED",
        entityType: "Warehouse", entityId: warehouseId, reason: reason.trim(),
        before: { defaultWarehouseId: current[0]?.id ?? null }, after: { defaultWarehouseId: warehouseId },
      });
      return { id: warehouseId, isDefault: true };
    });
  }

  async archiveWarehouse(userId: string, workspaceId: string, branchId: string, warehouseId: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException("An archive reason is required");
    const db = await this.db(userId, workspaceId);
    return db.$transaction(async (tx) => {
      const branch = await this.lockBranch(tx, branchId);
      const rows = await tx.$queryRaw<Array<{ id: string; is_default: boolean; status: string }>>`
        SELECT id, is_default, status FROM warehouses WHERE id = ${warehouseId}::uuid AND branch_id = ${branchId}::uuid FOR UPDATE
      `;
      if (!rows.length) throw new NotFoundException("Warehouse not found in Branch");
      if (rows[0].status === "ARCHIVED") return { id: warehouseId, unchanged: true };
      const active = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM warehouses WHERE branch_id = ${branchId}::uuid AND status = 'ACTIVE' ORDER BY id FOR UPDATE
      `;
      if (active.length <= 1) throw new ConflictException("A Branch must retain at least one active Warehouse");
      if (rows[0].is_default) {
        const replacement = active.find((item) => item.id !== warehouseId);
        if (!replacement) throw new ConflictException("A replacement default Warehouse is required");
        await tx.$executeRaw`UPDATE warehouses SET is_default = FALSE, updated_at = NOW() WHERE id = ${warehouseId}::uuid`;
        await tx.$executeRaw`UPDATE warehouses SET is_default = TRUE, updated_at = NOW() WHERE id = ${replacement.id}::uuid`;
      }
      await tx.$executeRaw`UPDATE warehouses SET status = 'ARCHIVED', is_default = FALSE, updated_at = NOW() WHERE id = ${warehouseId}::uuid`;
      await this.audit(tx, {
        storeId: branch.store_id, actorId: userId, action: "WAREHOUSE_ARCHIVED",
        entityType: "Warehouse", entityId: warehouseId, reason: reason.trim(),
        before: rows[0], after: { status: "ARCHIVED", isDefault: false },
      });
      return { id: warehouseId, status: "ARCHIVED" };
    });
  }

  async archiveBranch(userId: string, workspaceId: string, storeId: string, branchId: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException("An archive reason is required");
    const db = await this.db(userId, workspaceId);
    return db.$transaction(async (tx) => {
      await this.lockStore(tx, storeId);
      const rows = await tx.$queryRaw<Array<{ id: string; is_default: boolean; status: string }>>`
        SELECT id, is_default, status FROM branches WHERE id = ${branchId}::uuid AND store_id = ${storeId}::uuid FOR UPDATE
      `;
      if (!rows.length) throw new NotFoundException("Branch not found in Store");
      if (rows[0].status === "ARCHIVED") return { id: branchId, unchanged: true };
      const active = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM branches WHERE store_id = ${storeId}::uuid AND status = 'ACTIVE' ORDER BY id FOR UPDATE
      `;
      if (active.length <= 1) throw new ConflictException("A Store must retain at least one active Branch");
      const stock = await tx.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM warehouses w JOIN stock_balances b ON b.warehouse_id = w.id
          WHERE w.branch_id = ${branchId}::uuid AND (b.on_hand > 0 OR b.reserved > 0)
        ) AS exists
      `;
      if (stock[0].exists) throw new ConflictException("Cannot archive a Branch while its Warehouses contain stock");
      const replacement = rows[0].is_default ? active.find((item) => item.id !== branchId) : undefined;
      if (rows[0].is_default && !replacement) throw new ConflictException("A replacement default Branch is required");
      if (rows[0].is_default) {
        await tx.$executeRaw`UPDATE branches SET is_default = FALSE, updated_at = NOW() WHERE id = ${branchId}::uuid`;
        await tx.$executeRaw`UPDATE branches SET is_default = TRUE, updated_at = NOW() WHERE id = ${replacement!.id}::uuid`;
      }
      await tx.$executeRaw`UPDATE warehouses SET status = 'ARCHIVED', is_default = FALSE, updated_at = NOW() WHERE branch_id = ${branchId}::uuid AND status <> 'ARCHIVED'`;
      await tx.$executeRaw`UPDATE branches SET status = 'ARCHIVED', is_default = FALSE, updated_at = NOW() WHERE id = ${branchId}::uuid`;
      await this.audit(tx, {
        storeId, actorId: userId, action: "BRANCH_ARCHIVED", entityType: "Branch", entityId: branchId,
        reason: reason.trim(), before: rows[0],
        after: { status: "ARCHIVED", isDefault: false, replacementDefaultBranchId: replacement?.id ?? null },
      });
      return { id: branchId, status: "ARCHIVED", replacementDefaultBranchId: replacement?.id ?? null };
    });
  }

  private async lockStore(tx: Tx, storeId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT id, status FROM stores WHERE id = ${storeId}::uuid FOR UPDATE
    `;
    if (!rows.length) throw new NotFoundException("Store not found");
    if (rows[0].status !== "ACTIVE") throw new ConflictException("Store is not active");
    return rows[0];
  }

  private async lockBranch(tx: Tx, branchId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string; store_id: string; status: string }>>`
      SELECT id, store_id, status FROM branches WHERE id = ${branchId}::uuid FOR UPDATE
    `;
    if (!rows.length) throw new NotFoundException("Branch not found");
    if (rows[0].status !== "ACTIVE") throw new ConflictException("Branch is not active");
    return rows[0];
  }
}
