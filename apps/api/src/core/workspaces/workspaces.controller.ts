import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { WorkspacesService } from "./workspaces.service";

type AuthenticatedRequest = Request & { user: { userId: string } };

@Controller("workspaces")
@UseGuards(AuthGuard)
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.workspaces.listForUser(request.user.userId);
  }

  @Post()
  create(@Body() body: { slug: string; name: string }, @Req() request: AuthenticatedRequest) {
    return this.workspaces.create({ ...body, ownerUserId: request.user.userId });
  }

  @Get(":workspaceId/members")
  members(@Param("workspaceId") workspaceId: string, @Req() request: AuthenticatedRequest) {
    return this.workspaces.listMembers(request.user.userId, workspaceId);
  }

  @Get(":workspaceId/roles")
  roles(@Param("workspaceId") workspaceId: string, @Req() request: AuthenticatedRequest) {
    return this.workspaces.listRoles(request.user.userId, workspaceId);
  }

  @Post(":workspaceId/members")
  addMember(@Param("workspaceId") workspaceId: string, @Body() body: { email: string; roleKey?: string }, @Req() request: AuthenticatedRequest) {
    return this.workspaces.addMember(request.user.userId, workspaceId, body.email, body.roleKey ?? "member");
  }

  @Patch(":workspaceId/members/:membershipId")
  updateMember(@Param("workspaceId") workspaceId: string, @Param("membershipId") membershipId: string, @Body() body: { roleKey: string }, @Req() request: AuthenticatedRequest) {
    return this.workspaces.updateMemberRole(request.user.userId, workspaceId, membershipId, body.roleKey);
  }

  @Delete(":workspaceId/members/:membershipId")
  removeMember(@Param("workspaceId") workspaceId: string, @Param("membershipId") membershipId: string, @Req() request: AuthenticatedRequest) {
    return this.workspaces.removeMember(request.user.userId, workspaceId, membershipId);
  }

  @Put(":workspaceId/roles/:roleKey/permissions")
  updateRolePermissions(@Param("workspaceId") workspaceId: string, @Param("roleKey") roleKey: string, @Body() body: { permissionKeys: string[] }, @Req() request: AuthenticatedRequest) {
    return this.workspaces.updateRolePermissions(request.user.userId, workspaceId, roleKey, body.permissionKeys);
  }
}
