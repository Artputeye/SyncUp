import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { WorkspaceProvisioningService } from "../../database/workspace-provisioning.service";

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly db: PrismaService,
    private readonly provisioning: WorkspaceProvisioningService
  ) {}

  async create(input: { slug: string; name: string; ownerUserId: string }) {
    const workspace = await this.db.workspace.create({
      data: {
        slug: input.slug.toLowerCase(),
        name: input.name,
        memberships: {
          create: { userId: input.ownerUserId, isOwner: true }
        }
      }
    });
    return this.provisioning.provision(workspace.id);
  }
}
