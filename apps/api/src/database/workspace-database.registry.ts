import { ForbiddenException, Injectable, OnModuleDestroy, NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PrismaService } from "./prisma.service";
import { decryptWorkspaceCredential } from "./workspace-credential.crypto";

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
    if (!/^syncup_ws_[a-f0-9]{12}$/.test(database.databaseName) || !/^syncup_rt_[a-f0-9]{12}$/.test(database.username)) {
      throw new NotFoundException("Workspace database identity is invalid");
    }

    const cached = this.clients.get(workspaceId);
    if (cached) return cached;
    if (!database.secretCipher) throw new NotFoundException("Workspace database credential is unavailable");

    const password = decryptWorkspaceCredential(database.secretCipher);
    const url = new URL("postgresql://localhost");
    url.hostname = database.host;
    url.port = String(database.port);
    url.username = database.username;
    url.password = password;
    url.pathname = "/" + database.databaseName;
    url.searchParams.set("schema", "public");
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
