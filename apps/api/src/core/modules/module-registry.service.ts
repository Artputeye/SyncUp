import { Injectable, NotFoundException } from "@nestjs/common";
import { COMMERCE_MODULE_MANIFEST, ModuleManifest, WorkspaceType } from "./module-manifest";
import {
  getProvisioningProfileForType,
  PROVISIONING_PROFILES,
  ProvisioningProfileDefinition,
  resolveProvisioningProfile,
} from "../../shared/provisioning-profile-catalog";

export type ProvisioningProfile = ProvisioningProfileDefinition;

@Injectable()
export class ModuleRegistryService {
  private readonly manifests: readonly ModuleManifest[] = [COMMERCE_MODULE_MANIFEST];

  list(): readonly ModuleManifest[] {
    return this.manifests;
  }

  get(moduleId: string): ModuleManifest {
    const manifest = this.manifests.find((item) => item.id === moduleId);
    if (!manifest) throw new NotFoundException("ไม่พบโมดูลที่ลงทะเบียน");
    return manifest;
  }

  listProfiles(): readonly ProvisioningProfile[] {
    return PROVISIONING_PROFILES;
  }

  getProfile(workspaceType: WorkspaceType): ProvisioningProfile {
    const profile = getProvisioningProfileForType(workspaceType);
    if (!profile) throw new NotFoundException("ไม่พบ Provisioning Profile สำหรับ Workspace Type นี้");
    return profile;
  }

  resolvePersistedProfile(
    workspaceType: WorkspaceType | null,
    profileId: string | null,
    profileVersion: string | null,
  ): ProvisioningProfile | null {
    return resolveProvisioningProfile(workspaceType, profileId, profileVersion);
  }
}
