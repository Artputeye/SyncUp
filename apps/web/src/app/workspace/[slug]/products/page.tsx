"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Workspace = { id: string; slug: string; name: string; isOwner: boolean; roles?: { key: string }[] };
type ProductImage = { productId: string; mediaAssetId: string; thumbnailUrl: string; url: string };
type Product = {
  id: string; name: string; status: string; variantCount: number;
  variants: Array<{ sku: string; barcode: string | null; baseUom: { code: string } }>;
  image?: ProductImage;
};
type ImportPreview = {
  batchId: string; status: string; totalFiles: number; validFiles: number; invalidFiles: number;
  items: Array<{ id: string; filename: string; targetType: string | null; targetId: string | null; sku: string | null; role: string; status: string; error: string | null }>;
};
const statusLabel: Record<string, string> = { DRAFT: "ฉบับร่าง", ACTIVE: "พร้อมขาย", ARCHIVED: "เก็บถาวร" };

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  const response = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store", headers: { ...(init.body && !isFormData ? { "Content-Type": "application/json" } : {}), ...init.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(", ") : data.message || "เกิดข้อผิดพลาด");
  return data as T;
}

export default function ProductsPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [canImport, setCanImport] = useState(false);
  const [search, setSearch] = useState("");
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [manifestFile, setManifestFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load(query = "") {
    const workspaces = await api<Workspace[]>("/api/workspaces");
    const current = workspaces.find((item) => item.slug === slug);
    if (!current) { router.replace("/workspaces"); return; }
    setWorkspace(current);
    const [catalog, imageRows] = await Promise.all([
      api<{ items: Product[] }>("/api/tenant/" + current.id + "/products?pageSize=100" + (query ? "&search=" + encodeURIComponent(query) : "")),
      api<ProductImage[]>(`/api/tenant/${current.id}/product-images/catalog`).catch(() => []),
    ]);
    const images = new Map(imageRows.map((image) => [image.productId, image]));
    setCanManage(current.isOwner || current.roles?.some((role) => role.key === "admin" || role.key === "manager") === true);
    setCanImport(current.isOwner || current.roles?.some((role) => role.key === "admin") === true);
    setProducts(catalog.items.map((product) => ({ ...product, image: images.get(product.id) })));
  }

  useEffect(() => {
    let active = true;
    load().catch((e) => { if (active) setError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug]);

  async function previewImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !zipFile) return;
    setImportBusy(true); setError(""); setNotice(""); setPreview(null);
    try {
      const form = new FormData();
      form.append("archive", zipFile);
      if (manifestFile) form.append("manifest", manifestFile);
      const result = await api<ImportPreview>(`/api/tenant/${workspace.id}/image-imports/preview`, { method: "POST", body: form });
      setPreview(result);
    } catch (e) { setError(e instanceof Error ? e.message : "ตรวจสอบ ZIP ไม่สำเร็จ"); }
    finally { setImportBusy(false); }
  }

  async function commitImport() {
    if (!workspace || !preview || preview.validFiles === 0) return;
    setImportBusy(true); setError(""); setNotice("");
    try {
      const result = await api<{ status: string; applied: number; failed: number }>(`/api/tenant/${workspace.id}/image-imports/${preview.batchId}/commit`, { method: "POST" });
      setNotice(`นำเข้ารูปภาพแล้ว ${result.applied} ไฟล์ · ล้มเหลว ${result.failed} ไฟล์ · สถานะ ${result.status}`);
      setPreview(null); setZipFile(null); setManifestFile(null);
      await load(search.trim());
    } catch (e) { setError(e instanceof Error ? e.message : "นำเข้ารูปภาพไม่สำเร็จ"); }
    finally { setImportBusy(false); }
  }

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <button className="brand brand-button" onClick={() => router.push(`/workspace/${slug}`)}><span className="brand-mark">S</span> SyncUp</button>
        <div className="user-menu"><button className="ghost" onClick={() => router.push(`/workspace/${slug}/orders`)}>คำสั่งขาย</button><button className="ghost" onClick={() => router.push(`/workspace/${slug}/stores`)}>จัดการ Store</button><button className="ghost" onClick={() => router.push(`/workspace/${slug}`)}>Workspace</button></div>
      </header>
      <section className="dashboard-content">
        <div className="dashboard-head">
          <div><div className="eyebrow">COMMERCE / PRODUCT CATALOG</div><h1>สินค้า</h1><p className="subtle">{workspace?.name ?? "กำลังโหลด Workspace..."} · แคตตาล็อกกลางของ Workspace</p></div>
          {canManage && <button className="primary" onClick={() => router.push(`/workspace/${slug}/products/new`)}>＋ เพิ่มสินค้า</button>}
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        {notice && <div className="success" role="status">{notice}</div>}
        <form className="panel" onSubmit={(event) => { event.preventDefault(); setLoading(true); load(search.trim()).catch((e) => setError(e instanceof Error ? e.message : "ค้นหาไม่สำเร็จ")).finally(() => setLoading(false)); }}>
          <div className="field"><label htmlFor="product-search">ค้นหาชื่อ SKU หรือบาร์โค้ด</label><input id="product-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="เช่น TEST-EA-001" /></div>
        </form>

        {canImport && <section className="panel image-import-panel">
          <div><h2>นำเข้ารูปภาพจำนวนมาก</h2><p className="subtle">เฉพาะ OWNER / ADMIN · ZIP ไม่เกิน 25 MB · ภาพไม่เกิน 5 MB ต่อไฟล์ · สูงสุด 500 ภาพ</p></div>
          <form className="image-import-form" onSubmit={previewImport}>
            <div className="field"><label htmlFor="image-zip">ไฟล์ ZIP</label><input id="image-zip" type="file" accept=".zip,application/zip" onChange={(event) => { setZipFile(event.target.files?.[0] ?? null); setPreview(null); }} /></div>
            <div className="field"><label htmlFor="image-manifest">Manifest CSV (ไม่บังคับ)</label><input id="image-manifest" type="file" accept=".csv,text/csv" onChange={(event) => { setManifestFile(event.target.files?.[0] ?? null); setPreview(null); }} /></div>
            <button className="ghost" disabled={importBusy || !zipFile}>{importBusy ? "กำลังตรวจสอบ..." : "ตรวจสอบและ Preview"}</button>
          </form>
          <p className="caption">หากไม่ใช้ Manifest ให้ตั้งชื่อไฟล์เป็น SKU.jpg, SKU__main.jpg หรือ SKU__2.jpg เพื่อจับคู่กับ Variant</p>
          {preview && <div className="import-preview">
            <div className="store-card-meta"><strong>Preview Batch {preview.batchId.slice(0, 8)}</strong><span className="status">{preview.validFiles} ผ่าน</span><span className="status">{preview.invalidFiles} ไม่ผ่าน</span></div>
            <div className="import-preview-list">{preview.items.map((item) => <div className="import-preview-row" key={item.id}><span>{item.filename}</span><span>{item.sku || item.targetId || "—"}</span><span className={item.status === "VALID" ? "import-valid" : "import-invalid"}>{item.status}{item.error ? ` · ${item.error}` : ""}</span></div>)}</div>
            <button className="primary" disabled={importBusy || preview.validFiles === 0} onClick={commitImport}>{importBusy ? "กำลังนำเข้า..." : `ยืนยันนำเข้า ${preview.validFiles} รูป`}</button>
          </div>}
        </section>}

        {loading ? <p className="subtle">กำลังโหลดสินค้า...</p> : products.length === 0 ? (
          <div className="panel empty"><h2>ไม่พบสินค้า</h2><p>เพิ่มสินค้าลงแคตตาล็อกกลางก่อน แล้วค่อยเลือกเปิดขายในแต่ละ Store</p>{canManage && <button className="primary" onClick={() => router.push(`/workspace/${slug}/products/new`)}>เพิ่มสินค้าแรก</button>}</div>
        ) : (
          <div className="workspace-grid product-card-grid">
            {products.map((product) => {
              const variant = product.variants[0];
              return (
                <button type="button" className="workspace-card store-card-button product-card" key={product.id} onClick={() => router.push(`/workspace/${slug}/products/${product.id}`)}>
                  <div className="product-card-image">
                    {product.image ? <img src={product.image.thumbnailUrl} alt={product.name} loading="lazy" /> : <span>{product.name.slice(0, 1).toUpperCase()}</span>}
                  </div>
                  <div className="product-card-content">
                    <h3>{product.name}</h3>
                    <p>{variant?.sku ?? "ไม่มี Variant"}</p>
                    <div className="store-card-meta"><span className="status">{statusLabel[product.status] ?? product.status}</span><span className="status">{product.variantCount} Variant</span></div>
                    <div className="store-card-details"><div>หน่วย: {variant?.baseUom.code ?? "—"}</div><div>บาร์โค้ด: {variant?.barcode ?? "—"}</div></div>
                    <span className="store-card-open">ดูรายละเอียด →</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
        <div className="dashboard-foot">การอ่านสินค้าใช้สิทธิ์ commerce.product.view และตรวจ Workspace จากฝั่ง API</div>
      </section>
    </main>
  );
}
