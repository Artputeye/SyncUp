import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RbacModule } from "../rbac/rbac.module";
import { ModulesModule } from "../modules/modules.module";
import { SalesOrdersController } from "./sales-orders.controller";
import { SalesOrdersService } from "./sales-orders.service";
import { SalesReturnsService } from "./sales-returns.service";
import { SalesPaymentsService } from "./sales-payments.service";

@Module({
  imports: [AuthModule, RbacModule, ModulesModule],
  controllers: [SalesOrdersController],
  providers: [SalesOrdersService, SalesReturnsService, SalesPaymentsService],
  exports: [SalesOrdersService],
})
export class SalesOrdersModule {}
