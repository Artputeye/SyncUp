import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { RequirePermission } from "../rbac/rbac.decorator";
import { RbacGuard } from "../rbac/rbac.guard";
import { OpeningStockService } from "./opening-stock.service";

type AuthenticatedRequest = Request & { user: { userId: string } };

@Controller("tenant")
@UseGuards(AuthGuard, RbacGuard)
export class OpeningStockController {
  constructor(private readonly openingStock: OpeningStockService) {}

  @Get(":workspaceId/inventory/opening-stocks")
  @RequirePermission("commerce.inventory.view")
  list(
    @Param("workspaceId") workspaceId: string,
    @Req() request: AuthenticatedRequest,
    @Query() query: { warehouseId?: string; status?: string; page?: string; pageSize?: string },
  ) {
    return this.openingStock.list(request.user.userId, workspaceId, query);
  }

  @Post(":workspaceId/inventory/opening-stocks")
  @RequirePermission("commerce.inventory.receive")
  create(
    @Param("workspaceId") workspaceId: string,
    @Body() body: { warehouseId: string; reference?: string; notes?: string; idempotencyKey: string; items: Array<{ variantId: string; quantity: string; unitCost: string }> },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.openingStock.create(request.user.userId, workspaceId, body);
  }

  @Get(":workspaceId/inventory/opening-stocks/:openingStockId")
  @RequirePermission("commerce.inventory.view")
  get(
    @Param("workspaceId") workspaceId: string,
    @Param("openingStockId") openingStockId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.openingStock.get(request.user.userId, workspaceId, openingStockId);
  }

  @Patch(":workspaceId/inventory/opening-stocks/:openingStockId")
  @RequirePermission("commerce.inventory.receive")
  updateDraft(
    @Param("workspaceId") workspaceId: string,
    @Param("openingStockId") openingStockId: string,
    @Body() body: { reference?: string; notes?: string; items: Array<{ variantId: string; quantity: string; unitCost: string }> },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.openingStock.updateDraft(request.user.userId, workspaceId, openingStockId, body);
  }

  @Post(":workspaceId/inventory/opening-stocks/:openingStockId/post")
  @RequirePermission("commerce.inventory.receive")
  post(
    @Param("workspaceId") workspaceId: string,
    @Param("openingStockId") openingStockId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.openingStock.post(request.user.userId, workspaceId, openingStockId);
  }

  @Post(":workspaceId/inventory/opening-stocks/:openingStockId/cancel")
  @RequirePermission("commerce.inventory.receive")
  cancel(
    @Param("workspaceId") workspaceId: string,
    @Param("openingStockId") openingStockId: string,
    @Body() body: { reason?: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.openingStock.cancel(request.user.userId, workspaceId, openingStockId, body?.reason);
  }
}
