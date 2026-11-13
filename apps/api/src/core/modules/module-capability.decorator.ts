import { SetMetadata } from "@nestjs/common";

export const REQUIRED_MODULE_CAPABILITY = "syncup:required_module_capability";

export const RequireModuleCapability = (moduleId: string) =>
  SetMetadata(REQUIRED_MODULE_CAPABILITY, moduleId);
