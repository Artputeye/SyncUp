"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import "./inventory.css";

type Workspace = { id: string; slug: string; name: string; status: string };
type Variant = { id: string; sku: string; title: string; status: string; baseUom: { code: string; symbol?: string } };
type Product = { id: string; name: string; status: string; variants: Variant[] };
type Warehouse = { id: string; code: string; name: string; status: string; isDefault: boolean };
type Balance = { on_hand: string; reserved: string; available: string };
type Action = "receive" | "issue" | "adjust" | "transfer";

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init, credentials: "same-origin", cache: "no-store",
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(", ") : data.message || "เกิดข้อผิดพลาด");
  return data as T;
}

const actionLabels: Record<Action, string> = { receive: "รับสินค้าเข้า", issue: "จ่ายสินค้าออก", adjust: "ปรับยอดสต็อก", transfer: "โอนระหว่างคลัง" };
const formatQty = (value?: string) => Number(value ?? 0).toLocaleString("th-TH", { maximumFractionDigits: 3 });

export default function InventoryPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [variantId, setVariantId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [destinationWarehouseId, setDestinationWarehouseId] = useState("");
  const [balance, setBalance] = useState<Balance | null>(null);
  const [destinationBalance, setDestinationBalance] = useState<Balance | null>(null);
  const [action, setAction] = useState<Action>("receive");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const variants = useMemo(() => products.flatMap((product) => product.variants.filter((variant) => variant.status === "ACTIVE").map((variant) => ({ ...variant, productName: product.name }))), [products]);
  const selectedVariant = variants.find((variant) => variant.id === variantId);
  const activeWarehouses = warehouses.filter((warehouse) => warehouse.status === "ACTIVE");
  const selectedWarehouse = activeWarehouses.find((warehouse) => warehouse.id === warehouseId);
  const selectedDestination = activeWarehouses.find((warehouse) => warehouse.id === destinationWarehouseId);

  const loadBalance = useCallback(async (selectedWarehouseId: string, selectedVariantId: string): Promise<Balance | null> => {
    if (!workspace || !selectedWarehouseId || !selectedVariantId) return null;
    try {
      return await api<Balance>(`/api/tenant/${workspace.id}/inventory/warehouses/${selectedWarehouseId}/variants/${selectedVariantId}/balance`);
    } catch (cause) {
      if (cause instanceof Error && cause.message.toLowerCase().includes("not found")) return { on_hand: "0.000", reserved: "0.000", available: "0.000" };
      throw cause;
    }
  }, [workspace]);

  const load = useCallback(async () => {
    const workspaces = await api<Workspace[]>("/api/workspaces");
    const current = workspaces.find((item) => item.slug === slug);
    if (!current) { router.replace("/workspaces"); return; }
    setWorkspace(current);
    const [catalog, stores] = await Promise.all([
      api<{ items: Product[] }>(`/api/tenant/${current.id}/products?pageSize=100`),
      api<Array<{ id: string; status: string }>>(`/api/tenant/${current.id}/stores`),
    ]);
    const branchGroups = await Promise.all(stores.filter((store) => store.status === "ACTIVE").map(async (store) => {
      const branches = await api<Array<{ id: string; status: string }>>(`/api/tenant/${current.id}/stores/${store.id}/branches`);
      return Promise.all(branches.filter((branch) => branch.status === "ACTIVE").map((branch) =>
        api<Warehouse[]>(`/api/tenant/${current.id}/stores/${store.id}/branches/${branch.id}/warehouses`)));
    }));
    const allWarehouses = branchGroups.flat(2).filter((warehouse) => warehouse.status === "ACTIVE");
    const allProducts = catalog.items.filter((product) => product.status === "ACTIVE");
    setProducts(allProducts);
    setWarehouses(allWarehouses);
    setVariantId((currentId) => currentId && allProducts.some((product) => product.variants.some((variant) => variant.id === currentId)) ? currentId : allProducts.flatMap((product) => product.variants).find((variant) => variant.status === "ACTIVE")?.id ?? "");
    setWarehouseId((currentId) => currentId && allWarehouses.some((warehouse) => warehouse.id === currentId) ? currentId : allWarehouses.find((warehouse) => warehouse.isDefault)?.id ?? allWarehouses[0]?.id ?? "");
    setDestinationWarehouseId((currentId) => currentId && allWarehouses.some((warehouse) => warehouse.id === currentId) ? currentId : allWarehouses.find((warehouse) => warehouse.id !== (allWarehouses.find((item) => item.isDefault)?.id ?? allWarehouses[0]?.id))?.id ?? "");
  }, [router, slug]);

  useEffect(() => {
    let active = true;
    load().catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "โหลดข้อมูลไม่สำเร็จ"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load]);

  useEffect(() => {
    let active = true;
    loadBalance(warehouseId, variantId).then((value) => { if (active) setBalance(value); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "โหลดสต็อกไม่สำเร็จ"); });
    return () => { active = false; };
  }, [loadBalance, warehouseId, variantId]);

  useEffect(() => {
    let active = true;
    if (action !== "transfer") { setDestinationBalance(null); return () => { active = false; }; }
    loadBalance(destinationWarehouseId, variantId).then((value) => { if (active) setDestinationBalance(value); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "โหลดสต็อกปลายทางไม่สำเร็จ"); });
    return () => { active = false; };
  }, [action, destinationWarehouseId, loadBalance, variantId]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !warehouseId || !variantId) return;
    setBusy(true); setError(""); setNotice("");
    const idempotencyKey = window.crypto.randomUUID();
    const common = { idempotencyKey, reason: reason.trim() };
    let path = "";
    let body: Record<string, string>;
    if (action === "receive") {
      path = "receipts"; body = { warehouseId, variantId, quantity, unitCost, ...common };
    } else if (action === "issue") {
      path = "sales"; body = { warehouseId, variantId, quantity, ...common };
    } else if (action === "adjust") {
      path = "adjustments"; body = { warehouseId, variantId, countedQuantity: quantity, ...(unitCost.trim() ? { unitCost } : {}), ...common };
    } else {
      if (!destinationWarehouseId || destinationWarehouseId === warehouseId) { setError("กรุณาเลือกคลังปลายทางที่ต่างจากคลังต้นทาง"); setBusy(false); return; }
      path = "transfers"; body = { sourceWarehouseId: warehouseId, destinationWarehouseId, variantId, quantity, ...common };
    }
    try {
      const result = await api<{ movementType?: string; totalCost?: string; idempotentReplay?: boolean }>(`/api/tenant/${workspace.id}/inventory/${path}`, { method: "POST", body: JSON.stringify(body) });
      const detail = [result.movementType, result.totalCost ? `มูลค่า ${Number(result.totalCost).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "", result.idempotentReplay ? "รายการเดิม (ไม่บันทึกซ้ำ)" : ""].filter(Boolean).join(" · ");
      setNotice(`${actionLabels[action]}สำเร็จ${detail ? ` — ${detail}` : ""}`);
      setQuantity(""); setUnitCost(""); setReason("");
      const [nextBalance, nextDestination] = await Promise.all([
        loadBalance(warehouseId, variantId),
        action === "transfer" ? loadBalance(destinationWarehouseId, variantId) : Promise.resolve(null),
      ]);
      setBalance(nextBalance); if (action === "transfer") setDestinationBalance(nextDestination);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "บันทึกรายการไม่สำเร็จ");
    } finally { setBusy(false); }
  }

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <button className="brand brand-button" onClick={() => router.push(`/workspace/${slug}`)}><span className="brand-mark">S</span> SyncUp</button>
        <div className="user-menu"><button className="ghost" onClick={() => router.push(`/workspace/${slug}/inventory/opening-stock`)}>ยอดตั้งต้น</button><button className="ghost" onClick={() => router.push(`/workspace/${slug}/inventory/stocktakes`)}>ตรวจนับสต็อก</button><button className="ghost" onClick={() => router.push(`/workspace/${slug}/inventory/history`)}>ประวัติ Movement</button><button className="ghost" onClick={() => router.push(`/workspace/${slug}/products`)}>สินค้า</button><button className="ghost" onClick={() => router.push(`/workspace/${slug}/stores`)}>จัดการ Store</button><button className="ghost" onClick={() => router.push(`/workspace/${slug}`)}>Workspace</button></div>
      </header>
      <section className="dashboard-content inventory-page">
        <div className="dashboard-head"><div><div className="eyebrow">COMMERCE / INVENTORY</div><h1>คลังสินค้า</h1><p className="subtle">{workspace?.name ?? "กำลังโหลด Workspace..."} · รับเข้า จ่ายออก ปรับยอด และโอนระหว่างคลัง</p></div><button className="ghost" onClick={() => router.push(`/workspace/${slug}/products`)}>ดูสินค้า</button></div>
        {error && <div className="error" role="alert">{error}</div>}
        {notice && <div className="success" role="status">{notice}</div>}
        {loading ? <div className="panel">กำลังโหลดข้อมูลสินค้าและคลัง...</div> : activeWarehouses.length === 0 || variants.length === 0 ? (
          <div className="panel empty"><h2>ยังไม่พร้อมทำรายการ</h2><p>ต้องมีสินค้า Variant ที่ใช้งานได้ และคลังสินค้าที่ Active อย่างน้อยหนึ่งแห่ง</p></div>
        ) : (
          <>
            <section className="inventory-overview panel">
              <div className="inventory-selectors">
                <div className="field"><label htmlFor="inventory-variant">สินค้า / SKU</label><select id="inventory-variant" value={variantId} onChange={(event) => setVariantId(event.target.value)}>{variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.productName} · {variant.sku} · {variant.baseUom.code}</option>)}</select></div>
                <div className="field"><label htmlFor="inventory-warehouse">คลังสินค้า</label><select id="inventory-warehouse" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>{activeWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name} ({warehouse.code})</option>)}</select></div>
              </div>
              <div className="inventory-balance-grid">
                <div className="inventory-balance-card"><span>คงเหลือ</span><strong>{formatQty(balance?.on_hand)}</strong><small>{selectedVariant?.baseUom.code ?? "หน่วย"}</small></div>
                <div className="inventory-balance-card"><span>จองแล้ว</span><strong>{formatQty(balance?.reserved)}</strong><small>{selectedVariant?.baseUom.code ?? "หน่วย"}</small></div>
                <div className="inventory-balance-card"><span>พร้อมจ่าย</span><strong>{formatQty(balance?.available)}</strong><small>{selectedVariant?.baseUom.code ?? "หน่วย"}</small></div>
              </div>
              <p className="inventory-selection-note">{selectedWarehouse?.name ?? "—"} · {selectedVariant?.title ?? selectedVariant?.sku ?? "—"}</p>
            </section>
            <section className="panel inventory-transaction">
              <div className="panel-heading"><div><h2>ทำรายการสต็อก</h2><p>ทุกการบันทึกมี Idempotency Key ป้องกันการทำรายการซ้ำ</p></div></div>
              <div className="inventory-tabs" role="tablist" aria-label="ประเภทการทำรายการ">
                {(Object.keys(actionLabels) as Action[]).map((key) => <button type="button" role="tab" aria-selected={action === key} className={action === key ? "active" : ""} key={key} onClick={() => { setAction(key); setError(""); setNotice(""); }}>{actionLabels[key]}</button>)}
              </div>
              <form onSubmit={submit} className="inventory-form">
                {action === "transfer" && <div className="field"><label htmlFor="inventory-destination">คลังปลายทาง</label><select id="inventory-destination" value={destinationWarehouseId} onChange={(event) => setDestinationWarehouseId(event.target.value)}><option value="">เลือกคลังปลายทาง</option>{activeWarehouses.filter((warehouse) => warehouse.id !== warehouseId).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name} ({warehouse.code})</option>)}</select></div>}
                <div className="inventory-form-row">
                  <div className="field"><label htmlFor="inventory-quantity">{action === "adjust" ? "ยอดนับจริง" : "จำนวน"} ({selectedVariant?.baseUom.code ?? "หน่วย"})</label><input id="inventory-quantity" type="number" min="0.001" step="0.001" required value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="0.000" /></div>
                  {(action === "receive" || action === "adjust") && <div className="field"><label htmlFor="inventory-unit-cost">{action === "adjust" ? "ต้นทุนต่อหน่วย (จำเป็นเมื่อยอดเพิ่ม)" : "ต้นทุนต่อหน่วย"}</label><input id="inventory-unit-cost" type="number" min="0" step="0.000001" required={action === "receive"} value={unitCost} onChange={(event) => setUnitCost(event.target.value)} placeholder="0.00" /></div>}
                </div>
                <div className="field"><label htmlFor="inventory-reason">เหตุผล / หมายเหตุ</label><input id="inventory-reason" required minLength={1} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="ระบุเหตุผลในการทำรายการ" /></div>
                {action === "transfer" && selectedDestination && <div className="inventory-transfer-preview"><span>สต็อกปลายทางปัจจุบัน</span><strong>{formatQty(destinationBalance?.on_hand)} {selectedVariant?.baseUom.code}</strong><small>{selectedDestination.name}</small></div>}
                <div className="inventory-submit-row"><p>เมื่อยืนยัน ระบบจะบันทึก Movement และ Audit Log ตามสิทธิ์ของผู้ใช้</p><button className="primary" disabled={busy || !quantity || !reason.trim() || (action === "transfer" && (!destinationWarehouseId || destinationWarehouseId === warehouseId))}>{busy ? "กำลังบันทึก..." : `ยืนยัน${actionLabels[action]}`}</button></div>
              </form>
            </section>
          </>
        )}
        <div className="dashboard-foot">การอนุญาตทำรายการตรวจสอบที่ API ทุกครั้ง · <button className="inline-link" onClick={() => router.push(`/workspace/${slug}/inventory/stocktakes`)}>เปิดหน้าตรวจนับสต็อก →</button></div>
      </section>
    </main>
  );
}
