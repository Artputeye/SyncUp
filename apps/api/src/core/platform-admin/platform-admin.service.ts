import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Client } from "pg";
import { PrismaService } from "../../database/prisma.service";
import { decryptWorkspaceCredential } from "../../database/workspace-credential.crypto";

@Injectable()
export class PlatformAdminService {
  constructor(private readonly db: PrismaService) {}

  async overview() {
    const [users, activeUsers, workspaces, activeWorkspaces, suspendedWorkspaces, memberships] = await Promise.all([
      this.db.user.count(), this.db.user.count({ where: { status: "ACTIVE" } }),
      this.db.workspace.count(), this.db.workspace.count({ where: { status: "ACTIVE" } }),
      this.db.workspace.count({ where: { status: "SUSPENDED" } }), this.db.membership.count()
    ]);
    return { users, activeUsers, disabledUsers: users - activeUsers, workspaces, activeWorkspaces, suspendedWorkspaces, memberships };
  }

  async listUsers(search = "") {
    const q = search.trim();
    return this.db.user.findMany({
      where: q ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { displayName: { contains: q, mode: "insensitive" } }] } : undefined,
      select: { id: true, email: true, displayName: true, status: true, isPlatformAdmin: true, createdAt: true, _count: { select: { memberships: true } } },
      orderBy: { createdAt: "desc" }, take: 200
    });
  }

  async setUserStatus(userId: string, status: "ACTIVE" | "DISABLED", actorId: string) {
    if (!["ACTIVE", "DISABLED"].includes(status)) throw new BadRequestException("Invalid user status");
    if (userId === actorId && status === "DISABLED") throw new BadRequestException("ไม่สามารถปิดใช้งานบัญชี Platform Admin ที่กำลังเข้าสู่ระบบได้");
    const target = await this.db.user.findUnique({ where: { id: userId } });
    if (!target) throw new NotFoundException("ไม่พบบัญชีผู้ใช้");
    if (target.isPlatformAdmin && status === "DISABLED") {
      const admins = await this.db.user.count({ where: { isPlatformAdmin: true, status: "ACTIVE" } });
      if (admins <= 1) throw new BadRequestException("ต้องมี Platform Admin ที่ใช้งานได้อย่างน้อยหนึ่งบัญชี");
    }
    const user = await this.db.user.update({ where: { id: userId }, data: { status }, select: { id: true, email: true, status: true } });
    if (status === "DISABLED") await this.db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return user;
  }

  async listWorkspaces() {
    const rows = await this.db.workspace.findMany({
      include: { database: true, _count: { select: { memberships: true } } },
      orderBy: { createdAt: "desc" }
    });
    return Promise.all(rows.map(async workspace => {
      const database = workspace.database;
      let databaseStatus: "CONNECTED" | "DISCONNECTED" | "NOT_CONFIGURED" = "NOT_CONFIGURED";
      if (database?.secretCipher) {
        let client: Client | undefined;
        try {
          client = new Client({
            host: database.host, port: database.port, database: database.databaseName,
            user: database.username, password: decryptWorkspaceCredential(database.secretCipher),
            connectionTimeoutMillis: 2500, query_timeout: 2500
          });
          await client.connect(); await client.query("SELECT 1"); databaseStatus = "CONNECTED";
        } catch { databaseStatus = "DISCONNECTED"; }
        finally { await client?.end().catch(() => undefined); }
      }
      return {
        id: workspace.id, slug: workspace.slug, name: workspace.name, status: workspace.status,
        createdAt: workspace.createdAt, memberCount: workspace._count.memberships,
        database: database ? { provider: database.provider, databaseName: database.databaseName, schemaVersion: database.schemaVersion, status: databaseStatus } : { status: databaseStatus }
      };
    }));
  }

  async setWorkspaceStatus(workspaceId: string, status: "ACTIVE" | "SUSPENDED") {
    if (!["ACTIVE", "SUSPENDED"].includes(status)) throw new BadRequestException("Invalid workspace status");
    const workspace = await this.db.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) throw new NotFoundException("ไม่พบ Workspace");
    if (status === "ACTIVE" && workspace.status !== "ACTIVE" && workspace.status !== "SUSPENDED") throw new BadRequestException("Workspace ที่ยังไม่พร้อมใช้งานหรือเกิดข้อผิดพลาดต้องตรวจสอบก่อนเปิดใช้งาน");
    if (status === "SUSPENDED" && workspace.status !== "ACTIVE" && workspace.status !== "SUSPENDED") throw new BadRequestException("ระงับได้เฉพาะ Workspace ที่พร้อมใช้งาน");
    return this.db.workspace.update({ where: { id: workspaceId }, data: { status }, select: { id: true, name: true, status: true } });
  }

  async listMembers(workspaceId: string) {
    const workspace = await this.db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
    if (!workspace) throw new NotFoundException("ไม่พบ Workspace");
    return this.db.membership.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, email: true, displayName: true, status: true, isPlatformAdmin: true } },
        roles: { include: { role: { select: { key: true, name: true } } } } },
      orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }]
    }).then(rows => rows.map(({ roles, ...row }) => ({ ...row, roles: roles.map(item => item.role) })));
  }

  async listRoles(workspaceId: string) {
    const roles = await this.db.role.findMany({
      where: { workspaceId }, include: { permissions: { include: { permission: true } } }, orderBy: { name: "asc" }
    });
    return roles.map(role => ({ id: role.id, key: role.key, name: role.name, isSystem: role.isSystem, permissions: role.permissions.map(link => link.permission) }));
  }

  async setMemberRole(workspaceId: string, membershipId: string, roleKey: string) {
    const member = await this.db.membership.findFirst({ where: { id: membershipId, workspaceId }, include: { user: true } });
    if (!member) throw new NotFoundException("ไม่พบสมาชิก");
    if (member.isOwner) throw new BadRequestException("ไม่สามารถเปลี่ยนบทบาทเจ้าของ Workspace ได้");
    const role = await this.db.role.findFirst({ where: { workspaceId, key: roleKey } });
    if (!role) throw new BadRequestException("ไม่พบบทบาทที่เลือก");
    await this.db.$transaction([
      this.db.membershipRole.deleteMany({ where: { membershipId } }),
      this.db.membershipRole.create({ data: { membershipId, roleId: role.id } })
    ]);
    return { success: true };
  }

  async removeMember(workspaceId: string, membershipId: string) {
    const member = await this.db.membership.findFirst({ where: { id: membershipId, workspaceId } });
    if (!member) throw new NotFoundException("ไม่พบสมาชิก");
    if (member.isOwner) throw new BadRequestException("ไม่สามารถนำเจ้าของ Workspace ออกได้");
    await this.db.membership.delete({ where: { id: membershipId } });
    return { success: true };
  }

  async setRolePermissions(workspaceId: string, roleKey: string, permissionKeys: string[]) {
    if (!Array.isArray(permissionKeys) || permissionKeys.some(key => typeof key !== "string")) throw new BadRequestException("รูปแบบสิทธิ์ไม่ถูกต้อง");
    const role = await this.db.role.findFirst({ where: { workspaceId, key: roleKey } });
    if (!role || role.key === "admin") throw new BadRequestException("ไม่สามารถแก้ไขบทบาทนี้ได้");
    const permissions = await this.db.permission.findMany({ where: { key: { in: permissionKeys } } });
    if (permissions.length !== new Set(permissionKeys).size) throw new BadRequestException("มีสิทธิ์ที่ไม่รู้จัก");
    await this.db.$transaction([
      this.db.rolePermission.deleteMany({ where: { roleId: role.id } }),
      ...permissions.map(permission => this.db.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } }))
    ]);
    return { success: true };
  }
}
