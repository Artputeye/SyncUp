import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../../database/prisma.service";
import { ModuleRegistryService } from "./module-registry.service";
import { REQUIRED_MODULE_CAPABILITY } from "./module-capability.decorator";

type CapabilityRequest = {
  user?: { userId?: string };
  params?: Record<string, unknown>;
  headers?: Record<string, string | string[] | undefined>;
  workspaceId?: string;
};

@Injectable()
export class WorkspaceModuleCapabilityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: PrismaService,
    private readonly modules: ModuleRegistryService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const moduleId = this.reflector.getAllAndOverride<string>(REQUIRED_MODULE_CAPABILITY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!moduleId) return true;

    const request = context.switchToHttp().getRequest<CapabilityRequest>();
    const userId = request.user?.userId;
    const workspaceId = request.params?.workspaceId;
    if (!userId || typeof workspaceId !== "string" || !workspaceId.trim()) {
      throw new ForbiddenException("Authenticated Workspace route context is required");
    }

    const headerWorkspaceId = request.headers?.["x-workspace-id"];
    if (headerWorkspaceId !== undefined && (typeof headerWorkspaceId !== "string" || headerWorkspaceId !== workspaceId)) {
      throw new ForbiddenException("Workspace route and header context do not match");
    }

    const membership = await this.db.membership.findFirst({
      where: {
        userId,
        workspaceId,
        workspace: { status: "ACTIVE" },
      },
      select: {
        id: true,
        workspace: {
          select: {
            id: true,
            type: true,
            provisioningProfileId: true,
            provisioningProfileVersion: true,
          },
        },
      },
    });
    if (!membership?.workspace) {
      throw new ForbiddenException("No active membership for this Workspace");
    }

    let manifest;
    try {
      manifest = this.modules.get(moduleId);
    } catch {
      throw new ForbiddenException("Requested Module is not registered");
    }

    const workspace = membership.workspace;
    if (!workspace.type || !manifest.workspaceTypes.includes(workspace.type)) {
      throw new ForbiddenException("Module is not available for this Workspace Type");
    }

    const profile = this.modules.resolvePersistedProfile(
      workspace.type,
      workspace.provisioningProfileId,
      workspace.provisioningProfileVersion,
    );
    if (!profile || !profile.allowedModuleIds.includes(moduleId)) {
      throw new ForbiddenException("Workspace Provisioning Profile does not grant this Module");
    }

    const installation = await this.db.moduleInstallation.findUnique({
      where: { workspaceId_moduleId: { workspaceId, moduleId } },
      select: { enabled: true, status: true },
    });
    if (!installation?.enabled || installation.status !== "ENABLED") {
      throw new ForbiddenException("Module is not enabled for this Workspace");
    }

    request.workspaceId = workspaceId;
    return true;
  }
}
