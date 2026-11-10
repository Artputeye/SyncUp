"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Workspace = { id: string; slug: string };
type Unit = { code: string; name: string; symbol: string };

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store", headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(", ") : data.message || "เกิดข้อผิดพลาด");
  return data as T;
}

export default function NewProductPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [workspaceId, setWorkspaceId] = useState("");
  const [units, setUnits] = useState<Unit[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("DRAFT");
  const [sku, setSku] = useState("");
  const [title, setTitle] = useState("");
  const [barcode, setBarcode] = useState("");
  const [uomCode, setUomCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      const workspaces = await api<Workspace[]>("/api/workspaces");
      const current = workspaces.find((item) => item.slug === slug);
      if (!current) { router.replace("/workspaces"); return; }
      const rows = await api<Unit[]>(`/api/tenant/${current.id}/units`);
      if (!active) return;
      setWorkspaceId(current.id);
      setUnits(rows);
      setUomCode(rows.find((unit) => unit.code === "EA")?.code ?? rows[0]?.code ?? "");
    })().catch((e) => { if (active) setError(e instanceof Error ? e.message : "โหลดหน่วยนับไม่สำเร็จ"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug]);

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const created = await api<{ id: string }>(`/api/tenant/${workspaceId}/products`, {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(), description: description.trim() || null, status,
          variant: { sku: sku.trim(), title: title.trim() || name.trim(), barcode: barcode.trim() || null, uomCode },
        }),
      });
      router.push(`/workspace/${slug}/products/${created.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : "สร้างสินค้าไม่สำเร็จ"); }
    finally { setBusy(false); }
  }

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <button className="brand brand-button" onClick={() => router.push(`/workspace/${slug}`)}><span className="brand-mark">S</span> SyncUp</button>
        <div className="user-menu"><button className="ghost" onClick={() => router.push(`/workspace/${slug}/products`)}>สินค้าทั้งหมด</button></div>
      </header>
      <section className="dashboard-content">
        <div className="dashboard-head"><div><div className="eyebrow">COMMERCE / NEW PRODUCT</div><h1>เพิ่มสินค้า</h1><p className="subtle">สร้างสินค้าและ Variant แรกในแคตตาล็อกกลาง</p></div></div>
        {error && <div className="error" role="alert">{error}</div>}
        {loading ? <p className="subtle">กำลังโหลดหน่วยนับ...</p> : (
          <form className="panel" onSubmit={createProduct}>
            <div className="form-grid">
              <div className="field"><label htmlFor="product-name">ชื่อสินค้า</label><input id="product-name" required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} /></div>
              <div className="field"><label htmlFor="product-status">สถานะ</label><select id="product-status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="DRAFT">ฉบับร่าง</option><option value="ACTIVE">พร้อมขาย</option></select></div>
              <div className="field field-wide"><label htmlFor="product-description">รายละเอียด</label><textarea id="product-description" rows={4} maxLength={10000} value={description} onChange={(event) => setDescription(event.target.value)} /></div>
              <div className="field"><label htmlFor="variant-sku">SKU</label><input id="variant-sku" required maxLength={100} value={sku} onChange={(event) => setSku(event.target.value)} /></div>
              <div className="field"><label htmlFor="variant-title">ชื่อ Variant</label><input id="variant-title" maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="ถ้าเว้นว่าง จะใช้ชื่อสินค้า" /></div>
              <div className="field"><label htmlFor="variant-barcode">บาร์โค้ด</label><input id="variant-barcode" maxLength={128} value={barcode} onChange={(event) => setBarcode(event.target.value)} /></div>
              <div className="field"><label htmlFor="variant-uom">หน่วยฐาน</label><select id="variant-uom" required value={uomCode} onChange={(event) => setUomCode(event.target.value)}>{units.map((unit) => <option key={unit.code} value={unit.code}>{unit.code} — {unit.name}</option>)}</select></div>
            </div>
            {!units.length && <p className="error">ยังไม่มีหน่วยนับที่ใช้งานได้</p>}
            <div className="modal-actions section-spaced">
              <button type="button" className="ghost" onClick={() => router.push(`/workspace/${slug}/products`)}>ยกเลิก</button>
              <button className="primary" disabled={busy || !units.length}>{busy ? "กำลังบันทึก..." : "สร้างสินค้า"}</button>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}
