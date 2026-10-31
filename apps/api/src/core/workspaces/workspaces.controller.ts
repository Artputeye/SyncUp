import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { WorkspacesService } from "./workspaces.service";

@Controller("workspaces")
@UseGuards(AuthGuard)
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Post()
  create(@Body() body: { slug: string; name: string }, @Req() request: Request & { user: { userId: string } }) {
    return this.workspaces.create({ ...body, ownerUserId: request.user.userId });
  }
}