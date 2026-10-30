import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { WorkspaceDatabaseRegistry } from "./workspace-database.registry";
import { WorkspaceProvisioningService } from "./workspace-provisioning.service";

@Global()
@Module({
  providers: [PrismaService, WorkspaceDatabaseRegistry, WorkspaceProvisioningService],
  exports: [PrismaService, WorkspaceDatabaseRegistry, WorkspaceProvisioningService]
})
export class DatabaseModule {}
