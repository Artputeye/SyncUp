import { Injectable, NotFoundException } from "@nestjs/common";
import { COMMERCE_MODULE_MANIFEST, ModuleManifest } from "./module-manifest";

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
}
