import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RbacModule } from "../rbac/rbac.module";
import { ProductsController } from "./products.controller";
import { ProductCommandService } from "./product-command.service";
import { ProductQueryService } from "./product-query.service";

@Module({
  imports: [AuthModule, RbacModule],
  controllers: [ProductsController],
  providers: [ProductQueryService, ProductCommandService],
})
export class ProductsModule {}
