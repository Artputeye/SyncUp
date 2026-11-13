import { Body, Controller, Get, Param, Patch, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { RequirePermission } from "../rbac/rbac.decorator";
import { RbacGuard } from "../rbac/rbac.guard";
import { RequireModuleCapability } from "../modules/module-capability.decorator";
import { WorkspaceModuleCapabilityGuard } from "../modules/workspace-module-capability.guard";
import { StoreLifecycleService } from "./store-lifecycle.service";
import { WarehouseQueryService } from "./warehouse-query.service";

type AuthenticatedRequest = Request & { user: { userId: string } };

@Controller("tenant")
@RequireModuleCapability("commerce")
@UseGuards(AuthGuard, WorkspaceModuleCapabilityGuard, RbacGuard)
export class WarehousesController {
  constructor(
    private readonly warehouses: WarehouseQueryService,
    private readonly lifecycle: StoreLifecycleService,
  ) {}

  @Get(":workspaceId/stores/:storeId/branches/:branchId/warehouses")
  @RequirePermission("commerce.store.view")
  list(
    @Param("workspaceId") workspaceId: string, @Param("storeId") storeId: string,
    @Param("branchId") branchId: string, @Req() request: AuthenticatedRequest,
  ) {
    return this.warehouses.listWarehouses(request.user.userId, workspaceId, storeId, branchId);
  }

  @Get(":workspaceId/stores/:storeId/branches/:branchId/warehouses/:warehouseId")
  @RequirePermission("commerce.store.view")
  get(
    @Param("workspaceId") workspaceId: string, @Param("storeId") storeId: string,
    @Param("branchId") branchId: string, @Param("warehouseId") warehouseId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.warehouses.getWarehouse(request.user.userId, workspaceId, storeId, branchId, warehouseId);
  }

  @Patch(":workspaceId/stores/:storeId/branches/:branchId/warehouses/:warehouseId")
  @RequirePermission("commerce.store.manage")
  update(
    @Param("workspaceId") workspaceId: string, @Param("storeId") storeId: string,
    @Param("branchId") branchId: string, @Param("warehouseId") warehouseId: string,
    @Body() body: { code: string; name: string }, @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycle.updateWarehouse(request.user.userId, workspaceId, storeId, branchId, warehouseId, body);
  }
}
