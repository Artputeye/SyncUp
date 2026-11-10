"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import "./stocktakes.css";

type Workspace = { id: string; slug: string; name: string };
type Warehouse = { id: string; code: string; name: string; status: string; isDefault: boolean };
type StocktakeListItem = {
  id: string; status: "DRAFT" | "IN_PROGRESS" | "FINALIZED" | "CANCELLED";
  reference: string | null; notes: string | null; snapshotAt: string; createdAt: string; finalizedAt: string | null;
  warehouse: { id: string; name: string; code: string }; lineCount: number; countedCount: number;
};
type StocktakeLine = {
  id: string; variantId: string; sku: string; variantTitle: string; productName: string;
  systemQuantity: string; countedQuantity: string | null; variance: string | null; unitCost: string | null; note: string | null;
};
type StocktakeDetail = {
  id: string; status: StocktakeListItem["status"]; reference: string | null; notes: string | null;
  snapshotAt: string; createdAt: string; finalizedAt: string | null;
  warehouse: { id: string; name: string; code: string }; lines: StocktakeLine[];
};
type LineDraft = { countedQuantity: string; unitCost: string; note: string };

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init, credentials: "same-origin", cache: "no-store",
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(", ") : data.message || "เกิดข้อผิดพลาด");
  return data as T;
}

const statusLabels: Record<StocktakeListItem["status"], string> = {
  DRAFT: "ฉบับร่าง", IN_PROGRESS: "กำลังตรวจนับ", FINALIZED: "ปิดรอบแล้ว", CANCELLED: "ยกเลิก",
};
const formatQty = (value: string | null) => value === null ? "—" : Number(value).toLocaleString("th-TH", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const formatDate = (value: string) => new Date(value).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });

