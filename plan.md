# SyncUp POS & Commerce — Product Roadmap

> เป้าหมาย: พัฒนา SyncUp ให้เป็นระบบ Omnichannel รองรับ POS หน้าร้านและร้านค้าออนไลน์ ใช้สินค้า ราคา สต๊อก ลูกค้า คำสั่งซื้อ และต้นทุนชุดเดียวกัน ลูกค้าทั่วไปเข้าดูสินค้าได้โดยไม่ต้อง Login
>
> สถานะเริ่มต้น: วางแผน (ยังไม่ถือว่าฟีเจอร์เหล่านี้พัฒนาแล้ว)

การตัดสินใจล่าสุด 2026-11-02: Commerce Core รองรับ Opening Stock และ Direct Receiving โดยไม่บังคับ Supplier/Purchase Order; Opening Stock Post ได้หนึ่ง Session ต่อ Warehouse; Quantity รองรับจำนวนเต็มและทศนิยมทุกหน่วยสูงสุด 3 ตำแหน่ง; รองรับ Custom UOM/Unit Conversion และตั้งราคาขายแยกตามหน่วย เช่น เบียร์ขายเป็นขวดและยกลัง; ทั้งคู่ Post ผ่าน Stock Ledger และ Moving Weighted Average
> วิธีทำงาน: ทำทีละ Phase ปิดงานและทดสอบก่อนเริ่ม Phase ถัดไป

---

## 1. Product vision และขอบเขต

### พื้นที่ใช้งาน 3 ส่วน

1. **Public website / Online Store** — ลูกค้าเข้าชมร้านและสินค้าได้โดยไม่ Login ดูรายละเอียด ตัวเลือกสินค้า ราคา และสั่งซื้อแบบ Guest ใน Phase ถัดไป
2. **Workspace Admin** — เจ้าของร้าน/พนักงาน Login เพื่อจัดการสินค้า ราคา สต๊อก คำสั่งซื้อ ลูกค้า ภาษี รายงาน และตั้งค่าร้าน
3. **POS** — หน้าขายหน้าร้าน เน้นความเร็ว รองรับค้นหา/สแกน Barcode รับชำระเงิน พิมพ์ใบเสร็จ และใช้สต๊อกร่วมกับ Online

### หลักการออกแบบ

- POS และ Online ใช้ Product Catalog, Inventory, Pricing, Customer และ Order ชุดเดียวกัน
- ลูกค้าไม่ต้องมีบัญชีเพื่อดูสินค้า และรองรับ Guest Checkout
- ข้อมูลธุรกิจอยู่ใน Tenant Database ของ Workspace ตามสถาปัตยกรรม Multi-workspace ปัจจุบัน
- API ทุกตัวต้องตรวจ Workspace Membership และ Permission ฝั่ง Server ห้ามเชื่อ Workspace ID จาก Browser เพียงอย่างเดียว
- แยกยอดขายสุทธิ ภาษี ส่วนลด ต้นทุน กำไร และค่าธรรมเนียมให้ตรวจสอบย้อนหลังได้
- เก็บ Stock Movement และรายการการเงินเป็น Ledger ไม่ลบ/แก้ประวัติธุรกรรมเดิมโดยตรง
- ใช้ Decimal สำหรับเงินและ Quantity ทุกหน่วย; Quantity เก็บ PostgreSQL NUMERIC(20,3)/Prisma Decimal รองรับทศนิยมสูงสุด 3 ตำแหน่ง ห้ามใช้ Float/Double
- ออกแบบให้รองรับหลายสาขาตั้งแต่ต้น แม้ MVP เปิดใช้สาขาเดียว
- Public API ส่งเฉพาะข้อมูลที่เผยแพร่ ห้ามส่งต้นทุนหรือข้อมูลภายใน
- ยกเลิก/คืนเงิน/คืนสินค้า ต้องมีรายการย้อนกลับและ Audit Trail
- Procurement (PR/PO/รับสินค้า/Invoice) และ Accounting (AP/AR/GL) เป็น Optional Modules เปิดใช้แยกกันได้ต่อ Workspace; Commerce Core ต้องทำงานได้แม้ไม่เปิดโมดูลเหล่านี้

### ไม่ทำใน MVP

- Marketplace ภายนอกและการ Sync ออเดอร์อัตโนมัติ
- ระบบบัญชีเต็มรูปแบบ/GL/ปิดงบ
- E-Tax Invoice / e-Receipt Integration
- CRM Automation/สะสมแต้มขั้นสูง
- Multi-currency / Multi-country Tax
- Offline POS แบบเต็มรูปแบบ
- Native Mobile App

---

## 2. โครงสร้างหน้าเป้าหมาย

### Public (ไม่ต้อง Login)
- / — หน้าแนะนำ SyncUp หรือหน้าเลือก/ค้นหาร้าน (รอตัดสินใจ)
- /s/[storeSlug] — หน้าแรกของร้าน
- /s/[storeSlug]/products — รายการสินค้า/ตัวกรอง
- /s/[storeSlug]/products/[productSlug] — รายละเอียดสินค้า/Variant
- /s/[storeSlug]/cart — ตะกร้า
- /s/[storeSlug]/checkout — Guest Checkout
- /s/[storeSlug]/orders/[publicOrderToken] — ติดตาม Order ด้วย Token ที่เดายาก
- /login — เข้าสู่ระบบพนักงาน/เจ้าของร้าน (รองรับ Google Sign-In ตามนโยบายที่กำหนด)
- /forgot-password — ขอรีเซ็ตรหัสผ่านด้วยอีเมล
- /reset-password/[token] — ตั้งรหัสผ่านใหม่ด้วย Token แบบใช้ครั้งเดียว

### Workspace Admin
- /workspaces — เลือก Workspace
- /workspace/[slug] — Dashboard
- /workspace/[slug]/products — สินค้า/หมวดหมู่
- /workspace/[slug]/inventory — สต๊อก/ประวัติ
- /workspace/[slug]/orders — คำสั่งซื้อทุกช่องทาง
- /workspace/[slug]/customers — ลูกค้า
- /workspace/[slug]/reports — ยอดขาย/กำไร/ภาษี
- /workspace/[slug]/settings — ร้าน ภาษี สาขา ช่องทางขาย ผู้ใช้งาน

### POS
- /workspace/[slug]/pos — หน้าขาย
- /workspace/[slug]/pos/shifts — เปิด/ปิดกะและสรุปเงินสด
- /workspace/[slug]/pos/receipts/[id] — ใบเสร็จ/พิมพ์ซ้ำตามสิทธิ์

> URL เป็นข้อเสนอ ปรับตาม Route Convention จริงได้ แต่ต้องแยก Public, Admin และ POS ชัดเจน

---

## 3. Roadmap ตามลำดับความสำคัญ

- **P0 — Foundation/Blocker:** ต้องทำก่อน เป็นฐานของระบบ
- **P1 — MVP:** จำเป็นต่อการเปิดร้านและเริ่มขาย
- **P2 — Operational:** ทำให้การปฏิบัติงานครบขึ้น
- **P3 — Advanced:** ส่วนขยายหลัง MVP และผ่านการใช้งานจริง

### Phase 0 — Product decisions & Foundation audit (P0)

