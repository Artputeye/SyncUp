import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { WorkspaceDatabaseRegistry } from "./workspace-database.registry";
import { WorkspaceProvisioningService } from "./workspace-provisioning.service";
import { TenantMigrationRunner } from "./tenant-migration.runner";

@Global()
@Module({
  providers: [PrismaService, WorkspaceDatabaseRegistry, WorkspaceProvisioningService, TenantMigrationRunner],
  exports: [PrismaService, WorkspaceDatabaseRegistry, WorkspaceProvisioningService, TenantMigrationRunner]
})
export class DatabaseModule {}