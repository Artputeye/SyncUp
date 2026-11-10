"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Address = { line1: string; line2: string; subdistrict: string; district: string; province: string; postalCode: string; country: string };
type Store = {
  id: string; name: string; slug: string; status: string; storeType: string;
  description: string | null; contactEmail: string | null; contactPhone: string | null;
  address: Partial<Address> | null; currency: string; timezone: string;
};
const emptyAddress: Address = { line1: "", line2: "", subdistrict: "", district: "", province: "", postalCode: "", country: "Thailand" };

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store", headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(", ") : data.message || "เกิดข้อผิดพลาด");
  return data as T;
}

export default function StoreDetailPage() {
  const { slug, storeId } = useParams<{ slug: string; storeId: string }>();
  const router = useRouter();
  const [store, setStore] = useState<Store | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [address, setAddress] = useState<Address>(emptyAddress);
  const [currency, setCurrency] = useState("THB");
  const [timezone, setTimezone] = useState("Asia/Bangkok");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const [me, workspaces] = await Promise.all([
      api<{ user?: { userId?: string; id?: string } }>("/api/auth/me"),
      api<Array<{ id: string; slug: string; isOwner: boolean }>>("/api/workspaces"),
    ]);
    const workspace = workspaces.find((item) => item.slug === slug);
    if (!workspace) { router.replace("/workspaces"); return; }
    const [data, members] = await Promise.all([
      api<Store>(`/api/tenant/${workspace.id}/stores/${storeId}`),
      api<Array<{ user: { id: string }; roles: { key: string }[] }>>(`/api/workspaces/${workspace.id}/members`),
    ]);
    const userId = me.user?.userId ?? me.user?.id ?? "";
    setCanManage(workspace.isOwner || members.some((member) =>
      member.user.id === userId && member.roles.some((role) => role.key === "admin" || role.key === "manager")
    ));
    setStore(data);
    setName(data.name);
    setDescription(data.description ?? "");
    setContactEmail(data.contactEmail ?? "");
    setContactPhone(data.contactPhone ?? "");
    setAddress({ ...emptyAddress, ...(data.address ?? {}) });
    setCurrency(data.currency.trim());
    setTimezone(data.timezone);
  }

  useEffect(() => {
    let active = true;
    load().catch((e) => { if (active) setError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug, storeId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const workspaces = await api<Array<{ id: string; slug: string }>>("/api/workspaces");
      const workspaceId = workspaces.find((item) => item.slug === slug)?.id;
      if (!workspaceId) throw new Error("ไม่พบ Workspace");
      const updated = await api<Store>(`/api/tenant/${workspaceId}/stores/${storeId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null, contactEmail: contactEmail.trim() || null, contactPhone: contactPhone.trim() || null, address, currency, timezone }),
      });
      setStore(updated); setNotice("บันทึกข้อมูล Store เรียบร้อยแล้ว");
    } catch (e) { setError(e instanceof Error ? e.message : "บันทึกข้อมูลไม่สำเร็จ"); }
    finally { setBusy(false); }
  }

  function updateAddress(key: keyof Address, value: string) {
    setAddress((current) => ({ ...current, [key]: value }));
  }

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <button className="brand brand-button" onClick={() => router.push("/workspaces")}><span className="brand-mark">S</span> SyncUp</button>
        <div className="user-menu"><button className="ghost" onClick={() => router.push(`/workspace/${slug}/stores/${storeId}/branches`)}>Branches</button>
          <button className="ghost" onClick={() => router.push(`/workspace/${slug}/stores`)}>Store ทั้งหมด</button>
          <button className="ghost" onClick={() => router.push(`/workspace/${slug}`)}>Workspace</button>
        </div>
      </header>
      <section className="dashboard-content">
        <div className="dashboard-head">
          <div><div className="eyebrow">COMMERCE / STORE DETAILS</div><h1>{store?.name ?? "รายละเอียด Store"}</h1><p className="subtle">/{store?.slug ?? ""} · {store?.status ?? ""}</p></div>
          <button className="ghost" onClick={() => router.push(`/workspace/${slug}/stores`)}>← กลับไป Store</button>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        {notice && <div className="success" role="status">{notice}</div>}
        {loading ? <p className="subtle">กำลังโหลดข้อมูล Store...</p> : (
          <form className="panel" onSubmit={save}>
            <div className="panel-heading"><div><h2>ข้อมูลทั่วไป</h2><p>ชื่อและรายละเอียดของ Store</p></div></div>
            <div className="form-grid">
              <div className="field"><label htmlFor="store-name">ชื่อ Store</label><input id="store-name" required maxLength={160} disabled={!canManage} value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="field"><label htmlFor="store-slug">Store URL ID</label><input id="store-slug" value={store?.slug ?? ""} disabled /></div>
              <div className="field field-wide"><label htmlFor="store-description">รายละเอียด</label><textarea id="store-description" rows={4} maxLength={10000} disabled={!canManage} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="รายละเอียดเกี่ยวกับ Store" /></div>
            </div>
            <div className="panel-heading section-spaced"><div><h2>ข้อมูลติดต่อ</h2><p>ช่องทางติดต่อหลักของ Store</p></div></div>
            <div className="form-grid">
              <div className="field"><label htmlFor="contact-email">อีเมลติดต่อ</label><input id="contact-email" type="email" maxLength={320} disabled={!canManage} value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="contact@example.com" /></div>
              <div className="field"><label htmlFor="contact-phone">เบอร์โทรศัพท์</label><input id="contact-phone" type="tel" maxLength={40} disabled={!canManage} value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="+66 ..." /></div>
            </div>
            <div className="panel-heading section-spaced"><div><h2>ที่อยู่</h2><p>ที่อยู่หลักของ Store</p></div></div>
            <div className="form-grid">
              <div className="field field-wide"><label htmlFor="address-line1">ที่อยู่</label><input id="address-line1" disabled={!canManage} value={address.line1} onChange={(e) => updateAddress("line1", e.target.value)} placeholder="บ้านเลขที่ อาคาร ถนน" /></div>
              <div className="field field-wide"><label htmlFor="address-line2">รายละเอียดเพิ่มเติม</label><input id="address-line2" disabled={!canManage} value={address.line2} onChange={(e) => updateAddress("line2", e.target.value)} placeholder="หมู่บ้าน ชั้น ห้อง ฯลฯ" /></div>
              <div className="field"><label htmlFor="subdistrict">แขวง / ตำบล</label><input id="subdistrict" disabled={!canManage} value={address.subdistrict} onChange={(e) => updateAddress("subdistrict", e.target.value)} /></div>
              <div className="field"><label htmlFor="district">เขต / อำเภอ</label><input id="district" disabled={!canManage} value={address.district} onChange={(e) => updateAddress("district", e.target.value)} /></div>
              <div className="field"><label htmlFor="province">จังหวัด</label><input id="province" disabled={!canManage} value={address.province} onChange={(e) => updateAddress("province", e.target.value)} /></div>
              <div className="field"><label htmlFor="postal-code">รหัสไปรษณีย์</label><input id="postal-code" maxLength={20} disabled={!canManage} value={address.postalCode} onChange={(e) => updateAddress("postalCode", e.target.value)} /></div>
              <div className="field"><label htmlFor="country">ประเทศ</label><input id="country" disabled={!canManage} value={address.country} onChange={(e) => updateAddress("country", e.target.value)} /></div>
            </div>
            <div className="panel-heading section-spaced"><div><h2>ภูมิภาคและสกุลเงิน</h2><p>ค่าเริ่มต้นสำหรับราคาและเวลาของ Store</p></div></div>
            <div className="form-grid">
              <div className="field"><label htmlFor="currency">สกุลเงิน (ISO 4217)</label><select id="currency" disabled={!canManage} value={currency} onChange={(e) => setCurrency(e.target.value)}><option value="THB">THB — Thai Baht</option><option value="USD">USD — US Dollar</option><option value="EUR">EUR — Euro</option><option value="JPY">JPY — Japanese Yen</option><option value="GBP">GBP — Pound Sterling</option><option value="SGD">SGD — Singapore Dollar</option><option value="MYR">MYR — Malaysian Ringgit</option></select></div>
              <div className="field"><label htmlFor="timezone">เขตเวลา</label><select id="timezone" disabled={!canManage} value={timezone} onChange={(e) => setTimezone(e.target.value)}><option value="Asia/Bangkok">Asia/Bangkok (UTC+07:00)</option><option value="Asia/Singapore">Asia/Singapore (UTC+08:00)</option><option value="Asia/Tokyo">Asia/Tokyo (UTC+09:00)</option><option value="Asia/Kuala_Lumpur">Asia/Kuala_Lumpur (UTC+08:00)</option><option value="Europe/London">Europe/London</option><option value="Europe/Paris">Europe/Paris</option><option value="America/New_York">America/New_York</option><option value="America/Los_Angeles">America/Los_Angeles</option><option value="UTC">UTC</option></select></div>
            </div>
            <div className="modal-actions section-spaced">
              <span className="subtle">{canManage ? "สิทธิ์ commerce.store.manage" : "สิทธิ์อ่านอย่างเดียว"}</span>
              {canManage && <button className="primary" disabled={busy}>{busy ? "กำลังบันทึก..." : "บันทึกการเปลี่ยนแปลง"}</button>}
            </div>
          </form>
        )}
      </section>
    </main>
  );
}
