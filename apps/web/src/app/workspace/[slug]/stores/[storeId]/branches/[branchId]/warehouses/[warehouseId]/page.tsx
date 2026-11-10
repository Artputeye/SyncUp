"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Workspace = { id: string; slug: string; isOwner: boolean };
type Member = { user: { id: string }; roles: { key: string }[] };
type Warehouse = { id: string; branchId: string; code: string; name: string; status: string; isDefault: boolean };

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store", headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(", ") : data.message || "เกิดข้อผิดพลาด");
  return data as T;
}

export default function WarehouseDetailPage() {
  const { slug, storeId, branchId, warehouseId } = useParams<{ slug: string; storeId: string; branchId: string; warehouseId: string }>();
  const router = useRouter();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const [me, workspaces] = await Promise.all([
      api<{ user?: { userId?: string; id?: string } }>("/api/auth/me"),
      api<Workspace[]>("/api/workspaces"),
    ]);
    const current = workspaces.find((item) => item.slug === slug);
    if (!current) { router.replace("/workspaces"); return; }
    setWorkspace(current);
    const [members, data] = await Promise.all([
      api<Member[]>(`/api/workspaces/${current.id}/members`),
      api<Warehouse>(`/api/tenant/${current.id}/stores/${storeId}/branches/${branchId}/warehouses/${warehouseId}`),
    ]);
    const userId = me.user?.userId ?? me.user?.id ?? "";
    setCanManage(current.isOwner || members.some((member) => member.user.id === userId && member.roles.some((role) => role.key === "admin" || role.key === "manager")));
    setWarehouse(data); setCode(data.code); setName(data.name);
  }

  useEffect(() => {
    let active = true;
    load().catch((e) => { if (active) setError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug, storeId, branchId, warehouseId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!workspace) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const updated = await api<Warehouse>(`/api/tenant/${workspace.id}/stores/${storeId}/branches/${branchId}/warehouses/${warehouseId}`, {
        method: "PATCH", body: JSON.stringify({ code: code.trim().toUpperCase(), name: name.trim() }),
      });
      setWarehouse((current) => current ? { ...current, ...updated } : updated);
      setNotice("บันทึกข้อมูลคลังเรียบร้อยแล้ว");
    } catch (e) { setError(e instanceof Error ? e.message : "บันทึกข้อมูลไม่สำเร็จ"); }
    finally { setBusy(false); }
  }

  async function setDefault() {
    if (!workspace || !reason.trim()) { setError("กรุณาระบุเหตุผลในการเปลี่ยนคลังหลัก"); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/tenant/${workspace.id}/branches/${branchId}/warehouses/${warehouseId}/default`, {
        method: "PATCH", body: JSON.stringify({ reason: reason.trim() }),
      });
      setReason(""); await load(); setNotice("กำหนดคลังหลักเรียบร้อยแล้ว");
    } catch (e) { setError(e instanceof Error ? e.message : "กำหนดคลังหลักไม่สำเร็จ"); }
    finally { setBusy(false); }
  }

  return (
    <main className="workspace-shell">
      <header className="topbar"><button className="brand brand-button" onClick={() => router.push(`/workspace/${slug}`)}><span className="brand-mark">S</span> SyncUp</button>
        <div className="user-menu"><button className="ghost" onClick={() => router.push(`/workspace/${slug}/stores/${storeId}/branches/${branchId}/warehouses`)}>คลังทั้งหมด</button><button className="ghost" onClick={() => router.push(`/workspace/${slug}/stores/${storeId}/branches/${branchId}`)}>ข้อมูลสาขา</button></div>
      </header>
      <section className="dashboard-content">
        <div className="dashboard-head"><div><div className="eyebrow">COMMERCE / WAREHOUSE DETAILS</div><h1>{warehouse?.name ?? "รายละเอียดคลัง"}</h1><p className="subtle">{warehouse?.code ?? ""} · {warehouse?.status ?? ""} {warehouse?.isDefault ? "· คลังหลัก" : ""}</p></div>
          <button className="ghost" onClick={() => router.push(`/workspace/${slug}/stores/${storeId}/branches/${branchId}/warehouses`)}>← กลับไปคลัง</button></div>
        {error && <div className="error" role="alert">{error}</div>}{notice && <div className="success" role="status">{notice}</div>}
        {loading ? <p className="subtle">กำลังโหลดข้อมูลคลัง...</p> : warehouse && <>
          <form className="panel" onSubmit={save}>
            <div className="panel-heading"><div><h2>ข้อมูลคลังสินค้า</h2><p>แก้ไขรหัสและชื่อคลังภายในสาขานี้</p></div></div>
            <div className="form-grid">
              <div className="field"><label htmlFor="warehouse-code">รหัสคลัง</label><input id="warehouse-code" required maxLength={40} pattern="[A-Za-z0-9_-]+" disabled={!canManage || warehouse.status !== "ACTIVE"} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></div>
              <div className="field"><label htmlFor="warehouse-name">ชื่อคลัง</label><input id="warehouse-name" required maxLength={160} disabled={!canManage || warehouse.status !== "ACTIVE"} value={name} onChange={(e) => setName(e.target.value)} /></div>
            </div>
            <div className="modal-actions section-spaced"><span className="subtle">{canManage ? "สิทธิ์ commerce.store.manage" : "สิทธิ์อ่านอย่างเดียว"}</span>{canManage && warehouse.status === "ACTIVE" && <button className="primary" disabled={busy}>{busy ? "กำลังบันทึก..." : "บันทึกการเปลี่ยนแปลง"}</button>}</div>
          </form>
          <section className="panel section-spaced">
            <div className="panel-heading"><div><h2>กำหนดคลังหลัก</h2><p>แต่ละสาขามีคลังหลักได้หนึ่งแห่ง</p></div></div>
            {warehouse.isDefault ? <span className="status">คลังหลักปัจจุบัน</span> : canManage && warehouse.status === "ACTIVE" && <>
              <div className="field"><label htmlFor="default-reason">เหตุผลในการเปลี่ยนคลังหลัก</label><input id="default-reason" required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ระบุเหตุผลเพื่อบันทึก Audit Log" /></div>
              <div className="modal-actions"><button type="button" className="primary" disabled={busy || !reason.trim()} onClick={setDefault}>กำหนดเป็นคลังหลัก</button></div>
            </>}
          </section>
        </>}
      </section>
    </main>
  );
}
