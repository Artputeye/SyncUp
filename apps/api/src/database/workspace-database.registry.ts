import { ForbiddenException, Injectable, OnModuleDestroy, NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PrismaService } from "./prisma.service";
import { decryptWorkspaceCredential } from "./workspace-credential.crypto";

type CachedClient = { identity: string; client: PrismaClient };
type PendingClient = { identity: string; promise: Promise<PrismaClient> };

@Injectable()
export class WorkspaceDatabaseRegistry implements OnModuleDestroy {
  private readonly clients = new Map<string, CachedClient>();
  private readonly pending = new Map<string, PendingClient>();

  constructor(private readonly controlDb: PrismaService) {}

  protected createClient(url: string): PrismaClient {
    return new PrismaClient({ datasources: { db: { url } } });
  }

  private databaseIdentity(database: {
    host: string;
    port: number;
    databaseName: string;
    username: string;
    secretCipher: string | null;
  }): string {
    return JSON.stringify([
      database.host,
      database.port,
      database.databaseName,
      database.username,
      database.secretCipher,
    ]);
  }

  async forMembership(userId: string, workspaceId: string): Promise<PrismaClient> {
    const membership = await this.controlDb.membership.findFirst({
      where: { userId, workspaceId, workspace: { status: "ACTIVE", database: { isNot: null } } },
      include: { workspace: { include: { database: true } } },
    });
    if (!membership) throw new ForbiddenException("No active membership for this workspace");
    const database = membership.workspace.database;
    if (!database) throw new NotFoundException("Workspace database is not provisioned");
    if (!/^syncup_ws_[a-f0-9]{12}$/.test(database.databaseName) || !/^syncup_rt_[a-f0-9]{12}$/.test(database.username)) {
      throw new NotFoundException("Workspace database identity is invalid");
    }
    if (!database.secretCipher) throw new NotFoundException("Workspace database credential is unavailable");

    const identity = this.databaseIdentity(database);
    const cached = this.clients.get(workspaceId);
    if (cached?.identity === identity) return cached.client;
    if (cached) {
      this.clients.delete(workspaceId);
      await cached.client.$disconnect();
    }

    const inFlight = this.pending.get(workspaceId);
    if (inFlight) {
      if (inFlight.identity === identity) return inFlight.promise;
      await inFlight.promise.catch(() => undefined);
      return this.forMembership(userId, workspaceId);
    }

    const password = decryptWorkspaceCredential(database.secretCipher);
    const url = new URL("postgresql://localhost");
    url.hostname = database.host;
    url.port = String(database.port);
    url.username = database.username;
    url.password = password;
    url.pathname = "/" + database.databaseName;
    url.searchParams.set("schema", "public");

    const pending: PendingClient = {
      identity,
      promise: Promise.resolve(null as unknown as PrismaClient),
    };
    pending.promise = (async () => {
      const client = this.createClient(url.toString());
      try {
        await client.$connect();
        const latest = await this.controlDb.workspaceDatabase.findUnique({ where: { workspaceId } });
        if (!latest || this.databaseIdentity(latest) !== identity) {
          await client.$disconnect();
          throw new NotFoundException("Workspace database identity changed during connection");
        }
        this.clients.set(workspaceId, { identity, client });
        return client;
      } catch (error) {
        await client.$disconnect().catch(() => undefined);
        throw error;
      } finally {
        if (this.pending.get(workspaceId) === pending) this.pending.delete(workspaceId);
      }
    })();
    this.pending.set(workspaceId, pending);
    return pending.promise;
  }

  async evict(workspaceId: string) {
    const inFlight = this.pending.get(workspaceId);
    if (inFlight) await inFlight.promise.catch(() => undefined);
    const cached = this.clients.get(workspaceId);
    if (!cached) return;
    this.clients.delete(workspaceId);
    await cached.client.$disconnect();
  }

  async onModuleDestroy() {
    await Promise.all([...this.pending.values()].map((item) => item.promise.catch(() => undefined)));
    await Promise.all([...this.clients.values()].map((item) => item.client.$disconnect()));
    this.clients.clear();
    this.pending.clear();
  }
}