export default function StocktakesPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<StocktakeListItem[]>([]);
  const [selected, setSelected] = useState<StocktakeDetail | null>(null);
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyLine, setBusyLine] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const activeWarehouses = useMemo(() => warehouses.filter(item => item.status === "ACTIVE"), [warehouses]);
  const editable = selected && (selected.status === "DRAFT" || selected.status === "IN_PROGRESS");

  const loadList = useCallback(async (workspaceId: string) => {
    const result = await api<{ items: StocktakeListItem[] }>(`/api/tenant/${workspaceId}/inventory/stocktakes?page=1&pageSize=50`);
    setItems(result.items);
  }, []);

  const openStocktake = useCallback(async (workspaceId: string, id: string) => {
    const detail = await api<StocktakeDetail>(`/api/tenant/${workspaceId}/inventory/stocktakes/${id}`);
    setSelected(detail);
    setDrafts(Object.fromEntries(detail.lines.map(line => [line.id, {
      countedQuantity: line.countedQuantity ?? "",
      unitCost: line.unitCost ?? "",
      note: line.note ?? "",
    }])));
  }, []);

  const load = useCallback(async () => {
    const workspaces = await api<Workspace[]>("/api/workspaces");
    const current = workspaces.find(item => item.slug === slug);
    if (!current) { router.replace("/workspaces"); return; }
    setWorkspace(current);
    const stores = await api<Array<{ id: string; status: string }>>(`/api/tenant/${current.id}/stores`);
    const branchGroups = await Promise.all(stores.filter(store => store.status === "ACTIVE").map(async store => {
      const branches = await api<Array<{ id: string; status: string }>>(`/api/tenant/${current.id}/stores/${store.id}/branches`);
      return Promise.all(branches.filter(branch => branch.status === "ACTIVE").map(branch =>
        api<Warehouse[]>(`/api/tenant/${current.id}/stores/${store.id}/branches/${branch.id}/warehouses`)));
    }));
    const all = branchGroups.flat(2).filter(warehouse => warehouse.status === "ACTIVE");
    setWarehouses(all);
    setWarehouseId(currentId => currentId && all.some(item => item.id === currentId)
      ? currentId : all.find(item => item.isDefault)?.id ?? all[0]?.id ?? "");
    await loadList(current.id);
  }, [loadList, router, slug]);

  useEffect(() => {
    let active = true;
    load().catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "โหลดข้อมูลไม่สำเร็จ"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load]);

  async function createStocktake(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !warehouseId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<{ stocktakeId: string }>(`/api/tenant/${workspace.id}/inventory/stocktakes`, {
        method: "POST",
        body: JSON.stringify({ warehouseId, reference: reference.trim() || undefined, notes: notes.trim() || undefined, idempotencyKey: window.crypto.randomUUID() }),
      });
      await loadList(workspace.id);
      await openStocktake(workspace.id, result.stocktakeId);
      setReference(""); setNotes("");
      setNotice("สร้างรอบตรวจนับแล้ว ระบบบันทึกยอดคงเหลือเป็น Snapshot ณ เวลาสร้างรอบ");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "สร้างรอบตรวจนับไม่สำเร็จ"); }
    finally { setBusy(false); }
  }

  function updateDraft(lineId: string, field: keyof LineDraft, value: string) {
    setDrafts(current => ({ ...current, [lineId]: { ...(current[lineId] ?? { countedQuantity: "", unitCost: "", note: "" }), [field]: value } }));
  }

  async function saveLine(line: StocktakeLine) {
    if (!workspace || !selected || !editable) return;
    const draft = drafts[line.id];
    if (!draft?.countedQuantity.trim()) { setError("กรุณากรอกยอดตรวจนับจริง"); return; }
    setBusyLine(line.id); setError(""); setNotice("");
    try {
      await api(`/api/tenant/${workspace.id}/inventory/stocktakes/${selected.id}/lines/${line.id}`, {
        method: "PATCH",
        body: JSON.stringify({ countedQuantity: draft.countedQuantity, ...(draft.unitCost.trim() ? { unitCost: draft.unitCost } : {}), note: draft.note }),
      });
      await openStocktake(workspace.id, selected.id);
      await loadList(workspace.id);
      setNotice(`บันทึกยอดตรวจนับ ${line.sku} แล้ว`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "บันทึกยอดตรวจนับไม่สำเร็จ"); }
    finally { setBusyLine(""); }
  }

  async function finalizeStocktake() {
    if (!workspace || !selected || !editable) return;
    if (!window.confirm("ยืนยันปิดรอบตรวจนับ? ระบบจะปรับยอดสต็อกตามผลต่าง และไม่สามารถแก้ไขรอบนี้ได้")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<{ movements: unknown[]; idempotentReplay: boolean }>(`/api/tenant/${workspace.id}/inventory/stocktakes/${selected.id}/finalize`, {
        method: "POST", body: JSON.stringify({ reason: reference.trim() ? `Stocktake ${reference.trim()}` : "Stocktake reconciliation" }),
      });
      await openStocktake(workspace.id, selected.id);
      await loadList(workspace.id);
      setNotice(`ปิดรอบตรวจนับสำเร็จ · บันทึก Movement ${result.movements?.length ?? 0} รายการ${result.idempotentReplay ? " · เป็นคำขอซ้ำที่ไม่บันทึกเพิ่ม" : ""}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "ปิดรอบตรวจนับไม่สำเร็จ"); }
    finally { setBusy(false); }
  }

  async function cancelStocktake() {
    if (!workspace || !selected || !editable) return;
    if (!window.confirm("ยืนยันยกเลิกรอบตรวจนับนี้?")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/tenant/${workspace.id}/inventory/stocktakes/${selected.id}/cancel`, { method: "POST", body: JSON.stringify({ reason: "Cancelled from stocktake screen" }) });
      await openStocktake(workspace.id, selected.id);
      await loadList(workspace.id);
      setNotice("ยกเลิกรอบตรวจนับแล้ว");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "ยกเลิกรอบตรวจนับไม่สำเร็จ"); }
    finally { setBusy(false); }
  }

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <button className="brand brand-button" onClick={() => router.push(`/workspace/${slug}`)}><span className="brand-mark">S</span> SyncUp</button>
        <div className="user-menu"><button className="ghost" onClick={() => router.push(`/workspace/${slug}/inventory`)}>คลังสินค้า</button><button className="ghost" onClick={() => router.push(`/workspace/${slug}/inventory/history`)}>ประวัติ Movement</button><button className="ghost" onClick={() => router.push(`/workspace/${slug}`)}>Workspace</button></div>
      </header>
      <section className="dashboard-content stocktake-page">
        <div className="dashboard-head"><div><div className="eyebrow">COMMERCE / INVENTORY / STOCKTAKE</div><h1>ตรวจนับสต็อก</h1><p className="subtle">{workspace?.name ?? "กำลังโหลด Workspace..."} · เปิดรอบตรวจนับ บันทึกยอดจริง และกระทบยอดอย่างมีหลักฐาน</p></div></div>
        {error && <div className="error" role="alert">{error}</div>}
        {notice && <div className="success" role="status">{notice}</div>}
        {loading ? <div className="panel">กำลังโหลดรอบตรวจนับ...</div> : (
          <>
            <section className="panel stocktake-create">
              <div className="panel-heading"><div><h2>เริ่มรอบตรวจนับใหม่</h2><p>ระบบจะบันทึกยอดคงเหลือปัจจุบันเป็น Snapshot สำหรับใช้เปรียบเทียบ</p></div></div>
              <form onSubmit={createStocktake} className="stocktake-create-form">
                <div className="field"><label htmlFor="stocktake-warehouse">คลังสินค้า</label><select id="stocktake-warehouse" value={warehouseId} onChange={event => setWarehouseId(event.target.value)} required><option value="">เลือกคลังสินค้า</option>{activeWarehouses.map(item => <option key={item.id} value={item.id}>{item.name} ({item.code})</option>)}</select></div>
                <div className="stocktake-create-row">
                  <div className="field"><label htmlFor="stocktake-reference">เลขที่ / อ้างอิง (ไม่บังคับ)</label><input id="stocktake-reference" value={reference} onChange={event => setReference(event.target.value)} maxLength={100} placeholder="เช่น ST-2026-001" /></div>
                  <div className="field"><label htmlFor="stocktake-notes">หมายเหตุ (ไม่บังคับ)</label><input id="stocktake-notes" value={notes} onChange={event => setNotes(event.target.value)} maxLength={1000} placeholder="รายละเอียดการตรวจนับ" /></div>
                </div>
                <div className="stocktake-actions"><p>การสร้างรอบยังไม่ปรับยอดสต็อก จนกว่าจะกดปิดรอบ</p><button className="primary" disabled={busy || !warehouseId}>{busy ? "กำลังสร้าง..." : "สร้างรอบตรวจนับ"}</button></div>
              </form>
            </section>

            <section className="stocktake-layout">
              <div className="panel stocktake-list">
                <div className="panel-heading"><div><h2>รอบตรวจนับ</h2><p>รายการล่าสุดไม่เกิน 50 รอบ</p></div></div>
                {items.length === 0 ? <div className="stocktake-empty">ยังไม่มีรอบตรวจนับ</div> : <div className="stocktake-list-items">
                  {items.map(item => <button type="button" key={item.id} className={selected?.id === item.id ? "stocktake-list-item selected" : "stocktake-list-item"} onClick={() => workspace && openStocktake(workspace.id, item.id).catch(cause => setError(cause instanceof Error ? cause.message : "เปิดรอบตรวจนับไม่สำเร็จ"))}>
                    <span className={`stocktake-status ${item.status.toLowerCase()}`}>{statusLabels[item.status]}</span>
                    <strong>{item.reference || item.warehouse.name}</strong>
                    <small>{item.warehouse.name} · {formatDate(item.createdAt)}</small>
                    <small>ตรวจแล้ว {item.countedCount}/{item.lineCount} รายการ</small>
                  </button>)}
                </div>}
              </div>

              <div className="panel stocktake-detail">
                {!selected ? <div className="stocktake-empty"><h2>เลือกรอบตรวจนับ</h2><p>เลือกจากรายการทางซ้ายเพื่อดูยอดระบบและบันทึกยอดตรวจนับจริง</p></div> : (
                  <>
                    <div className="panel-heading"><div><span className={`stocktake-status ${selected.status.toLowerCase()}`}>{statusLabels[selected.status]}</span><h2>{selected.reference || selected.warehouse.name}</h2><p>{selected.warehouse.name} ({selected.warehouse.code}) · Snapshot {formatDate(selected.snapshotAt)}</p></div></div>
                    {selected.lines.length === 0 ? <div className="stocktake-empty">ไม่พบรายการ Stock Balance ในคลังนี้ จึงไม่มีรายการสำหรับตรวจนับ</div> : (
                      <div className="stocktake-lines">
                        {selected.lines.map(line => {
                          const draft = drafts[line.id] ?? { countedQuantity: line.countedQuantity ?? "", unitCost: line.unitCost ?? "", note: line.note ?? "" };
                          const variance = draft.countedQuantity.trim() && Number.isFinite(Number(draft.countedQuantity))
                            ? Number(draft.countedQuantity) - Number(line.systemQuantity) : null;
                          return <article className="stocktake-line" key={line.id}>
                            <div className="stocktake-line-heading"><div><strong>{line.productName}</strong><small>{line.sku} · {line.variantTitle}</small></div><div className="stocktake-system"><small>ยอดระบบ</small><b>{formatQty(line.systemQuantity)}</b></div></div>
                            <div className="stocktake-line-inputs">
                              <div className="field"><label htmlFor={`count-${line.id}`}>ยอดตรวจนับจริง</label><input id={`count-${line.id}`} type="number" min="0" step="0.001" disabled={!editable || busyLine === line.id} value={draft.countedQuantity} onChange={event => updateDraft(line.id, "countedQuantity", event.target.value)} placeholder="0.000" /></div>
                              <div className="field"><label htmlFor={`cost-${line.id}`}>ต้นทุนต่อหน่วย (เมื่อยอดเพิ่ม)</label><input id={`cost-${line.id}`} type="number" min="0" step="0.000001" disabled={!editable || busyLine === line.id} value={draft.unitCost} onChange={event => updateDraft(line.id, "unitCost", event.target.value)} placeholder="จำเป็นเมื่อยอดเพิ่ม" /></div>
                              <div className="field"><label htmlFor={`note-${line.id}`}>หมายเหตุ</label><input id={`note-${line.id}`} disabled={!editable || busyLine === line.id} value={draft.note} onChange={event => updateDraft(line.id, "note", event.target.value)} maxLength={500} placeholder="หมายเหตุ" /></div>
                            </div>
                            <div className="stocktake-line-footer"><span>ผลต่าง <b className={variance === null || variance === 0 ? "" : variance > 0 ? "positive" : "negative"}>{variance === null ? "ยังไม่กรอก" : `${variance > 0 ? "+" : ""}${variance.toFixed(3)}`}</b></span>{editable && <button className="ghost" type="button" disabled={busyLine === line.id || !draft.countedQuantity.trim()} onClick={() => saveLine(line)}>{busyLine === line.id ? "กำลังบันทึก..." : "บันทึกยอด"}</button>}</div>
                          </article>;
                        })}
                      </div>
                    )}
                    <div className="stocktake-finalize">
                      <p>การปิดรอบจะสร้าง Movement เฉพาะรายการที่มีผลต่าง หากยอดระบบเปลี่ยนหลัง Snapshot ระบบจะปฏิเสธการปิดรอบเพื่อให้ตรวจนับใหม่</p>
                      {editable && <div><button className="ghost" type="button" disabled={busy} onClick={cancelStocktake}>ยกเลิกรอบ</button><button className="primary" type="button" disabled={busy || selected.lines.length === 0 || selected.lines.some(line => line.countedQuantity === null)} onClick={finalizeStocktake}>{busy ? "กำลังประมวลผล..." : "ปิดรอบและปรับสต็อก"}</button></div>}
                    </div>
                  </>
                )}
              </div>
            </section>
          </>
        )}
      </section>
    </main>
  );
}
