import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RbacModule } from "../rbac/rbac.module";
import { ModulesModule } from "../modules/modules.module";
import { ProductsController } from "./products.controller";
import { ProductCommandService } from "./product-command.service";
import { ProductQueryService } from "./product-query.service";
import { MediaController } from "./media.controller";
import { MediaService } from "./media.service";
import { ImageImportController } from "./image-import.controller";
import { ImageImportService } from "./image-import.service";

@Module({
  imports: [AuthModule, RbacModule, ModulesModule],
  controllers: [ProductsController, MediaController, ImageImportController],
  providers: [ProductQueryService, ProductCommandService, MediaService, ImageImportService],
})
export class ProductsModule {}
