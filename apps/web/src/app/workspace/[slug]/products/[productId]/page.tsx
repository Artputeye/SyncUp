"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Workspace = { id: string; slug: string; isOwner: boolean; roles?: { key: string }[] };
type Variant = { id: string; sku: string; title: string; barcode: string | null; status: string; baseUom: { code: string; name: string } };
type Product = { id: string; name: string; description: string | null; status: string; variants: Variant[] };
type ProductImage = { id: string; mediaAssetId: string; isPrimary: boolean; sortOrder: number; altText: string | null; url: string; thumbnailUrl: string };
const statusLabel: Record<string, string> = { DRAFT: "ฉบับร่าง", ACTIVE: "พร้อมขาย", ARCHIVED: "เก็บถาวร" };

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  const response = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store", headers: { ...(init.body && !isFormData ? { "Content-Type": "application/json" } : {}), ...init.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(", ") : data.message || "เกิดข้อผิดพลาด");
  return data as T;
}

export default function ProductDetailPage() {
  const { slug, productId } = useParams<{ slug: string; productId: string }>();
  const router = useRouter();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [images, setImages] = useState<ProductImage[]>([]);
  const [variantImages, setVariantImages] = useState<ProductImage[]>([]);
  const [variantFiles, setVariantFiles] = useState<File[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("DRAFT");
  const [sku, setSku] = useState("");
  const [title, setTitle] = useState("");
  const [barcode, setBarcode] = useState("");
  const [reason, setReason] = useState("");
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
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
    const [imageRows] = await Promise.all([
      api<ProductImage[]>(`/api/tenant/${current.id}/products/${productId}/images`).catch(() => []),
    ]);
    setCanManage(current.isOwner || current.roles?.some((role) => role.key === "admin" || role.key === "manager") === true);
    apply(data);
    setImages(imageRows);
    const variantRows = data.variants[0] ? await api<ProductImage[]>("/api/tenant/" + current.id + "/variants/" + data.variants[0].id + "/images").catch(() => []) : [];
    setVariantImages(variantRows);
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

  async function uploadImages(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !selectedImages.length) return;
    setBusy(true); setError(""); setNotice("");
    try {
      for (let index = 0; index < selectedImages.length; index++) {
        const file = selectedImages[index];
        const form = new FormData();
        form.append("file", file);
        form.append("isPrimary", images.length === 0 && index === 0 ? "true" : "false");
        form.append("sortOrder", String(images.length + index));
        form.append("altText", name.trim());
        await api(`/api/tenant/${workspace.id}/products/${productId}/images`, { method: "POST", body: form });
      }
      setSelectedImages([]);
      await load();
      setNotice("อัปโหลดรูปภาพสินค้าเรียบร้อยแล้ว");
    } catch (e) {
      setError(e instanceof Error ? e.message : "อัปโหลดรูปภาพไม่สำเร็จ");
      await load().catch(() => undefined);
    } finally { setBusy(false); }
  }

  async function uploadVariantImages(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !product?.variants[0] || !variantFiles.length) return;
    setBusy(true); setError(""); setNotice("");
    try {
      for (let index = 0; index < variantFiles.length; index++) {
        const form = new FormData(); form.append("file", variantFiles[index]);
        form.append("isPrimary", variantImages.length === 0 && index === 0 ? "true" : "false");
        form.append("sortOrder", String(variantImages.length + index)); form.append("altText", title.trim() || name.trim());
        await api("/api/tenant/" + workspace.id + "/variants/" + product.variants[0].id + "/images", { method: "POST", body: form });
      }
      setVariantFiles([]); await load(); setNotice("อัปโหลดรูปภาพ Variant เรียบร้อยแล้ว");
    } catch (e) { setError(e instanceof Error ? e.message : "อัปโหลดรูป Variant ไม่สำเร็จ"); await load().catch(() => undefined); }
    finally { setBusy(false); }
  }

  async function deleteVariantImage(imageId: string) {
    if (!workspace || !product?.variants[0] || !window.confirm("ต้องการลบรูปภาพ Variant นี้ใช่หรือไม่?")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api("/api/tenant/" + workspace.id + "/variants/" + product.variants[0].id + "/images/" + imageId, { method: "DELETE" });
      setVariantImages((rows) => rows.filter((row) => row.id !== imageId)); setNotice("ลบรูปภาพ Variant แล้ว");
    } catch (e) { setError(e instanceof Error ? e.message : "ลบรูป Variant ไม่สำเร็จ"); }
    finally { setBusy(false); }
  }
  async function setPrimary(imageId: string) {
    if (!workspace) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const updated = await api<ProductImage[]>(`/api/tenant/${workspace.id}/products/${productId}/images/${imageId}`, {
        method: "PATCH", body: JSON.stringify({ isPrimary: true }),
      });
      setImages(updated);
      setNotice("เปลี่ยนรูปหลักเรียบร้อยแล้ว");
    } catch (e) { setError(e instanceof Error ? e.message : "เปลี่ยนรูปหลักไม่สำเร็จ"); }
    finally { setBusy(false); }
  }

  async function deleteImage(imageId: string) {
    if (!workspace || !window.confirm("ต้องการลบรูปภาพนี้ใช่หรือไม่?")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/tenant/${workspace.id}/products/${productId}/images/${imageId}`, { method: "DELETE" });
      setImages((rows) => rows.filter((row) => row.id !== imageId));
      setNotice("ลบรูปภาพเรียบร้อยแล้ว");
    } catch (e) { setError(e instanceof Error ? e.message : "ลบรูปภาพไม่สำเร็จ"); }
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

  function chooseImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const invalid = files.find((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024);
    if (invalid) {
      setError("รองรับ JPG, PNG, WebP และไฟล์ละไม่เกิน 5 MB");
      setSelectedImages([]);
      event.target.value = "";
      return;
    }
    setError("");
    setSelectedImages(files);
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
          <>
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

            <section className="panel product-media-panel">
              <div className="section-heading"><div><h2>รูปภาพสินค้า</h2><p className="subtle">รูปหลักและรูปแกลเลอรี · JPG, PNG, WebP · ไม่เกิน 5 MB ต่อรูป</p></div><span className="status">{images.length} รูป</span></div>
              {images.length ? (
                <div className="product-image-gallery">
                  {images.map((image) => (
                    <article className="product-image-tile" key={image.id}>
                      <img src={image.thumbnailUrl} alt={image.altText || name} />
                      {image.isPrimary && <span className="product-image-primary">รูปหลัก</span>}
                      {editable && <div className="product-image-actions">
                        {!image.isPrimary && <button type="button" className="ghost" disabled={busy} onClick={() => setPrimary(image.id)}>ตั้งเป็นรูปหลัก</button>}
                        <button type="button" className="ghost danger-text" disabled={busy} onClick={() => deleteImage(image.id)}>ลบ</button>
                      </div>}
                    </article>
                  ))}
                </div>
              ) : <p className="subtle">ยังไม่มีรูปภาพสินค้า</p>}
              {editable && <form className="product-image-upload" onSubmit={uploadImages}>
                <div className="field"><label htmlFor="product-images">เพิ่มรูปภาพ (เลือกได้หลายไฟล์)</label><input id="product-images" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={chooseImages} /></div>
                {selectedImages.length > 0 && <p className="subtle">เลือกแล้ว {selectedImages.length} ไฟล์ · {(selectedImages.reduce((sum, file) => sum + file.size, 0) / 1024 / 1024).toFixed(2)} MB</p>}
                <button className="primary" disabled={busy || !selectedImages.length}>{busy ? "กำลังอัปโหลด..." : "อัปโหลดรูปภาพ"}</button>
              </form>}
            </section>
            {product.variants[0] && <section className="panel product-media-panel">
              <div className="section-heading"><div><h2>รูปภาพ Variant: {product.variants[0].title}</h2><p className="subtle">รูปภาพเฉพาะ SKU {product.variants[0].sku}</p></div><span className="status">{variantImages.length} รูป</span></div>
              {variantImages.length ? <div className="product-image-gallery">{variantImages.map((image) => <article className="product-image-tile" key={image.id}><img src={image.thumbnailUrl} alt={image.altText || title || name} />{image.isPrimary && <span className="product-image-primary">รูปหลัก Variant</span>}{editable && <div className="product-image-actions"><button type="button" className="ghost danger-text" disabled={busy} onClick={() => deleteVariantImage(image.id)}>ลบ</button></div>}</article>)}</div> : <p className="subtle">ยังไม่มีรูปภาพเฉพาะ Variant</p>}
              {editable && <form className="product-image-upload" onSubmit={uploadVariantImages}><div className="field"><label htmlFor="variant-images">เพิ่มรูปภาพ Variant</label><input id="variant-images" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setVariantFiles(Array.from(event.target.files ?? []).filter((file) => file.size <= 5 * 1024 * 1024 && ["image/jpeg", "image/png", "image/webp"].includes(file.type)))} /></div><button className="primary" disabled={busy || !variantFiles.length}>{busy ? "กำลังอัปโหลด..." : "อัปโหลดรูป Variant"}</button></form>}
            </section>}
          </>
        )}
      </section>
    </main>
  );
}
