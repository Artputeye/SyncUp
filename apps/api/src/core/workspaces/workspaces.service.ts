import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { WorkspaceProvisioningService } from "../../database/workspace-provisioning.service";
import { DEFAULT_WORKSPACE_ROLES, WORKSPACE_PERMISSIONS } from "../rbac/permission-catalog";



@Injectable()
export class WorkspacesService {
  constructor(private readonly db: PrismaService, private readonly provisioning: WorkspaceProvisioningService) {}

  async listForUser(userId: string) {
    const memberships = await this.db.membership.findMany({
      where: { userId, workspace: { slug: { not: "test" } } },
      include: { workspace: { select: { id: true, slug: true, name: true, status: true, createdAt: true } }, roles: { include: { role: { select: { key: true } } } } },
      orderBy: { createdAt: "asc" }
    });
    return memberships.map(({ workspace, isOwner, roles }) => ({ ...workspace, isOwner, roles: roles.map(({ role }) => ({ key: role.key })) }));
  }

  async create(input: { slug: string; name: string; ownerUserId: string }) {
    const workspace = await this.db.workspace.create({
      data: { slug: input.slug.toLowerCase(), name: input.name, memberships: { create: { userId: input.ownerUserId, isOwner: true } } }
    });

    try {
      // Bootstrap control-plane roles before provisioning can mark the Workspace ACTIVE.
      // This keeps a partially initialized Workspace from becoming available to users.
      await this.ensureDefaultRoles(workspace.id);
      return await this.provisioning.provision(workspace.id);
    } catch (error) {
      // Provisioning marks its own failures FAILED; this also covers a role-bootstrap failure
      // that occurs before the provisioning service is entered.
      await this.db.workspace.updateMany({
        where: { id: workspace.id, status: "PROVISIONING" },
        data: { status: "FAILED" }
      });
      throw error;
    }
  }

  private async ensureDefaultRoles(workspaceId: string, includeInventoryStaff = false) {
    await this.db.permission.createMany({ data: WORKSPACE_PERMISSIONS.map(permission => ({ ...permission })), skipDuplicates: true });
    for (const definition of DEFAULT_WORKSPACE_ROLES) {
      // Inventory Staff is created only when an authorized assignment requests it.
      if (definition.key === "inventory_staff" && !includeInventoryStaff) continue;
      let role = await this.db.role.findFirst({ where: { workspaceId, key: definition.key } });
      if (!role) role = await this.db.role.create({ data: { workspaceId, key: definition.key, name: definition.name, isSystem: true } });
      const permissions = await this.db.permission.findMany({ where: { key: { in: [...definition.permissions] } }, select: { id: true } });
      await this.db.rolePermission.createMany({ data: permissions.map(permission => ({ roleId: role!.id, permissionId: permission.id })), skipDuplicates: true });
    }
  }

