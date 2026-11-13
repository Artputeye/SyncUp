"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { WorkspaceNavigation } from "@/components/workspace-navigation";

type Workspace = {
  id: string;
  slug: string;
  name: string;
  type: "POS" | "ONLINE" | null;
  status: string;
  provisioningProfileId?: string | null;
  provisioningProfileVersion?: string | null;
};

export default function OnlineWorkspacePage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      const response = await fetch("/api/workspaces", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("ไม่สามารถตรวจสอบ Workspace ได้");
      const rows = await response.json() as Workspace[];
      const current = rows.find((item) => item.slug === slug);
      if (!current) { router.replace("/workspaces"); return; }
      if (current.type !== "ONLINE") {
        router.replace(current.type === "POS" ? "/workspace/" + current.slug + "/pos" : "/workspaces");
        return;
      }
      if (current.status !== "ACTIVE") {
        setError("Workspace นี้ยังไม่พร้อมใช้งาน กรุณาตรวจสอบสถานะการเตรียมระบบ");
        setWorkspace(current);
        return;
      }
      setWorkspace(current);
    }
    load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "เกิดข้อผิดพลาด"))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [router, slug]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    router.replace("/");
    router.refresh();
  }

  return <main className="workspace-shell">
    <header className="topbar">
      <button className="brand brand-button" onClick={() => router.push("/workspaces")}><span className="brand-mark">S</span> SyncUp</button>
      <div className="user-menu">
        {workspace && <WorkspaceNavigation workspaceId={workspace.id} className="workspace-nav-items" />}
        <span className="status">SyncUp Online</span>
        <button className="ghost" onClick={() => router.push("/workspaces")}>เปลี่ยน Workspace</button>
        <button className="ghost" onClick={logout}>ออกจากระบบ</button>
      </div>
    </header>
    <section className="dashboard-content">
      <div className="dashboard-head">
        <div><div className="eyebrow">ONLINE WORKSPACE</div><h1>{workspace?.name ?? (loading ? "กำลังโหลด..." : "SyncUp Online")}</h1><p className="subtle">พื้นที่จัดการร้านค้าออนไลน์ แยกจาก POS Workspace</p></div>
        <span className="status">{workspace?.status ?? (loading ? "LOADING" : "—")}</span>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      {workspace && <section className="panel">
        <div className="panel-heading"><div><h2>Workspace พร้อมสำหรับ Online Modules</h2><p>ข้อมูลสินค้า ราคา สต็อก ลูกค้า และคำสั่งซื้อของ Online จะอยู่ใน Workspace และ Tenant Database นี้โดยเฉพาะ</p></div></div>
        <div className="dashboard-stats">
          <div className="stat-card"><span>ประเภท</span><strong>ONLINE</strong></div>
          <div className="stat-card"><span>Provisioning Profile</span><strong>{workspace.provisioningProfileId ?? "ยังไม่กำหนด"}</strong></div>
          <div className="stat-card"><span>เวอร์ชัน</span><strong>{workspace.provisioningProfileVersion ?? "—"}</strong></div>
        </div>
        <div className="empty">Online commerce modules ยังไม่เปิดให้ใช้งานในรุ่นนี้ หน้านี้จะแสดงความสามารถเมื่อ Track Online เริ่มพัฒนา</div>
      </section>}
      <div className="dashboard-foot">การเข้าถึง Workspace ตรวจสอบจาก Membership ฝั่งเซิร์ฟเวอร์</div>
    </section>
  </main>;
}
