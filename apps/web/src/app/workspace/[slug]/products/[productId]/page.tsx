"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Workspace = { id: string; slug: string; isOwner: boolean; roles?: { key: string }[] };
type Variant = { id: string; sku: string; title: string; barcode: string | null; status: string; baseUom: { code: string; name: string } };
type Product = { id: string; name: string; description: string | null; status: string; variants: Variant[] };
const statusLabel: Record<string, string> = { DRAFT: "ฉบับร่าง", ACTIVE: "พร้อมขาย", ARCHIVED: "เก็บถาวร" };

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store", headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(", ") : data.message || "เกิดข้อผิดพลาด");
  return data as T;
}

export default function ProductDetailPage() {
  const { slug, productId } = useParams<{ slug: string; productId: string }>();
  const router = useRouter();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("DRAFT");
  const [sku, setSku] = useState("");
  const [title, setTitle] = useState("");
  const [barcode, setBarcode] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function apply(data: Product) {
    const variant = data.variants[0];
    setProduct(data);
    setName(data.name);
    setDescription(data.description ?? "");
    setStatus(data.status === "ARCHIVED" ? "ARCHIVED" : data.status);
    setSku(variant?.sku ?? "");
    setTitle(variant?.title ?? "");
    setBarcode(variant?.barcode ?? "");
  }

  async function load() {
    const workspaces = await api<Workspace[]>("/api/workspaces");
    const current = workspaces.find((item) => item.slug === slug);
    if (!current) { router.replace("/workspaces"); return; }
    setWorkspace(current);
    const data = await api<Product>("/api/tenant/" + current.id + "/products/" + productId);
    setCanManage(current.isOwner || current.roles?.some((role) => role.key === "admin" || role.key === "manager") === true);
    apply(data);
  }

  useEffect(() => {
    let active = true;
    load().catch((e) => { if (active) setError(e instanceof Error ? e.message : "โหลดสินค้าไม่สำเร็จ"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug, productId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !product?.variants[0]) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const updated = await api<Product>(`/api/tenant/${workspace.id}/products/${productId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(), description: description.trim() || null, status,
          variant: { id: product.variants[0].id, sku: sku.trim(), title: title.trim(), barcode: barcode.trim() || null },
        }),
      });
      apply(updated);
      setNotice("บันทึกสินค้าเรียบร้อยแล้ว");
    } catch (e) { setError(e instanceof Error ? e.message : "บันทึกสินค้าไม่สำเร็จ"); }
    finally { setBusy(false); }
  }

  async function archive() {
    if (!workspace || !reason.trim()) { setError("กรุณาระบุเหตุผลในการเก็บสินค้า"); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const updated = await api<Product>(`/api/tenant/${workspace.id}/products/${productId}/archive`, {
        method: "POST", body: JSON.stringify({ reason: reason.trim() }),
      });
      apply(updated);
      setReason("");
      setNotice("เก็บสินค้าเข้าคลังเรียบร้อยแล้ว");
    } catch (e) { setError(e instanceof Error ? e.message : "เก็บสินค้าไม่สำเร็จ"); }
    finally { setBusy(false); }
  }

  const archived = product?.status === "ARCHIVED";
  const editable = canManage && !archived;

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <button className="brand brand-button" onClick={() => router.push(`/workspace/${slug}`)}><span className="brand-mark">S</span> SyncUp</button>
        <div className="user-menu"><button className="ghost" onClick={() => router.push(`/workspace/${slug}/products`)}>สินค้าทั้งหมด</button></div>
      </header>
      <section className="dashboard-content">
        <div className="dashboard-head">
          <div><div className="eyebrow">COMMERCE / PRODUCT</div><h1>{product?.name ?? "รายละเอียดสินค้า"}</h1><p className="subtle">{product ? statusLabel[product.status] ?? product.status : ""}</p></div>
          <button className="ghost" onClick={() => router.push(`/workspace/${slug}/products`)}>← กลับไปสินค้า</button>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        {notice && <div className="success" role="status">{notice}</div>}
        {loading ? <p className="subtle">กำลังโหลดสินค้า...</p> : product && (
          <form className="panel" onSubmit={save}>
            <div className="form-grid">
              <div className="field"><label htmlFor="product-name">ชื่อสินค้า</label><input id="product-name" required maxLength={200} disabled={!editable} value={name} onChange={(event) => setName(event.target.value)} /></div>
              <div className="field"><label htmlFor="product-status">สถานะ</label><select id="product-status" disabled={!editable} value={status} onChange={(event) => setStatus(event.target.value)}>{archived ? <option value="ARCHIVED">เก็บถาวร</option> : <><option value="DRAFT">ฉบับร่าง</option><option value="ACTIVE">พร้อมขาย</option></>}</select></div>
              <div className="field field-wide"><label htmlFor="product-description">รายละเอียด</label><textarea id="product-description" rows={4} maxLength={10000} disabled={!editable} value={description} onChange={(event) => setDescription(event.target.value)} /></div>
              <div className="field"><label htmlFor="variant-sku">SKU</label><input id="variant-sku" required maxLength={100} disabled={!editable} value={sku} onChange={(event) => setSku(event.target.value)} /></div>
              <div className="field"><label htmlFor="variant-title">ชื่อ Variant</label><input id="variant-title" required maxLength={160} disabled={!editable} value={title} onChange={(event) => setTitle(event.target.value)} /></div>
              <div className="field"><label htmlFor="variant-barcode">บาร์โค้ด</label><input id="variant-barcode" maxLength={128} disabled={!editable} value={barcode} onChange={(event) => setBarcode(event.target.value)} /></div>
              <div className="field"><label htmlFor="variant-uom">หน่วยฐาน</label><input id="variant-uom" value={product.variants[0] ? `${product.variants[0].baseUom.code} — ${product.variants[0].baseUom.name}` : "—"} disabled /></div>
            </div>
            <div className="modal-actions section-spaced">
              <span className="subtle">{editable ? "สิทธิ์แก้ไขสินค้า" : archived ? "สินค้านี้เก็บถาวรแล้ว" : "สิทธิ์อ่านอย่างเดียว"}</span>
              {editable && <button className="primary" disabled={busy}>{busy ? "กำลังบันทึก..." : "บันทึกการเปลี่ยนแปลง"}</button>}
            </div>
            {editable && (
              <div className="form-grid section-spaced">
                <div className="field field-wide"><label htmlFor="archive-reason">เหตุผลในการเก็บถาวร</label><input id="archive-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="เช่น เลิกขาย" /></div>
                <button type="button" className="ghost" disabled={busy} onClick={archive}>เก็บสินค้าเข้าคลัง</button>
              </div>
            )}
          </form>
        )}
      </section>
    </main>
  );
}
