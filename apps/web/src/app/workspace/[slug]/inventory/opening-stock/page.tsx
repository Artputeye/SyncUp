"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import "./opening-stock.css";

type Workspace = { id: string; slug: string; name: string };
type Warehouse = { id: string; code: string; name: string; status: string; isDefault: boolean };
type Product = { id: string; name: string; status: string; variants: Array<{ id: string; sku: string; title: string; status: string; baseUom: { code: string; symbol?: string } }> };
type CatalogVariant = { id: string; sku: string; title: string; productName: string; uom: string };
type DraftLine = { variantId: string; quantity: string; unitCost: string };
type CsvPreviewRow = { rowNumber: number; sku: string; quantity: string; unitCost: string; variantId?: string; error?: string };
type OpeningListItem = { id: string; status: "DRAFT" | "POSTED" | "CANCELLED"; reference: string | null; createdAt: string; postedAt: string | null; warehouse: { id: string; name: string; code: string }; itemCount: number; totalQuantity: string; totalCost: string };
type OpeningDetail = { id: string; status: OpeningListItem["status"]; reference: string | null; notes: string | null; createdAt: string; postedAt: string | null; warehouse: OpeningListItem["warehouse"]; items: Array<{ id: string; variantId: string; sku: string; variantTitle: string; productName: string; uomCode: string | null; quantity: string; unitCost: string; totalCost: string }> };

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store", headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(", ") : data.message || "เกิดข้อผิดพลาด");
  return data as T;
}
const money = (value: string) => Number(value).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (value: string) => Number(value).toLocaleString("th-TH", { maximumFractionDigits: 3 });
const statusText = { DRAFT: "ฉบับร่าง", POSTED: "บันทึกแล้ว", CANCELLED: "ยกเลิก" };

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"' ) { cell += '"'; i++; }
    else if (char === '"' ) quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim()); cell = "";
      if (row.some(value => value !== "")) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(value => value !== "")) rows.push(row);
  if (quoted) throw new Error("ไฟล์ CSV มีเครื่องหมายอัญประกาศไม่ครบ");
  return rows;
}

