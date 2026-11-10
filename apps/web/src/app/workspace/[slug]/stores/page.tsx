"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Workspace = { id: string; slug: string; name: string; status: string; isOwner: boolean };
type Member = { isOwner: boolean; user: { id: string }; roles: { key: string }[] };
type Store = { id: string; name: string; slug: string; status: string; storeType: string; currency: string; timezone: string; activeBranchCount: number; defaultBranchName: string | null };

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store", headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(", ") : data.message || "เกิดข้อผิดพลาด");
  return data as T;
}

export default function StoresPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [storeSlug, setStoreSlug] = useState("");

  async function load() {
    const [me, workspaces] = await Promise.all([
      api<{ user?: { userId?: string; id?: string } }>("/api/auth/me"),
      api<Workspace[]>("/api/workspaces"),
    ]);
    const current = workspaces.find((item) => item.slug === slug);
    if (!current) { router.replace("/workspaces"); return; }
    setWorkspace(current);
    const [members, rows] = await Promise.all([
      api<Member[]>(`/api/workspaces/${current.id}/members`),
      api<Store[]>(`/api/tenant/${current.id}/stores`),
    ]);
    const userId = me.user?.userId ?? me.user?.id ?? "";
    setCanManage(current.isOwner || members.some((member) =>
      member.user.id === userId && member.roles.some((role) => role.key === "admin" || role.key === "manager")
    ));
    setStores(rows);
  }

  useEffect(() => {
    let active = true;
    load().catch((e) => { if (active) setError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug]);

  async function createStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace) return;
    setBusy(true); setError("");
    try {
      await api(`/api/tenant/${workspace.id}/stores`, { method: "POST", body: JSON.stringify({ name: name.trim(), slug: storeSlug.trim() }) });
      setName(""); setStoreSlug(""); setShowCreate(false); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "สร้าง Store ไม่สำเร็จ"); }
    finally { setBusy(false); }
  }

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <button className="brand brand-button" onClick={() => router.push(`/workspace/${slug}`)}><span className="brand-mark">S</span> SyncUp</button>
        <div className="user-menu"><button className="ghost" onClick={() => router.push(`/workspace/${slug}`)}>Workspace</button><button className="ghost" onClick={() => router.push("/workspaces")}>Workspace ทั้งหมด</button></div>
      </header>
      <section className="dashboard-content">
        <div className="dashboard-head"><div><div className="eyebrow">COMMERCE / STORE MANAGEMENT</div><h1>จัดการ Store</h1><p className="subtle">{workspace?.name ?? "กำลังโหลด Workspace..."}</p></div>{canManage && <button className="primary" onClick={() => setShowCreate(true)}>＋ เพิ่ม Store</button>}</div>
        {error && <div className="error" role="alert">{error}</div>}
        {loading ? <p className="subtle">กำลังโหลด Store...</p> : stores.length === 0 ? (
          <div className="panel empty"><h2>ยังไม่มี Store</h2><p>สร้าง Store แรกเพื่อเริ่มตั้งค่าสาขา คลังสินค้า และช่องทางขาย</p>{canManage && <button className="primary" onClick={() => setShowCreate(true)}>สร้าง Store แรก</button>}</div>
        ) : (
          <div className="workspace-grid">
            {stores.map((store) => (
              <button type="button" className="workspace-card store-card-button" key={store.id} onClick={() => router.push(`/workspace/${slug}/stores/${store.id}`)}>
                <div className="workspace-icon">{store.name.slice(0, 1).toUpperCase()}</div><h3>{store.name}</h3><p>/{store.slug}</p>
                <div className="store-card-meta"><span className="status">{store.status === "ACTIVE" ? "ใช้งาน" : store.status}</span><span className="status">{store.activeBranchCount} สาขา</span></div>
                <div className="store-card-details"><div>สาขาหลัก: {store.defaultBranchName ?? "—"}</div><div>ประเภท: {store.storeType}</div><div>สกุลเงิน: {store.currency}</div><div>เขตเวลา: {store.timezone}</div></div>
                <span className="store-card-open">ดูรายละเอียดและแก้ไข →</span>
              </button>
            ))}
          </div>
        )}
        <div className="dashboard-foot">การอ่านข้อมูล Store ถูกจำกัดด้วย commerce.store.view และตรวจสอบ Workspace ฝั่ง API</div>
      </section>
      {showCreate && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCreate(false); }}>
          <section className="modal"><h2>สร้าง Store</h2><p className="subtle">ระบบจะสร้างสำนักงานใหญ่และคลังหลักให้อัตโนมัติ</p>
            <form onSubmit={createStore}>
              <div className="field"><label htmlFor="store-name">ชื่อ Store</label><input id="store-name" required maxLength={160} value={name} onChange={(event) => { const value = event.target.value; setName(value); setStoreSlug(value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80)); }} placeholder="เช่น ARTTECH Official" /></div>
              <div className="field"><label htmlFor="store-slug">Store URL ID</label><input id="store-slug" required pattern="[a-z0-9-]+" maxLength={80} value={storeSlug} onChange={(event) => setStoreSlug(event.target.value.toLowerCase())} placeholder="arttech-official" /></div>
              <div className="modal-actions"><button type="button" className="ghost" onClick={() => setShowCreate(false)}>ยกเลิก</button><button className="primary" disabled={busy}>{busy ? "กำลังสร้าง..." : "สร้าง Store"}</button></div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
