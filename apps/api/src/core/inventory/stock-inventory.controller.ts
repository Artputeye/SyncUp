import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { RequirePermission } from "../rbac/rbac.decorator";
import { RbacGuard } from "../rbac/rbac.guard";
import { RequireModuleCapability } from "../modules/module-capability.decorator";
import { WorkspaceModuleCapabilityGuard } from "../modules/workspace-module-capability.guard";
import { StockInventoryService } from "./stock-inventory.service";

type AuthenticatedRequest = Request & { user: { userId: string } };

@Controller("tenant")
@RequireModuleCapability("commerce")
@UseGuards(AuthGuard, WorkspaceModuleCapabilityGuard, RbacGuard)
export class StockInventoryController {
  constructor(private readonly inventory: StockInventoryService) {}

  @Post(":workspaceId/inventory/reservations")
  @RequirePermission("commerce.inventory.reservation.manage")
  reserve(@Param("workspaceId") workspaceId: string, @Body() body: {
    warehouseId: string; variantId: string; quantity: string; idempotencyKey: string;
    referenceId?: string; referenceType?: string; expiresAt?: string;
  }, @Req() request: AuthenticatedRequest) {
    return this.inventory.reserve(request.user.userId, workspaceId, body);
  }

  @Post(":workspaceId/inventory/reservations/:reservationId/release")
  @RequirePermission("commerce.inventory.reservation.manage")
  release(@Param("workspaceId") workspaceId: string, @Param("reservationId") reservationId: string, @Req() request: AuthenticatedRequest) {
    return this.inventory.release(request.user.userId, workspaceId, reservationId);
  }

  @Post(":workspaceId/inventory/reservations/:reservationId/consume")
  @RequirePermission("commerce.inventory.reservation.manage")
  consume(@Param("workspaceId") workspaceId: string, @Param("reservationId") reservationId: string, @Req() request: AuthenticatedRequest) {
    return this.inventory.consume(request.user.userId, workspaceId, reservationId);
  }

  @Post(":workspaceId/inventory/receipts")
  @RequirePermission("commerce.inventory.receive")
  receive(@Param("workspaceId") workspaceId: string, @Body() body: {
    warehouseId: string; variantId: string; quantity: string; unitCost: string;
    idempotencyKey: string; referenceId?: string; reason?: string;
  }, @Req() request: AuthenticatedRequest) {
    return this.inventory.receive(request.user.userId, workspaceId, body);
  }

  @Post(":workspaceId/inventory/sales")
  @RequirePermission("commerce.inventory.issue")
  issue(@Param("workspaceId") workspaceId: string, @Body() body: {
    warehouseId: string; variantId: string; quantity: string; idempotencyKey: string;
    referenceId?: string; reason?: string;
  }, @Req() request: AuthenticatedRequest) {
    return this.inventory.issue(request.user.userId, workspaceId, body);
  }

  @Post(":workspaceId/inventory/transfers")
  @RequirePermission("commerce.inventory.transfer")
  transfer(@Param("workspaceId") workspaceId: string, @Body() body: {
    sourceWarehouseId: string; destinationWarehouseId: string; variantId: string;
    quantity: string; idempotencyKey: string; reason: string;
  }, @Req() request: AuthenticatedRequest) {
    return this.inventory.transfer(request.user.userId, workspaceId, body);
  }

  @Post(":workspaceId/inventory/adjustments")
  @RequirePermission("commerce.inventory.adjust")
  adjust(@Param("workspaceId") workspaceId: string, @Body() body: { warehouseId: string; variantId: string; countedQuantity: string; unitCost?: string; idempotencyKey: string; reason: string }, @Req() request: AuthenticatedRequest) {
    return this.inventory.adjust(request.user.userId, workspaceId, body);
  }

  @Get(":workspaceId/inventory/stocktakes")
  @RequirePermission("commerce.inventory.view")
  listStocktakes(@Param("workspaceId") workspaceId: string, @Req() request: AuthenticatedRequest,
    @Query() query: { warehouseId?: string; status?: string; page?: string; pageSize?: string }) {
    return this.inventory.listStocktakes(request.user.userId, workspaceId, query);
  }

