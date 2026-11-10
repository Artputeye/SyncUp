"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Workspace = { id: string; slug: string; name: string; isOwner: boolean; roles?: { key: string }[] };
type Product = {
  id: string; name: string; status: string; variantCount: number;
  variants: Array<{ sku: string; barcode: string | null; baseUom: { code: string } }>;
};
const statusLabel: Record<string, string> = { DRAFT: "ฉบับร่าง", ACTIVE: "พร้อมขาย", ARCHIVED: "เก็บถาวร" };

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store", headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
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
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(query = "") {
    const workspaces = await api<Workspace[]>("/api/workspaces");
    const current = workspaces.find((item) => item.slug === slug);
    if (!current) { router.replace("/workspaces"); return; }
    setWorkspace(current);
    const catalog = await api<{ items: Product[] }>("/api/tenant/" + current.id + "/products?pageSize=100" + (query ? "&search=" + encodeURIComponent(query) : ""));
    setCanManage(current.isOwner || current.roles?.some((role) => role.key === "admin" || role.key === "manager") === true);
    setProducts(catalog.items);
  }

  useEffect(() => {
    let active = true;
    load().catch((e) => { if (active) setError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug]);

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <button className="brand brand-button" onClick={() => router.push(`/workspace/${slug}`)}><span className="brand-mark">S</span> SyncUp</button>
        <div className="user-menu"><button className="ghost" onClick={() => router.push(`/workspace/${slug}/stores`)}>จัดการ Store</button><button className="ghost" onClick={() => router.push(`/workspace/${slug}`)}>Workspace</button></div>
      </header>
      <section className="dashboard-content">
        <div className="dashboard-head">
          <div><div className="eyebrow">COMMERCE / PRODUCT CATALOG</div><h1>สินค้า</h1><p className="subtle">{workspace?.name ?? "กำลังโหลด Workspace..."} · แคตตาล็อกกลางของ Workspace</p></div>
          {canManage && <button className="primary" onClick={() => router.push(`/workspace/${slug}/products/new`)}>＋ เพิ่มสินค้า</button>}
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        <form className="panel" onSubmit={(event) => { event.preventDefault(); setLoading(true); load(search.trim()).catch((e) => setError(e instanceof Error ? e.message : "ค้นหาไม่สำเร็จ")).finally(() => setLoading(false)); }}>
          <div className="field"><label htmlFor="product-search">ค้นหาชื่อ SKU หรือบาร์โค้ด</label><input id="product-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="เช่น TEST-EA-001" /></div>
        </form>
        {loading ? <p className="subtle">กำลังโหลดสินค้า...</p> : products.length === 0 ? (
          <div className="panel empty"><h2>ไม่พบสินค้า</h2><p>เพิ่มสินค้าลงแคตตาล็อกกลางก่อน แล้วค่อยเลือกเปิดขายในแต่ละ Store</p>{canManage && <button className="primary" onClick={() => router.push(`/workspace/${slug}/products/new`)}>เพิ่มสินค้าแรก</button>}</div>
        ) : (
          <div className="workspace-grid">
            {products.map((product) => {
              const variant = product.variants[0];
              return (
                <button type="button" className="workspace-card store-card-button" key={product.id} onClick={() => router.push(`/workspace/${slug}/products/${product.id}`)}>
                  <div className="workspace-icon">{product.name.slice(0, 1).toUpperCase()}</div>
                  <h3>{product.name}</h3>
                  <p>{variant?.sku ?? "ไม่มี Variant"}</p>
                  <div className="store-card-meta"><span className="status">{statusLabel[product.status] ?? product.status}</span><span className="status">{product.variantCount} Variant</span></div>
                  <div className="store-card-details"><div>หน่วย: {variant?.baseUom.code ?? "—"}</div><div>บาร์โค้ด: {variant?.barcode ?? "—"}</div></div>
                  <span className="store-card-open">ดูรายละเอียดและแก้ไข →</span>
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
