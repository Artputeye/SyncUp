import { Injectable, NotFoundException } from "@nestjs/common";
import { WorkspaceDatabaseRegistry } from "../../database/workspace-database.registry";

export type WarehouseRecord = {
  id: string; branchId: string; code: string; name: string; status: string;
  isDefault: boolean; createdAt: Date; updatedAt: Date;
};

@Injectable()
export class WarehouseQueryService {
  constructor(private readonly databases: WorkspaceDatabaseRegistry) {}

  async listWarehouses(userId: string, workspaceId: string, storeId: string, branchId: string) {
    const db = await this.databases.forMembership(userId, workspaceId);
    const branches = await db.$queryRaw<Array<{ id: string }>>`
      SELECT b.id FROM branches b
      INNER JOIN stores s ON s.id = b.store_id
      WHERE b.id = ${branchId}::uuid AND b.store_id = ${storeId}::uuid
    `;
    if (!branches.length) throw new NotFoundException("Branch not found in Store");
    return db.$queryRaw<WarehouseRecord[]>`
      SELECT w.id, w.branch_id AS "branchId", w.code, w.name, w.status,
        w.is_default AS "isDefault", w.created_at AS "createdAt", w.updated_at AS "updatedAt"
      FROM warehouses w
      WHERE w.branch_id = ${branchId}::uuid
      ORDER BY w.is_default DESC, w.created_at ASC, w.name ASC
    `;
  }

  async getWarehouse(userId: string, workspaceId: string, storeId: string, branchId: string, warehouseId: string) {
    const db = await this.databases.forMembership(userId, workspaceId);
    const rows = await db.$queryRaw<WarehouseRecord[]>`
      SELECT w.id, w.branch_id AS "branchId", w.code, w.name, w.status,
        w.is_default AS "isDefault", w.created_at AS "createdAt", w.updated_at AS "updatedAt"
      FROM warehouses w
      INNER JOIN branches b ON b.id = w.branch_id
      WHERE w.id = ${warehouseId}::uuid AND w.branch_id = ${branchId}::uuid
        AND b.store_id = ${storeId}::uuid
    `;
    if (!rows.length) throw new NotFoundException("Warehouse not found in Branch");
    return rows[0];
  }
}
