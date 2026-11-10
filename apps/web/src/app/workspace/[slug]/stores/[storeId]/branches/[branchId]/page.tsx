"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Address = { line1: string; line2: string; subdistrict: string; district: string; province: string; postalCode: string; country: string };
type Branch = { id: string; storeId: string; code: string; name: string; status: string; isDefault: boolean; phone: string | null; address: Partial<Address> | null; activeWarehouseCount?: number; defaultWarehouseName?: string | null };
type Workspace = { id: string; slug: string; isOwner: boolean };
type Member = { user: { id: string }; roles: { key: string }[] };
const emptyAddress: Address = { line1: "", line2: "", subdistrict: "", district: "", province: "", postalCode: "", country: "Thailand" };

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store", headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(", ") : data.message || "เกิดข้อผิดพลาด");
  return data as T;
}

export default function BranchDetailPage() {
  const { slug, storeId, branchId } = useParams<{ slug: string; storeId: string; branchId: string }>();
  const router = useRouter();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState<Address>(emptyAddress);
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
      api<Branch>(`/api/tenant/${current.id}/stores/${storeId}/branches/${branchId}`),
    ]);
    const userId = me.user?.userId ?? me.user?.id ?? "";
    setCanManage(current.isOwner || members.some((member) => member.user.id === userId && member.roles.some((role) => role.key === "admin" || role.key === "manager")));
    setBranch(data); setCode(data.code); setName(data.name); setPhone(data.phone ?? "");
    setAddress({ ...emptyAddress, ...(data.address ?? {}) });
  }

  useEffect(() => {
    let active = true;
    load().catch((e) => { if (active) setError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug, storeId, branchId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!workspace) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const updated = await api<Branch>(`/api/tenant/${workspace.id}/stores/${storeId}/branches/${branchId}`, {
        method: "PATCH", body: JSON.stringify({ code: code.trim().toUpperCase(), name: name.trim(), phone: phone.trim() || null, address }),
      });
      setBranch((current) => current ? { ...current, ...updated } : updated);
      setNotice("บันทึกข้อมูลสาขาเรียบร้อยแล้ว");
    } catch (e) { setError(e instanceof Error ? e.message : "บันทึกข้อมูลไม่สำเร็จ"); }
    finally { setBusy(false); }
  }

  async function setDefault() {
    if (!workspace || !reason.trim()) { setError("กรุณาระบุเหตุผลในการเปลี่ยนสาขาหลัก"); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/tenant/${workspace.id}/stores/${storeId}/branches/${branchId}/default`, { method: "PATCH", body: JSON.stringify({ reason: reason.trim() }) });
      setReason(""); await load(); setNotice("เปลี่ยนสาขาหลักเรียบร้อยแล้ว");
    } catch (e) { setError(e instanceof Error ? e.message : "เปลี่ยนสาขาหลักไม่สำเร็จ"); }
    finally { setBusy(false); }
  }

  function updateAddress(key: keyof Address, value: string) { setAddress((current) => ({ ...current, [key]: value })); }

  return (
    <main className="workspace-shell">
      <header className="topbar"><button className="brand brand-button" onClick={() => router.push(`/workspace/${slug}`)}><span className="brand-mark">S</span> SyncUp</button>
        <div className="user-menu">
          <button className="ghost" onClick={() => router.push(`/workspace/${slug}/stores/${storeId}/branches/${branchId}/warehouses`)}>Warehouses</button><button className="ghost" onClick={() => router.push(`/workspace/${slug}/stores/${storeId}/branches`)}>สาขาทั้งหมด</button><button className="ghost" onClick={() => router.push(`/workspace/${slug}/stores/${storeId}`)}>ข้อมูล Store</button></div>
      </header>
      <section className="dashboard-content">
        <div className="dashboard-head"><div><div className="eyebrow">COMMERCE / BRANCH DETAILS</div><h1>{branch?.name ?? "รายละเอียดสาขา"}</h1><p className="subtle">{branch?.code ?? ""} · {branch?.status ?? ""} {branch?.isDefault ? "· สาขาหลัก" : ""}</p></div>
          <button className="ghost" onClick={() => router.push(`/workspace/${slug}/stores/${storeId}/branches`)}>← กลับไปสาขา</button></div>
        {error && <div className="error" role="alert">{error}</div>}{notice && <div className="success" role="status">{notice}</div>}
        {loading ? <p className="subtle">กำลังโหลดข้อมูลสาขา...</p> : branch && <>
          <form className="panel" onSubmit={save}>
            <div className="panel-heading"><div><h2>ข้อมูลสาขา</h2><p>แก้ไขรหัส ชื่อ ช่องทางติดต่อ และที่อยู่</p></div></div>
            <div className="form-grid">
              <div className="field"><label htmlFor="branch-code">รหัสสาขา</label><input id="branch-code" required maxLength={40} pattern="[A-Za-z0-9_-]+" disabled={!canManage || branch.status !== "ACTIVE"} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></div>
              <div className="field"><label htmlFor="branch-name">ชื่อสาขา</label><input id="branch-name" required maxLength={160} disabled={!canManage || branch.status !== "ACTIVE"} value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="field"><label htmlFor="branch-phone">เบอร์โทรศัพท์</label><input id="branch-phone" type="tel" maxLength={40} disabled={!canManage || branch.status !== "ACTIVE"} value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            </div>
            <div className="panel-heading section-spaced"><div><h2>ที่อยู่สาขา</h2><p>ข้อมูลที่อยู่สำหรับการดำเนินงานของสาขา</p></div></div>
            <div className="form-grid">
              <div className="field field-wide"><label htmlFor="address-line1">ที่อยู่</label><input id="address-line1" disabled={!canManage || branch.status !== "ACTIVE"} value={address.line1} onChange={(e) => updateAddress("line1", e.target.value)} /></div>
              <div className="field field-wide"><label htmlFor="address-line2">รายละเอียดเพิ่มเติม</label><input id="address-line2" disabled={!canManage || branch.status !== "ACTIVE"} value={address.line2} onChange={(e) => updateAddress("line2", e.target.value)} /></div>
              <div className="field"><label htmlFor="subdistrict">แขวง / ตำบล</label><input id="subdistrict" disabled={!canManage || branch.status !== "ACTIVE"} value={address.subdistrict} onChange={(e) => updateAddress("subdistrict", e.target.value)} /></div>
              <div className="field"><label htmlFor="district">เขต / อำเภอ</label><input id="district" disabled={!canManage || branch.status !== "ACTIVE"} value={address.district} onChange={(e) => updateAddress("district", e.target.value)} /></div>
              <div className="field"><label htmlFor="province">จังหวัด</label><input id="province" disabled={!canManage || branch.status !== "ACTIVE"} value={address.province} onChange={(e) => updateAddress("province", e.target.value)} /></div>
              <div className="field"><label htmlFor="postal-code">รหัสไปรษณีย์</label><input id="postal-code" maxLength={20} disabled={!canManage || branch.status !== "ACTIVE"} value={address.postalCode} onChange={(e) => updateAddress("postalCode", e.target.value)} /></div>
              <div className="field"><label htmlFor="country">ประเทศ</label><input id="country" disabled={!canManage || branch.status !== "ACTIVE"} value={address.country} onChange={(e) => updateAddress("country", e.target.value)} /></div>
            </div>
            <div className="modal-actions section-spaced"><span className="subtle">{canManage ? "สิทธิ์ commerce.store.manage" : "สิทธิ์อ่านอย่างเดียว"}</span>{canManage && branch.status === "ACTIVE" && <button className="primary" disabled={busy}>{busy ? "กำลังบันทึก..." : "บันทึกการเปลี่ยนแปลง"}</button>}</div>
          </form>
          <section className="panel section-spaced"><div className="panel-heading"><div><h2>การตั้งค่าสาขาหลัก</h2><p>แต่ละ Store มี Default Branch ได้หนึ่งแห่ง</p></div></div>
            <p className="subtle">คลังที่ใช้งาน: {branch.activeWarehouseCount ?? 0} · คลังหลัก: {branch.defaultWarehouseName ?? "—"}</p>
            {branch.isDefault ? <span className="status">สาขาหลักปัจจุบัน</span> : canManage && branch.status === "ACTIVE" && <>
              <div className="field"><label htmlFor="default-reason">เหตุผลในการเปลี่ยนสาขาหลัก</label><input id="default-reason" required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ระบุเหตุผลเพื่อบันทึก Audit Log" /></div>
              <div className="modal-actions"><button type="button" className="primary" disabled={busy || !reason.trim()} onClick={setDefault}>กำหนดเป็นสาขาหลัก</button></div>
            </>}
          </section>
        </>}
      </section>
    </main>
  );
}