- [ ] 0.1 ตรวจสถานะ Auth, Workspace Provisioning, Tenant DB Registry และ RBAC
- [ ] 0.1a เพิ่ม Forgot Password/Password Reset สำหรับบัญชีผู้ใช้: ขอรีเซ็ตผ่านอีเมล, ตอบกลับแบบไม่เปิดเผยว่ามีบัญชีหรือไม่, ใช้ Token แบบสุ่มที่เก็บในรูป Hash มีวันหมดอายุและใช้ได้ครั้งเดียว, จำกัดอัตราการขอ, บันทึก Audit และกำหนดนโยบาย Session หลังเปลี่ยนรหัสผ่าน
- [ ] 0.1b เพิ่ม Google Sign-In สำหรับพนักงาน/เจ้าของร้านผ่าน OAuth 2.0 / OpenID Connect: ตรวจสอบ ID Token ฝั่ง Server (issuer, audience, signature, expiry, nonce/state), จับคู่บัญชีด้วย Google subject ที่คงที่ ไม่ใช้ email เป็นตัวระบุหลัก, กำหนดขั้นตอนเชื่อมบัญชีเดิม/ป้องกัน Account Takeover, ตรวจ Workspace Membership/RBAC หลัง Login, รองรับ callback/redirect allowlist, ปิดการใช้ implicit flow และบันทึก Audit; เก็บ Client Secret ฝั่ง Server เท่านั้น
- [ ] 0.2 ทำให้ API Boot ผ่านทุก Module และมี Smoke Test
- [x] 0.3 ยืนยันรูปแบบธุรกิจ: หนึ่ง Workspace มีหลายร้าน และแต่ละร้านมีหลายสาขาได้
- [x] 0.4 กำหนดสกุลเงินหลัก THB และ timezone Asia/Bangkok เป็นค่าเริ่มต้น (สามารถกำหนดต่อ Store)
- [x] 0.5 VAT ตั้งค่าได้แยกตาม Store และรองรับราคาแบบรวม/ไม่รวม VAT
- [x] 0.6 ใช้ Moving Weighted Average โดยคำนวณแยก Variant + Warehouse
- [x] 0.7 กำหนดสถานะ Order, Payment, Fulfillment, Return และ Stock Movement
- [x] 0.7a รองรับ Partial Payment/Deposit ตั้งแต่ MVP; Order มีหลาย Payment, paidTotal/balanceDue/paymentStatus และ Idempotency
- [x] 0.7b Tax Rounding ระดับ Document Level ด้วย HALF_UP; เก็บ Tax Snapshot และคงค่าเดิมสำหรับเอกสารเก่า
- [x] 0.7c Partial Return อ้าง OrderItem เดิม; แยก returnQuantity/restockQuantity และคำนวณคืนเงินจากราคา/ส่วนลด/ภาษี Snapshot
- [x] 0.7d Return UOM Snapshot และ Default Return Cost Policy ระบุใน ERD/API; รอ Accounting Review ก่อน Production
- [x] 0.7e TaxCategory/TaxRate effective date และ OrderTaxLine calculation snapshots ระบุใน ERD/API
- [ ] 0.8 กำหนดเลขเอกสารแยกตามสาขา/ปี/ประเภทเอกสาร
- [ ] 0.9 กำหนด Permission Matrix: Owner, Admin, Manager, Cashier, Inventory Staff
- [ ] 0.10 ทบทวน ERD Draft ใน docs/architecture/commerce-erd.md และทำ API Contract ก่อนสร้าง Business Tables (รวม StoreProductVariant, shared Product Master, Default Branch/Warehouse, Opening Stock และ Direct Receiving)
- [ ] 0.11 กำหนด Backup/Restore Tenant DB และ Audit Log
- [ ] 0.12 ยืนยัน Public URL: เริ่มด้วย /s/{storeSlug} แล้วค่อยเพิ่ม Custom Domain
- [ ] 0.13 ออกแบบ Tenant Prisma Schema/Client แยกจาก Control Prisma Schema; Tenant Runtime ใช้ Client ที่ generate จาก Tenant schema เท่านั้น
- [ ] 0.14 ออกแบบ Stock Adjustment CSV Import/Export (OWNER only): Template/Snapshot, Preview, row validation, stale snapshot, atomic commit, idempotency และ audit
- [ ] 0.15 ทบทวน Tenant migration strategy ให้รองรับการ Provision/Migrate ทุก Workspace โดย Runtime DB role ไม่มีสิทธิ์ DDL
- [ ] 0.9 กำหนด Permission Matrix: Owner, Admin, Manager, Cashier, Inventory Staff
- [ ] 0.10 ทบทวน ERD Draft ใน docs/architecture/commerce-erd.md และทำ API Contract ก่อนสร้าง Business Tables (รวม StoreProductVariant, shared Product Master, Default Branch/Warehouse, Opening Stock และ Direct Receiving)
- [ ] 0.11 กำหนด Backup/Restore Tenant DB และ Audit Log
- [ ] 0.12 ยืนยัน Public URL: เริ่มด้วย /s/{storeSlug} แล้วค่อยเพิ่ม Custom Domain

**เกณฑ์ผ่าน:** API และ Workspace ใช้งานได้จริง ขอบเขตธุรกิจชัด มี ERD/สถานะเอกสาร/Permission ที่เป็นข้อกำหนดเดียวกัน

### Phase 1 — Core Store & Product Catalog (P0 → P1)

**Backend / Data**
- [ ] 1.1 สร้าง Tenant Module: store
- [ ] 1.2 ข้อมูลร้าน: ชื่อ โลโก้ คำอธิบาย ที่อยู่ ช่องทางติดต่อ สถานะเผยแพร่
- [ ] 1.3 Branch: สร้าง Default Branch `สำนักงานใหญ่` อัตโนมัติเมื่อสร้าง Store; Store มี Default Branch ได้หนึ่งแห่ง
- [ ] 1.4 Store-specific Categories และลำดับแสดงผล (StoreCategory / StoreProductCategory)
- [ ] 1.5 Product และ Product Variant (SKU แยกตามสี/ขนาด)
- [ ] 1.5a StoreProductVariant: เลือกเปิดขาย/เผยแพร่เป็นราย Variant ต่อ Store
- [ ] 1.6 Barcode, SKU, รูปภาพ และรายละเอียดสินค้า
- [ ] 1.6a UnitOfMeasure ระดับ Workspace: หน่วยเริ่มต้น + Custom UOM (ชื่อ/ชื่อย่อ/dimension/decimalPlaces 0–3)
- [ ] 1.6b Variant base UOM + VariantUOM conversion factor; หน่วยขาย/รับซื้อกำหนดต่อ Variant
- [ ] 1.6c ProductPrice แยกราคาตามหน่วยขายของ Variant เช่น เบียร์ 1 ขวด 40 บาท / 1 ลัง 450 บาท; POS/Online เลือกหน่วยขายและแปลงสต๊อกเป็นหน่วยฐาน
- [ ] 1.6d ProductImage/VariantImage: รูปหลัก รูปแกลเลอรี รูปเฉพาะ Variant, sortOrder และ altText
- [ ] 1.6e Bulk Image Upload ผ่าน Folder/ZIP สำหรับ ADMIN/OWNER; Mapping ด้วย Filename หรือ Manifest CSV (Product ID/Variant ID/SKU), Preview, validation, checksum, staging storage และ Audit Trail
- [ ] 1.6f Public Store แสดงเฉพาะรูปที่เผยแพร่แล้ว; ป้องกันไฟล์อันตราย, path traversal และ archive bomb
- [ ] 1.7 แยกราคาขาย ราคาทุน และสถานะภาษี
- [ ] 1.8 Product Status: Draft, Active, Archived
- [ ] 1.9 API CRUD พร้อม Validation, Pagination, Search และ Permission
- [ ] 1.10 Audit Log สำหรับสร้าง/แก้ไข/ปิดใช้งานสินค้า

**Admin UI**
- [ ] 1.11 หน้า Store Settings เบื้องต้น
- [ ] 1.12 หน้ารายการสินค้า ค้นหา กรอง แบ่งหน้า
- [ ] 1.13 หน้าสร้าง/แก้ไขสินค้าและ Variant
- [ ] 1.14 จัดการหมวดหมู่
- [ ] 1.15 อัปโหลดรูปภาพ พร้อมจำกัดชนิด/ขนาดไฟล์

**Public Store**
- [ ] 1.16 ปรับหน้า / เป็น Public Landing ตามข้อสรุป
- [ ] 1.17 ทำ /s/[storeSlug] ให้เปิดได้โดยไม่ Login
- [ ] 1.18 หน้ารายการสินค้าและรายละเอียดสินค้า
- [ ] 1.19 แสดงเฉพาะสินค้าที่ Active และ Published
- [ ] 1.20 SEO Metadata, Open Graph, Sitemap และ Responsive Layout

