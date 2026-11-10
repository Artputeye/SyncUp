import { BadRequestException, Injectable } from "@nestjs/common";
import { access, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import * as path from "node:path";

type BackupLocationConfig = { path: string; updatedAt: string };
type BackupLocationStatus = {
  configured: boolean;
  path: string | null;
  updatedAt: string | null;
  status: "NOT_CONFIGURED" | "READY" | "UNAVAILABLE";
  message: string;
};

@Injectable()
export class BackupLocationService {
  private get configFile(): string {
    const dataDir = process.env.SYNCUP_DATA_DIR ?? path.resolve(process.cwd(), "data");
    return path.resolve(process.env.SYNCUP_BACKUP_CONFIG_FILE ?? path.join(dataDir, "backup-location.json"));
  }

  private async readConfig(): Promise<BackupLocationConfig | null> {
    try {
      const raw = await readFile(this.configFile, "utf8");
      const value = JSON.parse(raw) as Partial<BackupLocationConfig>;
      if (typeof value.path !== "string" || typeof value.updatedAt !== "string") return null;
      return { path: value.path, updatedAt: value.updatedAt };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async getStatus(): Promise<BackupLocationStatus> {
    const config = await this.readConfig();
    if (!config) {
      return { configured: false, path: null, updatedAt: null, status: "NOT_CONFIGURED", message: "ยังไม่ได้กำหนดโฟลเดอร์ Backup" };
    }
    try {
      const info = await stat(config.path);
      if (!info.isDirectory()) {
        return { configured: true, path: config.path, updatedAt: config.updatedAt, status: "UNAVAILABLE", message: "Path นี้ไม่ใช่โฟลเดอร์" };
      }
      await access(config.path, constants.W_OK);
      return { configured: true, path: config.path, updatedAt: config.updatedAt, status: "READY", message: "Server เข้าถึงโฟลเดอร์และมีสิทธิ์เขียนได้" };
    } catch {
      return { configured: true, path: config.path, updatedAt: config.updatedAt, status: "UNAVAILABLE", message: "Server เข้าถึงโฟลเดอร์ไม่ได้ หรือไม่มีสิทธิ์เขียน ตรวจสอบการเชื่อมต่อ NAS และบัญชี Windows ที่ใช้รัน API" };
    }
  }

  async save(location: string): Promise<BackupLocationStatus> {
    const value = typeof location === "string" ? location.trim() : "";
    const isUnc = value.startsWith("\\\\") && value.split("\\").filter(Boolean).length >= 2;
    const isWindowsAbsolute = /^[A-Za-z]:[\\/]/.test(value);
    if (!value || value.length > 1024 || value.includes("\0") || (!isUnc && !isWindowsAbsolute && !path.isAbsolute(value))) {
      throw new BadRequestException("กรุณาระบุ Absolute Path หรือ UNC Path ของ Shared Folder บน NAS");
    }
    const config: BackupLocationConfig = { path: value, updatedAt: new Date().toISOString() };
    const target = this.configFile;
    const temporary = target + ".tmp";
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(temporary, JSON.stringify(config, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
    return this.getStatus();
  }
}
