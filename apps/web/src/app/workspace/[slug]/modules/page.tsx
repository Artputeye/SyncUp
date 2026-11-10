"use client";

import "./modules.css";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Compatibility = {
  compatible: boolean;
  platformVersion: string;
  module: { id: string; version: string };
  requiredTenantMigrations: string[];
  appliedTenantMigrations: string[];
  issues: string[];
};
type Manifest = {
  id: string;
  name: string;
  description: string;
  version: string;
  source: string;
  compatibility: { minPlatformVersion: string; maxPlatformVersionExclusive: string };
  dependencies: string[];
  requiredTenantMigrations: string[];
  permissions: string[];
};
type Installation = {
  id: string;
  moduleId: string;
  version: string;
  enabled: boolean;
  status: "INSTALLED" | "ENABLED" | "DISABLED" | "FAILED";
  installedAt: string;
  enabledAt: string | null;
  disabledAt: string | null;
};
type ModuleRow = { manifest: Manifest; installation: Installation | null; compatibility: Compatibility };
type AuditEvent = { id: string; action: string; entityId: string; occurredAt: string; metadata: Record<string, unknown> };
type Workspace = { id: string; slug: string; name: string; status: string; isOwner: boolean };

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(", ") : data.message || "เกิดข้อผิดพลาด");
  return data as T;
}

const statusLabels: Record<string, string> = { INSTALLED: "ติดตั้งแล้ว", ENABLED: "เปิดใช้งาน", DISABLED: "ปิดใช้งาน", FAILED: "ผิดพลาด" };
const actionLabels: Record<string, string> = { MODULE_INSTALLED: "ติดตั้งโมดูล", MODULE_ENABLED: "เปิดใช้งานโมดูล", MODULE_DISABLED: "ปิดใช้งานโมดูล" };

