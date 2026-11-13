import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RbacModule } from "../rbac/rbac.module";
import { ModulesController } from "./modules.controller";
import { ModuleActivationService } from "./module-activation.service";
import { ModuleRegistryService } from "./module-registry.service";
import { WorkspaceModuleCapabilityGuard } from "./workspace-module-capability.guard";

@Module({
  imports: [AuthModule, RbacModule],
  controllers: [ModulesController],
  providers: [ModuleRegistryService, ModuleActivationService, WorkspaceModuleCapabilityGuard],
  exports: [ModuleRegistryService, ModuleActivationService, WorkspaceModuleCapabilityGuard],
})
export class ModulesModule {}
