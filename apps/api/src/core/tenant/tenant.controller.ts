import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { RequirePermission } from "../rbac/rbac.decorator";
import { RbacGuard } from "../rbac/rbac.guard";
import { TenantService } from "./tenant.service";
import { StoreLifecycleService } from "./store-lifecycle.service";

type AuthenticatedRequest = Request & { user: { userId: string } };

@Controller("tenant")
@UseGuards(AuthGuard, RbacGuard)
export class TenantController {
  constructor(
    private readonly tenant: TenantService,
    private readonly lifecycle: StoreLifecycleService,
  ) {}

  @Get(":workspaceId/settings")
  listSettings(@Param("workspaceId") workspaceId: string, @Req() request: AuthenticatedRequest) {
    return this.tenant.listSettings(request.user.userId, workspaceId);
  }

  @Post(":workspaceId/stores")
  @RequirePermission("commerce.store.manage")
  createStore(
    @Param("workspaceId") workspaceId: string,
    @Body() body: { name: string; slug: string; branchCode?: string; warehouseCode?: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycle.createStore(request.user.userId, workspaceId, body);
  }

  @Post(":workspaceId/stores/:storeId/branches")
  @RequirePermission("commerce.store.manage")
  createBranch(
    @Param("workspaceId") workspaceId: string,
    @Param("storeId") storeId: string,
    @Body() body: { code: string; name: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycle.createBranch(request.user.userId, workspaceId, storeId, body);
  }

  @Post(":workspaceId/branches/:branchId/warehouses")
  @RequirePermission("commerce.store.manage")
  createWarehouse(
    @Param("workspaceId") workspaceId: string,
    @Param("branchId") branchId: string,
    @Body() body: { code: string; name: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycle.createWarehouse(request.user.userId, workspaceId, branchId, body);
  }

  @Patch(":workspaceId/stores/:storeId/branches/:branchId/default")
  @RequirePermission("commerce.store.manage")
  setDefaultBranch(
    @Param("workspaceId") workspaceId: string, @Param("storeId") storeId: string,
    @Param("branchId") branchId: string, @Body() body: { reason: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycle.setDefaultBranch(request.user.userId, workspaceId, storeId, branchId, body.reason);
  }

  @Patch(":workspaceId/branches/:branchId/warehouses/:warehouseId/default")
  @RequirePermission("commerce.store.manage")
  setDefaultWarehouse(
    @Param("workspaceId") workspaceId: string, @Param("branchId") branchId: string,
    @Param("warehouseId") warehouseId: string, @Body() body: { reason: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycle.setDefaultWarehouse(request.user.userId, workspaceId, branchId, warehouseId, body.reason);
  }

  @Patch(":workspaceId/branches/:branchId/warehouses/:warehouseId/archive")
  @RequirePermission("commerce.store.manage")
  archiveWarehouse(
    @Param("workspaceId") workspaceId: string, @Param("branchId") branchId: string,
    @Param("warehouseId") warehouseId: string, @Body() body: { reason: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycle.archiveWarehouse(request.user.userId, workspaceId, branchId, warehouseId, body.reason);
  }

  @Patch(":workspaceId/stores/:storeId/branches/:branchId/archive")
  @RequirePermission("commerce.store.manage")
  archiveBranch(
    @Param("workspaceId") workspaceId: string, @Param("storeId") storeId: string,
    @Param("branchId") branchId: string, @Body() body: { reason: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycle.archiveBranch(request.user.userId, workspaceId, storeId, branchId, body.reason);
  }
}
