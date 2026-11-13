import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { DatabaseModule } from "./database/database.module";
import { WorkspacesModule } from "./core/workspaces/workspaces.module";
import { RbacModule } from "./core/rbac/rbac.module";
import { AuthModule } from "./core/auth/auth.module";
import { PlatformAdminModule } from "./core/platform-admin/platform-admin.module";
import { TenantModule } from "./core/tenant/tenant.module";
import { StockInventoryModule } from "./core/inventory/stock-inventory.module";
import { ModulesModule } from "./core/modules/modules.module";
import { ProductsModule } from "./core/products/products.module";
import { SalesOrdersModule } from "./core/orders/sales-orders.module";

@Module({
  imports: [DatabaseModule, AuthModule, WorkspacesModule, RbacModule, PlatformAdminModule, TenantModule, StockInventoryModule, ModulesModule, ProductsModule, SalesOrdersModule],
  controllers: [HealthController]
})
export class AppModule {}
