import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  StreamableFile,
  Body,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import type { Request, Response } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { RequirePermission } from "../rbac/rbac.decorator";
import { RbacGuard } from "../rbac/rbac.guard";
import { RequireModuleCapability } from "../modules/module-capability.decorator";
import { WorkspaceModuleCapabilityGuard } from "../modules/workspace-module-capability.guard";
import { MediaService } from "./media.service";

type AuthenticatedRequest = Request & { user: { userId: string } };
const uploadOptions = {
  storage: memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 4, parts: 5 },
};

function parseOptions(body: Record<string, unknown>) {
  const isPrimary = body.isPrimary === undefined ? undefined
    : body.isPrimary === true || body.isPrimary === "true" || body.isPrimary === "1";
  const sortOrder = body.sortOrder === undefined ? undefined : Number(body.sortOrder);
  if (sortOrder !== undefined && !Number.isInteger(sortOrder)) throw new BadRequestException("sortOrder must be an integer");
  const altText = body.altText === undefined ? undefined : String(body.altText);
  return { isPrimary, sortOrder, altText };
}

@Controller("tenant")
@RequireModuleCapability("commerce")
@UseGuards(AuthGuard, WorkspaceModuleCapabilityGuard, RbacGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post(":workspaceId/products/:productId/images")
  @RequirePermission("commerce.product.update")
  @UseInterceptors(FileInterceptor("file", uploadOptions))
  uploadProduct(
    @Param("workspaceId") workspaceId: string,
    @Param("productId") productId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.media.uploadProductImage(request.user.userId, workspaceId, productId, file, parseOptions(body ?? {}));
  }

  @Get(":workspaceId/product-images/catalog")
  @RequirePermission("commerce.product.view")
  listCatalog(@Param("workspaceId") workspaceId: string, @Req() request: AuthenticatedRequest) {
    return this.media.listCatalogPrimaryImages(request.user.userId, workspaceId);
  }
  @Get(":workspaceId/products/:productId/images")
  @RequirePermission("commerce.product.view")
  listProduct(
    @Param("workspaceId") workspaceId: string,
    @Param("productId") productId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.media.listProductImages(request.user.userId, workspaceId, productId);
  }

  @Patch(":workspaceId/products/:productId/images/:imageId")
  @RequirePermission("commerce.product.update")
  updateProduct(
    @Param("workspaceId") workspaceId: string,
    @Param("productId") productId: string,
    @Param("imageId") imageId: string,
    @Body() body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.media.updateProductImage(request.user.userId, workspaceId, productId, imageId, parseOptions(body ?? {}));
  }

  @Delete(":workspaceId/products/:productId/images/:imageId")
  @RequirePermission("commerce.product.update")
  deleteProduct(
    @Param("workspaceId") workspaceId: string,
    @Param("productId") productId: string,
    @Param("imageId") imageId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.media.deleteProductImage(request.user.userId, workspaceId, productId, imageId);
  }

  @Post(":workspaceId/variants/:variantId/images")
  @RequirePermission("commerce.product.update")
  @UseInterceptors(FileInterceptor("file", uploadOptions))
  uploadVariant(
    @Param("workspaceId") workspaceId: string,
    @Param("variantId") variantId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.media.uploadVariantImage(request.user.userId, workspaceId, variantId, file, parseOptions(body ?? {}));
  }

  @Get(":workspaceId/variants/:variantId/images")
  @RequirePermission("commerce.product.view")
  listVariant(@Param("workspaceId") workspaceId: string, @Param("variantId") variantId: string, @Req() request: AuthenticatedRequest) {
    return this.media.listVariantImages(request.user.userId, workspaceId, variantId);
  }
  @Patch(":workspaceId/variants/:variantId/images/:imageId")
  @RequirePermission("commerce.product.update")
  updateVariant(@Param("workspaceId") workspaceId: string, @Param("variantId") variantId: string, @Param("imageId") imageId: string, @Body() body: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    return this.media.updateVariantImage(request.user.userId, workspaceId, variantId, imageId, parseOptions(body ?? {}));
  }

  @Delete(":workspaceId/variants/:variantId/images/:imageId")
  @RequirePermission("commerce.product.update")
  deleteVariant(@Param("workspaceId") workspaceId: string, @Param("variantId") variantId: string, @Param("imageId") imageId: string, @Req() request: AuthenticatedRequest) {
    return this.media.deleteVariantImage(request.user.userId, workspaceId, variantId, imageId);
  }
  @Get(":workspaceId/media/:mediaAssetId/:kind")
  @RequirePermission("commerce.product.view")
  async getMedia(
    @Param("workspaceId") workspaceId: string,
    @Param("mediaAssetId") mediaAssetId: string,
    @Param("kind") kind: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.media.getMediaFile(request.user.userId, workspaceId, mediaAssetId, kind);
    response.setHeader("Content-Type", file.mimeType);
    response.setHeader("Content-Length", String(file.size));
    response.setHeader("Cache-Control", "private, no-store, max-age=0");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Vary", "Cookie, Authorization");
    response.setHeader("X-Content-Type-Options", "nosniff");
    return new StreamableFile(file.bytes);
  }
}