**เกณฑ์ผ่าน:** ร้านเพิ่มสินค้า/หมวดหมู่ได้ บุคคลทั่วไปดูร้านและสินค้าได้โดยไม่ Login และไม่เห็นต้นทุนหรือข้อมูลภายใน

### Phase 2 — Inventory & Costing (P0 → P1)

- [ ] 2.1 Warehouse ผูกกับสาขา; สร้าง Default Warehouse `คลังหลัก` อัตโนมัติพร้อม Default Branch เมื่อสร้าง Store; แต่ละ Branch มี Default Warehouse ได้หนึ่งแห่ง
- [ ] 2.2 Stock Balance แยก Product Variant + Warehouse
- [ ] 2.3 Stock Movement Ledger: รับเข้า ขาย จอง ยกเลิกจอง คืน ปรับปรุง โอนคลัง
- [ ] 2.4 Stock Adjustment พร้อมเหตุผลและผู้อนุมัติ
- [ ] 2.5 Stock Transfer ระหว่างคลัง พร้อมสถานะส่ง/รับ
- [ ] 2.6 Stock Reservation สำหรับ Checkout/Order ที่ยังไม่ชำระ
- [ ] 2.7 ป้องกันขายเกินสต๊อกด้วย DB Transaction/Lock
- [ ] 2.8 นโยบายสินค้าติดลบ (ค่าเริ่มต้นไม่อนุญาต ยกเว้นผู้มีสิทธิ์)
- [ ] 2.9 ต้นทุน Moving Weighted Average และ Cost Snapshot ในรายการขาย
- [ ] 2.10 Opening Stock: บันทึกยอดตั้งต้นเป็น Session ต่อ Warehouse พร้อม quantity และ unit cost; แต่ละ Warehouse Post ได้เพียงหนึ่ง Session
- [ ] 2.10a Direct Receiving: รับสินค้าเข้า Warehouse ได้โดยไม่ต้องมี Supplier/PO; Supplier เป็นข้อมูลอ้างอิงเสริม
- [ ] 2.10b ทั้งสองวิธีสร้าง Stock Ledger และคำนวณ Moving Weighted Average แบบ Atomic + Idempotent; หลัง Post แก้ย้อนหลังด้วย Reversal/Adjustment เท่านั้น
- [ ] 2.10c Quantity ทุกหน่วยรองรับจำนวนเต็ม/ทศนิยมสูงสุด 3 ตำแหน่ง; ใช้ Decimal และ Validation สอดคล้องกันทุก API/ตาราง
- [ ] 2.10d Stock Ledger/Balance เก็บหน่วยฐานเท่านั้น; แปลงจากหน่วยขาย/รับซื้อก่อนบันทึก พร้อม Snapshot หน่วยและ Conversion Factor ในรายการขาย
- [ ] 2.10e Stock Adjustment CSV: OWNER ดาวน์โหลด Stock Snapshot/Template, Upload CSV, Preview Validation และ Commit แบบ Atomic/Idempotent; ตรวจ Stale Snapshot และ Audit Trail
- [ ] 2.10f CSV Import Batch/Rows เก็บ checksum, uploader, status, row-level errors และผล Commit; ป้องกัน CSV Formula Injection และกำหนด file/row limits
- [ ] 2.11 หน้าสต๊อกคงเหลือ/ต่ำกว่าจุดสั่งซื้อ/ประวัติเคลื่อนไหว
- [ ] 2.12 รายงานมูลค่าสต๊อก ณ วันที่กำหนด
- [ ] 2.13 ทดสอบ Ledger, Reconciliation และ Concurrent Sale

**เกณฑ์ผ่าน:** ทุกการเปลี่ยนสต๊อกมี Ledger ยอดคงเหลือตรวจสอบย้อนกลับได้ และการขายพร้อมกันไม่ทำให้สต๊อกผิดพลาด

### Phase 3 — Sales, Orders & Payments Core (P1)

- [ ] 3.1 Order และ Order Items แบบ Snapshot ชื่อ/SKU/ราคา/ภาษี/ส่วนลด/ต้นทุน ณ เวลาขาย
- [ ] 3.2 Order Number แยกช่องทาง/สาขาตามกติกา
- [ ] 3.3 Order Status และ State Transition ที่ตรวจสอบได้
- [ ] 3.4 ส่วนลดระดับรายการและระดับบิล
- [ ] 3.5 ค่าจัดส่งและค่าบริการแยกจากสินค้า
- [ ] 3.6 Payment และ Payment Transaction แยกจาก Order
- [ ] 3.7 เงินสด โอน/QR และบันทึกผลชำระผ่านผู้ให้บริการ
- [ ] 3.8 Payment Provider Adapter ไม่ผูก Business Logic กับผู้ให้บริการรายเดียว
- [ ] 3.9 Idempotency สำหรับสร้าง Order และรับ Payment Webhook
- [ ] 3.10 เอกสารยกเลิก Order, Void และ Refund
- [ ] 3.11 Reservation Timeout และคืนสต๊อกเมื่อชำระไม่สำเร็จ/หมดเวลา
- [ ] 3.12 หน้ารวมคำสั่งซื้อ ค้นหา กรอง และดูรายละเอียด
- [ ] 3.13 Audit Trail สำหรับสถานะและธุรกรรมการเงิน

**เกณฑ์ผ่าน:** สร้าง Order รับชำระ ยกเลิก คืนเงินได้ โดย Order, Payment และ Inventory ไม่ขัดแย้งกัน

### Phase 4 — POS MVP (P1)

- [ ] 4.1 POS Permission และเลือกสาขา/คลัง
- [ ] 4.2 Cashier Shift: เปิดกะ ใส่เงินตั้งต้น ปิดกะ
- [ ] 4.3 หน้าขาย Responsive สำหรับ Desktop/Tablet
- [ ] 4.4 ค้นหาสินค้าด้วยชื่อ SKU และ Barcode
- [ ] 4.5 เพิ่ม/ลดจำนวน แก้รายการ และพักบิล
- [ ] 4.6 คำนวณส่วนลด ภาษี ยอดสุทธิ และเงินทอน
- [ ] 4.7 เงินสดและ QR/โอนแบบบันทึกผล
- [ ] 4.8 ใบเสร็จอย่างย่อและพิมพ์ผ่าน Browser
- [ ] 4.9 พิมพ์ซ้ำโดยบันทึกผู้สั่งพิมพ์และเวลา
- [ ] 4.10 ตัดสต๊อกตามกติกา Order/Payment
- [ ] 4.11 สรุปยอดขายตามกะ แยกช่องทางชำระ และเงินสดที่ควรมี
- [ ] 4.12 Void/Refund ตาม Permission
- [ ] 4.13 ทดสอบ Double Submit และการเชื่อมต่อหลุดระหว่างบันทึก

**เกณฑ์ผ่าน:** พนักงานเปิดกะ ขาย รับเงิน พิมพ์ใบเสร็จ ปิดกะ และตรวจยอดได้จริง ยอดขายกับสต๊อกตรงกัน

### Phase 5 — Online Store Checkout (P1)

