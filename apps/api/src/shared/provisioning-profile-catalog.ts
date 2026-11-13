import type { WorkspaceType } from "@prisma/client";

export interface ProvisioningProfileDefinition {
  id: string;
  name: string;
  version: string;
  workspaceType: WorkspaceType;
  allowedModuleIds: readonly string[];
  defaultModuleIds: readonly string[];
}

export const PROVISIONING_PROFILES: readonly ProvisioningProfileDefinition[] = [
  {
    id: "pos-standard",
    name: "SyncUp POS Standard",
    version: "1.0.0",
    workspaceType: "POS",
    allowedModuleIds: ["commerce"],
    defaultModuleIds: ["commerce"],
  },
  {
    id: "online-standard",
    name: "SyncUp Online Standard",
    version: "1.0.0",
    workspaceType: "ONLINE",
    allowedModuleIds: [],
    defaultModuleIds: [],
  },
];

export function getProvisioningProfileForType(workspaceType: WorkspaceType): ProvisioningProfileDefinition | null {
  return PROVISIONING_PROFILES.find((profile) => profile.workspaceType === workspaceType) ?? null;
}

export function resolveProvisioningProfile(
  workspaceType: WorkspaceType | null,
  profileId: string | null,
  profileVersion: string | null,
): ProvisioningProfileDefinition | null {
  if (!workspaceType || !profileId || !profileVersion) return null;
  return PROVISIONING_PROFILES.find(
    (profile) => profile.id === profileId && profile.version === profileVersion && profile.workspaceType === workspaceType,
  ) ?? null;
}
