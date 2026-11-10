import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PlatformAdminController } from "./platform-admin.controller";
import { PlatformAdminGuard } from "./platform-admin.guard";
import { PlatformAdminService } from "./platform-admin.service";
import { BackupLocationService } from "./backup-location.service";

@Module({
  imports: [AuthModule],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminGuard, PlatformAdminService, BackupLocationService]
})
export class PlatformAdminModule {}