- [ ] 5.1 ตะกร้าสินค้า Guest ไม่ต้อง Login
- [ ] 5.2 ตรวจราคาและสต๊อกจาก Server ใหม่ก่อนยืนยัน Order
- [ ] 5.3 Checkout เก็บชื่อ เบอร์โทร อีเมล และที่อยู่เท่าที่จำเป็น
- [ ] 5.4 ที่อยู่จัดส่งและข้อมูลผู้รับ
- [ ] 5.5 วิธีชำระเงินที่ร้านเปิดใช้งาน
- [ ] 5.6 สร้าง Online Order และส่งเข้าหลังบ้าน
- [ ] 5.7 Public Order Tracking Token แบบสุ่มเดายาก ห้ามใช้เลข Order เป็นสิทธิ์เข้าถึง
- [ ] 5.8 แจ้งยืนยัน Order/ชำระเงินผ่าน Email หรือช่องทางที่เลือก
- [ ] 5.9 สถานะเตรียมสินค้า จัดส่ง สำเร็จ และยกเลิก
- [ ] 5.10 จัดการขนส่ง เลข Tracking และผู้ให้บริการ
- [ ] 5.11 ป้องกัน Bot/Spam และจำกัดอัตรา Checkout
- [ ] 5.12 Privacy Notice, Consent และนโยบายเก็บข้อมูลลูกค้า
- [ ] 5.13 บันทึกข้อมูลผู้ซื้อเป็น Customer Profile แบบ Guest-first: ชื่อ เบอร์โทร อีเมล และที่อยู่จัดส่ง/ออกใบเสร็จเท่าที่จำเป็น; ลูกค้าไม่ต้องสมัครบัญชีก่อนสั่งซื้อ
- [ ] 5.14 เชื่อม Order กับ Customer แบบไม่สร้างข้อมูลซ้ำโดยไม่จำเป็น; ตรวจ/รวม Customer จากข้อมูลติดต่อด้วยกติกาที่ชัดเจนและไม่เปิดเผยข้อมูลข้ามผู้ใช้
- [ ] 5.15 ตรวจสอบการชำระเงินสำเร็จอัตโนมัติจาก Payment Gateway ผ่าน Webhook ที่ตรวจลายเซ็น/แหล่งที่มาและตรวจสอบสถานะกับ Provider เมื่อจำเป็น; ห้ามเชื่อค่าจากหน้า Redirect หรือ Browser เพียงอย่างเดียว
- [ ] 5.16 ป้องกัน Webhook ซ้ำ/ผิดลำดับด้วย Idempotency และการตรวจ Provider Event ID; บันทึก Payment Transaction, เวลา, จำนวนเงิน, สกุลเงิน และผลตรวจสอบลง Audit Trail
- [ ] 5.17 เปลี่ยน Payment Status และยืนยัน Order เฉพาะเมื่อยอด/สกุลเงิน/Order reference ตรงกันและตรวจสอบสำเร็จ; กรณีรอตรวจสอบ ล้มเหลว หรือยอดไม่ตรงให้คงสถานะรอตรวจสอบและแจ้งผู้ดูแล
- [ ] 5.18 ทดสอบ Payment Pending/Success/Failure/Expired/Refund, Webhook Retry, Event ปลอม, จำนวนเงินไม่ตรง และการแจ้งสถานะซ้ำ; แจ้งลูกค้าเมื่อยืนยันผลสำเร็จจริงเท่านั้น

**เกณฑ์ผ่าน:** ลูกค้าเข้าร้านโดยไม่ Login เลือกสินค้า Checkout แบบ Guest บันทึกข้อมูลผู้ซื้อเท่าที่จำเป็น และติดตาม Order ได้; ร้านเห็น Order ในหลังบ้าน; ระบบตรวจยืนยันการจ่ายเงินสำเร็จอัตโนมัติอย่างปลอดภัยและไม่ยืนยันจาก Redirect เพียงอย่างเดียว; สต๊อกไม่ถูกขายเกิน

### Phase 6 — Tax, Receipts & Profit Reports (P1 → P2)

- [ ] 6.1 Tax Profile ร้าน/สาขา (เลขผู้เสียภาษี ที่อยู่สำนักงานใหญ่/สาขา)
- [ ] 6.2 Tax Mode: ไม่จด VAT / จด VAT และอัตราภาษีตามวันที่มีผล
- [ ] 6.3 ราคาสินค้ารวม VAT และไม่รวม VAT
- [ ] 6.4 แยกยอดก่อนภาษี ภาษี ส่วนลด ค่าจัดส่ง และยอดสุทธิ
- [ ] 6.5 Tax Snapshot ใน Order/Receipt เพื่อไม่ให้การตั้งค่าใหม่เปลี่ยนเอกสารเก่า
- [ ] 6.6 ใบเสร็จรับเงินและเอกสารอย่างย่อ POS ตามรูปแบบที่ตรวจสอบแล้ว
- [ ] 6.7 ออกแบบ Tax Invoice/ใบกำกับภาษีเต็มรูปแบบ ให้ผู้เชี่ยวชาญตรวจสอบก่อนใช้จริง
- [ ] 6.8 เอกสารลดหนี้/คืนสินค้าและภาษีที่เกี่ยวข้อง
- [ ] 6.8a Partial Return: ขาย 1 ลัง (12 ขวด) คืน 2 ขวด; รับสต๊อกกลับ 2 ขวด, net sold 10 ขวด และ refund จาก OrderItem/Tax Snapshot เดิม
- [ ] 6.8b Partial Return สินค้าเสียหาย: คืนเงินได้แต่ restockQuantity=0; ทดสอบคืนหลายครั้งสะสม, ห้ามคืนเกินยอดขาย และ Idempotency
- [ ] 6.8c Return Post ต้อง atomic ระหว่าง Return, StockMovement, InventoryCost/WAC และ Refund; ทดสอบ ledger reconcile
- [ ] 6.8d Return Costing: สินค้า SELLABLE รับกลับด้วยต้นทุน unit_cost_snapshot จาก OrderItem เดิมและคำนวณ WAC ใหม่; DAMAGED/UNSELLABLE ไม่เพิ่ม on_hand และต้องบันทึก disposition/write-off
- [ ] 6.8e Tax Snapshot: ทดสอบ Tax Category/Rate ตาม effective date, Document Level + HALF_UP ต่อ currency minor unit, และไม่เปลี่ยนผล Order เก่าหลังแก้ Tax Profile
- [ ] 6.9 Sales Summary แยกวัน/เดือน/สาขา/ช่องทาง
- [ ] 6.10 Gross Profit = ยอดขายสุทธิไม่รวม VAT - ต้นทุนสินค้าที่ขาย
- [ ] 6.11 แยกส่วนลด คืนสินค้า และกำไรขั้นต้น
- [ ] 6.12 ค่าใช้จ่ายดำเนินงานและค่าธรรมเนียม Payment/Delivery เพื่อคำนวณ Contribution Profit
- [ ] 6.13 รายงานภาษีขายและยอดภาษีตามช่วงเวลา
- [ ] 6.14 Export CSV/XLSX และ Permission รายงาน
- [ ] 6.15 ทดสอบสูตรด้วยชุดข้อมูลอ้างอิงและคืนสินค้าบางส่วน

**เกณฑ์ผ่าน:** รายงานยอดขาย ต้นทุน กำไรขั้นต้น และภาษีแยกกัน สูตรตรวจสอบได้ เอกสารเก่าไม่เปลี่ยนตามการตั้งค่าใหม่

> ข้อควรระวัง: ระบบช่วยคำนวณและจัดเตรียมข้อมูลภาษีได้ แต่การใช้เอกสารเป็นใบกำกับภาษีตามกฎหมายไทยต้องตรวจสอบรูปแบบและข้อกำหนดกับผู้เชี่ยวชาญ/กรมสรรพากรก่อนเปิดใช้จริง

### Phase 7 — Customers, Purchasing & Replenishment (P2)

- [ ] 7.1 Customer Profile รวม Guest ที่ยินยอมให้เก็บข้อมูล
- [ ] 7.2 รวมประวัติ POS และ Online ด้วย Customer Identity ที่ปลอดภัย
- [ ] 7.3 Supplier
- [ ] 7.4 Purchase Order
- [ ] 7.5 รับสินค้าเข้าคลังจากเอกสารซื้อ
- [ ] 7.6 บันทึกต้นทุนซื้อ ค่าขนส่ง และต้นทุนเพิ่มเติมตามนโยบาย
- [ ] 7.7 คืนสินค้า Supplier
- [ ] 7.8 Reorder Point และแจ้งเตือนสินค้าใกล้หมด
- [ ] 7.9 รายงานการซื้อและประวัติ Supplier

