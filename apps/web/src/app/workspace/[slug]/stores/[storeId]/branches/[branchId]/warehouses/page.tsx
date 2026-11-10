"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Workspace = { id: string; slug: string; isOwner: boolean };
type Member = { user: { id: string }; roles: { key: string }[] };
type Branch = { id: string; code: string; name: string; status: string };
type Warehouse = { id: string; branchId: string; code: string; name: string; status: string; isDefault: boolean };

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store", headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(", ") : data.message || "เกิดข้อผิดพลาด");
  return data as T;
}

export default function WarehousesPage() {
  const { slug, storeId, branchId } = useParams<{ slug: string; storeId: string; branchId: string }>();
  const router = useRouter();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [canManage, setCanManage] = useState(false);
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
    const [members, branchData, rows] = await Promise.all([
      api<Member[]>(`/api/workspaces/${current.id}/members`),
      api<Branch>(`/api/tenant/${current.id}/stores/${storeId}/branches/${branchId}`),
      api<Warehouse[]>(`/api/tenant/${current.id}/stores/${storeId}/branches/${branchId}/warehouses`),
    ]);
    const userId = me.user?.userId ?? me.user?.id ?? "";
    setCanManage(current.isOwner || members.some((member) => member.user.id === userId && member.roles.some((role) => role.key === "admin" || role.key === "manager")));
    setBranch(branchData); setWarehouses(rows);
  }

  useEffect(() => {
    let active = true;
    load().catch((e) => { if (active) setError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug, storeId, branchId]);

  async function createWarehouse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!workspace) return;
    setBusy(true); setError("");
    try {
      await api(`/api/tenant/${workspace.id}/branches/${branchId}/warehouses`, {
        method: "POST", body: JSON.stringify({ code: code.trim().toUpperCase(), name: name.trim() }),
      });
      setCode(""); setName(""); setShowCreate(false); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "สร้างคลังไม่สำเร็จ"); }
    finally { setBusy(false); }
  }

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <button className="brand brand-button" onClick={() => router.push(`/workspace/${slug}`)}><span className="brand-mark">S</span> SyncUp</button>
        <div className="user-menu">
          <button className="ghost" onClick={() => router.push(`/workspace/${slug}/stores/${storeId}/branches/${branchId}`)}>ข้อมูลสาขา</button>
          <button className="ghost" onClick={() => router.push(`/workspace/${slug}/stores/${storeId}/branches`)}>สาขาทั้งหมด</button>
        </div>
      </header>
      <section className="dashboard-content">
        <div className="dashboard-head">
          <div><div className="eyebrow">COMMERCE / WAREHOUSE MANAGEMENT</div><h1>คลังสินค้า</h1><p className="subtle">{branch ? `${branch.name} · ${branch.code}` : "กำลังโหลดสาขา..."}</p></div>
          {canManage && branch?.status === "ACTIVE" && <button className="primary" onClick={() => setShowCreate(true)}>＋ เพิ่มคลัง</button>}
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        {loading ? <p className="subtle">กำลังโหลดคลังสินค้า...</p> : warehouses.length === 0 ? (
          <div className="panel empty"><h2>ไม่พบคลังสินค้า</h2><p>เพิ่มคลังสินค้าเพื่อใช้จัดเก็บและบริหารสต็อกของสาขานี้</p>{canManage && branch?.status === "ACTIVE" && <button className="primary" onClick={() => setShowCreate(true)}>สร้างคลังแรก</button>}</div>
        ) : (
          <div className="workspace-grid">
            {warehouses.map((warehouse) => (
              <button type="button" className="workspace-card store-card-button" key={warehouse.id} onClick={() => router.push(`/workspace/${slug}/stores/${storeId}/branches/${branchId}/warehouses/${warehouse.id}`)}>
                <div className="workspace-icon">W</div><h3>{warehouse.name}</h3><p>{warehouse.code}</p>
                <div className="store-card-meta"><span className="status">{warehouse.status === "ACTIVE" ? "ใช้งาน" : "เก็บแล้ว"}</span>{warehouse.isDefault && <span className="status">คลังหลัก</span>}</div>
                <span className="store-card-open">ดูรายละเอียดและแก้ไข →</span>
              </button>
            ))}
          </div>
        )}
        <div className="dashboard-foot">รายการคลังจำกัดตาม Workspace, Store และ Branch พร้อมสิทธิ์ commerce.store.view</div>
      </section>
      {showCreate && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCreate(false); }}>
        <section className="modal"><h2>เพิ่มคลังสินค้า</h2><p className="subtle">คลังใหม่จะถูกสร้างเป็นคลังใช้งาน และยังไม่ใช่คลังหลัก</p>
          <form onSubmit={createWarehouse}>
            <div className="field"><label htmlFor="warehouse-code">รหัสคลัง</label><input id="warehouse-code" required maxLength={40} pattern="[A-Za-z0-9_-]+" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="เช่น WH02" /></div>
            <div className="field"><label htmlFor="warehouse-name">ชื่อคลัง</label><input id="warehouse-name" required maxLength={160} value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น คลังสินค้าสำรอง" /></div>
            <div className="modal-actions"><button type="button" className="ghost" onClick={() => setShowCreate(false)}>ยกเลิก</button><button className="primary" disabled={busy}>{busy ? "กำลังสร้าง..." : "สร้างคลัง"}</button></div>
          </form>
        </section>
      </div>}
    </main>
  );
}