  @Post(":workspaceId/inventory/stocktakes")
  @RequirePermission("commerce.inventory.stocktake")
  createStocktake(@Param("workspaceId") workspaceId: string, @Body() body: {
    warehouseId: string; reference?: string; notes?: string; idempotencyKey: string;
  }, @Req() request: AuthenticatedRequest) {
    return this.inventory.createStocktake(request.user.userId, workspaceId, body);
  }

  @Get(":workspaceId/inventory/stocktakes/:stocktakeId")
  @RequirePermission("commerce.inventory.view")
  getStocktake(@Param("workspaceId") workspaceId: string, @Param("stocktakeId") stocktakeId: string,
    @Req() request: AuthenticatedRequest) {
    return this.inventory.getStocktake(request.user.userId, workspaceId, stocktakeId);
  }

  @Patch(":workspaceId/inventory/stocktakes/:stocktakeId/lines/:lineId")
  @RequirePermission("commerce.inventory.stocktake")
  recordStocktakeCount(@Param("workspaceId") workspaceId: string, @Param("stocktakeId") stocktakeId: string,
    @Param("lineId") lineId: string, @Body() body: { countedQuantity: string; unitCost?: string; note?: string },
    @Req() request: AuthenticatedRequest) {
    return this.inventory.recordStocktakeCount(request.user.userId, workspaceId, stocktakeId, lineId, body);
  }

  @Post(":workspaceId/inventory/stocktakes/:stocktakeId/finalize")
  @RequirePermission("commerce.inventory.stocktake")
  finalizeStocktake(@Param("workspaceId") workspaceId: string, @Param("stocktakeId") stocktakeId: string,
    @Body() body: { reason?: string }, @Req() request: AuthenticatedRequest) {
    return this.inventory.finalizeStocktake(request.user.userId, workspaceId, stocktakeId, body);
  }

  @Post(":workspaceId/inventory/stocktakes/:stocktakeId/cancel")
  @RequirePermission("commerce.inventory.stocktake")
  cancelStocktake(@Param("workspaceId") workspaceId: string, @Param("stocktakeId") stocktakeId: string,
    @Body() body: { reason?: string }, @Req() request: AuthenticatedRequest) {
    return this.inventory.cancelStocktake(request.user.userId, workspaceId, stocktakeId, body?.reason);
  }

  @Post(":workspaceId/inventory/movements/:movementId/reverse")
  @RequirePermission("commerce.inventory.movement.reverse")
  reverseMovement(@Param("workspaceId") workspaceId: string, @Param("movementId") movementId: string, @Body() body: {
    idempotencyKey: string; reason: string;
  }, @Req() request: AuthenticatedRequest) {
    return this.inventory.reverseMovement(request.user.userId, workspaceId, movementId, body);
  }

  @Post(":workspaceId/inventory/reservations/expire")
  @RequirePermission("commerce.inventory.reservation.manage")
  releaseExpired(@Param("workspaceId") workspaceId: string, @Body() body: { limit?: number }, @Req() request: AuthenticatedRequest) {
    return this.inventory.releaseExpired(request.user.userId, workspaceId, body?.limit ?? 100);
  }

  @Get(":workspaceId/inventory/movements")
  @RequirePermission("commerce.inventory.view")
  listMovements(@Param("workspaceId") workspaceId: string, @Req() request: AuthenticatedRequest, @Query() query: { warehouseId?: string; variantId?: string; movementType?: string; from?: string; to?: string; search?: string; page?: string; pageSize?: string }) {
    return this.inventory.listMovements(request.user.userId, workspaceId, query);
  }

  @Get(":workspaceId/inventory/warehouses/:warehouseId/variants/:variantId/balance")
  @RequirePermission("commerce.inventory.view")
  getBalance(@Param("workspaceId") workspaceId: string, @Param("warehouseId") warehouseId: string, @Param("variantId") variantId: string, @Req() request: AuthenticatedRequest) {
    return this.inventory.getBalance(request.user.userId, workspaceId, warehouseId, variantId);
  }
}