### Phase 8 — Omnichannel Operations & Integrations (P2 → P3)

- [ ] 8.1 Order Inbox รวมทุกช่องทาง
- [ ] 8.2 Channel Adapter สำหรับ Marketplace ตามลำดับความต้องการ
- [ ] 8.3 ระบบขนส่ง/พิมพ์ใบปะหน้า
- [ ] 8.4 Payment Gateway และ Webhook Verification
- [ ] 8.5 Barcode Scanner และ Receipt Printer compatibility
- [ ] 8.6 Cash Drawer ผ่านเครื่องพิมพ์/อุปกรณ์ที่รองรับ
- [ ] 8.7 Multi-branch Stock Transfer และเติมสต๊อก
- [ ] 8.8 Offline POS แบบ Local Queue และ Conflict Resolution (ต้องออกแบบก่อนพัฒนา)
- [ ] 8.9 Custom Domain และ SSL Automation สำหรับ Online Store

### Phase 9 — Advanced Finance, CRM & Governance (P3)

- [ ] 9.1 ระบบค่าใช้จ่ายและหมวดค่าใช้จ่าย
- [ ] 9.2 Dashboard กระแสเงินสดและกำไรหลังหักค่าใช้จ่าย
- [ ] 9.3 Coupon และ Campaign
- [ ] 9.4 Loyalty / Points / Membership Tier
- [ ] 9.5 Gift Card / Store Credit
- [ ] 9.6 Commission พนักงานขาย
- [ ] 9.7 Demand Forecast และ Stock Replenishment Suggestion
- [ ] 9.8 E-Tax Invoice / e-Receipt Integration
- [ ] 9.9 Accounting Export / Integration
- [ ] 9.10 Advanced Audit, Retention, Data Export และ Privacy Request

### Phase 10 — Optional Procurement & Accounting Modules (P3 — Future / Opt-in)

> โมดูลจัดซื้อและบัญชีเป็นส่วนเสริมที่ Workspace เลือกเปิดหรือไม่เปิดใช้ก็ได้ ไม่เป็น Dependency ของ POS, Online Store, Inventory Core หรือการรับสินค้าเข้าสต๊อกขั้นพื้นฐาน ต้องออกแบบเป็น Module แยก มี Permission, Navigation, API และการตั้งค่าเปิด/ปิดระดับ Workspace

- [ ] 10.1 Module Registry / Feature Entitlement สำหรับเปิด-ปิด Procurement และ Accounting แยกกันต่อ Workspace
- [ ] 10.2 Purchase Request (PR): ขอซื้อ เสนออนุมัติ และติดตามสถานะ (เปิดใช้ได้อิสระตามนโยบายร้าน)
- [ ] 10.3 Purchase Order (PO): สร้างจาก PR หรือสร้าง PO โดยตรงได้ รองรับอนุมัติ/ยกเลิก/แก้ไขตามสถานะ
- [ ] 10.4 Goods Receipt: รับสินค้าจาก PO แบบเต็มจำนวน/บางส่วน และบันทึกส่วนต่าง; การรับสินค้าแบบไม่ใช้ PO ต้องยังทำได้
- [ ] 10.5 Supplier Invoice / ใบแจ้งหนี้จากผู้ขาย: จับคู่กับ PO และ Goods Receipt, รองรับ Partial Invoice และตรวจยอด/ภาษี
- [ ] 10.6 Sales Invoice / เอกสารแจ้งหนี้ลูกค้า: ออกเอกสารจาก Order ตาม Workflow และสิทธิ์ที่กำหนด โดยไม่แทนที่ Order/Payment
- [ ] 10.7 Accounts Payable (AP) / Accounts Receivable (AR): เจ้าหนี้-ลูกหนี้ กำหนดชำระ รับ/จ่ายชำระ และสถานะคงค้าง
- [ ] 10.8 Chart of Accounts, Journal Entry และ General Ledger (GL) แบบ Double-entry
- [ ] 10.9 Posting Rules เชื่อม Sales, Payment, Refund, Inventory Cost, Purchase และ Expense ไปยังบัญชี
- [ ] 10.10 Financial Reports: Trial Balance, General Ledger, Profit & Loss, Balance Sheet และ Cash Flow
- [ ] 10.11 Period Closing, Fiscal Year, Audit Trail และการล็อกงวดบัญชี
- [ ] 10.12 Import/Export และ Integration กับโปรแกรมบัญชีภายนอก

**หลักการแยกโมดูล:** หาก Workspace ไม่เปิด Procurement จะยังรับสินค้าเข้าแบบ Direct Receiving/Opening Stock ได้; หากไม่เปิด Accounting ระบบยังขาย รับชำระ จัดการสต๊อก คำนวณต้นทุน และดูรายงานการดำเนินงานได้ตามปกติ โดยไม่สร้าง Journal/GL อัตโนมัติ

**เกณฑ์ผ่าน:** เปิดใช้เฉพาะโมดูลที่ Workspace ต้องการได้ โดยข้อมูลธุรกรรมต้นทางยังเป็น Source of Truth และการเปิดโมดูลภายหลังสามารถ Backfill/Import ตามนโยบายได้โดยไม่แก้ไขประวัติเดิม

---

## 4. Domain Modules ที่แนะนำ

แยกเป็น Business Modules ใน Modular Monolith ไม่รวมทุกอย่างไว้ใน Core

| Module | ความรับผิดชอบ |
|---|---|
| store | ข้อมูลร้าน สาขา ช่องทางขาย และการเผยแพร่ |
| catalog | หมวดหมู่ สินค้า Variant SKU Barcode รูปภาพ |
| pricing | Price List ราคาโปรโมชั่น และส่วนลด |
| inventory | คลัง Stock Ledger Reservation Transfer Adjustment |
| purchasing | Supplier Purchase Order และรับสินค้า |
| sales | Order, Order Item, Fulfillment และ Return |
| payments | Payment, Refund, Payment Provider |
| pos | Cashier Shift, Register, POS Workflow, Receipt |
| customers | Customer Profile และประวัติซื้อ |
| tax | Tax Profile, Tax Rule, Tax Snapshot และเอกสารภาษี |
| reports | Sales, Inventory Valuation, Cost, Profit และ Tax Reports |
| notifications | Email/ข้อความแจ้ง Order และสถานะ |
| integrations | Marketplace, Shipping, Payment และ Accounting Connectors |

**กติกาขอบเขต Module**
- Module อื่นเรียกผ่าน Service/API Contract ที่เปิดเผย ไม่เขียนตารางของกันและกันโดยตรง
- Order ใช้ Application Service/Contract ของ Pricing, Inventory และ Payment
- รายงานอ่านจาก Snapshot/Ledger หรือ Read Model ไม่แก้ธุรกรรมต้นทาง
- ทุก Module ประกาศ Manifest, Permission Keys, Navigation และ Migration ตาม Module Contract ของ SyncUp

---

## 5. Data Model ที่ต้องออกแบบ (ระดับแนวคิด)

### Store & Catalog
- Store, Branch, Warehouse
- Workspace Catalog: Product, ProductVariant, ProductImage, Barcode
- UnitOfMeasure (Workspace), VariantUOM (หน่วยฐาน/หน่วยขาย/หน่วยรับซื้อและ Conversion Factor)
- Store-specific assortment: StoreProduct, StoreCategory, StoreProductCategory
- PriceList, ProductPrice (แยกราคาตามหน่วยขาย)

### Inventory & Cost
- StockBalance (ยอดคงเหลือเพื่ออ่านเร็ว)
- StockMovement (Ledger ต้นทาง)
- StockReservation
- StockTransfer, StockAdjustment
- InventoryCostLayer หรือ CostHistory ตามวิธีคิดต้นทุน

### Sales & Payment
- Order, OrderItem, OrderAddress
- Payment, PaymentTransaction, Refund
- Fulfillment, Shipment, Return, ReturnItem
- Receipt / DocumentSequence
- CashierShift, CashMovement, POSRegister

