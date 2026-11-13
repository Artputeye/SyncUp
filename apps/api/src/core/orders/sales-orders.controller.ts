import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { RequirePermission } from "../rbac/rbac.decorator";
import { RbacGuard } from "../rbac/rbac.guard";
import { RequireModuleCapability } from "../modules/module-capability.decorator";
import { WorkspaceModuleCapabilityGuard } from "../modules/workspace-module-capability.guard";
import { SalesOrdersService } from "./sales-orders.service";
import { SalesReturnsService } from "./sales-returns.service";
import { SalesPaymentsService } from "./sales-payments.service";

type AuthenticatedRequest = Request & { user: { userId: string } };

@Controller("tenant")
@RequireModuleCapability("commerce")
@UseGuards(AuthGuard, WorkspaceModuleCapabilityGuard, RbacGuard)
export class SalesOrdersController {
  constructor(private readonly orders: SalesOrdersService, private readonly returns: SalesReturnsService, private readonly payments: SalesPaymentsService) {}

  @Post(":workspaceId/orders")
  @RequirePermission("commerce.sales.create")
  create(
    @Param("workspaceId") workspaceId: string,
    @Body() body: {
      storeId: string; branchId: string; warehouseId: string;
      items: Array<{ variantId: string; variantUomId: string; quantity: string }>;
      idempotencyKey: string;
    },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.orders.createOrder(request.user.userId, workspaceId, body);
  }

  @Get(":workspaceId/orders")
  @RequirePermission("commerce.orders.view")
  list(
    @Param("workspaceId") workspaceId: string,
    @Req() request: AuthenticatedRequest,
    @Query() query: { storeId?: string; branchId?: string; status?: string; search?: string; page?: string; pageSize?: string },
  ) {
    return this.orders.listOrders(request.user.userId, workspaceId, query);
  }

  @Get(":workspaceId/orders/:orderId")
  @RequirePermission("commerce.orders.view")
  get(
    @Param("workspaceId") workspaceId: string,
    @Param("orderId") orderId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.orders.getOrder(request.user.userId, workspaceId, orderId);
  }

  @Post(":workspaceId/orders/:orderId/post")
  @RequirePermission("commerce.sales.create")
  post(
    @Param("workspaceId") workspaceId: string,
    @Param("orderId") orderId: string,
    @Body() body: { idempotencyKey: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.orders.postOrder(request.user.userId, workspaceId, orderId, body?.idempotencyKey);
  }

  @Post(":workspaceId/orders/:orderId/payments")
  @RequirePermission("commerce.sales.create")
  recordPayment(
    @Param("workspaceId") workspaceId: string,
    @Param("orderId") orderId: string,
    @Body() body: { method: "CASH" | "CARD" | "BANK_TRANSFER" | "OTHER"; amount: string; idempotencyKey: string; externalReference?: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.payments.recordPayment(request.user.userId, workspaceId, orderId, body);
  }

  @Get(":workspaceId/orders/:orderId/payments")
  @RequirePermission("commerce.orders.view")
  listPayments(
    @Param("workspaceId") workspaceId: string,
    @Param("orderId") orderId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.payments.listPayments(request.user.userId, workspaceId, orderId);
  }

  @Post(":workspaceId/orders/:orderId/returns/:returnId/refunds")
  @RequirePermission("commerce.sales.void")
  createRefund(
    @Param("workspaceId") workspaceId: string,
    @Param("orderId") orderId: string,
    @Param("returnId") returnId: string,
    @Body() body: { paymentId: string; amount: string; idempotencyKey: string; reason?: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.payments.createRefund(request.user.userId, workspaceId, orderId, returnId, body);
  }

  @Get(":workspaceId/orders/:orderId/returns/:returnId/refunds")
  @RequirePermission("commerce.orders.view")
  listRefunds(
    @Param("workspaceId") workspaceId: string,
    @Param("orderId") orderId: string,
    @Param("returnId") returnId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.payments.listRefunds(request.user.userId, workspaceId, orderId, returnId);
  }

  @Post(":workspaceId/orders/:orderId/returns")
  @RequirePermission("commerce.sales.void")
  createReturn(
    @Param("workspaceId") workspaceId: string,
    @Param("orderId") orderId: string,
    @Body() body: { items: Array<{ orderItemId: string; quantity: string }>; idempotencyKey: string; reason?: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.returns.createReturn(request.user.userId, workspaceId, orderId, body);
  }

  @Get(":workspaceId/orders/:orderId/returns")
  @RequirePermission("commerce.orders.view")
  listReturns(
    @Param("workspaceId") workspaceId: string,
    @Param("orderId") orderId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.returns.listReturns(request.user.userId, workspaceId, orderId);
  }

  @Post(":workspaceId/orders/:orderId/cancel")
  @RequirePermission("commerce.sales.void")
  cancel(
    @Param("workspaceId") workspaceId: string,
    @Param("orderId") orderId: string,
    @Body() body: { reason?: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.orders.cancelOrder(request.user.userId, workspaceId, orderId, body?.reason);
  }
}
