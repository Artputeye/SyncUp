export type WorkspaceStatus = "provisioning" | "active" | "suspended" | "failed";
export interface WorkspaceSummary { id: string; slug: string; name: string; status: WorkspaceStatus; }
export interface ModuleManifest {
  id: string; name: string; version: string; description?: string; dependencies?: string[];
  permissions: string[];
  navigation?: Array<{ label: string; href: string; permission?: string }>;
}