### Tax & Reports
- TaxProfile, TaxRate/TaxRule
- OrderTaxSnapshot, DocumentTaxSnapshot
- Expense (ระยะถัดไป)
- ReportJob / ExportJob (เมื่อข้อมูลมีปริมาณมาก)

> ต้องทำ ERD และ Migration Review ก่อนสร้างตารางจริง โดยเฉพาะ Variant, Stock Ledger, Order Item Snapshot, Payment และ Tax Snapshot

---

## 6. กฎธุรกิจสำคัญ

1. **เงิน:** ใช้ Decimal; Tax Rounding ระดับ Document Level และ HALF_UP (THB 2 ตำแหน่ง); เก็บค่าฐาน/ภาษี Snapshot ก่อนและหลังปัด
2. **VAT:** แยกยอดก่อน VAT, VAT, ยอดรวม และระบุ Inclusive/Exclusive ต่อเอกสาร
3. **กำไร:** Gross Profit ไม่ใช่ยอดรับเงินลบราคาทุน ต้องหักส่วนลด/คืนสินค้าและไม่รวม VAT ในยอดขายสุทธิ
4. **ต้นทุน:** เก็บ Cost Snapshot ต่อ Order Item เพื่อให้รายงานย้อนหลังไม่เปลี่ยนเมื่อรับสินค้าใหม่
5. **สต๊อก:** Stock Movement เป็นหลักฐานต้นทาง; Stock Balance เป็นยอดสรุปที่ Reconcile ได้
6. **การจอง:** Order ที่ยังไม่ชำระมี Reservation Timeout และคืนสต๊อกอัตโนมัติ
7. **Concurrency:** ตัด/จองสต๊อกใน DB Transaction พร้อมป้องกันคำขอซ้ำ
8. **คืนสินค้า:** คืนเข้าสต๊อกหลังตรวจรับและระบุสภาพสินค้า
9. **ความปลอดภัย:** Public API ส่งเฉพาะข้อมูลเผยแพร่ ไม่ส่งต้นทุน/สต๊อกละเอียด/ข้อมูลลูกค้าภายใน
10. **Privacy:** Guest Customer เก็บเท่าที่จำเป็น มีนโยบายเก็บ/ลบ/ส่งออก
11. **Audit:** ปรับราคา ต้นทุน สต๊อก ภาษี Void และ Refund ต้องระบุผู้กระทำ เหตุผล และเวลา
12. **เลขเอกสาร:** สร้างแบบ Atomic ป้องกันเลขซ้ำเมื่อขายพร้อมกัน
13. **เวลา:** บันทึก Timestamp เป็น UTC แสดงผลตาม Timezone ร้าน
14. **Idempotency:** Checkout, Payment Webhook, POS Submit และ Refund ต้องรองรับการส่งซ้ำ

---

## 7. Permission เบื้องต้น

| Role | งานหลัก |
|---|---|
| Owner | ทุกอย่าง รวมตั้งค่าร้าน ภาษี ผู้ใช้ และรายงานการเงิน |
| Admin | จัดการระบบร้านและผู้ใช้ตามขอบเขตที่ Owner มอบหมาย |
| Manager | สินค้า สต๊อก Order อนุมัติปรับปรุง/คืนสินค้า และรายงาน |
| Cashier | POS เปิด/ปิดกะ ขาย รับชำระ พักบิล และดูรายการตามสิทธิ์ |
| Inventory Staff | รับเข้า โอนคลัง ปรับสต๊อก และดูต้นทุนตามสิทธิ์ |
| Accountant | ดูรายงานการเงิน ภาษี เอกสาร และ Export |

ตัวอย่าง granular permission keys: catalog.product.read, catalog.product.write, inventory.adjust.approve, pos.sale.create, sales.refund.approve, reports.profit.read, tax.settings.write

---

## 8. Testing, Security & Production Readiness

ทำควบคู่กับทุก Phase

- [ ] Unit Tests: ราคา ส่วนลด VAT ต้นทุน กำไร State Transition, Quantity Decimal (0–3 ตำแหน่ง), Unit Conversion และราคาแยกหน่วย
- [ ] Integration Tests: ขายสินค้าหน่วยฐาน/หน่วยแพ็ก เช่น เบียร์ 1 ขวดและ 1 ลัง; ตรวจยอดตัดสต๊อกหน่วยฐาน, ราคาแยกหน่วย, WAC และ Order Snapshot
- [ ] Integration Tests: Order + Payment + Inventory Transaction รวมทดสอบรับเข้า/ขาย/โอน/จองด้วย Quantity ทศนิยมและตรวจ Stock Balance ตรงกัน
- [ ] Tenant Isolation Tests: Workspace A อ่าน/แก้ Workspace B ไม่ได้
- [ ] RBAC Tests สำหรับทุก Endpoint ที่เปลี่ยนข้อมูล
- [ ] Public API Tests ว่าไม่เปิดเผยต้นทุน/ข้อมูลภายใน
- [ ] Concurrency Tests: Stock Reservation, Payment และ Document Sequence
- [ ] Idempotency Tests: Double Click และ Webhook Retry
- [ ] E2E: Admin เพิ่มสินค้า → Public ดูสินค้า → Checkout → Admin จัดการ Order
- [ ] E2E: POS เปิดกะ → ขาย → ชำระ → ใบเสร็จ → ปิดกะ
- [ ] Backup/Restore Drill ของ Tenant Database
- [ ] Auth Security Tests: Forgot Password ไม่เปิดเผยการมีอยู่ของบัญชี, Token หมดอายุ/ใช้ซ้ำ/ถูกแก้ไขต้องใช้ไม่ได้, Rate Limit, Email Delivery Failure และ Session Invalidation ตามนโยบาย
- [ ] Google Sign-In Tests: ID Token ผิดลายเซ็น/issuer/audience/nonce/หมดอายุ, callback state mismatch, redirect URI ไม่อนุญาต, บัญชี Google ยังไม่เชื่อม/อีเมลซ้ำ, การเชื่อมบัญชีต้องยืนยันเจ้าของบัญชีเดิม, Workspace Membership/RBAC และการยกเลิกสิทธิ์
- [ ] Rate Limit, CSRF, CORS, Secure Cookie, Input Validation และ Upload Security
- [ ] Structured Logs, Request ID, Audit Trail และ Error Monitoring
- [ ] Performance Test: Catalog, Search, Checkout และ POS
- [ ] Data Retention/Privacy และ Data Export
- [ ] ตรวจสอบภาษี/เอกสารกับผู้เชี่ยวชาญก่อนใช้งานจริง

---

## 9. วิธีทำงานในโปรเจกต์

วงจรการทำงานทีละรายการ:

1. เลือกงานถัดไปที่ยังไม่เสร็จและตรวจ Dependency
2. สรุป Scope, UX, Data Model, API Contract และ Acceptance Criteria ก่อนแก้โค้ด
3. ทำ Migration/API/UI เฉพาะงานนั้น
4. รัน Typecheck, Lint, Unit/Integration Tests ที่เกี่ยวข้อง
5. ทดสอบ Dev และตรวจ Tenant/RBAC
6. อัปเดต Checkbox และบันทึก Decision/ข้อจำกัด
7. Commit เป็นชุดงานที่อธิบายได้ ก่อนเริ่มงานถัดไป

### Definition of Done
- [ ] Backend Validation และ Authorization ครบ
- [ ] UI มี Loading, Empty, Error และ Success State
- [ ] มี Test สำหรับ Business Rules ที่เปลี่ยน
- [ ] ไม่ทำให้ Module อื่นเสีย
- [ ] Migration มีแนวทาง deploy และ recovery
- [ ] เอกสารและ Checkbox ตรงกับความจริง

---

## 10. ลำดับงานถัดไป (Next steps)

