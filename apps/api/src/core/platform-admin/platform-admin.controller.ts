import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { PlatformAdminGuard } from "./platform-admin.guard";
import { PlatformAdminService } from "./platform-admin.service";
import { BackupLocationService } from "./backup-location.service";

type AdminRequest = Request & { user: { userId: string; isPlatformAdmin: boolean } };

@Controller("platform-admin")
@UseGuards(AuthGuard, PlatformAdminGuard)
export class PlatformAdminController {
  constructor(
    private readonly admin: PlatformAdminService,
    private readonly backupLocation: BackupLocationService
  ) {}

  @Get("overview") overview() { return this.admin.overview(); }
  @Get("backup-location") backupLocationStatus() { return this.backupLocation.getStatus(); }
  @Put("backup-location") saveBackupLocation(@Body() body: { path: string }) { return this.backupLocation.save(body.path); }
  @Get("users") users(@Query("q") q = "") { return this.admin.listUsers(q); }
  @Patch("users/:userId/status") userStatus(@Param("userId") userId: string, @Body() body: { status: "ACTIVE" | "DISABLED" }, @Req() req: AdminRequest) {
    return this.admin.setUserStatus(userId, body.status, req.user.userId);
  }
  @Get("workspaces") workspaces() { return this.admin.listWorkspaces(); }
  @Patch("workspaces/:workspaceId/status") workspaceStatus(@Param("workspaceId") id: string, @Body() body: { status: "ACTIVE" | "SUSPENDED" }) {
    return this.admin.setWorkspaceStatus(id, body.status);
  }
  @Get("workspaces/:workspaceId/members") members(@Param("workspaceId") id: string) { return this.admin.listMembers(id); }
  @Get("workspaces/:workspaceId/roles") roles(@Param("workspaceId") id: string) { return this.admin.listRoles(id); }
  @Patch("workspaces/:workspaceId/members/:membershipId") memberRole(@Param("workspaceId") ws: string, @Param("membershipId") member: string, @Body() body: { roleKey: string }) {
    return this.admin.setMemberRole(ws, member, body.roleKey);
  }
  @Patch("workspaces/:workspaceId/members/:membershipId/remove") removeMember(@Param("workspaceId") ws: string, @Param("membershipId") member: string) {
    return this.admin.removeMember(ws, member);
  }
  @Patch("workspaces/:workspaceId/roles/:roleKey/permissions") rolePermissions(@Param("workspaceId") ws: string, @Param("roleKey") role: string, @Body() body: { permissionKeys: string[] }) {
    return this.admin.setRolePermissions(ws, role, body.permissionKeys);
  }
}
