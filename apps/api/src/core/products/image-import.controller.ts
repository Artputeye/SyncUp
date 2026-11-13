import {
  BadRequestException,
  Controller,
  Param,
  Post,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { RequirePermission } from "../rbac/rbac.decorator";
import { RbacGuard } from "../rbac/rbac.guard";
import { RequireModuleCapability } from "../modules/module-capability.decorator";
import { WorkspaceModuleCapabilityGuard } from "../modules/workspace-module-capability.guard";
import { ImageImportService } from "./image-import.service";

type AuthenticatedRequest = Request & { user: { userId: string } };
type ImportFiles = { archive?: Express.Multer.File[]; manifest?: Express.Multer.File[] };

@Controller("tenant")
@RequireModuleCapability("commerce")
@UseGuards(AuthGuard, WorkspaceModuleCapabilityGuard, RbacGuard)
export class ImageImportController {
  constructor(private readonly imports: ImageImportService) {}

  @Post(":workspaceId/image-imports/preview")
  @RequirePermission("commerce.product.update")
  @UseInterceptors(FileFieldsInterceptor(
    [{ name: "archive", maxCount: 1 }, { name: "manifest", maxCount: 1 }],
    { limits: { fileSize: 25 * 1024 * 1024, files: 2, fields: 2, parts: 4 } },
  ))
  preview(
    @Param("workspaceId") workspaceId: string,
    @UploadedFiles() files: ImportFiles,
    @Req() request: AuthenticatedRequest,
  ) {
    const archive = files?.archive?.[0];
    if (!archive) throw new BadRequestException("ZIP archive is required");
    const manifest = files?.manifest?.[0];
    if (manifest && manifest.size > 1024 * 1024) throw new BadRequestException("Manifest CSV must not exceed 1 MB");
    return this.imports.preview(request.user.userId, workspaceId, archive, manifest);
  }

  @Post(":workspaceId/image-imports/:batchId/commit")
  @RequirePermission("commerce.product.update")
  commit(
    @Param("workspaceId") workspaceId: string,
    @Param("batchId") batchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.imports.commit(request.user.userId, workspaceId, batchId);
  }
}