1. **P0 — Stabilize Foundation:** API Boot ผ่านทุก Module, Login/Session, Workspace Provisioning, Tenant DB Registry และ RBAC ใช้งานจริง พร้อม Smoke Tests
2. **P0 — Product Decisions:** ยืนยันแล้ว — Workspace มีหลาย Store, Store มีหลาย Branch, Variant, VAT configurable ต่อ Store, Moving Weighted Average, Manual + Gateway Payments
3. **P0 — Review Domain ERD:** ปรับเป็น Design Review v8 แล้ว; ยืนยัน Catalog กลางระดับ Workspace, SKU unique ทั้ง Workspace, StoreProductVariant, shared Product/Variant Master, Store-specific price/assortment/Category, Default Branch/Warehouse, Opening Stock + Direct Receiving, Quantity Decimal สูงสุด 3 ตำแหน่ง, Custom UOM/Variant Conversion/ราคาขายแยกหน่วย, Partial Payment/Deposit, Tax Document Level + HALF_UP และ Partial Return แล้ว; รอทบทวนรายละเอียดก่อน Migration sign-off
4. **P0 — API Contracts & Tenant Routing:** Draft v7 อยู่ที่ docs/api/commerce-api-contracts.md; ตรวจ DTO/permission/error/pagination และความสอดคล้องของ Composite Constraints ก่อน Implement
5. **P0 — Tenant Schema Review & Sign-off:** ตรวจ ERD/API Contract, Composite Constraints, Default Branch/Warehouse, Price History และ Stock Constraints; จากนั้นออกแบบ Test Plan สำหรับ CSV Import, Image Upload และ Tenant Provisioning โดยยังไม่สร้าง/ใช้ Migration จนกว่าจะอนุมัติครบ
6. **P1 — Build Store + Catalog Admin:** เริ่มหลัง Foundation ผ่านและ ERD ได้รับการอนุมัติ
7. **P1 — Future Phase: Online Ordering & Payment Verification:** หลัง Catalog, Inventory, Order/Payment Core ผ่านการทบทวน ให้ทำ Guest Checkout, ข้อมูลผู้ซื้อ/ที่อยู่จัดส่ง, Order Tracking และการตรวจยืนยัน Payment Gateway อัตโนมัติด้วย Webhook ที่ตรวจสอบความถูกต้องและรองรับ Idempotency ตาม Phase 5

**ไม่ควรเริ่ม POS หรือรายงานกำไร/ภาษีก่อน Catalog, Inventory Ledger, Order Snapshot และ Costing ผ่านการทบทวน** เพื่อป้องกันการรื้อโครงสร้างข้อมูลภายหลัง

---

## 11. Decision Log

| วันที่ | เรื่อง | สถานะ |
|---|---|---|
| 2026-11-02 | SyncUp Modular Monolith และ Tenant Database แยกต่อ Workspace | ยึดตาม Architecture ปัจจุบัน |
| 2026-11-02 | ลูกค้าดู Public Store ได้โดยไม่ Login | ยืนยันตาม Product Goal |
| 2026-11-02 | POS และ Online ใช้ Catalog/Inventory/Order ชุดเดียวกัน | ข้อเสนอหลัก |
| 2026-11-02 | เริ่มต้น THB และ Asia/Bangkok; override ได้ระดับ Store | ยืนยันเป็นค่าเริ่มต้น |
| 2026-11-02 | Moving Weighted Average แยก Variant + Warehouse | ยืนยันแล้ว |
| 2026-11-02 | Public Store ใช้ /s/{storeSlug} ก่อน Custom Domain | ข้อเสนอเริ่มต้น |
| 2026-11-02 | หนึ่ง Workspace มีหลาย Store และแต่ละ Store มีหลาย Branch | ยืนยันแล้ว |
| 2026-11-02 | VAT configurable ต่อ Store และรองรับ Inclusive/Exclusive | ยืนยันแล้ว |
| 2026-11-02 | รองรับ Manual Payments และ Payment Gateway | ยืนยันแล้ว |
| 2026-11-02 | Online Ordering ใน Phase 5 (Future Phase) | ลูกค้าสั่งซื้อแบบ Guest ได้; เก็บข้อมูลผู้ซื้อ/ผู้รับและที่อยู่เท่าที่จำเป็น; เชื่อม Order กับ Customer โดยไม่บังคับสมัครบัญชี |
| 2026-11-02 | Automatic Payment Verification สำหรับ Online Order | ยืนยันผลผ่าน Gateway Webhook ที่ตรวจลายเซ็น/แหล่งที่มา, ตรวจ Order reference/ยอดเงิน/สกุลเงิน, Idempotency และ Audit Trail; ห้ามถือว่า Redirect กลับหน้าเว็บคือหลักฐานว่าจ่ายสำเร็จ |
| 2026-11-02 | Forgot Password / Password Reset | เพิ่มใน Auth Foundation: ขอรีเซ็ตผ่านอีเมลโดยไม่เปิดเผยว่าบัญชีมีอยู่หรือไม่, Token แบบสุ่มเก็บเป็น Hash ใช้ครั้งเดียวและหมดอายุ, Rate Limit, Audit และนโยบายจัดการ Session หลังเปลี่ยนรหัสผ่าน |
| 2026-11-02 | Google Sign-In | เพิ่มเป็นงาน Auth Foundation ถัดไป: ใช้ OAuth 2.0 / OpenID Connect, ตรวจ ID Token ฝั่ง Server, เชื่อมบัญชีด้วย Google subject, ป้องกันการยึดบัญชีจาก email ซ้ำ, ตรวจ Workspace Membership/RBAC และบันทึก Audit |
| 2026-11-02 | Catalog กลางระดับ Workspace; แต่ละ Store เลือกสินค้าเปิดขายและตั้งราคาแยกกัน | ยืนยันแล้ว: Store หน้าร้านเน้นของชำทั่วไป และ Store ออนไลน์เน้นอุปกรณ์ IoT |
| 2026-11-02 | Category เป็นระดับ Store และ StoreProductCategory เชื่อมสินค้าเข้าหมวดของ Store เดียวกัน | ยืนยันแล้ว; ใช้ composite constraints ป้องกัน cross-store assignment |
| 2026-11-02 | SKU unique ทั้ง Workspace ไม่อนุญาต SKU ซ้ำข้าม Store | ยืนยันแล้ว; enforce ใน Tenant DB และ normalize SKU ก่อนตรวจซ้ำ |
| 2026-11-02 | Store เลือกเปิดขาย Variant เป็นรายตัวผ่าน StoreProductVariant | ยืนยันแล้ว |
| 2026-11-02 | Product/Variant name และ description ใช้ Catalog กลางร่วมกันทุก Store ไม่มี Store override | ยืนยันแล้ว |
| 2026-11-02 | PR/PO/Invoice และระบบบัญชีเป็น Optional Modules เปิด/ปิดแยกกันได้ต่อ Workspace และวางแผนพัฒนาภายหลัง | ยืนยันแนวทาง; ไม่เป็น Dependency ของ Commerce Core/MVP |
| 2026-11-02 | สร้าง Default Branch `สำนักงานใหญ่` และ Default Warehouse `คลังหลัก` อัตโนมัติเมื่อสร้าง Store | ยืนยันแล้ว; Store มี Default Branch หนึ่งแห่ง และแต่ละ Branch มี Default Warehouse หนึ่งแห่ง |
| 2026-11-02 | Opening Stock และ Direct Receiving เป็นวิธีรับสต๊อกเข้า Commerce Core ระยะแรก | ยืนยันแล้ว; ไม่บังคับ Supplier/PO, ทั้งคู่สร้าง Stock Ledger และคำนวณ Moving Weighted Average; Opening Stock Post ได้หนึ่ง Session ต่อ Warehouse |
| 2026-11-02 | Quantity รองรับจำนวนเต็มและทศนิยมทุกหน่วย สูงสุด 3 ตำแหน่ง | ยืนยันแล้ว; ใช้ PostgreSQL NUMERIC(20,3)/Prisma Decimal, API ใช้ decimal string และปฏิเสธค่าที่เกิน 3 ตำแหน่ง |
| 2026-11-02 | Custom UOM, Unit Conversion และราคาขายหลายหน่วย | ยืนยันแล้ว; UOM ระดับ Workspace, Variant กำหนดหน่วยฐาน/หน่วยขายและ conversion factor, Stock Ledger เก็บหน่วยฐาน, ProductPrice แยกตามหน่วยขาย |
| 2026-11-02 | Partial Payment/Deposit | ยืนยันรองรับตั้งแต่ MVP; Order มีหลาย Payment/หลายวิธี, Deposit เป็น Payment ที่ระบุ isDeposit, paidTotal/balanceDue/paymentStatus แยกจาก Order status |
| 2026-11-02 | Tax Rounding | ยืนยัน Document Level + HALF_UP; คำนวณแยก Tax Category/Rate, ปัดภาษีระดับเอกสารตาม currency minor unit (THB 2 ตำแหน่ง) และเก็บ Tax Snapshot |
| 2026-11-02 | Partial Return | ยืนยัน Return/ReturnItem แยกจำนวนรับคืนและจำนวน restock; คืนเงินจากราคา/ส่วนลด/ภาษี Snapshot เดิม; รองรับขาย 1 ลัง 12 ขวด คืน 2 ขวด เหลือ net sold 10 ขวด |
| 2026-11-02 | Return Cost Policy (proposed default) | สินค้า SELLABLE รับกลับด้วยต้นทุน unit_cost_snapshot จาก OrderItem เดิมและคำนวณ WAC ใหม่; DAMAGED/UNSELLABLE ไม่เพิ่ม on_hand และบันทึก disposition/write-off |


