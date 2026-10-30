import { ForbiddenException, Injectable, OnModuleDestroy, NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PrismaService } from "./prisma.service";

@Injectable()
export class WorkspaceDatabaseRegistry implements OnModuleDestroy {
  private readonly clients = new Map<string, PrismaClient>();

  constructor(private readonly controlDb: PrismaService) {}

  async forMembership(userId: string, workspaceId: string): Promise<PrismaClient> {
    const membership = await this.controlDb.membership.findFirst({
      where: { userId, workspaceId, workspace: { status: "ACTIVE", database: { isNot: null } } },
      include: { workspace: { include: { database: true } } }
    });
    if (!membership) throw new ForbiddenException("No active membership for this workspace");
    const database = membership.workspace.database;
    if (!database) throw new NotFoundException("Workspace database is not provisioned");

    const cached = this.clients.get(workspaceId);
    if (cached) return cached;

    const runtimeUrl = process.env.WORKSPACE_DATABASE_RUNTIME_URL;
    if (!runtimeUrl) throw new Error("WORKSPACE_DATABASE_RUNTIME_URL is not configured");
    const url = new URL(runtimeUrl);
    url.pathname = "/" + database.databaseName;
    const client = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    await client.$connect();
    this.clients.set(workspaceId, client);
    return client;
  }

  async evict(workspaceId: string) {
    const client = this.clients.get(workspaceId);
    if (!client) return;
    this.clients.delete(workspaceId);
    await client.$disconnect();
  }

  async onModuleDestroy() {
    await Promise.all([...this.clients.values()].map(client => client.$disconnect()));
    this.clients.clear();
  }
}
