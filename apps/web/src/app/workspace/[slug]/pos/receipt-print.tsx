"use client";

import "./receipt.css";

export type ReceiptItem = {
  id: string;
  product_name: string;
  variant_title?: string | null;
  sku: string;
  uom_code: string;
  quantity: string;
  unit_price?: string;
  tax_amount?: string;
  total_amount: string;
};

export type ReceiptOrder = {
  id: string;
  order_number: string;
  status: string;
  store_name: string;
  branch_code: string;
  branch_name: string;
  warehouse_code: string;
  warehouse_name: string;
  currency: string;
  tax_mode: string;
  price_tax_mode: string;
  subtotal: string;
  tax_amount: string;
  total_amount: string;
  posted_at?: string | null;
  created_at: string;
  items: ReceiptItem[];
};

export type ReceiptPayment = {
  id: string;
  payment_number: string;
  method: string;
  status: string;
  currency: string;
  amount: string;
  refunded_amount: string;
  external_reference?: string | null;
  received_at: string;
};

type Props = { order: ReceiptOrder; payments: ReceiptPayment[]; onClose: () => void };

const money = (value: string | number, currency: string) => Number(value ?? 0).toLocaleString("th-TH", {
  style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2
});
const quantity = (value: string) => Number(value).toLocaleString("th-TH", { maximumFractionDigits: 3 });
const dateTime = (value?: string | null) => value ? new Date(value).toLocaleString("th-TH") : "—";
const methodLabel: Record<string, string> = { CASH: "เงินสด", BANK_TRANSFER: "โอนเงิน", CARD: "บัตร", OTHER: "อื่น ๆ" };

export default function ReceiptPrint({ order, payments, onClose }: Props) {
  const paid = payments.reduce((sum, payment) => sum + Math.max(0, Number(payment.amount) - Number(payment.refunded_amount)), 0);
  const balance = Math.max(0, Number(order.total_amount) - paid);
  return <div className="syncup-receipt-overlay" role="presentation">
    <section className="syncup-receipt-dialog" role="dialog" aria-modal="true" aria-label="ตัวอย่างใบรับเงิน">
      <div className="syncup-receipt-toolbar">
        <div><strong>ตัวอย่างใบรับเงิน</strong><small>รูปแบบกระดาษความร้อน 80 มม.</small></div>
        <div><button type="button" onClick={() => window.print()}>พิมพ์ใบรับเงิน</button><button type="button" className="secondary" onClick={onClose}>ปิด</button></div>
      </div>
      <article className="syncup-receipt-paper">
        <header className="receipt-center">
          <strong className="receipt-brand">SyncUp</strong>
          <h1>ใบรับเงิน / SALES RECEIPT</h1>
          <p>เอกสารสรุปรายการขายและรับชำระ</p>
          <p><strong>{order.store_name}</strong></p>
          <p>สาขา {order.branch_code} · {order.branch_name}</p>
          <p>คลัง {order.warehouse_code} · {order.warehouse_name}</p>
        </header>
        <div className="receipt-rule" />
        <div className="receipt-meta"><span>เลขที่ Order</span><strong>{order.order_number}</strong></div>
        <div className="receipt-meta"><span>วันที่ขาย</span><span>{dateTime(order.posted_at ?? order.created_at)}</span></div>
        <div className="receipt-meta"><span>สถานะ</span><strong>{balance <= 0 ? "ชำระครบแล้ว" : paid > 0 ? "ชำระบางส่วน" : "ยังไม่ชำระ"}</strong></div>
        <div className="receipt-rule" />
        <div className="receipt-items-head"><span>รายการสินค้า</span><span>รวม</span></div>
        {order.items.map(item => <div className="receipt-item" key={item.id}>
          <strong>{item.product_name}{item.variant_title ? " · " + item.variant_title : ""}</strong>
          <small>{item.sku} · {quantity(item.quantity)} {item.uom_code} × {money(item.unit_price ?? "0", order.currency)}</small>
          <div><span>ภาษี {money(item.tax_amount ?? "0", order.currency)}</span><b>{money(item.total_amount, order.currency)}</b></div>
        </div>)}
        <div className="receipt-rule" />
        <div className="receipt-meta"><span>ยอดก่อนภาษี</span><span>{money(order.subtotal, order.currency)}</span></div>
        <div className="receipt-meta"><span>ภาษี</span><span>{money(order.tax_amount, order.currency)}</span></div>
        <div className="receipt-grand-total"><span>ยอดรวมสุทธิ</span><strong>{money(order.total_amount, order.currency)}</strong></div>
        <div className="receipt-rule" />
        <strong>รายการรับชำระ</strong>
        {payments.length ? payments.map(payment => <div className="receipt-payment" key={payment.id}>
          <div><strong>{payment.payment_number}</strong><span>{methodLabel[payment.method] ?? payment.method}</span></div>
          <div><span>{dateTime(payment.received_at)}</span><b>{money(payment.amount, payment.currency)}</b></div>
          {Number(payment.refunded_amount) > 0 && <small>คืนเงินแล้ว {money(payment.refunded_amount, payment.currency)}</small>}
          {payment.external_reference && <small>อ้างอิง {payment.external_reference}</small>}
        </div>) : <p className="receipt-muted">ไม่มีรายการรับชำระ</p>}
        <div className="receipt-meta"><span>รับชำระสุทธิ</span><strong>{money(paid, order.currency)}</strong></div>
        <div className="receipt-meta"><span>ยอดคงค้าง</span><strong>{money(balance, order.currency)}</strong></div>
        <div className="receipt-rule" />
        <footer className="receipt-center receipt-footer">
          <strong>ขอบคุณที่ใช้บริการ</strong>
          <p>เอกสารนี้เป็นใบรับเงินจากระบบขาย</p>
          <p>ไม่ใช่ใบกำกับภาษี</p>
          <small>พิมพ์เมื่อ {dateTime(new Date().toISOString())}</small>
        </footer>
      </article>
      <p className="syncup-receipt-disclaimer">ข้อมูลผู้ขาย/ที่อยู่/เลขประจำตัวผู้เสียภาษี และเลขที่ใบกำกับภาษีจะไม่แสดงจนกว่าจะตั้งค่าข้อมูลทางกฎหมายและรูปแบบเอกสารอย่างเป็นทางการ</p>
    </section>
  </div>;
}
