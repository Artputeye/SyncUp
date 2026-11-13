import { Body, Controller, Get, Param, Patch, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { RequirePermission } from "../rbac/rbac.decorator";
import { RbacGuard } from "../rbac/rbac.guard";
import { RequireModuleCapability } from "../modules/module-capability.decorator";
import { WorkspaceModuleCapabilityGuard } from "../modules/workspace-module-capability.guard";
import { StoreQueryService, UpdateStoreInput } from "./store-query.service";

type AuthenticatedRequest = Request & { user: { userId: string } };

@Controller("tenant")
@RequireModuleCapability("commerce")
@UseGuards(AuthGuard, WorkspaceModuleCapabilityGuard, RbacGuard)
export class StoresController {
  constructor(private readonly stores: StoreQueryService) {}

  @Get(":workspaceId/stores")
  @RequirePermission("commerce.store.view")
  list(
    @Param("workspaceId") workspaceId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.stores.listStores(request.user.userId, workspaceId);
  }

  @Get(":workspaceId/stores/:storeId")
  @RequirePermission("commerce.store.view")
  get(
    @Param("workspaceId") workspaceId: string,
    @Param("storeId") storeId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.stores.getStore(request.user.userId, workspaceId, storeId);
  }

  @Patch(":workspaceId/stores/:storeId")
  @RequirePermission("commerce.store.manage")
  update(
    @Param("workspaceId") workspaceId: string,
    @Param("storeId") storeId: string,
    @Body() body: UpdateStoreInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.stores.updateStore(request.user.userId, workspaceId, storeId, body);
  }
}
