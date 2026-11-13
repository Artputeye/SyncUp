import { Body, Controller, Get, Param, Patch, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { RequirePermission } from "../rbac/rbac.decorator";
import { RbacGuard } from "../rbac/rbac.guard";
import { RequireModuleCapability } from "../modules/module-capability.decorator";
import { WorkspaceModuleCapabilityGuard } from "../modules/workspace-module-capability.guard";
import { BranchQueryService } from "./branch-query.service";
import { StoreLifecycleService } from "./store-lifecycle.service";

type AuthenticatedRequest = Request & { user: { userId: string } };

@Controller("tenant")
@RequireModuleCapability("commerce")
@UseGuards(AuthGuard, WorkspaceModuleCapabilityGuard, RbacGuard)
export class BranchesController {
  constructor(private readonly branches: BranchQueryService, private readonly lifecycle: StoreLifecycleService) {}

  @Get(":workspaceId/stores/:storeId/branches")
  @RequirePermission("commerce.store.view")
  list(@Param("workspaceId") workspaceId: string, @Param("storeId") storeId: string, @Req() request: AuthenticatedRequest) {
    return this.branches.listBranches(request.user.userId, workspaceId, storeId);
  }

  @Get(":workspaceId/stores/:storeId/branches/:branchId")
  @RequirePermission("commerce.store.view")
  get(@Param("workspaceId") workspaceId: string, @Param("storeId") storeId: string, @Param("branchId") branchId: string, @Req() request: AuthenticatedRequest) {
    return this.branches.getBranch(request.user.userId, workspaceId, storeId, branchId);
  }

  @Patch(":workspaceId/stores/:storeId/branches/:branchId")
  @RequirePermission("commerce.store.manage")
  update(@Param("workspaceId") workspaceId: string, @Param("storeId") storeId: string, @Param("branchId") branchId: string,
    @Body() body: { code: string; name: string; phone?: string | null; address?: Record<string, unknown> | null }, @Req() request: AuthenticatedRequest) {
    return this.lifecycle.updateBranch(request.user.userId, workspaceId, storeId, branchId, body);
  }
}
