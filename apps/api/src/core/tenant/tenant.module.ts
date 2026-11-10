import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RbacModule } from "../rbac/rbac.module";
import { TenantController } from "./tenant.controller";
import { StoresController } from "./stores.controller";
import { BranchesController } from "./branches.controller";
import { WarehousesController } from "./warehouses.controller";
import { TenantService } from "./tenant.service";
import { StoreLifecycleService } from "./store-lifecycle.service";
import { StoreQueryService } from "./store-query.service";
import { BranchQueryService } from "./branch-query.service";
import { WarehouseQueryService } from "./warehouse-query.service";

@Module({
  imports: [AuthModule, RbacModule],
  controllers: [TenantController, StoresController, BranchesController, WarehousesController],
  providers: [TenantService, StoreLifecycleService, StoreQueryService, BranchQueryService, WarehouseQueryService],
  exports: [StoreLifecycleService, StoreQueryService, BranchQueryService, WarehouseQueryService],
})
export class TenantModule {}
