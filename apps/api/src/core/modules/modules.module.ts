import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RbacModule } from "../rbac/rbac.module";
import { ModulesController } from "./modules.controller";
import { ModuleActivationService } from "./module-activation.service";
import { ModuleRegistryService } from "./module-registry.service";

@Module({
  imports: [AuthModule, RbacModule],
  controllers: [ModulesController],
  providers: [ModuleRegistryService, ModuleActivationService],
  exports: [ModuleRegistryService, ModuleActivationService],
})
export class ModulesModule {}
