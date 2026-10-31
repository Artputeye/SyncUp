import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RbacService } from "./rbac.service";
import { REQUIRED_PERMISSION } from "./rbac.decorator";

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly rbac: RbacService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<string>(REQUIRED_PERMISSION, [
      context.getHandler(), context.getClass()
    ]);
    if (!permission) return true;
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.userId;
    const workspaceId = request.params?.workspaceId ?? request.headers?.["x-workspace-id"];
    if (!userId || typeof workspaceId !== "string") throw new ForbiddenException("Workspace authorization context is required");
    if (!(await this.rbac.hasPermission(userId, workspaceId, permission))) {
      throw new ForbiddenException("Missing workspace permission");
    }
    request.workspaceId = workspaceId;
    return true;
  }
}