import { Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { ModuleActivationService } from "./module-activation.service";

type AuthenticatedRequest = Request & { user: { userId: string } };

@Controller("workspaces/:workspaceId/modules")
@UseGuards(AuthGuard)
export class ModulesController {
  constructor(private readonly modules: ModuleActivationService) {}

  @Get()
  list(@Param("workspaceId") workspaceId: string, @Req() request: AuthenticatedRequest) {
    return this.modules.list(request.user.userId, workspaceId);
  }

  @Get("profile")
  profile(@Param("workspaceId") workspaceId: string, @Req() request: AuthenticatedRequest) {
    return this.modules.getProvisioningProfile(request.user.userId, workspaceId);
  }

  @Get("audit")
  auditLog(@Param("workspaceId") workspaceId: string, @Req() request: AuthenticatedRequest) {
    return this.modules.auditLog(request.user.userId, workspaceId);
  }

  @Get(":moduleId/compatibility")
  compatibility(
    @Param("workspaceId") workspaceId: string,
    @Param("moduleId") moduleId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.modules.checkCompatibility(request.user.userId, workspaceId, moduleId);
  }

  @Post(":moduleId/install")
  install(
    @Param("workspaceId") workspaceId: string,
    @Param("moduleId") moduleId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.modules.install(request.user.userId, workspaceId, moduleId);
  }

  @Post(":moduleId/enable")
  enable(
    @Param("workspaceId") workspaceId: string,
    @Param("moduleId") moduleId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.modules.enable(request.user.userId, workspaceId, moduleId);
  }

  @Post(":moduleId/disable")
  disable(
    @Param("workspaceId") workspaceId: string,
    @Param("moduleId") moduleId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.modules.disable(request.user.userId, workspaceId, moduleId);
  }
}
