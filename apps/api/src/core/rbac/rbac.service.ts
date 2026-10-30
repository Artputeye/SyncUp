import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";

@Injectable()
export class RbacService {
  constructor(private readonly db: PrismaService) {}

  async hasPermission(userId: string, workspaceId: string, permissionKey: string): Promise<boolean> {
    const membership = await this.db.membership.findFirst({
      where: { userId, workspaceId, workspace: { status: "ACTIVE" } },
      include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } }
    });
    if (!membership) return false;
    if (membership.isOwner) return true;
    return membership.roles.some(({ role }) =>
      role.permissions.some(({ permission }) => permission.key === permissionKey)
    );
  }
}
