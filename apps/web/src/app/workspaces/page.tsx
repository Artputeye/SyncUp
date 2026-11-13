"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Workspace = { id: string; slug: string; name: string; type: "POS" | "ONLINE" | null; status: string; isOwner: boolean; provisioningProfileId?: string | null; provisioningProfileVersion?: string | null; provisioningStartedAt?: string | null; provisionedAt?: string | null; provisioningError?: string | null };

export default function WorkspacesPage() {
  const router = useRouter();
  const [user, setUser] = useState<{email:string;isPlatformAdmin?:boolean}|null>(null);
  const [items, setItems] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [workspaceType, setWorkspaceType] = useState<"POS" | "ONLINE">("POS");
  const [creating, setCreating] = useState(false);

  async function load() {
    const me = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
    if (!me.ok) { router.replace("/"); return; }
    const meData = await me.json(); setUser(meData.user);
    const response = await fetch("/api/workspaces", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error("ไม่สามารถโหลด Workspace ได้");
    const workspaces = await response.json() as Workspace[];
    // Keep the internal test workspace out of the user-facing workspace picker.
    setItems(workspaces.filter(item => item.slug !== "test"));
  }
  useEffect(() => { load().catch(e=>setError(e.message)).finally(()=>setLoading(false)); }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method:"POST", credentials:"same-origin" });
    router.replace("/"); router.refresh();
  }
  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setCreating(true); setError("");
    try {
      const response = await fetch("/api/workspaces", { method:"POST", headers:{"Content-Type":"application/json"}, credentials:"same-origin", body:JSON.stringify({name,slug,type:workspaceType}) });
      const payload = await response.json().catch(()=>({}));
      if (!response.ok) throw new Error(Array.isArray(payload.message) ? payload.message.join(", ") : payload.message || "สร้าง Workspace ไม่สำเร็จ");
      setShowCreate(false); setName(""); setSlug(""); setWorkspaceType("POS"); await load();
    } catch(e) { setError(e instanceof Error ? e.message : "เกิดข้อผิดพลาด"); }
    finally { setCreating(false); }
  }

  return <main className="workspace-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">S</span> SyncUp</div><div className="user-menu"><span>{user?.email ?? "กำลังโหลด..."}</span>{user?.isPlatformAdmin&&<button className="ghost" onClick={()=>router.push("/admin")}>System Admin</button>}<button className="ghost" onClick={logout}>ออกจากระบบ</button></div></header>
    <section className="workspace-content">
      <div className="workspace-heading"><div><div className="eyebrow">YOUR ORGANIZATION</div><h1>เลือก Workspace</h1><p className="subtle" style={{margin:0}}>เลือกพื้นที่ทำงานเพื่อเริ่มต้น หรือสร้าง Workspace ใหม่</p></div><button className="primary" onClick={()=>setShowCreate(true)}>＋ สร้าง Workspace</button></div>
      {error && <div className="error" role="alert">{error}</div>}
      {loading ? <p className="subtle">กำลังโหลด Workspace...</p> : <div className="workspace-grid">{items.length ? items.map(item=><button key={item.id} className="workspace-card" onClick={()=>router.push("/workspace/"+item.slug+(item.type==="POS"?"/pos":item.type==="ONLINE"?"/online":""))} disabled={item.status!=="ACTIVE"||!item.type}><div className="workspace-icon">{item.type==="POS"?"P":item.type==="ONLINE"?"O":"?"}</div><h3>{item.name}</h3><p>/{item.slug} · {item.isOwner ? "Owner" : "Member"} · {item.type === "POS" ? "SyncUp POS" : item.type === "ONLINE" ? "SyncUp Online" : "ยังไม่จำแนกประเภท"}</p><p className="subtle">{item.provisioningProfileId&&item.provisioningProfileVersion?"Profile "+item.provisioningProfileId+" · v"+item.provisioningProfileVersion:"ยังไม่มี Provisioning Profile"}</p><span className="status">{item.status==="ACTIVE"?"พร้อมใช้งาน":item.status==="PROVISIONING"?"กำลังเตรียมระบบ":item.status==="FAILED"?"Provisioning ไม่สำเร็จ":item.status}</span>{item.provisioningError&&<span className="error" role="note">พบปัญหาในการเตรียมระบบ</span>}</button>) : <div className="empty">ยังไม่มี Workspace เริ่มต้นด้วยการสร้าง Workspace แรกของคุณ</div>}</div>}
    </section>
    {showCreate && <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setShowCreate(false)}}><section className="modal"><h2>สร้าง Workspace</h2><p className="subtle">Workspace ใหม่จะมีฐานข้อมูลแยกเป็นของตัวเอง</p><form onSubmit={createWorkspace}><div className="field"><label htmlFor="ws-name">ชื่อ Workspace</label><input id="ws-name" required maxLength={160} value={name} onChange={e=>{setName(e.target.value);setSlug(e.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,48))}} placeholder="เช่น Acme Company"/></div><div className="field"><label htmlFor="ws-type">ประเภท Workspace</label><select id="ws-type" required value={workspaceType} onChange={e=>setWorkspaceType(e.target.value as "POS" | "ONLINE")}><option value="POS">SyncUp POS</option><option value="ONLINE">SyncUp Online</option></select></div><div className="field"><label htmlFor="ws-slug">Workspace URL ID</label><input id="ws-slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxLength={48} value={slug} onChange={e=>setSlug(e.target.value.toLowerCase())} placeholder="acme-company"/></div>{error&&<div className="error">{error}</div>}<div className="modal-actions"><button type="button" className="ghost" onClick={()=>setShowCreate(false)}>ยกเลิก</button><button className="primary" disabled={creating}>{creating?"กำลังสร้าง...":"สร้าง Workspace"}</button></div></form></section></div>}
  </main>;
}
