import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ModulesModule } from "../modules/modules.module";
import { WorkspacesService } from "./workspaces.service";
import { WorkspacesController } from "./workspaces.controller";
@Module({ imports: [AuthModule, ModulesModule], controllers: [WorkspacesController], providers: [WorkspacesService], exports: [WorkspacesService] })
export class WorkspacesModule {}