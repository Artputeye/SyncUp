"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import "./pos.css";
import PosCheckoutDialog from "./pos-checkout-dialog";
import ReceiptPrint, { type ReceiptOrder, type ReceiptPayment } from "./receipt-print";
import { WorkspaceNavigation } from "@/components/workspace-navigation";

type Workspace = { id: string; slug: string; name: string };
type Store = { id: string; name: string; status: string; currency: string; activeBranchCount: number };
type Branch = { id: string; name: string; code: string; status: string; isDefault: boolean };
type Warehouse = { id: string; name: string; code: string; status: string; isDefault: boolean };
type PosContext = {
  storeId: string; branchId: string; warehouseId: string; currency: string;
  taxMode: "VAT" | "NO_VAT"; priceTaxMode: "INCLUSIVE" | "EXCLUSIVE"; currencyMinorUnits: number;
};
type PosProduct = {
  productId: string; productName: string; variantId: string; variantTitle: string; sku: string;
  barcode: string | null; variantUomId: string; uomCode: string; uomName: string;
  conversionToBase: string; unitPrice: string; currency: string; taxRate: string; available: string;
};
type CartLine = PosProduct & { quantity: number };
type OrderResult = { id: string; order_number: string; status: string; currency: string; total_amount: string };
type PaymentResult = { payment_number: string; amount: string; currency: string; method: string };
type CheckoutFlow = { phase: "CREATE" | "POST" | "PAYMENT"; createKey: string; postKey: string; paymentKey: string; orderId?: string; orderNumber?: string; totalAmount?: string; currency?: string; method: "CASH" | "CARD" | "BANK_TRANSFER"; externalReference: string; storeId: string; branchId: string; warehouseId: string; items: Array<{variantId:string;variantUomId:string;quantity:string}> };
type CompletedSale = { orderNumber:string; paymentNumber:string; amount:string; currency:string; method:string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(", ") : data.message || "เกิดข้อผิดพลาด");
  return data as T;
}

function money(value: number, currency: string, minorUnits: number) {
  return new Intl.NumberFormat("th-TH", {
    style: "currency", currency, minimumFractionDigits: minorUnits, maximumFractionDigits: minorUnits
  }).format(value);
}

function lineAmounts(line: CartLine, context: PosContext) {
  const gross = Number(line.unitPrice) * line.quantity;
  const rate = Number(line.taxRate);
  if (context.taxMode === "NO_VAT") return { net: gross, tax: 0, total: gross };
  if (context.priceTaxMode === "INCLUSIVE") {
    const net = gross / (1 + rate);
    return { net, tax: gross - net, total: gross };
  }
  const tax = gross * rate;
  return { net: gross, tax, total: gross + tax };
}

