import { Injectable } from "@nestjs/common";
import { WorkspaceDatabaseRegistry } from "../../database/workspace-database.registry";

@Injectable()
export class TenantService {
  constructor(private readonly databases: WorkspaceDatabaseRegistry) {}

  async listSettings(userId: string, workspaceId: string) {
    const database = await this.databases.forMembership(userId, workspaceId);
    return database.$queryRaw<Array<{ key: string; value: unknown; updated_at: Date }>>`
      SELECT key, value, updated_at
      FROM tenant_settings
      ORDER BY key ASC
    `;
  }
}
