"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Workspace = { id: string; slug: string; name: string; isOwner: boolean };
type Member = { isOwner: boolean; user: { id: string }; roles: { key: string }[] };
type Branch = { id: string; storeId: string; code: string; name: string; status: string; isDefault: boolean; phone: string | null; activeWarehouseCount?: number; defaultWarehouseName?: string | null };

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store", headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(", ") : data.message || "เกิดข้อผิดพลาด");
  return data as T;
}

export default function BranchesPage() {
  const { slug, storeId } = useParams<{ slug: string; storeId: string }>();
  const router = useRouter();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [storeName, setStoreName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");

  async function load() {
    const [me, workspaces] = await Promise.all([
      api<{ user?: { userId?: string; id?: string } }>("/api/auth/me"),
      api<Workspace[]>("/api/workspaces"),
    ]);
    const current = workspaces.find((item) => item.slug === slug);
    if (!current) { router.replace("/workspaces"); return; }
    setWorkspace(current);
    const [members, store, rows] = await Promise.all([
      api<Member[]>(`/api/workspaces/${current.id}/members`),
      api<{ name: string }>(`/api/tenant/${current.id}/stores/${storeId}`),
      api<Branch[]>(`/api/tenant/${current.id}/stores/${storeId}/branches`),
    ]);
    const userId = me.user?.userId ?? me.user?.id ?? "";
    setCanManage(current.isOwner || members.some((member) => member.user.id === userId && member.roles.some((role) => role.key === "admin" || role.key === "manager")));
    setStoreName(store.name);
    setBranches(rows);
  }

  useEffect(() => {
    let active = true;
    load().catch((e) => { if (active) setError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug, storeId]);

  async function createBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace) return;
    setBusy(true); setError("");
    try {
      await api(`/api/tenant/${workspace.id}/stores/${storeId}/branches`, { method: "POST", body: JSON.stringify({ code: code.trim().toUpperCase(), name: name.trim() }) });
      setCode(""); setName(""); setShowCreate(false); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "สร้างสาขาไม่สำเร็จ"); }
    finally { setBusy(false); }
  }

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <button className="brand brand-button" onClick={() => router.push(`/workspace/${slug}`)}><span className="brand-mark">S</span> SyncUp</button>
        <div className="user-menu"><button className="ghost" onClick={() => router.push(`/workspace/${slug}/stores/${storeId}`)}>ข้อมูล Store</button><button className="ghost" onClick={() => router.push(`/workspace/${slug}/stores`)}>Store ทั้งหมด</button></div>
      </header>
      <section className="dashboard-content">
        <div className="dashboard-head"><div><div className="eyebrow">COMMERCE / BRANCH MANAGEMENT</div><h1>จัดการสาขา</h1><p className="subtle">{storeName || "กำลังโหลด Store..."}</p></div>{canManage && <button className="primary" onClick={() => setShowCreate(true)}>＋ เพิ่มสาขา</button>}</div>
        {error && <div className="error" role="alert">{error}</div>}
        {loading ? <p className="subtle">กำลังโหลดสาขา...</p> : branches.length === 0 ? (
          <div className="panel empty"><h2>ไม่พบสาขา</h2><p>สร้างสาขาเพื่อกำหนดจุดขายและคลังสินค้า</p>{canManage && <button className="primary" onClick={() => setShowCreate(true)}>สร้างสาขาแรก</button>}</div>
        ) : (
          <div className="workspace-grid">
            {branches.map((branch) => (
              <button type="button" className="workspace-card store-card-button" key={branch.id} onClick={() => router.push(`/workspace/${slug}/stores/${storeId}/branches/${branch.id}`)}>
                <div className="workspace-icon">{branch.code.slice(0, 1)}</div><h3>{branch.name}</h3><p>{branch.code}</p>
                <div className="store-card-meta"><span className="status">{branch.status === "ACTIVE" ? "ใช้งาน" : "เก็บแล้ว"}</span>{branch.isDefault && <span className="status">สาขาหลัก</span>}</div>
                <div className="store-card-details"><div>คลังที่ใช้งาน: {branch.activeWarehouseCount ?? 0}</div><div>คลังหลัก: {branch.defaultWarehouseName ?? "—"}</div><div>โทร: {branch.phone || "—"}</div></div>
                <span className="store-card-open">ดูรายละเอียดและแก้ไข →</span>
              </button>
            ))}
          </div>
        )}
        <div className="dashboard-foot">ข้อมูลสาขาถูกจำกัดตาม Workspace Membership และ commerce.store.view</div>
      </section>
      {showCreate && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCreate(false); }}>
        <section className="modal"><h2>สร้างสาขา</h2><p className="subtle">ระบบจะสร้างคลังหลักให้สาขาใหม่โดยอัตโนมัติ</p>
          <form onSubmit={createBranch}>
            <div className="field"><label htmlFor="branch-code">รหัสสาขา</label><input id="branch-code" required maxLength={40} pattern="[A-Za-z0-9_-]+" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="เช่น BKK01" /></div>
            <div className="field"><label htmlFor="branch-name">ชื่อสาขา</label><input id="branch-name" required maxLength={160} value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น สาขาสยาม" /></div>
            <div className="modal-actions"><button type="button" className="ghost" onClick={() => setShowCreate(false)}>ยกเลิก</button><button className="primary" disabled={busy}>{busy ? "กำลังสร้าง..." : "สร้างสาขา"}</button></div>
          </form>
        </section>
      </div>}
    </main>
  );
}
