import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RbacModule } from "../rbac/rbac.module";
import { StockInventoryController } from "./stock-inventory.controller";
import { StockInventoryService } from "./stock-inventory.service";

@Module({
  imports: [AuthModule, RbacModule],
  controllers: [StockInventoryController],
  providers: [StockInventoryService],
  exports: [StockInventoryService],
})
export class StockInventoryModule {}
