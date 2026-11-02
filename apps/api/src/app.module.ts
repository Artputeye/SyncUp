import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { DatabaseModule } from "./database/database.module";
import { WorkspacesModule } from "./core/workspaces/workspaces.module";
import { RbacModule } from "./core/rbac/rbac.module";
import { AuthModule } from "./core/auth/auth.module";
import { PlatformAdminModule } from "./core/platform-admin/platform-admin.module";

@Module({
  imports: [DatabaseModule, AuthModule, WorkspacesModule, RbacModule, PlatformAdminModule],
  controllers: [HealthController]
})
export class AppModule {}
