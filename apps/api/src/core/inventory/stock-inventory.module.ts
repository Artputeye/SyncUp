import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RbacModule } from "../rbac/rbac.module";
import { OpeningStockController } from "./opening-stock.controller";
import { OpeningStockService } from "./opening-stock.service";
import { StockInventoryController } from "./stock-inventory.controller";
import { StockInventoryService } from "./stock-inventory.service";

@Module({
  imports: [AuthModule, RbacModule],
  controllers: [StockInventoryController, OpeningStockController],
  providers: [StockInventoryService, OpeningStockService],
  exports: [StockInventoryService, OpeningStockService],
})
export class StockInventoryModule {}
