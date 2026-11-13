"use client";

type CheckoutFlow = {
  phase: "CREATE" | "POST" | "PAYMENT";
  orderNumber?: string;
  totalAmount?: string;
  currency?: string;
  method: "CASH" | "CARD" | "BANK_TRANSFER";
};
type Line = { variantId: string; variantUomId: string; productName: string; uomCode: string; quantity: number; currency: string; unitPrice: string; taxRate: string };
type Context = { taxMode: "VAT" | "NO_VAT"; priceTaxMode: "INCLUSIVE" | "EXCLUSIVE"; currencyMinorUnits: number; currency: string };
type Props = {
  flow: CheckoutFlow | null;
  cart: Line[];
  total: number;
  context: Context | null;
  method: "CASH" | "CARD" | "BANK_TRANSFER";
  onMethod: (value: "CASH" | "CARD" | "BANK_TRANSFER") => void;
  reference: string;
  onReference: (value: string) => void;
  busy: boolean;
  error: string;
  ready: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onRetry: () => void;
};

function money(value: number, currency: string, digits: number) {
  return new Intl.NumberFormat("th-TH", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}
function totalFor(line: Line, context: Context) {
  const gross = Number(line.unitPrice) * line.quantity;
  const rate = Number(line.taxRate);
  if (context.taxMode === "NO_VAT" || context.priceTaxMode === "INCLUSIVE") return gross;
  return gross * (1 + rate);
}

export default function PosCheckoutDialog(props: Props) {
  const { flow, cart, total, context, method, onMethod, reference, onReference, busy, error, ready, onClose, onConfirm, onRetry } = props;
  return <div className="pos-modal-backdrop">
    <section className="pos-checkout-modal" role="dialog" aria-modal="true" aria-labelledby="pos-checkout-title">
      <div className="pos-checkout-head">
        <div><small>CHECKOUT</small><h2 id="pos-checkout-title">{flow ? "ดำเนินการขายต่อ" : "ตรวจสอบก่อนชำระเงิน"}</h2></div>
        {!flow && <button type="button" onClick={onClose} aria-label="ปิด Checkout">×</button>}
      </div>
      {!flow ? <>
        <div className="pos-checkout-items">{cart.map(line => <div key={line.variantId + ":" + line.variantUomId}>
          <span>{line.productName} × {line.quantity} {line.uomCode}</span>
          <b>{money(context ? totalFor(line, context) : 0, line.currency, context?.currencyMinorUnits ?? 2)}</b>
        </div>)}</div>
        <div className="pos-checkout-total"><span>ยอดรวมโดยประมาณ</span><strong>{money(total, context?.currency ?? "THB", context?.currencyMinorUnits ?? 2)}</strong></div>
        <label className="pos-payment-label">วิธีรับชำระ
          <select value={method} onChange={event => onMethod(event.target.value as Props["method"])}>
            <option value="CASH">เงินสด</option><option value="BANK_TRANSFER">โอนเงิน</option><option value="CARD">บัตร (บันทึก Ledger)</option>
          </select>
        </label>
        {method !== "CASH" && <label className="pos-payment-label">เลขอ้างอิง (ถ้ามี)
          <input value={reference} onChange={event => onReference(event.target.value)} maxLength={160} placeholder="เลขอ้างอิงสลิป / รายการ" />
        </label>}
        <div className="pos-payment-warning">บันทึกเฉพาะ Payment Ledger ภายในระบบ ยังไม่มีการตัดบัตรหรือยืนยันรายการโอนผ่านธนาคารอัตโนมัติ</div>
        {error && <div className="pos-alert" role="alert">{error}</div>}
        <button className="pos-confirm-checkout" type="button" disabled={busy || !ready || cart.length === 0} onClick={onConfirm}>ยืนยันขายและบันทึกรับชำระ</button>
      </> : <>
        <div className="pos-checkout-progress">
          <div className={flow.phase !== "CREATE" ? "done" : "current"}><b>1</b><span>สร้าง Order<br />จองสต็อก</span></div>
          <div className={flow.phase === "PAYMENT" ? "done" : flow.phase === "POST" ? "current" : ""}><b>2</b><span>ยืนยันขาย<br />ตัดสต็อก</span></div>
          <div className={flow.phase === "PAYMENT" ? "current" : ""}><b>3</b><span>บันทึกรับชำระ</span></div>
        </div>
        {flow.orderNumber && <div className="pos-checkout-total"><span>{flow.orderNumber} · ยอดจาก Server</span><strong>{money(Number(flow.totalAmount), flow.currency ?? "THB", context?.currencyMinorUnits ?? 2)}</strong></div>}
        {error && <div className="pos-alert" role="alert">{error}</div>}
        {flow.phase === "POST" && <div className="pos-payment-warning">Order ถูกสร้างและจองสต็อกแล้ว แต่ยังไม่ยืนยันขาย หากการตัดสต็อกล้มเหลวต่อเนื่อง สต็อกจะยังถูกจองไว้ ให้ผู้มีสิทธิ์จัดการยกเลิก Order เพื่อคืนสต็อก</div>}{flow.phase === "PAYMENT" && <div className="pos-payment-warning">Order ถูกยืนยันขายและตัดสต็อกแล้ว เหลือเพียงบันทึกการรับชำระ ให้ Retry ขั้น Payment ด้วย Key เดิมเท่านั้น</div>}<div className="pos-payment-warning">ห้ามเริ่มรายการขายใหม่จนกว่ารายการนี้จะเสร็จ หากขั้นตอนใดล้มเหลว ให้ Retry ด้วย Key เดิมเพื่อป้องกันรายการซ้ำ</div>
        <button className="pos-confirm-checkout" type="button" disabled={busy || !ready} onClick={onRetry}>{busy ? "กำลังดำเนินการ..." : "ลองอีกครั้ง / ดำเนินการต่อ"}</button>
      </>}
    </section>
  </div>;
}
