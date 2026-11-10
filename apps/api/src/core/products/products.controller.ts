import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { RequirePermission } from "../rbac/rbac.decorator";
import { RbacGuard } from "../rbac/rbac.guard";
import { CreateProductInput, ProductCommandService, UpdateProductInput } from "./product-command.service";
import { ProductListQuery, ProductQueryService } from "./product-query.service";

type AuthenticatedRequest = Request & { user: { userId: string } };

@Controller("tenant")
@UseGuards(AuthGuard, RbacGuard)
export class ProductsController {
  constructor(
    private readonly products: ProductQueryService,
    private readonly commands: ProductCommandService,
  ) {}

  @Get(":workspaceId/units")
  @RequirePermission("commerce.product.view")
  units(@Param("workspaceId") workspaceId: string, @Req() request: AuthenticatedRequest) {
    return this.products.listUnits(request.user.userId, workspaceId);
  }

  @Post(":workspaceId/products")
  @RequirePermission("commerce.product.create")
  create(
    @Param("workspaceId") workspaceId: string,
    @Body() body: CreateProductInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.commands.createProduct(request.user.userId, workspaceId, body);
  }

  @Patch(":workspaceId/products/:productId")
  @RequirePermission("commerce.product.update")
  update(
    @Param("workspaceId") workspaceId: string,
    @Param("productId") productId: string,
    @Body() body: UpdateProductInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.commands.updateProduct(request.user.userId, workspaceId, productId, body);
  }

  @Post(":workspaceId/products/:productId/archive")
  @RequirePermission("commerce.product.archive")
  archive(
    @Param("workspaceId") workspaceId: string,
    @Param("productId") productId: string,
    @Body() body: { reason?: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.commands.archiveProduct(request.user.userId, workspaceId, productId, body?.reason);
  }

  @Get(":workspaceId/products/lookup")
  @RequirePermission("commerce.product.view")
  lookup(
    @Param("workspaceId") workspaceId: string,
    @Query("code") code: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.products.lookupProduct(request.user.userId, workspaceId, code);
  }

  @Get(":workspaceId/products")
  @RequirePermission("commerce.product.view")
  list(
    @Param("workspaceId") workspaceId: string,
    @Query() query: ProductListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.products.listProducts(request.user.userId, workspaceId, query);
  }

  @Get(":workspaceId/products/:productId")
  @RequirePermission("commerce.product.view")
  get(
    @Param("workspaceId") workspaceId: string,
    @Param("productId") productId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.products.getProduct(request.user.userId, workspaceId, productId);
  }
}