  private async membershipFor(userId: string, workspaceId: string) {
    const membership = await this.db.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      include: { workspace: { select: { status: true } }, roles: { include: { role: true } } }
    });
    if (!membership) throw new ForbiddenException("คุณไม่ได้เป็นสมาชิกของ Workspace นี้");
    if (membership.workspace.status !== "ACTIVE") {
      throw new ForbiddenException("Workspace นี้ไม่ได้อยู่ในสถานะ ACTIVE");
    }
    return membership;
  }

  private async assertPermission(userId: string, workspaceId: string, permissionKey: string) {
    const membership = await this.membershipFor(userId, workspaceId);
    if (membership.isOwner) return membership;
    const detailed = await this.db.membership.findUnique({
      where: { id: membership.id },
      include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } }
    });
    const hasPermission = detailed?.roles.some(item => item.role.permissions.some(link => link.permission.key === permissionKey)) ?? false;
    if (!hasPermission) throw new ForbiddenException("คุณไม่มีสิทธิ์ดำเนินการนี้");
    return membership;
  }

  async listMembers(userId: string, workspaceId: string) {
    await this.assertPermission(userId, workspaceId, "members.view");
    const rows = await this.db.membership.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, email: true, displayName: true, status: true } }, roles: { include: { role: { select: { key: true, name: true } } } } },
      orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }]
    });
    return rows.map(({ roles, ...member }) => ({ ...member, roles: roles.map(item => item.role) }));
  }

  async listRoles(userId: string, workspaceId: string) {
    await this.membershipFor(userId, workspaceId);
    await this.ensureDefaultRoles(workspaceId);
    const rows = await this.db.role.findMany({
      where: { workspaceId },
      include: { permissions: { include: { permission: true } } },
      orderBy: { name: "asc" }
    });
    return rows.map(role => ({ id: role.id, key: role.key, name: role.name, isSystem: role.isSystem, permissions: role.permissions.map(item => item.permission) }));
  }

  async addMember(actorId: string, workspaceId: string, email: string, roleKey: string) {
    const actorMembership = await this.assertPermission(actorId, workspaceId, "members.manage");

    if (!email?.trim()) throw new BadRequestException("กรุณาระบุอีเมลสมาชิก");
    if (!DEFAULT_WORKSPACE_ROLES.some(definition => definition.key === roleKey)) {
      throw new BadRequestException("ไม่พบบทบาทที่เลือก");
    }
    if (roleKey === "admin" && !actorMembership.isOwner) {
      throw new ForbiddenException("เฉพาะเจ้าของ Workspace เท่านั้นที่เพิ่มผู้ดูแลระบบได้");
    }

    const user = await this.db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user || user.status !== "ACTIVE") throw new NotFoundException("ไม่พบบัญชีผู้ใช้นี้ กรุณาให้สมาชิกสมัครบัญชีก่อน");
    const exists = await this.db.membership.findUnique({ where: { userId_workspaceId: { userId: user.id, workspaceId } } });
    if (exists) throw new ConflictException("ผู้ใช้นี้เป็นสมาชิก Workspace อยู่แล้ว");

    // Provision Inventory Staff only after authorization and target-member validation succeed.
    await this.ensureDefaultRoles(workspaceId, roleKey === "inventory_staff");
    const role = await this.db.role.findFirst({ where: { key: roleKey, workspaceId } });
    if (!role) throw new BadRequestException("ไม่พบบทบาทที่เลือก");
    const member = await this.db.membership.create({ data: { userId: user.id, workspaceId, roles: { create: { roleId: role.id } } } });
    return { id: member.id, email: user.email, displayName: user.displayName, role: { key: role.key, name: role.name } };
  }

  async updateMemberRole(actorId: string, workspaceId: string, membershipId: string, roleKey: string) {
    await this.assertPermission(actorId, workspaceId, "members.manage");
    const target = await this.db.membership.findFirst({ where: { id: membershipId, workspaceId } });
    if (!target) throw new NotFoundException("ไม่พบสมาชิก");
    if (target.isOwner) throw new ForbiddenException("ไม่สามารถเปลี่ยนบทบาทเจ้าของ Workspace ได้");
    const role = await this.db.role.findFirst({ where: { key: roleKey, workspaceId } });
    if (!role) throw new BadRequestException("ไม่พบบทบาทที่เลือก");
    if (role.key === "admin" && !(await this.membershipFor(actorId, workspaceId)).isOwner) throw new ForbiddenException("เฉพาะเจ้าของ Workspace เท่านั้นที่กำหนดผู้ดูแลระบบได้");
    await this.db.$transaction([
      this.db.membershipRole.deleteMany({ where: { membershipId } }),
      this.db.membershipRole.create({ data: { membershipId, roleId: role.id } })
    ]);
    return { success: true };
  }

  async removeMember(actorId: string, workspaceId: string, membershipId: string) {
    await this.assertPermission(actorId, workspaceId, "members.manage");
    const target = await this.db.membership.findFirst({ where: { id: membershipId, workspaceId } });
    if (!target) throw new NotFoundException("ไม่พบสมาชิก");
    if (target.isOwner || target.userId === actorId) throw new ForbiddenException("ไม่สามารถนำเจ้าของ Workspace หรือตัวเองออกได้");
    await this.db.membership.delete({ where: { id: membershipId } });
    return { success: true };
  }

  async updateRolePermissions(actorId: string, workspaceId: string, roleKey: string, permissionKeys: string[]) {
    await this.assertPermission(actorId, workspaceId, "roles.manage");
    if (!Array.isArray(permissionKeys) || permissionKeys.some(key => typeof key !== "string")) throw new BadRequestException("รูปแบบสิทธิ์ไม่ถูกต้อง");
    const role = await this.db.role.findFirst({ where: { key: roleKey, workspaceId } });
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
