import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { WorkspaceDatabaseRegistry } from "../../database/workspace-database.registry";
import { RbacService } from "../rbac/rbac.service";
import { ModuleManifest } from "./module-manifest";
import { ModuleRegistryService } from "./module-registry.service";

const PLATFORM_VERSION = process.env.SYNCUP_PLATFORM_VERSION ?? "0.1.0";

function versionParts(version: string): number[] | null {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return null;
  return version.split(".").map(Number);
}

function compareVersions(left: string, right: string): number | null {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

@Injectable()
export class ModuleActivationService {
  constructor(
    private readonly db: PrismaService,
    private readonly rbac: RbacService,
    private readonly registry: ModuleRegistryService,
    private readonly tenantDatabases: WorkspaceDatabaseRegistry,
  ) {}

  private async assertManage(userId: string, workspaceId: string): Promise<void> {
    const workspace = await this.db.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, status: true },
    });
    if (!workspace) throw new NotFoundException("ไม่พบ Workspace");
    if (workspace.status !== "ACTIVE") {
      throw new ForbiddenException("Workspace ต้องอยู่ในสถานะ ACTIVE");
    }
    if (!(await this.rbac.hasPermission(userId, workspaceId, "modules.manage"))) {
      throw new ForbiddenException("ต้องมีสิทธิ์ modules.manage");
    }
  }

  private async compatibility(
    userId: string,
    workspaceId: string,
    manifest: ModuleManifest,
  ) {
    const issues: string[] = [];
    const minimum = compareVersions(PLATFORM_VERSION, manifest.compatibility.minPlatformVersion);
    const maximum = compareVersions(PLATFORM_VERSION, manifest.compatibility.maxPlatformVersionExclusive);

    if (minimum === null || maximum === null) {
      issues.push("Platform หรือ Manifest ใช้รูปแบบ semantic version ที่ไม่รองรับ");
    } else {
      if (minimum < 0) issues.push(`ต้องใช้ Platform อย่างน้อย ${manifest.compatibility.minPlatformVersion}`);
      if (maximum >= 0) issues.push(`Platform ต้องต่ำกว่า ${manifest.compatibility.maxPlatformVersionExclusive}`);
    }

    const registeredPermissions = await this.db.permission.findMany({
      where: { key: { in: manifest.permissions } },
      select: { key: true },
    });
    const registeredPermissionKeys = new Set(registeredPermissions.map((item) => item.key));
    const missingPermissions = manifest.permissions.filter((key) => !registeredPermissionKeys.has(key));
    if (missingPermissions.length) {
      issues.push(`ไม่พบ Permission ที่ประกาศใน Manifest: ${missingPermissions.join(", ")}`);
    }

    const installed = await this.db.moduleInstallation.findMany({
      where: { workspaceId, enabled: true },
      select: { moduleId: true },
    });
    const enabledIds = new Set(installed.map((item) => item.moduleId));
    for (const dependency of manifest.dependencies) {
      if (!enabledIds.has(dependency)) issues.push(`ต้องเปิดใช้งานโมดูล ${dependency} ก่อน`);
    }

    let tenantMigrationVersions: string[] = [];
    try {
      const tenant = await this.tenantDatabases.forMembership(userId, workspaceId);
      const rows = await tenant.$queryRawUnsafe<Array<{ version: string }>>(
        "SELECT version FROM tenant_migrations",
      );
      tenantMigrationVersions = rows.map((row) => row.version);
    } catch {
      issues.push("ไม่สามารถอ่าน Tenant Migration Ledger ได้");
    }

    for (const required of manifest.requiredTenantMigrations) {
      if (!tenantMigrationVersions.includes(required)) {
        issues.push(`ไม่พบ Tenant Migration ที่จำเป็น: ${required}`);
      }
    }

    return {
      compatible: issues.length === 0,
      platformVersion: PLATFORM_VERSION,
      module: { id: manifest.id, version: manifest.version },
      requiredTenantMigrations: manifest.requiredTenantMigrations,
      appliedTenantMigrations: tenantMigrationVersions,
      issues,
    };
  }

  async list(userId: string, workspaceId: string) {
    await this.assertManage(userId, workspaceId);
    const installations = await this.db.moduleInstallation.findMany({
      where: { workspaceId },
      orderBy: { moduleId: "asc" },
    });
    const byId = new Map(installations.map((item) => [item.moduleId, item]));
    return Promise.all(
      this.registry.list().map(async (manifest) => ({
        manifest,
        installation: byId.get(manifest.id) ?? null,
        compatibility: await this.compatibility(userId, workspaceId, manifest),
      })),
    );
  }

  async checkCompatibility(userId: string, workspaceId: string, moduleId: string) {
    await this.assertManage(userId, workspaceId);
    return this.compatibility(userId, workspaceId, this.registry.get(moduleId));
  }

  async auditLog(userId: string, workspaceId: string) {
    await this.assertManage(userId, workspaceId);
    return this.db.platformAuditLog.findMany({
      where: { workspaceId, entityType: "MODULE_INSTALLATION" },
      orderBy: { occurredAt: "desc" },
      take: 100,
    });
  }

  async install(userId: string, workspaceId: string, moduleId: string) {
    await this.assertManage(userId, workspaceId);
    const manifest = this.registry.get(moduleId);
    const check = await this.compatibility(userId, workspaceId, manifest);
    if (!check.compatible) {
      throw new BadRequestException({ message: "Module compatibility check failed", issues: check.issues });
    }

    const existing = await this.db.moduleInstallation.findUnique({
      where: { workspaceId_moduleId: { workspaceId, moduleId } },
    });
    if (existing) {
      if (existing.version !== manifest.version) {
        throw new ConflictException("มี Module เวอร์ชันอื่นติดตั้งอยู่ ต้องดำเนินการ Upgrade Lifecycle ก่อน");
      }
      return existing;
    }

    return this.db.$transaction(async (tx) => {
      const installation = await tx.moduleInstallation.create({
        data: {
          workspaceId,
          moduleId: manifest.id,
          version: manifest.version,
          source: manifest.source,
          status: "INSTALLED",
          installedBy: userId,
        },
      });
      await tx.platformAuditLog.create({
        data: {
          workspaceId,
          actorUserId: userId,
          action: "MODULE_INSTALLED",
          entityType: "MODULE_INSTALLATION",
          entityId: installation.id,
          metadata: { moduleId, version: manifest.version, source: manifest.source },
        },
      });
      return installation;
    });
  }

  async enable(userId: string, workspaceId: string, moduleId: string) {
    await this.assertManage(userId, workspaceId);
    const manifest = this.registry.get(moduleId);
    const installation = await this.db.moduleInstallation.findUnique({
      where: { workspaceId_moduleId: { workspaceId, moduleId } },
    });
    if (!installation) throw new NotFoundException("ต้องติดตั้งโมดูลก่อนเปิดใช้งาน");
    if (installation.version !== manifest.version) {
      throw new ConflictException("เวอร์ชันที่ติดตั้งไม่ตรงกับ Manifest ปัจจุบัน");
    }
    if (installation.status === "ENABLED" && installation.enabled) return installation;

    const check = await this.compatibility(userId, workspaceId, manifest);
    if (!check.compatible) {
      throw new BadRequestException({ message: "Module compatibility check failed", issues: check.issues });
    }

    return this.db.$transaction(async (tx) => {
      const updated = await tx.moduleInstallation.update({
        where: { id: installation.id },
        data: { enabled: true, status: "ENABLED", enabledAt: new Date(), disabledAt: null, lastError: null },
      });
      await tx.platformAuditLog.create({
        data: {
          workspaceId,
          actorUserId: userId,
          action: "MODULE_ENABLED",
          entityType: "MODULE_INSTALLATION",
          entityId: installation.id,
          metadata: { moduleId, version: manifest.version },
        },
      });
      return updated;
    });
  }

  async disable(userId: string, workspaceId: string, moduleId: string) {
    await this.assertManage(userId, workspaceId);
    const manifest = this.registry.get(moduleId);
    const installation = await this.db.moduleInstallation.findUnique({
      where: { workspaceId_moduleId: { workspaceId, moduleId } },
    });
    if (!installation) throw new NotFoundException("ไม่พบการติดตั้งโมดูล");
    if (installation.status === "DISABLED" && !installation.enabled) return installation;

    const enabledModules = await this.db.moduleInstallation.findMany({
      where: { workspaceId, enabled: true, moduleId: { not: moduleId } },
      select: { moduleId: true },
    });
    const enabledIds = new Set(enabledModules.map((item) => item.moduleId));
    const dependentManifests = this.registry.list().filter(
      (item) => enabledIds.has(item.id) && item.dependencies.includes(moduleId),
    );
    if (dependentManifests.length) {
      throw new ConflictException(
        `ยังมีโมดูลที่ต้องพึ่งพา ${moduleId}: ${dependentManifests.map((item) => item.id).join(", ")}`,
      );
    }

    return this.db.$transaction(async (tx) => {
      const updated = await tx.moduleInstallation.update({
        where: { id: installation.id },
        data: { enabled: false, status: "DISABLED", disabledAt: new Date() },
      });
      await tx.platformAuditLog.create({
        data: {
          workspaceId,
          actorUserId: userId,
          action: "MODULE_DISABLED",
          entityType: "MODULE_INSTALLATION",
          entityId: installation.id,
          metadata: { moduleId, version: manifest.version },
        },
      });
      return updated;
    });
  }
}
