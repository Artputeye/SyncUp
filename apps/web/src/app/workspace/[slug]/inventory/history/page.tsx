"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import "./history.css";

type Workspace = { id: string; slug: string; name: string };
type Warehouse = { id: string; name: string; code: string; status: string };
type Movement = {
  id: string; occurredAt: string; movementType: string; quantityDelta: string;
  unitCost: string | null; totalCost: string | null; reason: string | null;
  actorUserId: string | null;
  warehouse: { id: string; name: string; code: string };
  variant: { id: string; sku: string; title: string; productName: string };
};
type Result = { items: Movement[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } };

async function api<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "โหลดข้อมูลไม่สำเร็จ");
  return data as T;
}

const labels: Record<string, string> = {
  OPENING: "ยอดยกมา", RECEIVING: "รับเข้า", SALE: "จ่ายออก", RETURN: "รับคืน",
  ADJUSTMENT_IN: "ปรับเพิ่ม", ADJUSTMENT_OUT: "ปรับลด",
  TRANSFER_IN: "โอนเข้า", TRANSFER_OUT: "โอนออก", REVERSAL: "ย้อนรายการ",
};
const qty = (value: string) => Number(value).toLocaleString("th-TH", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const money = (value: string | null) => value === null ? "—" : Number(value).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function InventoryHistoryPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [rows, setRows] = useState<Movement[]>([]);
  const [pagination, setPagination] = useState<Result["pagination"]>({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [warehouseId, setWarehouseId] = useState("");
  const [movementType, setMovementType] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (page = 1) => {
    if (!workspace) return;
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (warehouseId) params.set("warehouseId", warehouseId);
      if (movementType) params.set("movementType", movementType);
      if (search.trim()) params.set("search", search.trim());
      if (from) params.set("from", new Date(from + "T00:00:00").toISOString());
      if (to) { const end = new Date(to + "T00:00:00"); end.setDate(end.getDate() + 1); params.set("to", end.toISOString()); }
      const result = await api<Result>(`/api/tenant/${workspace.id}/inventory/movements?${params.toString()}`);
      setRows(result.items); setPagination(result.pagination);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "โหลดประวัติไม่สำเร็จ"); }
    finally { setLoading(false); }
  }, [workspace, warehouseId, movementType, search, from, to]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const workspaces = await api<Workspace[]>("/api/workspaces");
        const current = workspaces.find(item => item.slug === slug);
        if (!current) { router.replace("/workspaces"); return; }
        if (!active) return;
        setWorkspace(current);
        const stores = await api<Array<{ id: string; status: string }>>(`/api/tenant/${current.id}/stores`);
        const groups = await Promise.all(stores.filter(s => s.status === "ACTIVE").map(async store => {
          const branches = await api<Array<{ id: string; status: string }>>(`/api/tenant/${current.id}/stores/${store.id}/branches`);
          return Promise.all(branches.filter(b => b.status === "ACTIVE").map(b =>
            api<Warehouse[]>(`/api/tenant/${current.id}/stores/${store.id}/branches/${b.id}/warehouses`)));
        }));
        if (active) setWarehouses(groups.flat(2).filter(w => w.status === "ACTIVE"));
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "โหลดข้อมูล Workspace ไม่สำเร็จ"); }
    })();
    return () => { active = false; };
  }, [slug, router]);

  useEffect(() => { if (workspace) void load(1); }, [workspace, load]);

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <button className="brand brand-button" onClick={() => router.push(`/workspace/${slug}`)}><span className="brand-mark">S</span> SyncUp</button>
        <div className="user-menu"><button className="ghost" onClick={() => router.push(`/workspace/${slug}/inventory`)}>คลังสินค้า</button><button className="ghost" onClick={() => router.push(`/workspace/${slug}`)}>Workspace</button></div>
      </header>
      <section className="dashboard-content inventory-history-page">
        <div className="dashboard-head"><div><div className="eyebrow">COMMERCE / INVENTORY / HISTORY</div><h1>ประวัติการเคลื่อนไหวสินค้า</h1><p className="subtle">{workspace?.name ?? "กำลังโหลด Workspace..."} · ตรวจสอบรายการย้อนหลังในคลังสินค้า</p></div><button className="ghost" onClick={() => router.push(`/workspace/${slug}/inventory`)}>กลับหน้าคลังสินค้า</button></div>
        {error && <div className="error" role="alert">{error}</div>}
        <section className="panel history-filters">
          <div className="history-filter-grid">
            <div className="field"><label htmlFor="history-search">ค้นหาสินค้า / SKU / เหตุผล</label><input id="history-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="พิมพ์คำค้น..." /></div>
            <div className="field"><label htmlFor="history-warehouse">คลังสินค้า</label><select id="history-warehouse" value={warehouseId} onChange={e => setWarehouseId(e.target.value)}><option value="">ทุกคลัง</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}</select></div>
            <div className="field"><label htmlFor="history-type">ประเภท</label><select id="history-type" value={movementType} onChange={e => setMovementType(e.target.value)}><option value="">ทุกประเภท</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
            <div className="field"><label htmlFor="history-from">ตั้งแต่วันที่</label><input id="history-from" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
            <div className="field"><label htmlFor="history-to">ถึงวันที่</label><input id="history-to" type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
          </div>
          <div className="history-filter-actions"><span>พบ {pagination.total.toLocaleString("th-TH")} รายการ</span><div><button className="ghost" onClick={() => { setSearch(""); setWarehouseId(""); setMovementType(""); setFrom(""); setTo(""); }}>ล้างตัวกรอง</button><button className="primary" onClick={() => void load(1)} disabled={loading}>ค้นหา</button></div></div>
        </section>
        <section className="panel history-table-panel">
          {loading ? <div className="history-empty">กำลังโหลดประวัติ...</div> : rows.length === 0 ? <div className="history-empty"><h2>ไม่พบประวัติการเคลื่อนไหว</h2><p>ลองเปลี่ยนตัวกรองหรือค้นหาด้วยคำอื่น</p></div> : (
            <div className="history-table-wrap"><table className="history-table"><thead><tr><th>วันเวลา</th><th>ประเภท</th><th>สินค้า / SKU</th><th>คลัง</th><th className="number">จำนวน</th><th className="number">ต้นทุน/หน่วย</th><th className="number">มูลค่ารวม</th><th>เหตุผล</th><th>ผู้ทำรายการ (ID)</th></tr></thead>
              <tbody>{rows.map(row => <tr key={row.id}><td>{new Date(row.occurredAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}</td><td><span className={row.quantityDelta.startsWith("-") ? "history-type history-negative" : "history-type"}>{labels[row.movementType] ?? row.movementType}</span></td><td><strong>{row.variant.productName}</strong><small>{row.variant.title} · {row.variant.sku}</small></td><td>{row.warehouse.name}<small>{row.warehouse.code}</small></td><td className={`number ${row.quantityDelta.startsWith("-") ? "negative" : "positive"}`}>{row.quantityDelta.startsWith("-") ? "" : "+"}{qty(row.quantityDelta)}</td><td className="number">{money(row.unitCost)}</td><td className="number">{money(row.totalCost)}</td><td>{row.reason || "—"}</td><td className="history-actor">{row.actorUserId || "—"}</td></tr>)}</tbody>
            </table></div>
          )}
          <div className="history-pagination"><span>หน้า {pagination.page} / {Math.max(1, pagination.totalPages)}</span><div><button className="ghost" disabled={loading || pagination.page <= 1} onClick={() => void load(pagination.page - 1)}>ก่อนหน้า</button><button className="ghost" disabled={loading || pagination.page >= pagination.totalPages} onClick={() => void load(pagination.page + 1)}>ถัดไป</button></div></div>
        </section>
        <div className="dashboard-foot">ข้อมูลประวัติเป็นแบบอ่านอย่างเดียว · การแก้ไขหรือย้อนรายการต้องทำผ่านขั้นตอนที่ได้รับอนุญาต</div>
      </section>
    </main>
  );
}
