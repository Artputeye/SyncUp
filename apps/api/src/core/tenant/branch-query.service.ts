import { Injectable, NotFoundException } from "@nestjs/common";
import { WorkspaceDatabaseRegistry } from "../../database/workspace-database.registry";

export type BranchAddress = {
  line1?: string; line2?: string; subdistrict?: string; district?: string;
  province?: string; postalCode?: string; country?: string;
};
export type BranchDetail = {
  id: string; storeId: string; code: string; name: string; status: string;
  isDefault: boolean; phone: string | null; address: BranchAddress | null;
  createdAt: Date; updatedAt: Date; activeWarehouseCount?: number; defaultWarehouseName?: string | null;
};

@Injectable()
export class BranchQueryService {
  constructor(private readonly databases: WorkspaceDatabaseRegistry) {}

  async listBranches(userId: string, workspaceId: string, storeId: string) {
    const db = await this.databases.forMembership(userId, workspaceId);
    const stores = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM stores WHERE id = ${storeId}::uuid
    `;
    if (!stores.length) throw new NotFoundException("Store not found");
    return db.$queryRaw<Array<BranchDetail>>`
      SELECT b.id, b.store_id AS "storeId", b.code, b.name, b.status,
        b.is_default AS "isDefault", b.phone, b.address,
        b.created_at AS "createdAt", b.updated_at AS "updatedAt",
        (SELECT COUNT(*)::int FROM warehouses w WHERE w.branch_id = b.id AND w.status = 'ACTIVE') AS "activeWarehouseCount",
        (SELECT w.name FROM warehouses w WHERE w.branch_id = b.id AND w.status = 'ACTIVE' AND w.is_default = TRUE LIMIT 1) AS "defaultWarehouseName"
      FROM branches b WHERE b.store_id = ${storeId}::uuid
      ORDER BY b.is_default DESC, b.created_at ASC, b.name ASC
    `;
  }

  async getBranch(userId: string, workspaceId: string, storeId: string, branchId: string): Promise<BranchDetail> {
    const db = await this.databases.forMembership(userId, workspaceId);
    const rows = await db.$queryRaw<BranchDetail[]>`
      SELECT b.id, b.store_id AS "storeId", b.code, b.name, b.status,
        b.is_default AS "isDefault", b.phone, b.address,
        b.created_at AS "createdAt", b.updated_at AS "updatedAt",
        (SELECT COUNT(*)::int FROM warehouses w WHERE w.branch_id = b.id AND w.status = 'ACTIVE') AS "activeWarehouseCount",
        (SELECT w.name FROM warehouses w WHERE w.branch_id = b.id AND w.status = 'ACTIVE' AND w.is_default = TRUE LIMIT 1) AS "defaultWarehouseName"
      FROM branches b WHERE b.id = ${branchId}::uuid AND b.store_id = ${storeId}::uuid
    `;
    if (!rows.length) throw new NotFoundException("Branch not found in Store");
    return rows[0];
  }
}