### เอกสารออกแบบ
- [Commerce Domain ERD — Design Review v8](docs/architecture/commerce-erd.md)
- [Commerce API Contracts — Draft v7](docs/api/commerce-api-contracts.md)

### ประเด็นที่ยังต้องทบทวนก่อน Migration

- StoreType จะเป็นเพียงค่าเริ่มต้น UX หรือบังคับข้อจำกัดช่องทาง POS/Online (ข้อเสนอปัจจุบัน: เป็นค่าเริ่มต้น UX)
- รายละเอียด Tax Category/Rate และเอกสารภาษีไทยต้องตรวจสอบกับผู้เชี่ยวชาญก่อนใช้งานจริง; วิธีปัดภาษีถูกกำหนดแล้วเป็น Document Level + HALF_UP
- Default Return Cost Policy ที่เสนอใน ERD/API: สินค้า SELLABLE รับกลับด้วยต้นทุนเดิมจาก OrderItem unit_cost_snapshot; DAMAGED/UNSELLABLE ไม่เพิ่ม on_hand และบันทึก disposition/write-off — ต้องทบทวนร่วมกับฝ่ายบัญชีก่อนเปิดใช้งานจริง
- Tax Category/Rate เป็น configurable ตาม effective date; ต้องตรวจสอบ mapping และเอกสารภาษีไทยกับผู้เชี่ยวชาญก่อน production; วิธีปัดถูกยืนยันแล้วเป็น Document Level + HALF_UP


การอัปเดตสถานะโครงการ 2026-11-02 (ตรวจจาก Repository และ Control/Tenant DB ล่าสุด)

### สถานะจริง ณ วันนี้

- **Foundation / Auth / Workspace:** มี Control DB, Auth, Workspace Membership/RBAC, Workspace Provisioning, Tenant DB Registry และ Platform Admin endpoints/UI อยู่ในโค้ดแล้ว; มีการตรวจ Control DB จริงและพบ Workspace A/B ยัง ACTIVE
- **Workspace A/B:** A = `workspace-a-local`, DB `syncup_ws_2a4577ace43c`; B = `workspace-b-local`, DB `syncup_ws_e4199e58d35b`. แต่ละ Workspace มี Owner 1 คน, ไม่มี Module Installation และไม่มี Workspace-specific Role ที่ถูกกำหนดเพิ่ม; Owner ทั้งสองเป็นคนละบัญชีและไม่ใช่ Platform Admin. ยังมี Active Session อย่างน้อยบัญชีละ 1 session จากการตรวจล่าสุด
- **Tenant DB:** ทั้ง A/B มีเพียง `tenant_settings`, `audit_events`, `tenant_migrations`; schema version เป็น `20261031000100_tenant_baseline`. ยังไม่มี Commerce/Product/Inventory/Media tables. Tenant baseline เดิมตรงกับ migration ที่ตรวจแล้ว
- **Commerce Data Model:** มี Tenant Prisma Schema และเอกสาร ERD/API Contract/Approved Decisions/Review/Final Plan แล้ว; การออกแบบ Composite Constraints, Default Branch/Warehouse, Price History, Stock Ledger/Reservation, WAC, Bulk Image Upload และ Provisioning ผ่านการทบทวนเชิงออกแบบตามบันทึกการตัดสินใจ
- **Media:** เพิ่ม `MediaAssetDerivative` และชนิด ORIGINAL/MAIN/THUMBNAIL ใน Prisma Schema แล้ว; Prisma validate ผ่านตามการตรวจล่าสุด. เป็น schema/design change ใน Repository เท่านั้น ยังไม่มี migration หรือ DB deployment
- **Migration:** มี Tenant initial Commerce migration specification และ SQL candidates (Prisma diff + custom constraints) แต่ยังไม่ reconcile เป็น incremental migration candidate ที่ผ่านการตรวจครบ และยังไม่มี Migration Sign-off. ห้าม generate/apply migration หรือ generate Prisma Client จนกว่าจะผ่าน Sign-off
- **Tests / Runtime:** ยังไม่มีหลักฐานว่า Commerce API, CSV Import, Bulk Image Upload, Store/Branch/Warehouse provisioning หรือ Stock/Price services ใช้งานจริงครบ; Docker Engine/DB tooling มีข้อจำกัดจากการตรวจครั้งก่อน จึงยังไม่ถือว่า Commerce runtime ผ่าน acceptance
- **POS Workspace:** ยังไม่ได้สร้าง Workspace POS และยังไม่ได้ระงับ A/B. แนวทางที่ตกลงคือ Suspend A/B และเก็บ Tenant DB เดิมไว้; ต้องเลือก Owner ของ POS ก่อนสร้าง. Provisioning ปัจจุบันตั้งชื่อ Tenant DB อัตโนมัติเป็น `syncup_ws_<uuid suffix>` ไม่รองรับการบังคับชื่อ `syncup_pos_local` ผ่าน flow ปัจจุบัน

### งานที่กำลังทำ / ลำดับถัดไป

1. [ ] เลือก Owner สำหรับ Workspace POS (Owner เดิมของ A หรือ B); ยังห้ามเดาแทนผู้ใช้
2. [ ] ตรวจสอบ/ยืนยัน flow สำหรับสร้าง POS Workspace และ Suspend A/B ผ่าน Platform Admin/Provisioning; หลังได้ Owner จึงดำเนินการและตรวจผล
3. [ ] ทำ Migration SQL Reconciliation: รวม Prisma-generated DDL กับ custom constraints, reconcile กับ baseline จริงของ A/B, ตรวจ extension/permissions/idempotency/order และแยก clean-install diff ออกจาก upgrade migration
4. [ ] ทดสอบ incremental migration candidate บน disposable PostgreSQL ที่มี baseline เดียวกัน; ตรวจ preflight/postflight และ rollback/recovery plan
5. [ ] ขอ Migration Sign-off แยกต่างหากก่อนสร้างหรือ apply migration จริง
6. [ ] หลัง Sign-off จึงค่อย deploy Tenant Commerce schema และเริ่ม implement/test Business APIs ตาม Phase

> หมายเหตุสถานะ: เครื่องหมาย [x] ใน Roadmap หมายถึงข้อกำหนด/การตัดสินใจหรือเอกสารออกแบบเสร็จตามข้อความของรายการนั้น ไม่ได้ยืนยันว่า Feature ถูก implement หรือ deploy แล้ว เว้นแต่ระบุชัดเจนว่าเป็นงานโค้ดและมีผลทดสอบรองรับ

\n