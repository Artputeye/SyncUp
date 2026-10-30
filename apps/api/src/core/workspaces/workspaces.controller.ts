import { Body, Controller, Post } from "@nestjs/common";
import { WorkspacesService } from "./workspaces.service";

@Controller("workspaces")
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Post()
  create(@Body() body: { slug: string; name: string; ownerUserId: string }) {
    // Temporary internal bootstrap endpoint. Protect with authentication and platform authorization before exposure.
    return this.workspaces.create(body);
  }
}