export default function WorkspaceModulesPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [rows, setRows] = useState<ModuleRow[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const workspaces = await api<Workspace[]>("/api/workspaces");
    const current = workspaces.find((item) => item.slug === slug);
    if (!current) { router.replace("/workspaces"); return; }
    setWorkspace(current);
    const [modules, events] = await Promise.all([
      api<ModuleRow[]>(`/api/workspaces/${current.id}/modules`),
      api<AuditEvent[]>(`/api/workspaces/${current.id}/modules/audit`),
    ]);
    setRows(modules);
    setAudit(events);
  }, [router, slug]);

  useEffect(() => {
    let active = true;
    load().catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "โหลดข้อมูลไม่สำเร็จ"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load]);

  async function transition(moduleId: string, action: "install" | "enable" | "disable") {
    if (!workspace) return;
    const labels = { install: "ติดตั้ง", enable: "เปิดใช้งาน", disable: "ปิดใช้งาน" };
    const warning = action === "disable"
      ? "การปิดโมดูลจะไม่ลบข้อมูลหรือ Migration ของ Tenant ต้องการดำเนินการต่อหรือไม่?"
      : action === "enable" ? "ยืนยันเปิดใช้งานโมดูลใน Workspace นี้หรือไม่?" : "ยืนยันติดตั้งโมดูลใน Workspace นี้หรือไม่?";
    if (!window.confirm(warning)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/workspaces/${workspace.id}/modules/${moduleId}/${action}`, { method: "POST" });
      await load();
      setNotice(`${labels[action]}โมดูลเรียบร้อยแล้ว`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${labels[action]}โมดูลไม่สำเร็จ`);
    } finally { setBusy(false); }
  }

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <button className="brand brand-button" onClick={() => router.push(`/workspace/${slug}`)}><span className="brand-mark">S</span> SyncUp</button>
        <div className="user-menu">
          <button className="ghost" onClick={() => router.push(`/workspace/${slug}`)}>Workspace</button>
          <button className="ghost" onClick={() => router.push(`/workspace/${slug}/stores`)}>จัดการ Store</button>
          <button className="ghost" onClick={() => router.push("/workspaces")}>Workspace ทั้งหมด</button>
        </div>
      </header>
      <section className="dashboard-content">
        <div className="dashboard-head">
          <div><div className="eyebrow">WORKSPACE / MODULE MANAGEMENT</div><h1>จัดการ Modules</h1><p className="subtle">{workspace?.name ?? "กำลังโหลด Workspace..."}</p></div>
          <span className="status">{workspace?.status ?? "LOADING"}</span>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        {notice && <div className="success" role="status">{notice}</div>}
        {loading ? <p className="subtle">กำลังตรวจสอบโมดูลและ Compatibility...</p> : rows.length === 0 ? (
          <section className="panel empty"><h2>ไม่พบโมดูลที่ลงทะเบียน</h2><p>ตรวจสอบ Module Registry ของระบบ</p></section>
        ) : (
          <div className="workspace-grid">
            {rows.map(({ manifest, installation, compatibility }) => (
              <article className="workspace-card module-card" key={manifest.id}>
                <div className="workspace-icon">{manifest.name.slice(0, 1)}</div>
                <h3>{manifest.name}</h3>
                <p>{manifest.description}</p>
                <div className="store-card-meta">
                  <span className="status">{manifest.id} · v{manifest.version}</span>
                  <span className="status">{installation ? statusLabels[installation.status] ?? installation.status : "ยังไม่ติดตั้ง"}</span>
                </div>
                <div className="store-card-details">
                  <div>Platform: {compatibility.platformVersion}</div>
                  <div>ต้องการ Platform: ≥ {manifest.compatibility.minPlatformVersion} และ &lt; {manifest.compatibility.maxPlatformVersionExclusive}</div>
                  <div>Tenant Migration: {compatibility.requiredTenantMigrations.join(", ") || "ไม่มี"}</div>
                  <div>Migration ที่พบ: {compatibility.appliedTenantMigrations.join(", ") || "ไม่พบ"}</div>
                </div>
                <div className={compatibility.compatible ? "success module-compatibility" : "error module-compatibility"} role="status">
                  {compatibility.compatible ? "ผ่าน Compatibility Check" : "ไม่ผ่าน Compatibility Check"}
                  {compatibility.issues.length > 0 && <ul>{compatibility.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
                </div>
                <div className="module-actions">
                  {!installation && <button className="primary" disabled={busy || !compatibility.compatible} onClick={() => transition(manifest.id, "install")}>ติดตั้ง</button>}
                  {installation && installation.status !== "ENABLED" && <button className="primary" disabled={busy || !compatibility.compatible} onClick={() => transition(manifest.id, "enable")}>เปิดใช้งาน</button>}
                  {installation?.status === "ENABLED" && <button className="ghost" disabled={busy} onClick={() => transition(manifest.id, "disable")}>ปิดใช้งาน</button>}
                </div>
              </article>
            ))}
          </div>
        )}
        <section className="panel">
          <div className="panel-heading"><div><h2>ประวัติ Module Lifecycle</h2><p>บันทึกการติดตั้ง เปิดใช้งาน และปิดใช้งานใน Workspace นี้</p></div><span className="count-pill">{audit.length} รายการ</span></div>
          {audit.length === 0 ? <p className="subtle">ยังไม่มีประวัติ</p> : <div className="member-list">
            {audit.map((event) => <div className="member-row" key={event.id}>
              <div className="member-avatar">M</div>
              <div className="member-identity"><strong>{actionLabels[event.action] ?? event.action}</strong><span>{String(event.metadata.moduleId ?? event.entityId)} · {String(event.metadata.version ?? "")}</span></div>
              <time className="subtle" dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString("th-TH")}</time>
            </div>)}
          </div>}
        </section>
        <div className="dashboard-foot">การจัดการ Modules ต้องมี modules.manage และทุกการเปลี่ยนสถานะถูกบันทึก Audit Log</div>
      </section>
    </main>
  );
}