export default function OpeningStockPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [variants, setVariants] = useState<CatalogVariant[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ variantId: "", quantity: "", unitCost: "" }]);
  const [items, setItems] = useState<OpeningListItem[]>([]);
  const [selected, setSelected] = useState<OpeningDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState("");
  const [importPreview, setImportPreview] = useState<CsvPreviewRow[]>([]);

  const activeWarehouses = useMemo(() => warehouses.filter(item => item.status === "ACTIVE"), [warehouses]);
  const totalValue = useMemo(() => lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitCost) || 0), 0), [lines]);

  const loadList = useCallback(async (workspaceId: string) => {
    const result = await api<{ items: OpeningListItem[] }>(`/api/tenant/${workspaceId}/inventory/opening-stocks?page=1&pageSize=50`);
    setItems(result.items);
  }, []);

  const openDetail = useCallback(async (workspaceId: string, id: string) => {
    const result = await api<OpeningDetail>(`/api/tenant/${workspaceId}/inventory/opening-stocks/${id}`);
    setSelected(result);
  }, []);

  const load = useCallback(async () => {
    const workspaces = await api<Workspace[]>("/api/workspaces");
    const current = workspaces.find(item => item.slug === slug);
    if (!current) { router.replace("/workspaces"); return; }
    setWorkspace(current);
    const [catalog, stores] = await Promise.all([
      api<{ items: Product[] }>(`/api/tenant/${current.id}/products?pageSize=100`),
      api<Array<{ id: string; status: string }>>(`/api/tenant/${current.id}/stores`),
    ]);
    const groups = await Promise.all(stores.filter(store => store.status === "ACTIVE").map(async store => {
      const branches = await api<Array<{ id: string; status: string }>>(`/api/tenant/${current.id}/stores/${store.id}/branches`);
      return Promise.all(branches.filter(branch => branch.status === "ACTIVE").map(branch =>
        api<Warehouse[]>(`/api/tenant/${current.id}/stores/${store.id}/branches/${branch.id}/warehouses`)));
    }));
    const activeProducts = catalog.items.filter(product => product.status === "ACTIVE");
    const activeVariants = activeProducts.flatMap(product => product.variants.filter(variant => variant.status === "ACTIVE").map(variant => ({
      id: variant.id, sku: variant.sku, title: variant.title, productName: product.name, uom: variant.baseUom?.code ?? "",
    })));
    const allWarehouses = groups.flat(2).filter(warehouse => warehouse.status === "ACTIVE");
    setVariants(activeVariants);
    setWarehouses(allWarehouses);
    setWarehouseId(currentId => currentId && allWarehouses.some(item => item.id === currentId) ? currentId : allWarehouses.find(item => item.isDefault)?.id ?? allWarehouses[0]?.id ?? "");
    await loadList(current.id);
  }, [loadList, router, slug]);

  useEffect(() => {
    let active = true;
    load().catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "โหลดข้อมูลไม่สำเร็จ"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load]);

  function updateLine(index: number, field: keyof DraftLine, value: string) {
    setLines(current => current.map((line, i) => i === index ? { ...line, [field]: value } : line));
  }
  function addLine() { setLines(current => [...current, { variantId: "", quantity: "", unitCost: "" }]); }
  function removeLine(index: number) { setLines(current => current.length === 1 ? [{ variantId: "", quantity: "", unitCost: "" }] : current.filter((_, i) => i !== index)); }

  function beginEdit(detail: OpeningDetail) {
    if (detail.status !== "DRAFT") return;
    setEditingId(detail.id); setWarehouseId(detail.warehouse.id);
    setReference(detail.reference ?? ""); setNotes(detail.notes ?? "");
    setLines(detail.items.map(item => ({ variantId: item.variantId, quantity: item.quantity, unitCost: item.unitCost })));
    setError(""); setImportMessage("");
    setNotice("กำลังแก้ไขฉบับร่าง " + (detail.reference || detail.id.slice(0, 8)));
  }

  function stopEditing() {
    setEditingId(null); setReference(""); setNotes("");
    setLines([{ variantId: "", quantity: "", unitCost: "" }]);
    setImportMessage(""); setError(""); setNotice("ยกเลิกการแก้ไขฉบับร่างแล้ว");
  }

  async function importCsvFile(file?: File) {
    if (!file) return;
    setError("");
    setImportMessage("");
    setImportPreview([]);
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("ไฟล์ CSV ต้องมีขนาดไม่เกิน 2 MB");
      const rows = parseCsv((await file.text()).replace(/^\uFEFF/, ""));
      if (rows.length < 2) throw new Error("ไฟล์ CSV ไม่มีข้อมูลสินค้า");
      if (rows.length > 501) throw new Error("ไฟล์ CSV ต้องมีสินค้าไม่เกิน 500 รายการ");
      const headers = rows[0].map(value => value.toLowerCase().replace(/[\s_-]/g, ""));
      const skuIndex = headers.findIndex(value => ["sku", "productsku", "รหัสสินค้า"].includes(value));
      const quantityIndex = headers.findIndex(value => ["quantity", "qty", "จำนวน"].includes(value));
      const costIndex = headers.findIndex(value => ["unitcost", "cost", "ต้นทุนต่อหน่วย"].includes(value));
      if ([skuIndex, quantityIndex, costIndex].some(index => index < 0)) throw new Error("ต้องมีหัวคอลัมน์ sku, quantity และ unitCost");
      const bySku = new Map(variants.map(variant => [variant.sku.trim().toLowerCase(), variant]));
      const seen = new Set<string>();
      const preview = rows.slice(1).flatMap((row, index) => {
        if (!row.some(value => value.trim())) return [];
        const sku = row[skuIndex]?.trim() ?? "";
        const variant = bySku.get(sku.toLowerCase());
        const quantity = row[quantityIndex]?.trim() ?? "";
        const unitCost = row[costIndex]?.trim() ?? "";
        let issue = !variant ? "ไม่พบ SKU" : "";
        if (!issue && (!/^(?:0|[1-9]\d{0,16})(?:\.\d{1,3})?$/.test(quantity) || !/[1-9]/.test(quantity))) issue = "จำนวนไม่ถูกต้อง";
        if (!issue && !/^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$/.test(unitCost)) issue = "ต้นทุนต่อหน่วยไม่ถูกต้อง";
        if (!issue && variant && seen.has(variant.id)) issue = "SKU ซ้ำ";
        if (!issue && variant) seen.add(variant.id);
        return [{ rowNumber: index + 2, sku, quantity, unitCost, variantId: issue ? undefined : variant?.id, error: issue || undefined }];
      });
      if (!preview.length) throw new Error("ไม่พบรายการสินค้าในไฟล์ CSV");
      setImportPreview(preview);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "อ่านไฟล์ CSV ไม่สำเร็จ");
    }
  }

  function confirmCsvImport() {
    if (!importPreview.length || importPreview.some(row => row.error || !row.variantId)) return;
    setLines(importPreview.map(row => ({ variantId: row.variantId!, quantity: row.quantity, unitCost: row.unitCost })));
    setImportMessage("นำเข้าสำเร็จ " + importPreview.length + " รายการ");
    setImportPreview([]);
  }

  function exportSelectedCsv() {
    if (!selected) return;
    const escape = (value: string) => '"' + value.replace(/"/g, '""') + '"';
    const rows = [
      ["sku", "product", "variant", "quantity", "unitCost", "totalCost", "uom"],
      ...selected.items.map(item => [item.sku, item.productName, item.variantTitle, item.quantity, item.unitCost, item.totalCost, item.uomCode ?? ""]),
    ];
    const content = "\\uFEFF" + rows.map(row => row.map(escape).join(",")).join("\\r\\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "opening-stock-" + (selected.reference || selected.id.slice(0, 8)).replace(/[^a-zA-Z0-9_-]/g, "_") + ".csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadCsvTemplate() {
    const content = "\uFEFFsku,quantity,unitCost\nSKU-001,10,12.500000\n";
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "opening-stock-template.csv"; anchor.click();
    URL.revokeObjectURL(url);
  }

  async function createDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !warehouseId) return;
    setError(""); setNotice("");
    const validLines = lines.filter(line => line.variantId && line.quantity.trim() && line.unitCost.trim());
    if (!validLines.length) { setError("กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ พร้อมจำนวนและต้นทุนต่อหน่วย"); return; }
    if (validLines.length !== lines.length) { setError("กรุณากรอกข้อมูลสินค้าให้ครบทุกบรรทัด หรือลบบรรทัดที่ยังไม่ใช้"); return; }
    if (new Set(validLines.map(line => line.variantId)).size !== validLines.length) { setError("ไม่สามารถเลือกสินค้า/ตัวเลือกซ้ำกันได้"); return; }
    setBusy(true);
    try {
      const payload = { reference: reference.trim() || undefined, notes: notes.trim() || undefined, items: validLines.map(line => ({ variantId: line.variantId, quantity: line.quantity, unitCost: line.unitCost })) };
      const result = editingId
        ? await api<{ openingStockId: string }>("/api/tenant/" + workspace.id + "/inventory/opening-stocks/" + editingId, { method: "PATCH", body: JSON.stringify(payload) })
        : await api<{ openingStockId: string }>("/api/tenant/" + workspace.id + "/inventory/opening-stocks", { method: "POST", body: JSON.stringify({ ...payload, warehouseId, idempotencyKey: window.crypto.randomUUID() }) });
      const targetId = editingId ?? result.openingStockId;
      await Promise.all([loadList(workspace.id), openDetail(workspace.id, targetId)]);
      setEditingId(null); setReference(""); setNotes(""); setLines([{ variantId: "", quantity: "", unitCost: "" }]); setImportMessage("");
      setNotice(editingId ? "บันทึกการแก้ไขฉบับร่างแล้ว" : "สร้างรายการยอดตั้งต้นฉบับร่างแล้ว โปรดตรวจสอบรายการก่อนกดบันทึกเข้าสต็อก");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "สร้างรายการไม่สำเร็จ"); }
    finally { setBusy(false); }
  }

  async function postSelected() {
    if (!workspace || !selected || selected.status !== "DRAFT") return;
    if (!window.confirm("ยืนยันบันทึกยอดตั้งต้นเข้าสต็อก? การบันทึกสำเร็จแล้วจะไม่สามารถสร้างยอดตั้งต้นซ้ำในคลังนี้ได้")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/tenant/${workspace.id}/inventory/opening-stocks/${selected.id}/post`, { method: "POST", body: JSON.stringify({}) });
      await Promise.all([loadList(workspace.id), openDetail(workspace.id, selected.id)]);
      setNotice("บันทึกยอดตั้งต้นเข้าสต็อกเรียบร้อยแล้ว");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "บันทึกยอดตั้งต้นไม่สำเร็จ"); }
    finally { setBusy(false); }
  }

  async function cancelSelected() {
    if (!workspace || !selected || selected.status !== "DRAFT") return;
    if (!window.confirm("ยืนยันยกเลิกรายการยอดตั้งต้นฉบับร่างนี้?")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/tenant/${workspace.id}/inventory/opening-stocks/${selected.id}/cancel`, { method: "POST", body: JSON.stringify({ reason: "Cancelled from opening stock screen" }) });
      await Promise.all([loadList(workspace.id), openDetail(workspace.id, selected.id)]);
      setNotice("ยกเลิกรายการฉบับร่างแล้ว");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "ยกเลิกรายการไม่สำเร็จ"); }
    finally { setBusy(false); }
  }

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <button className="brand brand-button" onClick={() => router.push(`/workspace/${slug}`)}><span className="brand-mark">S</span> SyncUp</button>
        <div className="user-menu">
          <button className="ghost" onClick={() => router.push(`/workspace/${slug}/inventory`)}>คลังสินค้า</button>
          <button className="ghost" onClick={() => router.push(`/workspace/${slug}/inventory/stocktakes`)}>ตรวจนับสต็อก</button>
          <button className="ghost" onClick={() => router.push(`/workspace/${slug}/inventory/history`)}>ประวัติ Movement</button>
          <button className="ghost" onClick={() => router.push(`/workspace/${slug}`)}>Workspace</button>
        </div>
      </header>
      <section className="dashboard-content opening-stock-page">
        <div className="dashboard-head">
          <div><div className="eyebrow">INVENTORY / INITIAL BALANCE</div><h1>กำหนดยอดตั้งต้นสินค้า</h1><p className="subtle">{workspace?.name ?? "กำลังโหลด Workspace..."} · กำหนดจำนวนและต้นทุนเริ่มต้นแยกตามคลังสินค้า</p></div>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        {notice && <div className="notice" role="status">{notice}</div>}
        {loading ? <div className="panel opening-empty">กำลังโหลดข้อมูล...</div> : (
          <>
            <form className="panel opening-create" onSubmit={createDraft}>
              <div className="panel-heading"><div><span className="eyebrow">{editingId ? "EDIT OPENING BALANCE" : "NEW OPENING BALANCE"}</span><h2>{editingId ? "แก้ไขฉบับร่างยอดตั้งต้น" : "สร้างรายการยอดตั้งต้น"}</h2><p>เลือกคลัง เพิ่มสินค้า จำนวนคงเหลือ และต้นทุนต่อหน่วย</p></div></div>
              <div className="opening-form-meta">
                <div className="field"><label htmlFor="opening-warehouse">คลังสินค้า</label><select id="opening-warehouse" value={warehouseId} onChange={event => setWarehouseId(event.target.value)} required disabled={!!editingId}><option value="">เลือกคลังสินค้า</option>{activeWarehouses.map(item => <option key={item.id} value={item.id}>{item.name} ({item.code})</option>)}</select></div>
                <div className="field"><label htmlFor="opening-reference">เลขที่ / อ้างอิง</label><input id="opening-reference" value={reference} onChange={event => setReference(event.target.value)} maxLength={100} placeholder="เช่น OPEN-2026-001" /></div>
                <div className="field opening-notes"><label htmlFor="opening-notes">หมายเหตุ</label><input id="opening-notes" value={notes} onChange={event => setNotes(event.target.value)} maxLength={1000} placeholder="รายละเอียดเพิ่มเติม (ไม่บังคับ)" /></div>
              </div>
              <div className="opening-import">
                <div><strong>นำเข้ารายการจาก CSV</strong><small>ใช้คอลัมน์ sku, quantity, unitCost · สูงสุด 500 รายการ</small></div>
                <input aria-label="นำเข้าไฟล์ CSV" type="file" accept=".csv,text/csv" onChange={event => { void importCsvFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
                <button type="button" className="ghost" onClick={downloadCsvTemplate}>ดาวน์โหลดไฟล์ตัวอย่าง</button>
               </div>
              {importPreview.length > 0 && (
                <div className="opening-preview">
                  <div className="opening-preview-head">
                    <div><strong>ตรวจสอบข้อมูลก่อนนำเข้า</strong><small>ผ่าน {importPreview.filter(row => !row.error).length} / {importPreview.length} รายการ · ไม่ผ่าน {importPreview.filter(row => row.error).length} รายการ</small></div>
                    <div className="opening-form-buttons">
                      <button type="button" className="ghost" onClick={() => setImportPreview([])}>ยกเลิก</button>
                      <button type="button" className="primary" onClick={confirmCsvImport} disabled={importPreview.some(row => row.error)}>ยืนยันนำเข้า</button>
                    </div>
                  </div>
                  <div className="opening-preview-table-wrap">
                    <table className="opening-preview-table">
                      <thead><tr><th>แถว</th><th>SKU</th><th>จำนวน</th><th>ต้นทุน/หน่วย</th><th>ผลตรวจสอบ</th></tr></thead>
                      <tbody>{importPreview.map(row => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.sku || "—"}</td><td>{row.quantity || "—"}</td><td>{row.unitCost || "—"}</td><td><span className={row.error ? "opening-preview-error" : "opening-preview-valid"}>{row.error || "ผ่าน"}</span></td></tr>)}</tbody>
                    </table>
                  </div>
                </div>
              )}
              {importMessage && <p className="opening-hint">{importMessage}</p>}
              <div className="opening-lines-head"><h3>รายการสินค้า</h3><button type="button" className="ghost" onClick={addLine}>＋ เพิ่มสินค้า</button></div>
              <div className="opening-lines">
                {lines.map((line, index) => (
                  <div className="opening-line" key={index}>
                    <div className="field"><label>สินค้า / SKU</label><select aria-label="สินค้า / SKU" value={line.variantId} onChange={event => updateLine(index, "variantId", event.target.value)} required><option value="">เลือกสินค้า</option>{variants.map(variant => <option key={variant.id} value={variant.id}>{variant.productName} · {variant.title} · {variant.sku}</option>)}</select></div>
                    <div className="field"><label>จำนวนตั้งต้น</label><input aria-label="จำนวนตั้งต้น" inputMode="decimal" type="number" min="0.001" step="0.001" value={line.quantity} onChange={event => updateLine(index, "quantity", event.target.value)} required /></div>
                    <div className="field"><label>ต้นทุนต่อหน่วย</label><input aria-label="ต้นทุนต่อหน่วย" inputMode="decimal" type="number" min="0" step="0.000001" value={line.unitCost} onChange={event => updateLine(index, "unitCost", event.target.value)} required /></div>
                    <button type="button" className="opening-remove" aria-label="ลบรายการสินค้า" onClick={() => removeLine(index)}>ลบ</button>
                  </div>
                ))}
              </div>
              <div className="opening-form-footer"><div><span>มูลค่ารวมโดยประมาณ</span><strong>฿{money(String(totalValue))}</strong></div><div className="opening-form-buttons">{editingId && <button className="ghost" type="button" onClick={stopEditing} disabled={busy}>ยกเลิกแก้ไข</button>}<button className="primary" type="submit" disabled={busy || !activeWarehouses.length || !variants.length}>{busy ? "กำลังบันทึก..." : editingId ? "บันทึกการแก้ไข" : "สร้างฉบับร่าง"}</button></div></div>
              <p className="opening-hint">ระบบจะยังไม่เพิ่มสต็อกจนกว่าจะกด “บันทึกเข้าสต็อก” ในขั้นตอนตรวจสอบรายการ</p>
            </form>

            <div className="opening-layout">
              <section className="panel opening-list">
                <div className="panel-heading"><div><h2>รายการยอดตั้งต้น</h2><p>ประวัติรายการของ Workspace นี้</p></div></div>
                {items.length ? <div className="opening-list-items">{items.map(item => (
                  <button type="button" className={"opening-list-item" + (selected?.id === item.id ? " selected" : "")} key={item.id} onClick={() => workspace && openDetail(workspace.id, item.id)}>
                    <div><strong>{item.reference || item.id.slice(0, 8)}</strong><span className={"opening-status " + item.status.toLowerCase()}>{statusText[item.status]}</span></div>
                    <small>{item.warehouse.name} ({item.warehouse.code})</small>
                    <small>{item.itemCount} รายการ · {qty(item.totalQuantity)} หน่วย · ฿{money(item.totalCost)}</small>
                  </button>
                ))}</div> : <div className="opening-empty">ยังไม่มีรายการยอดตั้งต้น</div>}
              </section>
              <section className="panel opening-detail">
                {selected ? <>
                  <div className="panel-heading"><div><span className={"opening-status " + selected.status.toLowerCase()}>{statusText[selected.status]}</span><h2>{selected.reference || "ยอดตั้งต้นสินค้า"}</h2><p>{selected.warehouse.name} ({selected.warehouse.code}) · สร้างเมื่อ {new Date(selected.createdAt).toLocaleString("th-TH")}</p></div><button type="button" className="ghost" onClick={exportSelectedCsv}>ส่งออก CSV</button></div>
                  {selected.notes && <p className="opening-detail-notes">{selected.notes}</p>}
                  <div className="opening-detail-lines">{selected.items.map(item => <div className="opening-detail-line" key={item.id}><div><strong>{item.productName} · {item.variantTitle}</strong><small>{item.sku} · {item.uomCode || "หน่วย"}</small></div><div><b>{qty(item.quantity)}</b><small>฿{money(item.unitCost)} / หน่วย</small></div><strong>฿{money(item.totalCost)}</strong></div>)}</div>
                  <div className="opening-detail-total"><span>มูลค่ารวม</span><strong>฿{money(selected.items.reduce((sum, item) => sum + Number(item.totalCost), 0).toString())}</strong></div>
                  {selected.status === "DRAFT" && <div className="opening-detail-actions"><p>ก่อนบันทึก ระบบจะตรวจสอบว่าสินค้าแต่ละรายการยังไม่มียอดหรือ Movement เดิมในคลังนี้</p><div><button className="ghost" type="button" onClick={() => beginEdit(selected)} disabled={busy}>แก้ไขฉบับร่าง</button><button className="ghost" type="button" onClick={cancelSelected} disabled={busy}>ยกเลิกฉบับร่าง</button><button className="primary" type="button" onClick={postSelected} disabled={busy}>{busy ? "กำลังดำเนินการ..." : "บันทึกเข้าสต็อก"}</button></div></div>}
                  {selected.status === "POSTED" && <p className="opening-posted-note">บันทึกเข้าสต็อกแล้วเมื่อ {selected.postedAt ? new Date(selected.postedAt).toLocaleString("th-TH") : "-"}</p>}
                </> : <div className="opening-empty"><h2>เลือกรายการยอดตั้งต้น</h2><p>สร้างรายการใหม่หรือเลือกรายการจากทางซ้ายเพื่อตรวจสอบรายละเอียด</p></div>}
              </section>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