export default function PosPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const base = "/workspace/" + params.slug;
  const searchRef = useRef<HTMLInputElement>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [storeId, setStoreId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [context, setContext] = useState<PosContext | null>(null);
  const [products, setProducts] = useState<PosProduct[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [error, setError] = useState("");
  const [catalogMessage, setCatalogMessage] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutMethod, setCheckoutMethod] = useState<"CASH" | "CARD" | "BANK_TRANSFER">("CASH");
  const [externalReference, setExternalReference] = useState("");
  const [checkoutFlow, setCheckoutFlow] = useState<CheckoutFlow | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [completedSale, setCompletedSale] = useState<CompletedSale | null>(null);
  const [receiptData, setReceiptData] = useState<{ order: ReceiptOrder; payments: ReceiptPayment[] } | null>(null);
  const [receiptError, setReceiptError] = useState("");
  const [checkoutRestored, setCheckoutRestored] = useState(false);

  useEffect(() => { try { const saved = sessionStorage.getItem("syncup-pos-checkout:" + params.slug); if (saved) { const restored = JSON.parse(saved) as CheckoutFlow; if (restored && ["CREATE","POST","PAYMENT"].includes(restored.phase) && restored.createKey && restored.postKey && restored.paymentKey) { setCheckoutFlow(restored); setCheckoutOpen(true); setCheckoutError("พบรายการ Checkout ที่ยังไม่เสร็จ กรุณาดำเนินการต่อด้วย Key เดิม"); } } } catch { setCheckoutError("ไม่สามารถกู้คืน Checkout Session ได้ กรุณาตรวจสอบคำสั่งขายก่อนเริ่มใหม่"); } finally { setCheckoutRestored(true); } }, [params.slug]);

  const loadBranches = useCallback(async (workspaceId: string, selectedStoreId: string) => {
    const rows = await api<Branch[]>(`/api/tenant/${workspaceId}/stores/${selectedStoreId}/branches`);
    const active = rows.filter((row) => row.status === "ACTIVE");
    setBranches(active);
    const selected = active.find((row) => row.isDefault) ?? active[0];
    setBranchId(selected?.id ?? "");
    setWarehouses([]);
    setWarehouseId("");
  }, []);

  const loadWarehouses = useCallback(async (workspaceId: string, selectedStoreId: string, selectedBranchId: string) => {
    const rows = await api<Warehouse[]>(`/api/tenant/${workspaceId}/stores/${selectedStoreId}/branches/${selectedBranchId}/warehouses`);
    const active = rows.filter((row) => row.status === "ACTIVE");
    setWarehouses(active);
    const selected = active.find((row) => row.isDefault) ?? active[0];
    setWarehouseId(selected?.id ?? "");
  }, []);

  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        const workspaces = await api<Workspace[]>("/api/workspaces");
        const current = workspaces.find((row) => row.slug === params.slug);
        if (!current) { router.replace("/workspaces"); return; }
        if (!active) return;
        setWorkspace(current);
        const rows = await api<Store[]>(`/api/tenant/${current.id}/stores`);
        const availableStores = rows.filter((row) => row.status === "ACTIVE");
        if (!active) return;
        setStores(availableStores);
        const selected = availableStores[0];
        if (selected) {
          setStoreId(selected.id);
          await loadBranches(current.id, selected.id);
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "โหลดข้อมูล POS ไม่สำเร็จ");
      } finally {
        if (active) setLoading(false);
      }
    }
    void initialize();
    return () => { active = false; };
  }, [params.slug, router, loadBranches]);

  useEffect(() => {
    if (!workspace || !storeId || !branchId) return;
    let active = true;
    setWarehouses([]);
    setWarehouseId("");
    loadWarehouses(workspace.id, storeId, branchId).catch((e) => {
      if (active) setError(e instanceof Error ? e.message : "โหลดคลังสินค้าไม่สำเร็จ");
    });
    return () => { active = false; };
  }, [workspace, storeId, branchId, loadWarehouses]);

  useEffect(() => {
    if (!workspace || !storeId || !branchId || !warehouseId) {
      setContext(null); setProducts([]); return;
    }
    let active = true;
    const controller = new AbortController();
    setCatalogLoading(true);
    setError("");
    const query = new URLSearchParams({ storeId, branchId, warehouseId });
    if (search.trim()) query.set("search", search.trim());
    const timer = window.setTimeout(() => {
      fetch(`/api/tenant/${workspace.id}/pos/catalog?${query.toString()}`, {
        credentials: "same-origin", cache: "no-store", signal: controller.signal
      }).then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(", ") : data.message || "โหลดสินค้าไม่สำเร็จ");
        return data as { context: PosContext; items: PosProduct[] };
      }).then((data) => {
        if (!active) return;
        setContext(data.context); setProducts(data.items);
        setCatalogMessage(data.items.length ? "" : "ไม่พบสินค้าที่พร้อมขายใน Store นี้ (ต้องเผยแพร่สินค้า กำหนดราคา ภาษี และสต็อกให้ครบ)");
      }).catch((e) => {
        if (active && e instanceof Error && e.name !== "AbortError") {
          setError(e.message); setContext(null); setProducts([]); setCatalogMessage("");
        }
      }).finally(() => { if (active) setCatalogLoading(false); });
    }, search.trim() ? 220 : 0);
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [workspace, storeId, branchId, warehouseId, search]);

  function saveCheckoutFlow(next: CheckoutFlow) {
    sessionStorage.setItem("syncup-pos-checkout:" + params.slug, JSON.stringify(next));
    setCheckoutFlow(next);
  }

  async function continueCheckout(initial: CheckoutFlow) {
    let current = initial;
    setCheckoutBusy(true);
    setCheckoutError("");
    try {
      if (current.phase === "CREATE") {
        const order = await api<OrderResult>("/api/tenant/" + workspace!.id + "/orders", {
          method: "POST",
          body: JSON.stringify({
            storeId: current.storeId, branchId: current.branchId, warehouseId: current.warehouseId,
            items: current.items, idempotencyKey: current.createKey
          })
        });
        current = { ...current, phase: "POST", orderId: order.id, orderNumber: order.order_number,
          totalAmount: order.total_amount, currency: order.currency };
        saveCheckoutFlow(current);
      }
      if (current.phase === "POST") {
        await api<OrderResult>("/api/tenant/" + workspace!.id + "/orders/" + current.orderId + "/post", {
          method: "POST", body: JSON.stringify({ idempotencyKey: current.postKey })
        });
        current = { ...current, phase: "PAYMENT" };
        saveCheckoutFlow(current);
      }
      if (current.phase === "PAYMENT") {
        const payment = await api<PaymentResult>("/api/tenant/" + workspace!.id + "/orders/" + current.orderId + "/payments", {
          method: "POST",
          body: JSON.stringify({ method: current.method, amount: current.totalAmount,
            idempotencyKey: current.paymentKey, externalReference: current.externalReference || undefined })
        });
        setCompletedSale({ orderNumber: current.orderNumber!, paymentNumber: payment.payment_number,
          amount: payment.amount, currency: payment.currency, method: payment.method });
        setReceiptData(null);
        setReceiptError("");
        try {
          const [order, paymentRows] = await Promise.all([
            api<ReceiptOrder>("/api/tenant/" + workspace!.id + "/orders/" + current.orderId),
            api<{ items: ReceiptPayment[] }>("/api/tenant/" + workspace!.id + "/orders/" + current.orderId + "/payments")
          ]);
          setReceiptData({ order, payments: paymentRows.items });
        } catch {
          setReceiptError("บันทึกการขายและรับชำระแล้ว แต่โหลดรายละเอียดใบรับเงินไม่สำเร็จ สามารถเปิดพิมพ์ซ้ำได้จากหน้าคำสั่งขาย");
        }
        try { sessionStorage.removeItem("syncup-pos-checkout:" + params.slug); } catch { /* payment idempotency still makes a later replay safe */ }
        setCheckoutFlow(null);
        setCheckoutOpen(false);
        setCart([]);
        setExternalReference("");
      }
    } catch (e) {
      setCheckoutError(e instanceof Error ? e.message : "Checkout ไม่สำเร็จ");
    } finally {
      setCheckoutBusy(false);
    }
  }

  function openCheckout() {
    if (!cart.length || !context || !workspace || checkoutFlow) return;
    setCheckoutError("");
    setCheckoutOpen(true);
  }

  function confirmCheckout() {
    if (!workspace || !context || !cart.length || checkoutFlow) return;
    const next: CheckoutFlow = {
      phase: "CREATE", createKey: crypto.randomUUID(), postKey: crypto.randomUUID(), paymentKey: crypto.randomUUID(),
      method: checkoutMethod, externalReference: externalReference.trim(),
      storeId: context.storeId, branchId: context.branchId, warehouseId: context.warehouseId,
      items: cart.map((line) => ({ variantId: line.variantId, variantUomId: line.variantUomId, quantity: String(line.quantity) }))
    };
    try {
      saveCheckoutFlow(next);
      void continueCheckout(next);
    } catch {
      setCheckoutError("ไม่สามารถบันทึกสถานะ Checkout ใน Session ได้ จึงหยุดก่อนสร้าง Order เพื่อป้องกันรายการซ้ำ");
    }
  }

  const selectedStore = stores.find((row) => row.id === storeId);
  const selectedBranch = branches.find((row) => row.id === branchId);
  const selectedWarehouse = warehouses.find((row) => row.id === warehouseId);

  function changeStore(nextStoreId: string) {
    setStoreId(nextStoreId); setBranchId(""); setWarehouses([]); setWarehouseId("");
    setCart([]); setError(""); setCatalogMessage("");
    if (workspace && nextStoreId) loadBranches(workspace.id, nextStoreId).catch((e) => setError(e instanceof Error ? e.message : "โหลดสาขาไม่สำเร็จ"));
  }

  function addProduct(product: PosProduct) {
    if (Number(product.available) <= 0) return;
    setCart((current) => {
      const index = current.findIndex((line) => line.variantId === product.variantId && line.variantUomId === product.variantUomId);
      if (index < 0) return [...current, { ...product, quantity: 1 }];
      return current.map((line, i) => i === index
        ? { ...line, quantity: Math.min(line.quantity + 1, Number(product.available)) }
        : line);
    });
  }

  function updateQuantity(identity: string, value: number) {
    setCart((current) => current.flatMap((line) => {
      const key = line.variantId + ":" + line.variantUomId;
      if (key !== identity) return [line];
      if (!Number.isFinite(value) || value <= 0) return [];
      return [{ ...line, quantity: Math.min(Math.round(value * 1000) / 1000, Number(line.available)) }];
    }));
  }

  const totals = useMemo(() => {
    if (!context) return { quantity: 0, net: 0, tax: 0, total: 0 };
    return cart.reduce((sum, line) => {
      const amount = lineAmounts(line, context);
      return { quantity: sum.quantity + line.quantity, net: sum.net + amount.net, tax: sum.tax + amount.tax, total: sum.total + amount.total };
    }, { quantity: 0, net: 0, tax: 0, total: 0 });
  }, [cart, context]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    router.replace("/");
    router.refresh();
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    searchRef.current?.blur();
  }

  return (
    <main className="pos-shell">
      <header className="pos-topbar">
        <div className="pos-brand-group">
          <button className="pos-brand" onClick={() => router.push("/workspaces")} aria-label="เปลี่ยน Workspace"><span className="pos-brand-mark">S</span> SyncUp</button>
          <span className="pos-divider" />
          <div className="pos-context"><small>POINT OF SALE</small><strong>หน้าขายหน้าร้าน</strong></div>
        </div>
        <div className="pos-top-actions">
          <span className="pos-live"><i /> เชื่อมต่อ Catalog</span>
          {workspace && <WorkspaceNavigation workspaceId={workspace.id} className="pos-nav-items" linkClassName="pos-backoffice" />}
          <button className="pos-avatar" onClick={() => router.push("/workspaces")} aria-label="เปลี่ยน Workspace">W</button>
          <button className="pos-backoffice" onClick={logout}>ออกจากระบบ</button>
        </div>
      </header>

      <div className="pos-layout">
        <section className="pos-catalog">
          <div className="pos-heading">
            <div><div className="pos-eyebrow">SALES COUNTER · {params.slug}</div><h1>เริ่มขายสินค้า</h1><p>ค้นหาสินค้าที่เผยแพร่และพร้อมขายใน Store พร้อมราคา ภาษี และสต็อกล่าสุด</p></div>
            <div className="pos-location">
              <span>⌖</span>
              <div><small>Store / Branch / Warehouse</small>
                <strong>{selectedStore?.name ?? "ยังไม่มี Store"}{selectedBranch ? " · " + selectedBranch.code : ""}</strong>
                <small>{selectedWarehouse?.name ?? "ยังไม่ได้เลือกคลังสินค้า"}</small>
              </div>
              <b>⌄</b>
            </div>
          </div>

          <div className="pos-context-selectors">
            <label>Store<select value={storeId} onChange={(event) => changeStore(event.target.value)} disabled={loading || stores.length === 0}>
              {stores.length === 0 && <option value="">ไม่มี Store ที่ใช้งาน</option>}
              {stores.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select></label>
            <label>Branch<select value={branchId} onChange={(event) => { setBranchId(event.target.value); setCart([]); }} disabled={!branches.length}>
              {branches.length === 0 && <option value="">ไม่มีสาขาที่ใช้งาน</option>}
              {branches.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}
            </select></label>
            <label>Warehouse<select value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); setCart([]); }} disabled={!warehouses.length}>
              {warehouses.length === 0 && <option value="">ไม่มีคลังที่ใช้งาน</option>}
              {warehouses.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}
            </select></label>
          </div>

          <div className="pos-toolbar">
            <form className="pos-search" onSubmit={submitSearch}>
              <span>⌕</span><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาชื่อสินค้า, SKU หรือ Barcode" aria-label="ค้นหาสินค้า" />
              {search && <button type="button" className="pos-clear-search" onClick={() => setSearch("")} aria-label="ล้างคำค้น">×</button>}
              <kbd>Enter</kbd>
            </form>
            <button className="pos-scan" onClick={() => searchRef.current?.focus()} type="button"><span>▦</span> สแกน / Barcode</button>
          </div>

          <div className="pos-section-heading"><div><h2>สินค้าพร้อมขาย</h2><span>{catalogLoading ? "กำลังค้นหา..." : products.length + " รายการ"}</span></div><small>{context?.currency ?? selectedStore?.currency ?? "—"}</small></div>
          {error && <div className="pos-alert" role="alert">{error}</div>}
          {loading ? <div className="pos-state">กำลังโหลด Workspace และจุดขาย...</div> :
            stores.length === 0 ? <div className="pos-state"><strong>ยังไม่มี Store ที่พร้อมใช้งาน</strong><p>ตั้งค่า Store และสาขาก่อนเริ่มขายสินค้า</p></div> :
            !branchId ? <div className="pos-state"><strong>ไม่พบ Branch ที่ใช้งานได้</strong><p>เพิ่มหรือเปิดใช้งานสาขาใน Store ที่เลือก</p></div> :
            !warehouseId ? <div className="pos-state"><strong>ไม่พบ Warehouse ที่ใช้งานได้</strong><p>เพิ่มหรือเปิดใช้งานคลังสินค้าใน Branch ที่เลือก</p></div> :
            catalogLoading ? <div className="pos-state">กำลังโหลดสินค้าและราคา...</div> :
            products.length === 0 ? <div className="pos-state"><strong>{catalogMessage || "ไม่พบสินค้าที่ตรงกับคำค้น"}</strong><p>แสดงเฉพาะสินค้าที่ Active, Published, มีราคาปัจจุบัน และผ่านเงื่อนไขภาษี</p></div> : (
              <div className="pos-products">
                {products.map((product) => {
                  const available = Number(product.available);
                  const lineKey = product.variantId + ":" + product.variantUomId;
                  const inCart = cart.find((line) => line.variantId === product.variantId && line.variantUomId === product.variantUomId)?.quantity ?? 0;
                  return (
                    <article className={"pos-product" + (available <= 0 ? " unavailable" : "")} key={lineKey}>
                      <div className="pos-product-visual"><span>PRODUCT</span><div className="pos-product-symbol">{product.productName.slice(0, 1).toUpperCase()}</div></div>
                      <div className="pos-product-copy">
                        <small>{product.sku}</small><strong>{product.productName}</strong><span className="pos-variant-title">{product.variantTitle} · {product.uomCode}</span>
                        <div className="pos-product-price"><b>{money(Number(product.unitPrice), product.currency, context?.currencyMinorUnits ?? 2)}</b><span className={available > 0 ? "in-stock" : "out-stock"}>{available > 0 ? "คงเหลือ " + available : "สินค้าหมด"}</span></div>
                        <button type="button" disabled={available <= inCart || catalogLoading} onClick={() => addProduct(product)}>{available <= inCart ? "เพิ่มครบแล้ว" : "＋ เพิ่มลงตะกร้า"}{inCart > 0 && <span> · {inCart}</span>}</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          {completedSale && <div className="pos-sale-success" role="status"><strong>ขายสำเร็จ · {completedSale.orderNumber}</strong><span>รับชำระ {money(Number(completedSale.amount), completedSale.currency, context?.currencyMinorUnits ?? 2)} · {completedSale.paymentNumber}</span>{receiptError && <small>{receiptError}</small>}<button type="button" onClick={() => { setCompletedSale(null); setReceiptData(null); setReceiptError(""); }}>เริ่มรายการใหม่</button></div>}
          <div className="pos-fixture"><b>i</b> ราคา ภาษี และจำนวนคงเหลือดึงจาก API ตาม Store / Warehouse ที่เลือก ยอดขายจริงจะตรวจสอบซ้ำจากฝั่งเซิร์ฟเวอร์ในขั้น Checkout</div>
        </section>

        <aside className="pos-cart">
          <div className="pos-cart-heading"><div><small>CURRENT SALE</small><h2>ตะกร้าสินค้า</h2></div><span>{cart.length} รายการ</span></div>
          {cart.length === 0 ? <div className="pos-empty-cart"><div className="pos-cart-icon">＋<i /><i /></div><strong>ยังไม่มีสินค้าในตะกร้า</strong><p>เลือกสินค้าจากรายการทางซ้าย<br />เพื่อเริ่มทำรายการขาย</p></div> : (
            <div className="pos-cart-lines">
              {cart.map((line) => {
                const identity = line.variantId + ":" + line.variantUomId;
                return <div className="pos-cart-line" key={identity}>
                  <div className="pos-cart-line-head"><div><strong>{line.productName}</strong><small>{line.sku} · {line.uomCode}</small></div>
                    <button type="button" onClick={() => updateQuantity(identity, 0)} aria-label={"นำ " + line.productName + " ออกจากตะกร้า"}>×</button></div>
                  <div className="pos-cart-line-foot"><div className="pos-qty">
                    <button type="button" onClick={() => updateQuantity(identity, line.quantity - 1)} aria-label="ลดจำนวน">−</button>
                    <input aria-label={"จำนวน " + line.productName} type="number" min="0.001" max={line.available} step="0.001" value={line.quantity} onChange={(event) => updateQuantity(identity, Number(event.target.value))} />
                    <button type="button" disabled={line.quantity >= Number(line.available)} onClick={() => updateQuantity(identity, line.quantity + 1)} aria-label="เพิ่มจำนวน">＋</button>
                  </div><b>{money(context ? lineAmounts(line, context).total : 0, line.currency, context?.currencyMinorUnits ?? 2)}</b></div>
                  <small className="pos-line-unit">{money(Number(line.unitPrice), line.currency, context?.currencyMinorUnits ?? 2)} / {line.uomCode} · พร้อมขาย {line.available}</small>
                </div>;
              })}
            </div>
          )}
          <div className="pos-summary">
            <div><span>จำนวนสินค้า</span><b>{totals.quantity.toLocaleString("th-TH")} ชิ้น</b></div>
            <div><span>ยอดก่อนภาษี</span><b>{money(totals.net, context?.currency ?? "THB", context?.currencyMinorUnits ?? 2)}</b></div>
            <div><span>ภาษี</span><b>{money(totals.tax, context?.currency ?? "THB", context?.currencyMinorUnits ?? 2)}</b></div>
            <div className="pos-total"><span>ยอดรวมโดยประมาณ</span><strong>{money(totals.total, context?.currency ?? "THB", context?.currencyMinorUnits ?? 2)}</strong></div>
            <button disabled={!cart.length || !context || checkoutBusy || !!checkoutFlow || !checkoutRestored} onClick={openCheckout}>ดำเนินการชำระเงิน <span>→</span></button>
            <p>สร้าง Order → จองสต็อก → ตัดสต็อก → บันทึกรับชำระ</p>
          </div>
        </aside>
      </div>
    {receiptData && <ReceiptPrint order={receiptData.order} payments={receiptData.payments} onClose={() => setReceiptData(null)} />}
    {checkoutOpen && <PosCheckoutDialog flow={checkoutFlow} cart={cart} total={totals.total} context={context} method={checkoutMethod} onMethod={setCheckoutMethod} reference={externalReference} onReference={setExternalReference} busy={checkoutBusy} error={checkoutError} ready={!!workspace} onClose={() => setCheckoutOpen(false)} onConfirm={confirmCheckout} onRetry={() => checkoutFlow && void continueCheckout(checkoutFlow)} />}
    </main>
  );
}
