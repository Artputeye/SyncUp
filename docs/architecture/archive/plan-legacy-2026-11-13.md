# SyncUp POS & Commerce — Product Roadmap

> เป้าหมาย: พัฒนา SyncUp เป็นแพลตฟอร์มที่รองรับ POS Workspace และ Online Commerce Workspace แยกจากกันอย่างชัดเจน แต่ใช้ Platform/Control Plane และชุดโค้ดหลักร่วมกันได้ แต่ละ Workspace มี Tenant Database, Catalog, Pricing, Inventory, Customer, Order, Payment, Configuration และ RBAC ของตนเอง ไม่มีการแชร์ข้อมูลธุรกิจข้าม Workspace โดยอัตโนมัติ ลูกค้าทั่วไปเข้าดู Online Store ได้โดยไม่ต้อง Login
>
> สถานะเริ่มต้น: วางแผน (ยังไม่ถือว่าฟีเจอร์เหล่านี้พัฒนาแล้ว)

การตัดสินใจล่าสุด 2026-11-02: Commerce Core รองรับ Opening Stock และ Direct Receiving โดยไม่บังคับ Supplier/Purchase Order; Opening Stock Post ได้หนึ่ง Session ต่อ Warehouse; Quantity รองรับจำนวนเต็มและทศนิยมทุกหน่วยสูงสุด 3 ตำแหน่ง; รองรับ Custom UOM/Unit Conversion และตั้งราคาขายแยกตามหน่วย เช่น เบียร์ขายเป็นขวดและยกลัง; ทั้งคู่ Post ผ่าน Stock Ledger และ Moving Weighted Average
> วิธีทำงาน: ทำทีละ Phase ปิดงานและทดสอบก่อนเริ่ม Phase ถัดไป

---

## 1. Product vision และขอบเขต

### รูปแบบผลิตภัณฑ์: 2 Workspace แยกอิสระ

1. **POS Workspace (ขายหน้าร้าน)** — Workspace สำหรับกิจการที่ขายผ่านหน้าร้าน เน้น Store/Branch/Warehouse, Product Catalog สำหรับ POS, ราคาหน้าร้าน, Stock, Cashier, Register/Shift, Barcode, Checkout, เงินสด/QR, Receipt, Return/Void และการปิดกะ
2. **Online Commerce Workspace (ขายออนไลน์)** — Workspace สำหรับกิจการที่ขายผ่านเว็บไซต์ เน้น Public Store, Online Catalog/Category, รูปภาพและ SEO, ราคาออนไลน์, Cart, Guest Checkout, Payment Gateway, Order Tracking, Fulfillment, Shipping และ Customer
3. **Platform / Control Plane** — ระบบบัญชีผู้ใช้, Login, Workspace Registry/Provisioning, Subscription/Entitlement, Permission framework และการดูแลระบบระดับแพลตฟอร์มเท่านั้น ไม่ใช่ที่เก็บข้อมูลธุรกิจร่วมของสอง Workspace

หนึ่งกิจการสามารถมี POS Workspace และ Online Commerce Workspace แยกกันได้ และแต่ละ Workspace สามารถมีหลาย Store/Branch ตามขอบเขตของตนเอง แต่การมี Workspace สองประเภทไม่ได้หมายความว่าจะใช้สินค้า ราคา สต๊อก ลูกค้า หรือ Order ชุดเดียวกัน

### หลักการแยกขอบเขต

- POS Workspace และ Online Commerce Workspace ต้องเป็นคนละ Workspace ID และคนละ Tenant Database; ห้ามใช้ Tenant DB เดียวกันเพื่อทำให้ดูเหมือนแยกช่องทาง
- Catalog, SKU namespace, Variant, Category, Product Images, Price List, Tax Profile, Stock Ledger/Balance, Warehouse, Customer, Order, Payment, Return, Fulfillment และ Business Audit เป็นข้อมูลเฉพาะ Workspace
- ห้ามอ่าน/เขียน/ค้นหา/รายงานข้อมูลข้าม Workspace โดยอาศัยเพียง Store ID, Product ID หรือ URL; ทุก API ต้องตรวจ Membership, Workspace Scope และ Permission ฝั่ง Server
- Shared code และ common libraries ใช้ร่วมกันได้ แต่ runtime data, tenant schema, migration lifecycle, storage namespace, secrets/configuration และ backup/restore ต้องแยกตาม Workspace
- ไม่ทำ Shared Product Master หรือ Shared Inventory ระหว่าง POS/Online ในรุ่นนี้; หากต้องการนำสินค้าไปใช้อีก Workspace ให้เป็น explicit import/export หรือ Integration ที่มี mapping, preview, approval, idempotency และ audit
- การ Sync ราคา/สต๊อก/Order/Customer ระหว่าง Workspace เป็น Future Integration เท่านั้น ต้อง opt-in รายคู่ Workspace และระบุ Source of Truth, Conflict Resolution และ Failure Recovery ก่อนเริ่ม
- POS และ Online อาจใช้แนวคิด/Domain Contract ร่วมกัน เช่น Money, Tax Calculation, Inventory Ledger และ Order State แต่ไม่ใช้ business records ร่วมกัน
- Public API ของ Online Workspace ส่งเฉพาะข้อมูลที่ Published และไม่เปิดเผยต้นทุน, internal stock, private customer data หรือข้อมูลของ POS Workspace
- ใช้ Decimal สำหรับเงินและ Quantity; Quantity เก็บ PostgreSQL NUMERIC(20,3)/Prisma Decimal สูงสุด 3 ตำแหน่ง
- ทุกการเปลี่ยน Stock/Payment/Refund ต้องมี Ledger หรือ immutable transaction และ Audit Trail
- Procurement และ Accounting ยังคงเป็น Optional Modules เปิดใช้แยกตาม Workspace

### ขอบเขตที่ไม่ทำในรุ่นแรก

- Live shared catalog หรือ shared stock ระหว่าง POS และ Online
- การรวม Order Inbox ข้าม Workspace โดยไม่มี Integration ที่ได้รับอนุมัติ
- Marketplace Sync อัตโนมัติ
- Offline POS แบบเต็มรูปแบบ
- Native Mobile App
- Accounting/GL เต็มรูปแบบ และ E-Tax Integration

## 2. โครงสร้างหน้าเป้าหมาย

### Platform / Authentication
- /login — Login ของผู้ใช้แพลตฟอร์ม
- /workspaces — เลือก Workspace ที่ผู้ใช้เป็นสมาชิก
- /platform — Platform administration เฉพาะผู้มีสิทธิ์ระดับแพลตฟอร์ม
- /workspace/[slug] — เข้า Workspace ที่เลือกและแสดง navigation ตาม Workspace Type

### POS Workspace
- /workspace/[slug]/pos — หน้าขายหน้าร้าน
- /workspace/[slug]/pos/shifts — เปิด/ปิดกะและกระทบยอดเงินสด
- /workspace/[slug]/pos/receipts/[id] — ใบเสร็จ/พิมพ์ซ้ำตามสิทธิ์
- /workspace/[slug]/products — Catalog ของ POS Workspace เท่านั้น
- /workspace/[slug]/inventory — Warehouse/Stock ของ POS Workspace
- /workspace/[slug]/orders — Order ที่เกิดใน POS Workspace
- /workspace/[slug]/settings — Store/Branch/Register/Tax/Payment และผู้ใช้งานของ POS Workspace

### Online Commerce Workspace
- /s/[storeSlug] — Public Store ของ Online Workspace (ไม่ต้อง Login)
- /s/[storeSlug]/products — Online Catalog
- /s/[storeSlug]/products/[productSlug] — Product/Variant detail
- /s/[storeSlug]/cart — Cart
- /s/[storeSlug]/checkout — Guest Checkout
- /s/[storeSlug]/orders/[publicOrderToken] — Order Tracking ด้วย Token ที่เดายาก
- /workspace/[slug]/products — Catalog ของ Online Workspace เท่านั้น
- /workspace/[slug]/orders — Online Orders
- /workspace/[slug]/fulfillment — เตรียมสินค้า/จัดส่ง
- /workspace/[slug]/settings — Online Store, Domain, SEO, Tax, Payment Gateway และ Shipping

> Route อาจใช้ convention ร่วมกันได้ แต่ต้อง derive Workspace Type จาก server-side registry/entitlement และ enforce ที่ API; ห้ามใช้การซ่อนเมนูฝั่ง Browser เป็น security boundary.

## 3. Roadmap ตามลำดับความสำคัญ

## 2.1 Architecture Decision — แยก POS Workspace และ Online Commerce Workspace (2026-11-13)

**การตัดสินใจล่าสุด — ใช้แทนแนวคิด Omnichannel Tenant เดียว**

### Workspace Boundary

| ขอบเขต | POS Workspace | Online Commerce Workspace |
|---|---|---|
| Tenant Database | แยกเฉพาะ POS | แยกเฉพาะ Online |
| Catalog / SKU / Variant | ของ POS เอง | ของ Online เอง |
| Category / Product Images | จัดการตามงานหน้าร้าน | จัดการตาม Online Store/SEO |
| Price / Promotion | ราคาหน้าร้าน | ราคา/โปรโมชั่นออนไลน์ |
| Inventory / Warehouse | สต๊อกหน้าร้านและคลัง POS | สต๊อกสำหรับ Online Fulfillment |
| Customer | ลูกค้าหน้าร้านตามนโยบาย | Guest/Online Customer |
| Order / Payment | POS Sale, Shift, Cash Movement | Online Order, Gateway Transaction |
| Fulfillment | รับสินค้าที่หน้าร้าน/งาน POS | Picking, Packing, Shipping, Tracking |
| Roles / Permissions | Owner/Admin/Manager/Cashier/Inventory | Owner/Admin/Manager/Content/Order Fulfillment |
| Reports | ยอดขายหน้าร้าน/กะ/เงินสด/สต๊อก | Online conversion/order/payment/shipping |

### Shared Platform vs Isolated Business Data

**ใช้ร่วมกันได้ (Platform / Code):**
- User identity และ Authentication
- Workspace Registry, Membership และ Provisioning orchestration
- Shared API contracts, common UI components, validation libraries
- Shared deployment pipeline และ observability framework โดยต้องใส่ Workspace context ใน logs

**ต้องแยกต่อ Workspace:**
- Tenant DB/schema และ Runtime DB credentials
- Product, Variant, SKU, Images metadata, Category และ Price
- Tax settings, Stock, Warehouse, Customer, Order, Payment, Refund และ Fulfillment
- Audit events, import batches, idempotency namespace และ document sequences
- Media storage namespace, encryption/configuration และ backup/restore lifecycle

### Product Track A — POS Workspace

1. **POS-A0 — Workspace foundation:** กำหนด Workspace Type = POS, provisioning template, default permissions/navigation, Tenant DB และ Store/Branch/Warehouse setup
2. **POS-A1 — POS Catalog & Store Operations:** Product/Variant, Barcode, UOM, รูปภาพ, Store assortment, POS price, tax และ stock availability
3. **POS-A2 — Inventory & Costing:** Opening Stock, Receiving, Adjustment, Transfer, Reservation, WAC และ reconciliation
4. **POS-A3 — POS UX & Checkout:** Product discovery, cart, checkout, idempotent sale posting และ payment ledger
5. **POS-A4 — Cashier Operations:** Register, Shift, opening float, cash movement, suspended bills, void/refund permissions
6. **POS-A5 — Receipt & Hardware:** receipt numbering, print/reprint audit, 80mm printer, cash drawer และ device compatibility
7. **POS-A6 — Reports & Readiness:** shift close, cash reconciliation, sales/stock reports, backup/restore, RBAC และ E2E
8. **POS-A7 — Production Activation:** เติมข้อมูลจริงและตรวจราคา/ภาษี/สต๊อก/ตัวตนผู้ขาย พร้อมอนุมัติเปิดใช้งานเฉพาะ POS Workspace

### Product Track B — Online Commerce Workspace

1. **ONL-B0 — Workspace foundation:** กำหนด Workspace Type = ONLINE, provisioning template, public store routing, permissions/navigation และ Tenant DB แยก
2. **ONL-B1 — Online Catalog & Content:** Product/Variant, Category, product images, bulk media import, SEO, publish/unpublish และ storefront theme
3. **ONL-B2 — Online Pricing & Availability:** Online price lists/promotions, tax configuration และ stock policy ที่เป็นของ Online Workspace เอง
4. **ONL-B3 — Storefront & Cart:** Public catalog, search/filter, product detail, variant selection, cart และ guest session
5. **ONL-B4 — Checkout & Payment:** buyer/shipping details, server-side price/tax/availability validation, gateway adapter, webhook signature verification และ idempotency
6. **ONL-B5 — Order Fulfillment:** order inbox, pick/pack, shipment, carrier tracking, cancellation/return/refund และ customer notifications
7. **ONL-B6 — Online Reports & Readiness:** conversion/order/payment/shipping reports, privacy, security, backup/restore และ E2E
8. **ONL-B7 — Production Activation:** domain/SSL, seller identity, policies, payment gateway, shipping rates และอนุมัติเปิด Online Workspace

### Cross-Workspace Integration (Future / Opt-in)

- ไม่ทำให้สอง Workspace แชร์ Tenant DB หรือใช้ foreign key ข้าม Tenant
- เริ่มจาก Catalog Export/Import แบบผู้ใช้สั่งงาน พร้อม mapping SKU, UOM, image, category และ preview ก่อน commit
- หากภายหลังต้อง Sync stock/order ให้ใช้ Integration Service + Outbox/Inbox, external IDs, idempotency, retry/dead-letter และ audit; ไม่ให้ API ของ Workspace หนึ่ง query DB ของอีก Workspace โดยตรง
- ต้องกำหนด Source of Truth และ conflict policy ต่อ entity ก่อนเปิด sync; ค่าเริ่มต้นคือ **ไม่มี sync**
- การรวมรายงานข้าม Workspace ทำผ่าน explicit analytics projection/export ที่ผ่าน permission และ privacy review เท่านั้น

### Execution Order / Dependency

1. Stabilize Platform Identity, Workspace Registry, Provisioning และ Tenant isolation
2. กำหนด Workspace Type/Entitlement และ provisioning templates โดยไม่เปลี่ยน Tenant DB เดิมอัตโนมัติ
3. ทำ POS Workspace ให้พร้อมขายหน้าร้าน (ใช้ POS implementation ที่มีเป็น baseline แต่ตรวจ gaps ตาม POS-A milestones)
4. ทำ Online Workspace แยกและย้าย/นำเข้าข้อมูลเฉพาะเมื่อมี mapping + preview + explicit approval
5. ทดสอบ isolation ระหว่าง POS และ Online: IDOR, cross-workspace API, media access, RBAC, import/export และ logs
6. เปิด Integration ข้าม Workspace เป็นโครงการแยกหลังทั้งสองฝั่งผ่าน readiness แล้วเท่านั้น

### Migration / Data Safety

- Workspace ปัจจุบันที่มีข้อมูลจริงหรือ migration history แล้ว **ห้ามเปลี่ยนประเภทหรือย้ายข้อมูลอัตโนมัติ**
- pos-local คงเป็น POS Workspace candidate ตามบทบาทปัจจุบัน; ต้องตรวจ Workspace Registry และยืนยันประเภทก่อนเปลี่ยน configuration จริง
- Online Workspace ต้องสร้างเป็น Workspace ใหม่พร้อม Tenant DB ใหม่ ไม่ reuse pos-local หรือ Tenant DB ของ POS
- ห้าม copy Product/Price/Stock/Customer/Order ระหว่าง Workspace โดยไม่ผ่าน export preview, field mapping, duplicate handling และการอนุมัติ
- การเปลี่ยน Workspace Type, provision Tenant DB, migration, RBAC หรือ data import ต้องมี target Workspace ชัดเจนและ approval แยกจากการแก้เอกสารแผน


- **P0 — Foundation/Blocker:** ต้องทำก่อน เป็นฐานของระบบ
- **P1 — MVP:** จำเป็นต่อการเปิดร้านและเริ่มขาย
- **P2 — Operational:** ทำให้การปฏิบัติงานครบขึ้น
- **P3 — Advanced:** ส่วนขยายหลัง MVP และผ่านการใช้งานจริง

### Phase 0 — Product decisions & Foundation audit (P0)

- [x] 0.1 ตรวจสถานะ Auth, Workspace Provisioning, Tenant DB Registry และ RBAC — Read-only audit completed 2026-11-05; partial pass and remaining gaps recorded in `docs/architecture/foundation-audit-2026-11-05.md`.
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
- [x] 2.10 Opening Stock: บันทึกยอดตั้งต้นเป็น Session ต่อ Warehouse พร้อม quantity และ unit cost; แต่ละ Warehouse Post ได้เพียงหนึ่ง Session (API/UI/E2E implemented 2026-11-10)
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

แยกเป็น Business Modules ใน Modular Monolith โดยใช้ Source Code/Contracts ร่วมกันได้ แต่ทุก Business Module ทำงานภายใต้ Workspace/Tenant context เดียวต่อ request และอ่าน/เขียนได้เฉพาะ Tenant Database ของ Workspace นั้น ไม่ใช่การแชร์ข้อมูลระหว่าง POS กับ Online

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

ตัวอย่าง granular permission keys ต้องมี Workspace scope เสมอ: commerce.product.view/update, inventory.adjust.approve, pos.sale.create, pos.shift.close, online.store.publish, online.order.fulfill, online.payment.refund, sales.refund.approve, reports.profit.read, tax.settings.write; Role/Navigation ของ POS และ Online แยกตาม Workspace Type และห้ามให้ permission ใน Workspace หนึ่งขยายไปอีก Workspace

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

ลำดับใหม่ยึด Architecture Decision 2026-11-13: POS และ Online เป็นคนละ Workspace/Tenant Database ไม่ใช่ Store/Channel ภายใน Tenant เดียวกัน

1. **P0 — Platform Workspace Typing:** ออกแบบ Workspace Type (POS, ONLINE) และ Entitlement/Provisioning Template, Navigation/Permission profile; รองรับ Workspace เดิมแบบ backward-compatible และห้าม auto-convert
2. **P0 — Tenant Isolation:** ทดสอบ Workspace ID → Tenant DB routing, Runtime credentials, media namespace, logs, cache keys, idempotency และ cross-workspace denial
3. **P1 — POS Workspace:** ใช้ pos-local เป็น candidate สำหรับตรวจสอบ POS; ทำ POS-A0 ถึง POS-A7 โดยเริ่มจาก readiness gaps (Cashier Shift, cash reconciliation, product/price/tax/stock data, backup protection) ก่อน Production Activation
4. **P1 — Online Workspace:** ออกแบบ Workspace ใหม่และ Tenant DB ใหม่; ทำ ONL-B0 ถึง ONL-B7 โดยเริ่ม provisioning + catalog/content + public storefront แล้วจึง checkout/payment/shipping
5. **P1 — Catalog Import/Export:** ทำ explicit transfer ระหว่าง Workspace แบบ Preview/Mapping/Approval/Audit; ไม่ทำ live shared catalog หรือ stock sync เป็นค่าเริ่มต้น
6. **P2 — Cross-Workspace Integration (Optional):** หลัง POS และ Online ผ่าน production readiness แล้ว ค่อยพิจารณา Outbox/Inbox integration สำหรับ stock/order/customer ตาม Source of Truth ที่ตกลง
7. **P2 — Consolidated Reporting (Optional):** ทำ analytics projection แยกจาก transactional DB พร้อม permission/privacy review

**สิ่งที่ห้ามทำระหว่างแผนนี้:** ห้ามเปลี่ยน pos-local หรือ Workspace ที่มีข้อมูลอยู่ให้เป็น Online, ห้าม reuse Tenant DB ระหว่าง POS/Online, ห้ามย้ายหรือคัดลอกข้อมูลจริง และห้าม Apply Migration/RBAC/Provisioning/Deploy โดยอาศัยเพียงการอนุมัติแก้ plan.md.

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



| 2026-11-13 | Architecture split: POS Workspace vs Online Commerce Workspace | **ยืนยันเป็นทิศทางล่าสุด** — คนละ Workspace ID และ Tenant DB; แยก Catalog/SKU/Price/Tax/Inventory/Customer/Order/Payment/Media/RBAC/Reports; ใช้ Platform identity และ source code ร่วมกันได้ แต่ไม่มี business-data sharing/sync โดยปริยาย; Integration เป็น opt-in ในอนาคต |
| 2026-11-13 | Supersede previous Omnichannel shared-data assumption | **ยกเลิกแนวคิดเดิม** ที่ POS และ Online ใช้ Product Catalog, Inventory, Customer และ Order ชุดเดียวกันภายใน Workspace เดียว; Decision Log วันที่ 2026-11-02 เป็นประวัติการตัดสินใจเดิม ไม่ใช่ข้อกำหนดปัจจุบัน |
| 2026-11-13 | Workspace Type and migration safety | Workspace Type (POS/ONLINE) จะกำหนด Navigation/Permission/Provisioning template; Workspace เดิมไม่ถูกแปลงอัตโนมัติ; Online ต้องเป็น Workspace/Tenant DB ใหม่ และการย้ายข้อมูลต้องมี Preview + Mapping + Approval |

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

- **Foundation / Auth / Workspace:** มี Control DB, Auth, Workspace Membership/RBAC, Workspace Provisioning, Tenant DB Registry, Platform Admin endpoints/UI และ Tenant API (`GET /api/tenant/:workspaceId/settings`) อยู่ในโค้ดแล้ว; ทดสอบ HTTP Authentication, tenant isolation และ Workspace status gate ผ่าน
- **Workspace A/B:** A = `workspace-a-local`, DB `syncup_ws_2a4577ace43c`; B = `workspace-b-local`, DB `syncup_ws_e4199e58d35b`. ทั้งสอง Workspace มี Owner คนละบัญชี และถูกเปลี่ยนสถานะเป็น `SUSPENDED` แล้ว; ตรวจยืนยันว่า Tenant DB ทั้งสองยังคงอยู่ ไม่ได้ลบหรือแก้ข้อมูลภายใน. User Session ยังคงเป็นระดับ User; การระงับสิทธิ์ทำผ่าน Workspace status gate
- **Tenant DB:** ทั้ง A/B มีเพียง `tenant_settings`, `audit_events`, `tenant_migrations`; schema version เป็น `20261031000100_tenant_baseline`. ยังไม่มี Commerce/Product/Inventory/Media tables. Tenant baseline เดิมตรงกับ migration ที่ตรวจแล้ว
- **Commerce Data Model:** มี Tenant Prisma Schema และเอกสาร ERD/API Contract/Approved Decisions/Review/Final Plan แล้ว; การออกแบบ Composite Constraints, Default Branch/Warehouse, Price History, Stock Ledger/Reservation, WAC, Bulk Image Upload และ Provisioning ผ่านการทบทวนเชิงออกแบบตามบันทึกการตัดสินใจ
- **Media:** เพิ่ม `MediaAssetDerivative` และชนิด ORIGINAL/MAIN/THUMBNAIL ใน Prisma Schema แล้ว; Prisma validate ผ่านตามการตรวจล่าสุด. เป็น schema/design change ใน Repository เท่านั้น ยังไม่มี migration หรือ DB deployment
- **Migration:** มี Tenant initial Commerce migration specification และ SQL candidates (Prisma diff + custom constraints) แต่ยังไม่ reconcile เป็น incremental migration candidate ที่ผ่านการตรวจครบ และยังไม่มี Migration Sign-off. ห้าม generate/apply migration หรือ generate Prisma Client จนกว่าจะผ่าน Sign-off
- **Tests / Runtime:** ยังไม่มีหลักฐานว่า Commerce API, CSV Import, Bulk Image Upload, Store/Branch/Warehouse provisioning หรือ Stock/Price services ใช้งานจริงครบ; Docker Engine/DB tooling มีข้อจำกัดจากการตรวจครั้งก่อน จึงยังไม่ถือว่า Commerce runtime ผ่าน acceptance
- **POS Workspace:** สร้าง `pos-local` แล้ว โดย Owner A (`owner-a@syncup.local`) เป็น Owner; Workspace ACTIVE และใช้ Tenant DB ที่ Provisioning ตั้งชื่ออัตโนมัติ. Workspace A/B ถูก Suspend และเก็บ Tenant DB เดิมไว้

### งานที่กำลังทำ / ลำดับถัดไป

1. [x] เลือก Owner สำหรับ Workspace POS: Owner A (`owner-a@syncup.local`) ยืนยันแล้วเมื่อ 2026-11-03
2. [x] สร้าง POS Workspace `pos-local` ด้วย Owner A; Provisioning และ Tenant DB Registry เชื่อมต่อฐานข้อมูลแยกด้วย Runtime Role ได้
3. [x] ทดสอบ Tenant API ผ่าน HTTP จริง: unauthenticated=401, Owner A อ่าน Workspace A=200, cross-tenant=403, Owner B อ่าน Workspace B=200, suspended Workspace=403; ทดสอบ service-level status gate ผ่าน
4. [x] Suspend Workspace A/B โดยเก็บ Tenant DB เดิมไว้; ตรวจสอบสถานะ `SUSPENDED` และ database existence สำเร็จ
5. [~] ทำ Migration SQL Reconciliation: สร้าง Prisma clean-install DDL candidate และ custom constraints candidate; จัดการ TIMESTAMPTZ และเพิ่ม canonical normalized-key constraints แล้ว แต่ยังต้องปิด effective-date overlap, branch/warehouse lifecycle, inventory/posting invariants และทำ incremental upgrade candidate
6. [ ] ทดสอบ incremental migration candidate บน disposable PostgreSQL ที่มี baseline เดียวกัน; ตรวจ preflight/postflight และ rollback/recovery plan
7. [ ] ขอ Migration Sign-off แยกต่างหากก่อนสร้างหรือ apply migration จริง
8. [ ] หลัง Sign-off จึงค่อย deploy Tenant Commerce schema และเริ่ม implement/test Business APIs ตาม Phase

### ความคืบหน้าการดำเนินการ 2026-11-03 — Tenant API และ Suspend

- Tenant API ผ่าน HTTP test: unauthenticated 401, own workspace 200, cross-tenant 403, suspended workspace 403; service-level suspension test ผ่าน
- Workspace A/B ถูก Suspend จริง; ตรวจยืนยันทั้งสองสถานะเป็น SUSPENDED และ Tenant DB เดิมยังคงอยู่
- POS Workspace `pos-local` ยังคง ACTIVE

### ความคืบหน้าการดำเนินการ 2026-11-03 — Migration Reconciliation

- `prisma validate --schema prisma/tenant/schema.prisma` ผ่านด้วย Prisma CLI 6.16.2 (ใช้ placeholder TENANT_DATABASE_URL สำหรับ validation เท่านั้น)
- สร้าง `docs/architecture/tenant-commerce-clean-install.candidate.sql` จาก `prisma migrate diff --from-empty`; เป็น Prisma DDL candidate เท่านั้น ไม่ใช่ migration ที่ deploy ได้ และไม่รวม baseline 3 ตาราง
- สร้าง `docs/architecture/tenant-commerce-custom-constraints.candidate.sql` เป็นข้อเสนอ partial unique indexes และ CHECK constraints; ยังไม่ได้ทดสอบกับ PostgreSQL และห้าม apply
- สร้าง `docs/architecture/tenant-commerce-migration-reconciliation.md` สรุป input, scope gap, clean-install vs incremental strategy และ verification gate
- แก้ Tenant Prisma DateTime ทุกฟิลด์เป็น native `@db.Timestamptz(3)` ตาม ERD แล้ว; `prisma validate` ผ่านและ regenerate clean-install candidate เรียบร้อย
- พบ gap อื่น: default Branch/Warehouse uniqueness, minimum Warehouse per Branch, normalized keys, effective-date overlap, inventory arithmetic checks และ Order/Payment/Return เป็น ERD scope ที่ยังไม่อยู่ใน Tenant Prisma schema
- เพิ่ม `Store.normalizedSlug` แบบ unique และเปลี่ยน uniqueness ของ Store slug จาก raw slug เป็น normalized slug; เพิ่ม CHECK candidate บังคับ normalized Store slug, Category slug, SKU, Barcode และ UOM code ให้เท่ากับ `lower(btrim(raw_value))`
- Regenerate clean-install candidate จาก schema ล่าสุด; `prisma validate` ผ่านด้วย Prisma CLI 6.16.2
- Normalization ยังต้องใช้ shared canonicalization function ใน API/CSV/Image Import และทดสอบทุก write path; ProductPrice/TaxRate exclusion candidate เพิ่มแล้วแต่ต้องทดสอบ btree_gist; TaxProfile selection และ branch/warehouse lifecycle ยังเปิดอยู่
- ยังไม่มี incremental-upgrade SQL ที่ผ่าน reconciliation; baseline SQL เป็น standalone file ไม่ใช่ Prisma migration history ที่ใช้เป็น authoritative `--from-migrations` source ได้โดยตรง
- ไม่มีการ Generate Prisma Client, Apply Migration หรือเชื่อมต่อ/แก้ไข Tenant DB จริงในขั้นตอนนี้

### ความคืบหน้าการดำเนินการก่อนหน้า 2026-11-03

- ยืนยัน Owner A (`owner-a@syncup.local`) เป็น Owner ของ POS; บัญชี ACTIVE และไม่ใช่ Platform Admin
- ตรวจ Control DB แบบอ่านอย่างเดียว: Workspace A/B ยัง ACTIVE, Owner A/B ถูกต้อง, มี Active Session อย่างละ 1; ยังไม่พบ `pos-local`
- ตรวจ Tenant DB A/B แบบ read-only: ยังคงผูกกับ DB เดิม `syncup_ws_2a4577ace43c` และ `syncup_ws_e4199e58d35b`; มีเฉพาะ Baseline 3 ตารางและ Migration `20261031000100_tenant_baseline`
- เพิ่ม Workspace ACTIVE guard ใน `WorkspacesService.membershipFor()` เพื่อปฏิเสธการจัดการสมาชิก/บทบาทเมื่อ Workspace ไม่ ACTIVE; `npm run build --prefix apps/api` ผ่าน
- **ยังไม่ได้สร้าง POS Workspace, ยังไม่ได้ Suspend A/B, ไม่มีการเปลี่ยน Tenant DB/ข้อมูล และไม่มีการ apply migration**
- ประเด็นต้องแก้ก่อน Suspend: metadata username ของ Tenant DB A/B เป็น `syncup_provisioner` แต่ `WorkspaceDatabaseRegistry` ตรวจรูปแบบ `syncup_rt_<12 hex>`; ต้องตรวจและ reconcile provisioning identity/credential mapping ก่อนยืนยันเส้นทางใช้งานจริง
- ตรวจเพิ่มแบบ read-only: Tenant DB ทั้งสองมี owner เป็น `syncup_provisioner`, มี Baseline 3 ตาราง และไม่มี Runtime Role `syncup_rt_<12 hex>`; Control DB มี `secretCipher` ว่างทั้งคู่. `WORKSPACE_DATABASE_ADMIN_URL` เชื่อมต่อได้ แต่ PostgreSQL role `syncup_provisioner` ไม่มี `CREATEROLE`; การ Provision A จึงหยุดที่ `CREATE ROLE` ก่อนสร้าง/แก้ Runtime Credential. คืนสถานะ A เป็น `ACTIVE` หลัง Provisioning error (เดิม ACTIVE); B ไม่ได้เริ่ม Provisioning.
- ปรับ `WorkspaceProvisioningService` ไม่ให้เปลี่ยน Workspace ที่เดิม ACTIVE เป็น FAILED เมื่อ Provisioning ล้มเหลว; จะตั้ง FAILED เฉพาะ Workspace ที่เริ่มจาก PROVISIONING. `npm run build` ต้องตรวจซ้ำหลังการแก้ไขนี้.
- **ยังไม่มีการสร้าง Runtime Role, ไม่มีการเขียน Credential ใหม่, ไม่มีการเปลี่ยนสิทธิ์ DB, ไม่มี POS Workspace และไม่มีการ Suspend A/B.** ต้องกำหนด Admin DB credential ที่มี `CREATEROLE` (แยกจาก Runtime Role) ก่อนทำ Credential Reconciliation ต่อ
- ตรวจเพิ่มรอบ 2026-11-03: `WORKSPACE_DATABASE_RUNTIME_URL` เชื่อมต่อได้ในฐานะ `syncup_runtime` แต่ไม่มี `CREATEROLE`/`CREATEDB`; ไม่มี Admin credential อื่นใน Environment ที่ตรวจพบ. จึงยังไม่มีบัญชีที่ได้รับสิทธิ์พอสร้าง Runtime Roles. ห้ามยกระดับ `syncup_provisioner` หรือ `syncup_runtime` เองจากแอป.
- ตรวจ Status Gate: `RbacService.hasPermission()` และ `WorkspaceDatabaseRegistry.forMembership()` กรองเฉพาะ Workspace `ACTIVE`; `WorkspacesService.membershipFor()` ก็ปฏิเสธ Workspace ที่ไม่ ACTIVE. อย่างไรก็ตาม ยังไม่มีการเรียก `WorkspaceDatabaseRegistry.forMembership()` จาก Tenant route/service ใน `apps/api/src` ณ ตอนตรวจ จึงต้องผูก Registry เข้ากับ Tenant request path ก่อนถือว่า Tenant API enforcement ครบ. ไม่เพิกถอน User Session แบบ global เมื่อ Suspend เพราะ Session เป็นระดับ User ไม่ใช่ Workspace; การเข้าถึง Workspace ต้องถูกปฏิเสธจาก Membership/Status gate.
- ตรวจยืนยันหลังการทดลอง: A/B ยังคง `ACTIVE`, `secretCipher` ยังว่าง, POS `pos-local` ยังไม่มี; ไม่มี Runtime Role ถูกสร้างและไม่มี DB permission/tenant data เปลี่ยนแปลง. `npm run build` และ `git diff --check` ผ่าน

> หมายเหตุสถานะ: เครื่องหมาย [x] ใน Roadmap หมายถึงข้อกำหนด/การตัดสินใจหรือเอกสารออกแบบเสร็จตามข้อความของรายการนั้น ไม่ได้ยืนยันว่า Feature ถูก implement หรือ deploy แล้ว เว้นแต่ระบุชัดเจนว่าเป็นงานโค้ดและมีผลทดสอบรองรับ



---

## ความคืบหน้าการดำเนินการ 2026-11-04 — Commerce Lifecycle, Runtime Security และ Migration Verification

 Repository และผลทดสอบบน Disposable PostgreSQL เท่านั้น ไม่ได้หมายความว่ามีการ Deploy Commerce Migration หรือแก้ไขฐานข้อมูล Tenant จริง

### Store / Branch / Warehouse Lifecycle

- [x] เพิ่ม shared canonicalization utility ที่ `apps/api/src/shared/canonicalization.ts`; กำหนดกติกา normalize Store/Category slug, SKU, Barcode, UOM และ Branch/Warehouse code ให้ใช้ร่วมกัน
- [x] เพิ่ม Store creation แบบ Transactional พร้อม Default Branch และ Default Warehouse
- [x] เพิ่มการสร้าง Branch พร้อม Default Warehouse และการสร้าง Warehouse ภายใต้ Branch
- [x] เพิ่มการกำหนด Default Branch/Default Warehouse โดย Lock parent row, ทำใน Transaction และบันทึก AuditLog
- [x] เพิ่ม Archive Warehouse: ป้องกันการ Archive คลังที่ยังเป็นคลัง Active สุดท้าย และเลือก Default Warehouse ทดแทน
- [x] เพิ่ม Archive Branch: ป้องกันการ Archive สาขา Active สุดท้าย, ตรวจ Stock Balance ที่ on_hand/reserved ไม่เป็นศูนย์, Archive Warehouses ลูกและ Branch แบบ Transactional พร้อมเลือก Default Branch ทดแทน
- [x] เพิ่ม Permission `commerce.store.manage` ใน WorkspacesService และ Control DB migration `202611030001_commerce_store_manage`
- [x] เพิ่ม Tenant API routes สำหรับ Store/Branch/Warehouse create, set-default และ archive ตาม Service ที่ implement
- [x] เพิ่ม `apps/api/scripts/verify-tenant-lifecycle-http.cjs` และ `test:tenant-lifecycle-http`; ทดสอบ HTTP routing ของครบทั้ง 7 mutation endpoints ด้วย production AuthGuard/RbacGuard, anonymous/cross-workspace/missing-permission denial, status contracts และ domain error mapping — PASS (ใช้ mocked service providers; ไม่ใช่การทดสอบกับ Tenant DB จริง)
- [x] เพิ่ม `verify-tenant-lifecycle-service.cjs` และ `test:tenant-lifecycle-service`; ทดสอบบน Disposable PostgreSQL จริง: create Store/Branch/Warehouse, audit persistence, concurrent default switching, archive/default replacement, last-active guards และ transaction rollback — PASS
- [x] Raw SQL lifecycle inserts ระบุ UUID ด้วย `gen_random_uuid()` สำหรับ Store/Branch/Warehouse/AuditLog เนื่องจาก Prisma `uuid()` เป็น client-side default
- [x] เพิ่ม service/database test ยืนยันว่า `stock_balances.reserved > 0` ป้องกันการ Archive Branch — PASS บน Disposable PostgreSQL
- [ ] ยังต้องทดสอบ Stock Reservation lifecycle/concurrency โดยตรงเมื่อ Reservation API ถูก implement
- [ ] ทบทวนการ guard Stock Reservation ให้สอดคล้องกับ reserved balance ก่อนเปิดใช้งานจริง

### Tenant Migration Verification

- [x] เพิ่ม Disposable Tenant migration harness: `apps/api/scripts/verify-tenant-migrations.cjs` และคำสั่ง `test:tenant-migrations`
- [x] ทดสอบ Clean install และ Incremental upgrade บน Disposable PostgreSQL: Lifecycle constraints, atomic default replacement, baseline ledger retention, migration ledger และ duplicate-application guard — PASS
- [x] เพิ่ม Control DB backup/restore rehearsal: `apps/api/scripts/verify-control-migration-backup-restore.cjs`; ทดสอบ Migration idempotency, permission scope และ Restore Tenant schema/Commerce ledger/sentinel data ไปยัง isolated database — PASS
- [x] เพิ่ม Runtime grants verification: `apps/api/scripts/verify-runtime-grants.cjs`; ยืนยัน Runtime Role ไม่มี DDL/role-creation privilege, เขียน Migration Ledger ไม่ได้, อ่าน Ledger ได้ และได้รับ default grants สำหรับ future tables/sequences — PASS
- [x] เพิ่ม Provisioning role isolation verification: `apps/api/scripts/verify-provisioning-role-isolation.cjs`; ยืนยัน membership เดิมถูกถอน, Runtime Role เป็น NOINHERIT และไม่มี memberships, PUBLIC table grants ถูกถอน, encrypted credential persistence และ runtime health check — PASS
- [x] เพิ่ม PostgreSQL privilege audit utility: `apps/api/scripts/postgres-privilege-audit.cjs` พร้อม Disposable integration test `verify-postgres-privilege-audit.cjs`
- [x] Privilege audit test — PASS: ทำงานใน READ ONLY transaction, inventory database/schema/relation/function/default ACLs, ตรวจพบ Runtime Role membership และ PUBLIC grants, รายงาน ownership และ PostgreSQL version
- [x] ตรวจ cleanup หลัง Privilege audit test: Disposable databases=0 และ roles=0
- [x] API build, `npm run typecheck`, `npm run test:canonicalization`, `npm run test:tenant-lifecycle-http`, `npm run test:tenant-lifecycle-service`, `npm run test:tenant-migrations`, `npm run test:runtime-grants`, `npm run test:provisioning-role-isolation`, `npm run test:postgres-privilege-audit`, `npm run test:control-backup-restore` และ `git diff --check` — PASS เมื่อ 2026-11-04; ESLint ยังรันไม่ได้เพราะไม่มี executable `eslint` และ `pnpm` ไม่ได้ติดตั้งใน environment
- [x] `npm run test:postgres-privilege-audit` — PASS ผ่าน Local Admin URL ที่จำกัด localhost เท่านั้น
- [x] ทำ Read-only privilege audit กับ Tenant DB ของ Workspace `pos-local` เมื่อ 2026-11-04; พบ policy deviations 3 รายการ: Runtime Role `INHERIT=true`, `PUBLIC` มี schema `USAGE`, และ Runtime Role มี INSERT/UPDATE/DELETE บน `tenant_migrations` ทั้งที่ควรเป็น SELECT-only; รายละเอียดใน `docs/architecture/pos-local-tenant-privilege-audit-2026-11-04.md` (remediation และ Read-only post-audit PASS เมื่อ 2026-11-04; ดู execution record ด้านล่าง)
- [ ] ยังไม่มีการ Apply Commerce Migration หรือ Generate Tenant Prisma Client; ผลทดสอบทั้งหมดข้างต้นใช้ Disposable resources ที่สร้างและลบโดย test harness เท่านั้น

### Runtime Security / Migration Runner

- [x] Harden TenantMigrationRunner: ถอน PUBLIC database/schema/table/sequence/function privileges และ PUBLIC default privileges
- [x] Runtime Role ได้เฉพาะ schema USAGE, table DML, sequence USAGE/SELECT และ default grants สำหรับ objects ใหม่; `tenant_migrations` เป็น SELECT-only
- [x] Provisioning ถอน inherited role memberships ก่อน Activate Runtime Role และกำหนด NOINHERIT
- [x] Health check ตรวจ database connection, current_user ให้ตรงกับ runtime URL username และการมีอยู่ของ `tenant_settings`
- [x] ตรวจสอบ Privilege Audit กับ Workspace Tenant `pos-local` จริงแล้ว; พบ 3 policy deviations ตามรายงาน. ผู้ใช้อนุมัติ remediation แล้ว และดำเนินการผ่าน PostgreSQL provisioner session แบบมี precondition/transaction guard เมื่อ 2026-11-04; Read-only post-audit และ Runtime Role smoke test PASS แล้ว

### ลำดับงานถัดไป

1. [x] ได้รับการยืนยันและทำ Read-only Privilege Audit กับ `pos-local` แล้ว; ไม่พบการเปลี่ยนแปลงฐานข้อมูล
2. [x] จัดทำผล Audit และระบุ remediation 3 รายการใน `docs/architecture/pos-local-tenant-privilege-audit-2026-11-04.md`; **แก้ไขแล้วและตรวจ Read-only ซ้ำ PASS เมื่อ 2026-11-04**
3. [x] ได้รับอนุมัติและดำเนินการ remediation 3 รายการกับ `pos-local` ผ่าน PostgreSQL provisioner session แบบมี guard เมื่อ 2026-11-04; Read-only Audit และ Runtime Role smoke test หลังแก้ไข PASS
4. [x] เพิ่ม HTTP lifecycle route/guard integration harness; PASS โดยใช้ mocked services
5. [x] เพิ่ม service/database integration test บน Disposable PostgreSQL สำหรับ lifecycle, audit, rollback, concurrency และ default replacement — PASS
6. [x] ยืนยัน Branch archive guard ปฏิเสธ Warehouse ที่มี reserved stock — PASS; Reservation lifecycle/concurrency ผ่าน Service จริงบน Disposable PostgreSQL แล้ว
7. ทบทวน Migration Reconciliation และ Migration Sign-off ให้ครบก่อน Generate Prisma Client หรือ Apply Migration จริง
8. หลัง Sign-off จึงเริ่ม Tenant Commerce deployment และทดสอบ Business APIs ตาม Phase

> หมายเหตุ: [x] หมายถึงมี implementation หรือผลทดสอบตามที่ระบุ; Disposable test PASS ไม่ใช่หลักฐานว่า Workspace Tenant จริงผ่านการตรวจหรือว่า Migration ถูก Deploy แล้ว


## Stock Reservation / Inventory Service MVP and Disposable-DB Integration (2026-11-04)

- [x] Added `StockInventoryModule`, `StockInventoryService` and `StockInventoryController` with Membership-scoped Tenant DB resolution through `WorkspaceDatabaseRegistry`.
- [x] Added authenticated API routes for reserve/release/consume/expiry, receiving, direct issue, reversal and balance read; all routes require `commerce.inventory.manage`.
- [x] Added control-plane permission seed migration `202611040001_commerce_inventory_manage` and included the permission in new Workspace default admin roles. The migration file is prepared only; it has NOT been applied.
- [x] Reservation lifecycle uses row locks and idempotent replay; expired ACTIVE reservations are released using database time and bounded `SKIP LOCKED` batches.
- [x] Reservation and Release do not create physical `StockMovement` rows; removed reservation-only values from `StockMovementType` and `StockReferenceType` Prisma enums and aligned the clean-install / upgrade SQL candidates.
- [x] Receiving, issue, consume and reversal update StockBalance, InventoryCost and physical StockMovement in one transaction. WAC uses PostgreSQL NUMERIC, 3-decimal quantities, 6-decimal cost/value, HALF_UP, zero-stock reset and reconciliation guard.
- [x] Reversal is the exact opposite of the original movement, records `reversal_of_id`, requires a reason and is idempotent / limited to one reversal per original.
- [x] Six service transaction scenarios now call the production `StockInventoryService`; the seventh database CHECK-constraint scenario is verified directly, and the HTTP smoke test calls the real controller and production AuthGuard/RbacGuard against the same Disposable PostgreSQL DB.
- [x] Additional Disposable DB tests cover reservation expiry, receipt WAC, receipt/reversal idempotency, cost reconciliation and HTTP authorization/routing.
- [x] `npm run test:stock-reservation-concurrency` passes; cleanup verified with zero `syncup_stock_concurrency_*` databases and zero remaining sessions.
- [ ] Full Opening Stock/Draft Direct Receiving, multi-line receiving, Supplier/PO validation, Return, Transfer, CSV Adjustment, audit UI and background expiry scheduling remain outside this MVP and require separate implementation/tests.
- Migration Sign-off and deployment to any real Tenant remain on hold. No Tenant database or control-plane migration was changed by this work.

## Continuation update — 2026-11-04

- Fixed the Inventory `consume()` expiry guard: the locked reservation read now calculates `is_expired` using PostgreSQL `clock_timestamp()` before any balance/cost mutation. An expired ACTIVE reservation is released and cannot create a SALE movement.
- Consumption now preserves the reservation's `reference_type` and `reference_id` on its physical SALE movement (falling back to the reservation id when no source reference id was supplied).
- Extended the Disposable PostgreSQL inventory harness with a regression case proving that consuming an expired reservation releases it, leaves on-hand stock unchanged, and writes no SALE movement. Re-ran it in this continuation session against localhost-only Disposable PostgreSQL; PASS.
- Re-ran the Store/Branch/Warehouse service integration suite against Disposable PostgreSQL; PASS for create, defaults, concurrency, archive invariants, reserved-stock protection and transaction rollback.
- Re-ran Tenant clean-install/incremental migration candidate acceptance; PASS. Runtime least-privilege grants, PostgreSQL privilege-audit detection, provisioning role-isolation, and Control DB migration + Tenant backup/restore rehearsal also PASSed on uniquely named Disposable DBs.
- Re-ran Tenant Lifecycle HTTP integration and canonicalization tests; PASS. API/Web build and typecheck, Control/Tenant Prisma schema validation and `git diff --check` PASS from the preceding checks.
- Regenerated `tenant-commerce-incremental-upgrade.candidate.sql` from the current clean-install/custom/canonicalization/lifecycle candidates. It remains review-only.
- Current-session checks: API build/typecheck PASS; Web build/typecheck PASS; both Control and Tenant Prisma schemas validate; canonicalization tests PASS; Tenant Lifecycle HTTP integration harness PASS; `git diff --check` PASS.
- Remaining tooling limitation: API lint cannot start because ESLint is not installed for that package; Web lint cannot start because the repository has no ESLint 9 flat config.
- No Prisma Client was generated. No Control DB migration or Tenant SQL was applied. No real Tenant database was modified. Migration Sign-off remains NOT GRANTED.


## pos-local privilege remediation — 2026-11-04

- [x] Applied the three previously approved least-privilege corrections to pos-local only: Runtime Role NOINHERIT; revoke PUBLIC schema public USAGE; make tenant_migrations SELECT-only for Runtime Role.
- [x] Applied inside a single transaction with exact database/role/owner preconditions, a transaction advisory lock and in-transaction postcondition checks.
- [x] Re-ran the privilege audit in a read-only transaction: zero ERROR findings.
- [x] Connected using the registered Runtime Role credential and verified read-only access to tenant_migrations and tenant_settings; schema USAGE remains available and migration-ledger writes are not granted.
- [x] Verified database/table ownership and role memberships remain unchanged.
- No schema migration, Control DB mutation, application data mutation, Prisma Client generation or deployment was performed. Migration Sign-off remains NOT GRANTED.


## Final Preflight — pos-local — 2026-11-04

- [x] Read-only registry/database identity check: `pos-local` ACTIVE; Tenant DB `syncup_ws_c0130bf3c1c0`; Runtime Role `syncup_rt_c0130bf3c1c0`.
- [x] Read-only PostgreSQL compatibility snapshot: PostgreSQL 18.6, UTF8; exact baseline ledger row retained; no Commerce tables exist. Incremental Upgrade is the correct candidate path.
- [x] Read-only extension check: `btree_gist` 1.8 is available/trusted but not installed; Provisioner database/schema CREATE capability confirmed. No extension installed.
- [x] Rechecked Runtime Role NOINHERIT and least-privilege schema/Ledger grants; no lock waits or idle-in-transaction sessions observed.
- [x] Disposable PostgreSQL 18.6 backup/restore rehearsal PASS; restored schema, Store row, Tenant setting sentinel and Commerce migration ledger verified; disposable databases cleaned up.
- [x] Disposable Control DB checks PASS for Store and Inventory permission migrations: idempotent and admin-only grants.
- [x] Actual `pos-local` custom-format backup and isolated Recovery restore completed; see Actual pos-local Backup/Restore Rehearsal below for ID, timestamp, SHA-256 and verification results.
- [ ] Confirm expected collation/ctype `English_United States.1252`.
- [ ] Approve maintenance window, application revision/checksum, traffic/write freeze and rollback operator.
- [ ] Separately authorize/apply Control DB permission migrations only after sign-off; current real Control DB has neither Commerce permission key nor migration history entry.
- [ ] Obtain explicit Migration Sign-off naming Workspace `pos-local`, Incremental Upgrade candidate `docs/architecture/tenant-commerce-incremental-upgrade.candidate.sql`, version `202611030001_tenant_commerce`, SHA-256 `836f1af276b908813be9089cb3a2813363820b9e00d3a054d7693af62d2473b3`.

Final Preflight disposition: **PARTIAL PASS; Migration Sign-off NOT GRANTED.** No real Tenant/Control migration, extension installation, Prisma Client generation or deployment was performed.

## Actual pos-local Backup/Restore Rehearsal — 2026-11-04

- [x] Backed up actual `pos-local` with PostgreSQL 18.6 custom format and restored the exact archive into isolated Recovery DB `syncup_recovery_pos_local_20261104075738_5bab7de0`.
- [x] Verified schema, every table's row count/content checksum, migration ledger, database identity/version/locale and Runtime Role isolation.
- [x] Backup file: `%LOCALAPPDATA%\SyncUp\Backups\pos-local_20261104075738_5bab7de0.dump`; 4,746 bytes; created 2026-11-04 14:57:40.615 +07:00.
- [x] SHA-256: `e70190385bf33d614892cc37c41349e0f002479a16ba830cc4723aa9c27d21d5`.
- [ ] Confirm retention/storage policy and collation; define maintenance/deployment/rollback window; separately authorize Control DB permission migrations; obtain explicit named-target Migration Sign-off.
- Backup and Recovery DB remain local pending explicit cleanup approval; no automatic expiry/off-device copy is configured.

## pos-local Final Sign-off Review — 2026-11-04 (read-only; pending owner confirmations)

- [x] Reviewed the baseline DDL and application references for `tenant_settings` and `audit_events`.
- `tenant_settings=0` is consistent with the current provisioning/baseline lifecycle: the baseline creates the table but does not seed settings, and the workspace provisioning flow does not insert default rows. The Workspace owner explicitly confirmed that no default settings rows are expected because pos-local has no business data (2026-11-05).
- `audit_events=0` is consistent with a workspace that has not yet performed operations through the currently identified Stock/Inventory audit writer. The Workspace owner explicitly confirmed that no business activity has occurred that should have produced audit rows (2026-11-05).
- Do not add placeholder settings or synthetic audit rows merely to make either table non-empty.
- [x] Workspace owner confirmed both zero-row counts are expected for `pos-local` before first Commerce use (2026-11-05).
- [x] Workspace owner approved the Backup/Recovery retention policy (2026-11-05): daily backups retained 30 days; weekly backups 12 weeks; monthly backups 12 months; each pre-migration backup retained at least 30 days after successful migration acceptance; rehearsal Recovery DB retained until an encrypted off-host backup and restore are verified, then retained at least 7 additional days before requesting cleanup approval; maintain one encrypted off-host copy; verify SHA-256 on every copy; perform a restore test quarterly.
- Policy approval is recorded; operational activation is pending an approved off-host destination/credentials, retention-job implementation and verification. No automatic expiry, deletion, off-host transfer, or cleanup was performed. The existing backup and Recovery DB remain retained locally.
- [x] Approve the proposed Backup/Recovery retention and off-host storage policy (2026-11-05).
- [ ] Confirm `English_United States.1252` as the intended Tenant collation/ctype.
- [ ] Define maintenance window, application release revision/checksum, traffic/write freeze, deployment operator and rollback plan.
- [ ] Separately authorize the two Control DB permission migrations; they remain unapplied to the real Control DB.
- [ ] Obtain explicit Migration Sign-off naming `pos-local`, candidate `docs/architecture/tenant-commerce-incremental-upgrade.candidate.sql`, version `202611030001_tenant_commerce`, SHA-256 `836f1af276b908813be9089cb3a2813363820b9e00d3a054d7693af62d2473b3`.

Final review disposition: **PARTIAL PASS — Migration Sign-off NOT GRANTED.** This review did not apply Tenant or Control DB migrations, install extensions, generate a Tenant Prisma Client, deploy, modify source Tenant data, or delete the retained backup/Recovery DB.


## Synology NAS Backup Destination Configuration — 2026-11-05

- [x] Added a Platform Admin-only API to save the backup destination path outside the database, avoiding a Control DB schema migration.
- [x] Added a Backup / NAS panel in System Admin; the homepage Backup button keeps the entered path through login and saves it to the API configuration.
- [x] API validates absolute/UNC paths and checks that its own process can access the directory with write permission.
- [x] Added Synology DSM/SMB setup notes in `docs/operations/synology-backup-destination.md`.
- [ ] Verify against the actual DS220+ Shared Folder after its network path and Windows service-account permissions are configured.
- [ ] Implement actual PostgreSQL backup creation, scheduled retention, encrypted off-host copy and quarterly restore verification.
- No NAS credentials were requested or stored; no database migration or actual backup was run.


## Foundation audit continuation — 2026-11-05

- [x] Completed read-only audit of Auth, Workspace Provisioning, Tenant DB Registry and RBAC; findings and remaining production gaps are recorded in `docs/architecture/foundation-audit-2026-11-05.md`.
- [x] Fixed Workspace bootstrap ordering: default permissions/roles are seeded before Tenant provisioning can activate the Workspace; bootstrap failure marks the Workspace FAILED and does not start Tenant provisioning.
- [x] Added `apps/api/scripts/verify-workspace-bootstrap.cjs` and `test:workspace-bootstrap`; ordering and failure-state assertions PASS.
- [x] API build and typecheck PASS after the source change.
- [ ] Remaining: authentication rate limiting/CSRF/DTO hardening, password reset, Google Sign-In, bounded Tenant client cache/invalidation, formal Owner/Admin/Manager/Cashier/Inventory Staff permission matrix, and focused authorization tests.
- No real database, migration, Prisma Client generation or deployment was performed.


## Workspace Permission Matrix — 2026-11-05

- [x] Define Owner, Admin, Manager, Cashier, Inventory Staff, Member and Viewer permissions in `docs/architecture/workspace-permission-matrix.md`.
- [x] Map Store, branch, warehouse, Product Catalog, pricing, inventory, POS sales, orders and reports to explicit permission keys.
- [x] Centralize permission definitions and default role grants in `apps/api/src/core/rbac/permission-catalog.ts`.
- [x] Seed Admin, Manager, Cashier and Inventory Staff roles during Workspace bootstrap; preserve legacy Member and Viewer roles.
- [x] Keep Platform Admin authorization separate from Workspace RBAC.
- [x] API build, typecheck, Workspace bootstrap test and git diff --check PASS.
- [ ] Before production: add endpoint-level authorization tests and branch/warehouse scope rules; design discount/refund approvals and sensitive margin permissions.
- No real database migration or role reassignment of existing users was performed.


## Store Management foundation — 2026-11-05

- [x] Reuse the existing Tenant Store/Branch/Warehouse lifecycle instead of duplicating create/archive/default logic.
- [x] Add a membership-scoped Store listing API with active Branch count and default Branch summary.
- [x] Protect Store listing with `commerce.store.view`; Store creation remains protected by `commerce.store.manage`.
- [x] Add the Workspace Store Management page with Store listing and create flow; creation automatically provisions the default Branch and Warehouse in the existing transaction.
- [x] Add HTTP RBAC/tenant-isolation and query-service contract checks.
- [x] API build/typecheck, Web build/typecheck, Store query tests and git diff --check PASS.
- [ ] Next: Store detail/edit and Store status lifecycle; then dedicated Branch Management UI and endpoints.
- No real Tenant/Control DB migration, Prisma Client generation, or deployment was performed.


## Progress update — 2026-11-05 (Store Detail & Edit)

### Current status
- [x] Store Management listing and create flow: membership-scoped listing, active Branch/default Branch summary, permission enforcement and default Branch/Warehouse creation reuse.
- [x] Store Detail API: GET is protected by `commerce.store.view`; PATCH is protected by `commerce.store.manage` and resolves the Tenant DB through the caller's Workspace membership.
- [x] Store Edit: name, description, contact email/phone, address, currency and timezone; Store slug is read-only in the current UI.
- [x] Store update uses a transaction and row lock, validates/normalizes input, and records before/after values in `STORE_UPDATED` audit data.
- [x] Store listing cards navigate to the Store detail/edit page; edit controls are presented according to the current owner/admin/manager UI role check, with server-side RBAC remaining authoritative.
- [x] Store edit service and HTTP contract checks, Store query service/HTTP checks, Tenant lifecycle HTTP checks and Workspace bootstrap checks — PASS.
- [x] API build/typecheck and Web typecheck/build — PASS; `git diff --check` — PASS (line-ending warnings only).
- [ ] Improve Store form currency/timezone selection beyond the current limited dropdown choices.
- [ ] Implement Store status lifecycle and finish dedicated Branch Management UI/detail/edit flows.
- No Prisma schema change, Prisma Client generation, real Tenant/Control DB migration or deployment was performed in this Store Detail & Edit task.

### Progress measurement
- Checklist snapshot in this plan at this update: 89 checked / 207 unchecked = 296 checkbox items; raw checkbox completion is **30.1%**. This is a mechanical count, includes duplicated/overlapping checklist items and does not weight task size.
- Delivery estimate for the currently active Foundation + Store Management workstream is approximately **65%**; this is not the completion percentage of the entire SyncUp product roadmap.
- Overall roadmap progress should therefore be communicated as **about 30% by raw checklist count**, with the active Foundation/Store workstream about 65%. Recalculate after deduplicating and weighting roadmap tasks for a more meaningful project KPI.

### Next implementation sequence
1. Branch Management UI and detail/edit flows, reusing the existing Branch/Warehouse lifecycle services and workspace/store scope.
2. Warehouse Management UI and operational workflows.
3. Product Catalog (categories, products, variants, SKU/barcode, UOM and pricing).
4. Inventory operations UI (opening stock, receiving, issue, adjustment, transfer and movement history).
5. POS Sales MVP.

### Deployment gates (still blocking production rollout)
- Confirm Tenant collation/ctype, maintenance/release/rollback plan and explicit named-target Migration Sign-off.
- Control DB permission migrations and Tenant Commerce migration candidates remain unapplied to the real databases; no Prisma Client generation or production deployment is authorized by this progress update.
- Backup/NAS implementation remains deferred per the user's instruction; do not resume it as part of the next feature phase without a new request.


## Product API Read-only — 2026-11-06

### Implementation status

- [x] เพิ่ม `ProductsModule`, `ProductsController` และ `ProductQueryService` สำหรับ Product List, Product Detail และ SKU/Barcode Lookup
- [x] ทุก Endpoint ใช้ GET และบังคับ `AuthGuard`, `RbacGuard`, `commerce.product.view`; Tenant DB ถูก resolve จาก Workspace Membership ผ่าน `WorkspaceDatabaseRegistry`
- [x] Product List รองรับ Pagination, Status/Store filter และ Text Search; Detail แสดง Variant/UOM/Barcode; Lookup ค้นหา SKU และ Barcode แบบ exact match
- [x] API typecheck และ build ผ่าน
- [x] Manager authentication บน `pos-local` ผ่าน (HTTP 201)
- [x] Manager GET Product List ผ่าน (HTTP 200); หลัง seed มีสินค้า 1 รายการ
- [x] Negative checks ผ่านตามคาด: Detail ด้วย UUID ที่ไม่มีอยู่คืน HTTP 404
- [x] Positive checks ของ Product Detail และ SKU/Barcode Lookup ผ่านบน `pos-local` เมื่อ 2026-11-06: Detail และ Lookup ทั้ง SKU และ Barcode ได้ HTTP 200 จากสินค้าทดสอบ `TEST-EA-001`

### Test data preparation — completed 2026-11-06

- [x] ผู้ใช้อนุมัติให้สร้างข้อมูลทดสอบหนึ่งสินค้า และอนุมัติ UOM `EA` (ชิ้น) เพื่อรองรับ Variant
- [x] สร้างหรือยืนยัน UOM `EA` ใน Tenant DB `syncup_ws_c0130bf3c1c0`
- [x] สร้าง Product ทดสอบหนึ่งรายการ พร้อม Variant, SKU และ Barcode
- [x] ทดสอบ GET Product List, Product Detail และ SKU/Barcode Lookup ด้วยข้อมูลจริง แล้วบันทึก HTTP status และผลลัพธ์
- [x] ตรวจสอบและยืนยันการเชื่อมต่อฐานข้อมูล `syncup_ws_c0130bf3c1c0` และ Schema `public` ที่มีตาราง Product ก่อน Seed

**ข้อสังเกตการเตรียมข้อมูล:** ครั้งก่อน pgAdmin เจอ `relation "public.products" does not exist` และ SQLSTATE `25P02` เพราะ session ไม่ได้อยู่ที่ Tenant DB/schema ที่ migration ถูก apply แล้ว ตรวจเมื่อ 2026-11-06 ด้วย session ใหม่: `current_database() = syncup_ws_c0130bf3c1c0`, `current_schema() = public`, role `syncup_provisioner`, host `127.0.0.1` ตาราง `products`, `unit_of_measures`, `product_variants`, `variant_barcodes` และ `variant_uoms` มีอยู่ใน `public` และ ledger มี `202611030001_tenant_commerce`

ข้อมูลทดสอบที่ commit แล้ว มีอย่างละ 1 แถว:
- UOM `EA` / `ea`, ชื่อ `ชิ้น`, dimension `COUNT`
- Product `สินค้าทดสอบ`, status `ACTIVE`, id `e91ad73d-dd00-435d-850d-25e1fb0b4994`
- Variant SKU `TEST-EA-001`, barcode `8850000000017`, base UOM `EA`
- Audit log action `PRODUCT_TEST_SEEDED`

ผล HTTP ด้วย Manager ของ `pos-local` (`manager-e2e@syncup.local`):
- GET Product List = 200, total 1, ชื่อ `สินค้าทดสอบ`, SKU `TEST-EA-001`
- GET Product Detail = 200, UOM `EA`, barcode `8850000000017`
- GET Lookup SKU `TEST-EA-001` = 200
- GET Lookup barcode `8850000000017` = 200
- GET Detail ด้วย UUID ที่ไม่มีอยู่ = 404

### Scope and safety

- ทดสอบ Product endpoints ด้วย GET เท่านั้น; การ POST Login ใช้เพื่อสร้าง Manager session สำหรับทดสอบ
- เพิ่มข้อมูลทดสอบหนึ่งชุดใน `pos-local` แล้ว: UOM `EA`, Product, Variant, Barcode และ Audit log ตามที่อนุมัติ ไม่มีการเปลี่ยน Store, Branch, Warehouse หรือ Migration
- Positive checks ของ Product Detail และ SKU/Barcode Lookup ผ่านด้วย HTTP 200 จาก `TEST-EA-001`
- ขั้นถัดไปคือวางแผน Product Management UI และ Write APIs แยกเป็นขั้นตอน และขออนุมัติก่อนเปลี่ยนข้อมูลธุรกิจจริงเพิ่มเติม


## Product Management E2E — 2026-11-06

### Implementation and verification
- [x] Add Playwright Product Management E2E covering Manager Create, Detail, Edit, exact SKU lookup, exact Barcode lookup and Archive.
- [x] Verify Cashier can read Product List, Detail and Lookup, while Create, Update and Archive are rejected with HTTP 403.
- [x] Verify Cashier Product Detail page is read-only and does not require the separate members.view permission.
- [x] Fix Product page permission projection: GET /api/workspaces now includes only the current user's role keys; Product List/Detail no longer call the members listing API just to infer whether the current user can manage products.
- [x] Add repeatable command npm run test:e2e:products in apps/web.
- [x] API typecheck/build and Web typecheck/build — PASS.
- [x] Playwright Product Management E2E — PASS (Manager lifecycle + Cashier read-only RBAC).

### Isolated E2E data
- Workspace: e2e-commerce-20261106; Tenant DB: syncup_ws_e65ca36b8068.
- Added UOM EA / ea (ชิ้น) to this E2E tenant because it initially had no active UOM.
- E2E created, edited, looked up and archived its Product/Variant; final status for Product and Variant is ARCHIVED.
- Three unique E2E Product/Variant records were created during the initial failing attempt and two subsequent passing runs; all three are ARCHIVED and confined to the dedicated E2E tenant. The initial attempt exposed the Cashier page permission dependency; both complete reruns passed.
- Cashier denied write attempts did not alter the final Product record.
- No changes to pos-local, no production migration, no deployment and no commit/push were performed.

### Follow-up
- [ ] Add integration-level Product Command tests against an ephemeral PostgreSQL database for transaction rollback, duplicate SKU/barcode conflicts and multi-barcode preservation.
- [ ] Keep E2E workspace Commerce lifecycle state unchanged; do not run module Enable/Disable tests as part of Product E2E.


---

## Roadmap reconciliation and Inventory readiness — 2026-11-10

สถานะนี้เทียบ Implementation/ผลทดสอบที่มีหลักฐานกับ Roadmap; ไม่ใช่การยืนยันว่าแต่ละ Phase ผ่าน Production Acceptance

### Workstream status

| Workstream | สถานะ ณ 2026-11-10 |
|---|---|
| Foundation / Workspace / RBAC | Implemented with remaining production gaps; ต้องทำ full role-grant reconciliation และ production security gates |
| Store / Branch / Warehouse | Core management implemented: list/create/detail/edit, default/archive lifecycle และ service/HTTP tests |
| Product Catalog | Core Product management implemented: list/detail/create/edit/archive, SKU/Barcode lookup และ Manager/Cashier E2E; Categories, images, multi-UOM pricing และ Public Store ยังไม่ครบ |
| Inventory | Receive, Issue, Adjustment, Transfer, Movement History และ Stocktake API/UI พร้อม E2E; RBAC/idempotency/concurrency hardening ผ่าน |
| POS / Order / Payment | ยังไม่ครบ workflow; Phases 3–4 ยังเป็นงานถัดไปหลัง Catalog/Inventory acceptance |
| Public Store / Guest Checkout | ยังไม่ implement; Phases 1 Public Store และ 5 Checkout ยังไม่ผ่าน |
| Backup / Recovery | Local backup/restore rehearsal ผ่าน; encrypted off-host backup/restore ยังเป็น gate เปิดอยู่ |

### Inventory scope ที่เสร็จแล้ว แต่ยังไม่เท่ากับ Phase 2 complete

- Reservation lifecycle/concurrency tests, Receive/Issue/Adjustment/Transfer และ Movement History มี implementation และ tests
- Stocktake API/UI ผ่านบน E2E Tenant ที่มี Stocktake schema migration
- Transfer เป็น atomic paired movement ไม่ใช่ workflow ส่ง/รับแบบสองขั้นตาม checklist เดิม
- Opening Stock ต่อ Warehouse ยังไม่ถือว่าเสร็จ; Stocktake ไม่ใช่ตัวแทน Opening Stock
- ยังไม่มี Sales/Order integration จึงยังไม่ถือว่า Cost Snapshot ณ เวลาขายหรือ concurrent sale ผ่าน
- `pos-local` มี StockBalance/InventoryCost/StockMovement เป็น 0 แถว จึงยังรับรอง WAC/Inventory Value จากธุรกรรมจริงไม่ได้

### pos-local Readiness findings — 2026-11-10

- Store/Branch/Warehouse เริ่มต้น Active และ Default ถูกต้อง; Store ยังไม่ Published
- มี Owner และ Manager membership; ยังไม่มีผู้ใช้ที่ได้รับมอบหมาย Admin, Cashier หรือ Inventory Staff
- Admin permission grants ยังไม่ตรงกับ Default Role Matrix; ต้อง reconcile ทุก Permission Catalog key ไม่ใช่ Apply migration candidate 005 แล้วสันนิษฐานว่าครบ
- `stocktake_sessions` / `stocktake_lines` ยังไม่มีใน `pos-local`; `GET /inventory/stocktakes` ตอบ HTTP 500 จาก schema gap
- Local Backup/Restore ผ่าน แต่ encrypted off-host Backup/Restore ยังเป็น deployment blocker
- ผลตรวจเป็น Read-only; ไม่มีการเปลี่ยน Role, Business data, Tenant/Control schema หรือ Migration Ledger

รายละเอียด Findings และ Remediation Plan อยู่ใน `docs/operations/inventory-operational-readiness-remediation-plan-2026-11-10.md`.

### ลำดับงานถัดไปที่มีผลบังคับใช้

ลำดับนี้ supersede Next Steps เดิมวันที่ 2026-11-05 สำหรับช่วง Inventory Operational Readiness:

1. **R1 — Full RBAC reconciliation (Read-only):** เทียบ Permission Catalog, Control DB permission rows, role_permissions และ Role existence กับ `workspace-permission-matrix.md`.
2. **R2 — RBAC remediation candidate:** จัดทำ forward-only SQL/test plan จาก diff ที่พิสูจน์แล้ว; ห้าม Apply หรือเปลี่ยน membership assignment โดยไม่มีอนุมัติ
3. **R3 — Stocktake migration review:** ตรวจ candidate SQL, Prisma schema, migration runner และ API compatibility; ห้าม Apply กับ `pos-local` ในขั้นนี้
4. **R4 — Backup/deployment preflight:** ต้องมี encrypted off-host backup + restore verification, maintenance window และ rollback plan ก่อนการเปลี่ยน Tenant จริง
5. หลังจากนั้นจึงขออนุมัติแยกสำหรับ Control DB RBAC changes, Tenant Stocktake migration และ Opening Inventory data

### วิธีรายงานความคืบหน้า

- ค่า 30.1% ใน Progress update 2026-11-05 เป็น raw checkbox count ณ วันนั้นและล้าสมัยแล้ว
- ห้ามอ้างตัวเลขดังกล่าวเป็นความคืบหน้าปัจจุบัน; หลาย checklist items เป็น composite scope และ Implementation ล่าสุดยังไม่ได้ reconcile กลับทุก checkbox
- ใช้ Workstream status และ Readiness gates ด้านบนจนกว่าจะทำ checklist mapping/deduplication ครบถ้วน

งาน reconciliation นี้ไม่มี Migration, Production deployment, commit หรือ push.


## R1 — Full RBAC reconciliation result — 2026-11-10 (Read-only)

- [x] เทียบ Application Permission Catalog 30 keys กับ Control DB permission rows: พบ 31 rows เพราะมี legacy `commerce.inventory.manage` เพิ่มอีก 1 key
- [x] เทียบ Role grants: Admin expected 30 / actual 12 (missing 19, unexpected legacy 1); Manager expected 27 / actual 27 (exact match)
- [x] ตรวจ Role rows: มี admin/manager/member/viewer; ไม่มี cashier และ inventory_staff
- [x] ตรวจ Membership: Owner 1 (ownership bypass) และ Manager 1; ไม่มี Cashier/Inventory Staff assignment
- [x] ตรวจ Migration ledger: 001/002 applied; 003/004 ไม่มี ledger row แต่มี schema effects ที่เคยตรวจพบ; 005 ยังไม่ applied
- [x] ยืนยันว่า migration candidate 005 ไม่เพียงพอ: Manager มี 3 inventory grants อยู่แล้ว; Admin ยังขาด 16 grants หลังเพิ่ม 3 keys; Inventory Staff role ยังไม่มี
- [x] พบว่า `WorkspacesService.listRoles()` เรียก `ensureDefaultRoles()` ซึ่งทำ database writes จาก read/list path; ห้ามใช้ endpoint นี้ใน Read-only audit จนกว่าจะแยก provisioning ออกจาก GET path
- R1 เสร็จแบบ Read-only; ไม่มี database mutation หรือ Role assignment
- R2 ต้องเตรียม migration/role provisioning strategy ใหม่ และทำ Control migration ledger reconciliation ก่อน ห้ามใช้ `prisma migrate deploy` แบบเหมารวม หรือสร้าง migration ledger rows ย้อนหลัง
- รายละเอียด: `docs/operations/inventory-operational-readiness-remediation-plan-2026-11-10.md`


## R2 status - 2026-11-10

- Read-only reconciliation confirms Migration 003 schema effects and Migration 004 runtime grants are present and match current SQL, but neither has a Control Prisma ledger row.
- Migration 005 remains unapplied and on hold; it is not a complete RBAC remediation.
- Do not rerun 003/004, run prisma migrate deploy, or insert historical ledger rows.
- The owner must decide whether to explicitly authorize Prisma migrate resolve --applied for exactly 003/004 after review, or retain the no-backfill rule and approve a separate migration-lineage/runner redesign. No option has been executed.
- Detailed evidence and disposition are appended to docs/operations/inventory-operational-readiness-remediation-plan-2026-11-10.md.
- Drafted the pos-local RBAC remediation design (Admin 30, Manager 27 unchanged, Cashier 7 role provisioned without membership assignment, Inventory Staff remains on-demand/13, Member/Viewer untouched); it is documented but not an executable or approved migration.
- Candidate design requires read-only preflight, additive idempotent grants, no membership changes, preservation of legacy commerce.inventory.manage, and a separate fix/test for listRoles GET-side effects.

- R2 rehearsal PASS (2026-11-10): Prisma migrate resolve --applied for exactly Control migrations 003/004 succeeded on a disposable restore; checksums matched and migrate status left 005 as the only pending migration. Live Control DB remains untouched pending explicit approval.
- RBAC candidate rehearsal PASS on a separate disposable restore: Admin 30 catalog grants plus preserved legacy grant; Manager unchanged at 27; Cashier created with 7 grants; Inventory Staff remains on-demand; memberships, other workspaces, permission catalog and migration ledger unchanged; second run idempotent.
- Evidence: docs/operations/r2-migration-rbac-rehearsal-2026-11-10.md. Candidate SQL is docs/operations/pos-local-rbac-remediation-candidate-2026-11-10.sql and is not an active migration.
- Approval gates remain separate: live Control ledger resolution for 003/004; RBAC candidate application to pos-local. Migration 005 and Stocktake remain on hold.
- Stocktake candidate SQL rehearsal PASS on a disposable restore of the pinned pos-local Tenant backup. Verified two tables, 12/9 columns, enum values, seven named constraints, six indexes, empty tables and unchanged Tenant ledger. Live pos-local read-only audit confirms runtime default CRUD grants; TenantMigrationRunner currently applies only baseline, so a dedicated approved incremental executor is still required. No live DB change. See docs/operations/r2-migration-rbac-rehearsal-2026-11-10.md.


## Checkpoint — 2026-11-10: pos-local Stocktake migration and UI verification

### Completed
- Applied `20261107000100_tenant_inventory_stocktake` to the `pos-local` Tenant database `syncup_ws_c0130bf3c1c0` after explicit approval. The migration SQL and Tenant ledger insert were committed atomically by the guarded incremental migration executor.
- Created and verified a pre-migration custom-format backup at `D:\Back up\SyncUp\Backups\pos-local_pre_stocktake_20261110044830.dump`; SHA256 `b78890368bf2014664c38bb1e817d84f6716f0f8768d37b56010db6ebbe0ac40`. Backup is local and not encrypted; off-host encrypted backup remains an outstanding operational task.
- Post-migration read-only verification PASS: 2 Stocktake tables, expected columns/enums/constraints/indexes, empty initial tables, 3 Tenant migration ledger entries, and runtime CRUD grants limited to Stocktake tables. Runtime role cannot insert into migration ledger.
- API typecheck/build PASS. `pos-local` Manager HTTP inventory/Stocktake E2E PASS, including idempotency, validation, stale snapshot guard, WAC, transfer concurrency and fixture cleanup.
- Browser UI E2E PASS (1/1) using the `pos-local` Manager login. This test stubs Stocktake API responses and verifies the UI flow; the separate Manager HTTP E2E above exercises the real API/database.
- Added `apps/web/e2e/pos-local-stocktake-ui.spec.ts` and operational executor, rehearsal, backup and verification scripts/reports under `apps/api/scripts/` and `docs/operations/`.
- `pos-local` RBAC remediation is applied and verified: Admin has all 30 catalog grants plus preserved legacy grant; Manager unchanged; Cashier role has 7 grants; Inventory Staff remains provisioned on demand.

### Current safeguards and remaining work
- No deployment, commit or push was performed as part of the database migration/UI verification.
- Control DB migration ledger resolution for Control migrations 003/004 was approved in a separate step but has not been executed; do not claim it is reconciled. Control migration 005 remains unreconciled and must not be deployed as-is.
- At the time of this checkpoint, Opening Stock per Warehouse was still outstanding; it was implemented in the subsequent checkpoint below. Stocktake remains a separate workflow.
- Off-host encrypted backup and key-recovery design remain open. The existing local backup is not encrypted.
- Preserve the distinction between `e2e-commerce-20261106` and production-like `pos-local`; do not reuse E2E fixtures against production data.

### Recommended next implementation
1. Completed in the subsequent Opening Stock checkpoint below.
2. Add real-browser UI/API integration coverage for Stocktake against `pos-local` only when a controlled test fixture and cleanup plan are in place.
3. Resolve the Control migration ledger state only within the exact previously approved 003/004 scope; review migration 005 separately.
4. Complete encrypted off-host backup and restore/key-recovery verification before treating backup readiness as production-grade.


## Checkpoint — 2026-11-10: Opening Stock per Warehouse implementation

### Implemented
- Added `OpeningStockService` and `OpeningStockController` in the Inventory module:
  - `GET /api/tenant/:workspaceId/inventory/opening-stocks` — paginated list and status/warehouse filters.
  - `POST /api/tenant/:workspaceId/inventory/opening-stocks` — create a DRAFT session with multi-line variant quantities and unit costs.
  - `GET /api/tenant/:workspaceId/inventory/opening-stocks/:openingStockId` — session detail.
  - `PATCH /api/tenant/:workspaceId/inventory/opening-stocks/:openingStockId` — edit DRAFT reference, notes and lines; posted/cancelled sessions are immutable.
  - `POST .../:openingStockId/post` — atomically post all lines.
  - `POST .../:openingStockId/cancel` — cancel DRAFT only.
- Reused the existing Tenant schema and database objects (`OpeningStockSession`, `OpeningStockItem`, `OpeningStockStatus`, and the unique `posted_warehouse_id` index). A read-only audit confirmed the tables, columns, unique indexes, enum values and runtime CRUD grants already exist in `pos-local`; no migration or Production database write was performed.
- Posting writes StockBalance and InventoryCost, creates `StockMovementType.OPENING` with `StockReferenceType.OPENING_STOCK`, and writes audit events in the same transaction. Opening cost initializes WAC and inventory value directly from quantity × unit cost.
- Safety rules: one posted Opening Stock session per Warehouse; unique variants per draft; positive quantities up to 3 decimals; non-negative unit cost up to 6 decimals; idempotency replay checks the complete payload; changed payload returns conflict; posting is atomic and row-locked; an item with prior movement history or non-empty balance/cost cannot be initialized; a posted session cannot be cancelled.
- Uses existing `commerce.inventory.receive` permission for create/post/cancel and `commerce.inventory.view` for list/detail; no new Control RBAC migration was required.
- Added UI at `/workspace/[slug]/inventory/opening-stock` with multi-line entry, DRAFT editing, CSV import by SKU/quantity/unitCost (including a downloadable template), draft review, post confirmation, cancellation, list/detail and navigation from Inventory/Stocktake. Movement history now displays and filters `OPENING` as “ยอดยกมา”.
- Added `apps/api/scripts/verify-opening-stock-http-e2e.cjs` and `apps/web/e2e/opening-stock-ui.spec.ts`.

### Verification
- API typecheck PASS; API build PASS.
- Web typecheck PASS; Web production build PASS.
- Real API/DB HTTP E2E on `e2e-commerce-20261106` PASS: Inventory Staff create permission, Cashier denied with HTTP 403, create/replay, payload conflict 409, concurrent post (exactly one movement), WAC/InventoryCost/StockBalance reconciliation, movement history filter, one-post-per-warehouse conflict 409, and fixture cleanup.
- Browser UI E2E PASS (1/1). Opening Stock endpoints and supporting catalog/warehouse data are stubbed in this UI test; the separate HTTP E2E above exercises the real API/database.
- API lint could not run because ESLint is not installed in the API workspace. Web lint is currently blocked by the repository's ESLint 9 configuration (no `eslint.config.*`); these are tooling/configuration issues, not passing lint checks.
- No migration, live `pos-local` inventory mutation, deployment, commit or push was performed for this implementation. E2E fixtures were cleaned up.

### Follow-up
1. Completed 2026-11-11: CSV export for selected Opening Stock documents and all-or-nothing bulk CSV validation preview (per-row status/reason; confirm enabled only when every row is valid).
2. Completed 2026-11-11: Opening Stock permission-specific HTTP assertions for Cashier and Viewer.
3. Keep Opening Stock as a one-time baseline workflow; use Direct Receiving for subsequent inbound stock and Stocktake for physical count reconciliation.

### Follow-up verification — 2026-11-11
- Added DRAFT edit endpoint and UI. PATCH locks the session row, rejects non-DRAFT state, validates active variants and duplicate variants, replaces item lines atomically, and writes a draft-update audit event.
- Preserved create idempotency semantics across edits by storing the original create payload in the `OPENING_STOCK_CREATED` audit metadata. Replaying the original key/payload after an edit still resolves to the original session; a changed payload remains HTTP 409. Legacy DRAFT records receive their original payload snapshot on first edit.
- Added CSV import with case-insensitive SKU matching, duplicate/unknown SKU detection, quantity/cost validation, quoted-field parsing, a 2 MB file-size limit, a 500-item limit, and template download. Import is available when creating or editing a DRAFT.
- API HTTP E2E PASS on `e2e-commerce-20261106`: edit DRAFT, verify edited values, replay original create payload after edit, verify posting, verify PATCH after post returns HTTP 409, reconcile quantity/WAC/inventory value/movement and cleanup.
- Browser UI E2E PASS (1/1): create DRAFT, enter edit mode, import CSV, save edited draft, then post. API/data endpoints remain stubbed in this browser test.
- API typecheck/build PASS; Web typecheck/production build PASS.
- Follow-up: selected document CSV export includes SKU, product/variant, quantity, unit cost, total cost and UOM. CSV import now presents a row-by-row validation preview and only permits all-valid imports; invalid SKU and disabled-confirm behavior are covered by Playwright.
- Browser UI E2E PASS (1/1) including invalid-row preview, successful import confirmation, Draft edit, Post and CSV download.
- No migration, live `pos-local` database write, deployment, commit or push was performed.

### Opening Stock RBAC verification — 2026-11-11
- Extended `apps/api/scripts/verify-opening-stock-http-e2e.cjs` with role-specific checks against a real DRAFT in the dedicated `e2e-commerce-20261106` workspace.
- Cashier: list/detail access remains allowed; create, DRAFT edit and post all return HTTP 403.
- Viewer: this E2E workspace has no dedicated Viewer account, so the existing Cashier membership was temporarily switched to the existing `viewer` role for the HTTP checks. Viewer list/detail and create/edit/post all return HTTP 403 (the Viewer role does not have `commerce.inventory.view`). The original Cashier membership role was restored in `finally` and independently verified.
- Opening Stock HTTP E2E PASS; general inventory RBAC smoke test PASS (4 roles, 36 authorization assertions); API typecheck/build PASS.
- E2E fixture cleanup passed. No production workspace, production role, tenant migration, deployment, commit or push was performed.

## Checkpoint — 2026-11-11: Inventory end-to-end regression verification

### API / database workflows
- `apps/api/scripts/verify-inventory-http-e2e.cjs` PASS on `e2e-commerce-20261106`: Receive, Issue, Adjustment In/Out, Movement History filters/pagination, Transfer paired movements, idempotency replay, validation/rollback, stale Stocktake snapshot, Stocktake finalize/cancel, and transfer concurrency (same-key and distinct-key parallel requests).
- `apps/api/scripts/verify-opening-stock-http-e2e.cjs` PASS: Opening Stock create/edit/post, original-payload idempotency after Draft edit, RBAC negative assertions and fixture cleanup.
- `apps/api/scripts/verify-e2e-inventory-rbac-http.cjs` PASS: 4 roles and 36 authorization assertions.
- `apps/api/scripts/verify-stocktake-ui-real-api-e2e.cjs` PASS after starting the local Web server: real browser create/count/finalize against API and database; WAC 5.181818, inventory value 57.000000, one `ADJUSTMENT_IN` movement; fixture and audit cleanup PASS.

### Browser UI regression
- Playwright PASS: 6/6 across `inventory-management.spec.ts`, `opening-stock-ui.spec.ts` and `pos-local-stocktake-ui.spec.ts`.
- Corrected stale `pos-local-stocktake-ui.spec.ts` expectations: it previously relied on obsolete element IDs and attempted to run an Inventory Staff account from the E2E workspace against `pos-local`. The POS-local spec now checks the current accessible controls for its Manager scenario; Inventory Staff permission coverage remains in the E2E-workspace spec.
- Web TypeScript typecheck PASS; Next.js production build PASS.

### Scope / safety
- All API fixture tests ran against the dedicated local E2E workspace and cleaned up test records/audit rows.
- Real-browser Stocktake API test used the same E2E workspace; no business fixture remained.
- No production `pos-local` database mutation, migration, permission change, deployment, commit or push was performed.
- `git diff --check` PASS. Existing unrelated worktree changes were preserved.

## Checkpoint — 2026-11-11: pos-local Sales Migration Readiness & Rehearsal

- Read-only baseline confirmed for Workspace `pos-local` / Tenant `syncup_ws_c0130bf3c1c0`: ledger contains Baseline, Commerce and Stocktake only; `product_variants.tax_category_id` and all Sales tables/types are absent.
- Created fresh custom-format local backup `D:\Back up\SyncUp\Backups\pos-local_pre_sales_20261111072507.dump` (132,122 bytes); SHA-256 `2abc971ecc0e1362a35f5da13230fd5c31eba22795c147814ed788b36d458901`; `pg_restore --list` and post-rehearsal hash verification PASS.
- Added `apps/api/scripts/rehearse-pos-local-sales-migrations.cjs` and npm command `npm run rehearse:sales-migrations`. The script verifies exact Control registration and read-only Tenant identity, creates a custom-format backup, restores a disposable DB, applies the three Sales candidate migrations in dependency order with ledger entries, validates schema/FKs/indexes/runtime grants, and drops the clone.
- Rehearsal PASS: 7 Sales tables, 4 enums, 20 foreign keys, 29 indexes, tax-category column and WAC/posting snapshots present; Sales business tables empty. Runtime DML on Sales tables and SELECT-only migration-ledger access verified.
- Actual `pos-local` Runtime Grants inspected read-only: CONNECT, schema USAGE, existing table DML, migration ledger SELECT-only; Provisioner default privileges include table DML and sequence SELECT/USAGE for the runtime role.
- Rehearsal DB confirmed dropped. Live Tenant post-check still shows the original 3-entry ledger and no Sales schema. No registered Tenant or Control DB writes, migration applies, RBAC changes, deployment, commit or push.
- Backup limitation remains: local-only and not encrypted/at-rest protected (BitLocker was previously Off); off-host encrypted backup requirement remains open.
- **Activation not approved/performed.** Applying all three migrations to `pos-local` still requires separate explicit approval naming the Workspace and exact migration versions, plus a fresh backup and guarded live execution.
- Detailed evidence: `docs/operations/pos-local-sales-migration-readiness-2026-11-11.md`.


## Checkpoint — 2026-11-11: pos-local Sales Migrations Applied & Verified

- User explicitly approved exactly three Tenant migrations for `pos-local`: `20261111000100_tenant_sales_orders`, `20261111000200_tenant_sales_returns`, `20261111000300_tenant_sales_payments_refunds`.
- Created fresh pre-activation custom-format backup `D:\Back up\SyncUp\Backups\pos-local_pre_sales_activation_20261111074409.dump` (132,122 bytes), SHA-256 `d6feb9a1647fd6d9bdbc87ed69a1cd7e8727774350c3961b25d92b418f5ced5d`; archive list and restore-to-disposable validation PASS; restore-check database dropped; hash rechecked after activation.
- Added guarded executor `apps/api/scripts/activate-pos-local-sales-migrations.cjs` and npm command `activate:pos-local-sales`. It verifies exact Control registration, local DB endpoints, provisioner identity, candidate checksums, fresh backup and exact pre-ledger, acquires Tenant migration advisory lock, then applies all 3 SQL files and ledger entries atomically in one transaction with pre-commit schema/grant verification.
- Live activation returned `POS_LOCAL_SALES_MIGRATION_ACTIVATION=PASS`.
- Post-commit read-only verification: Tenant ledger now 6 entries (Baseline, Commerce, Stocktake, Sales Orders, Sales Returns, Sales Payments/Refunds); table count 46; 7 Sales tables; 4 Sales enums; 20 FKs; 29 indexes; tax-category column, posting and WAC snapshot columns present.
- Runtime role has DML on all 7 Sales tables, database CONNECT and schema USAGE; migration ledger SELECT-only (INSERT denied). New Sales business tables are empty (0 Orders/Items/Returns/Return Items/Payments/Refunds).
- Control registration unchanged. No Control schema/ledger, RBAC, or permission changes.
- API typecheck, Prisma validate/generate, Sales service E2E, HTTP/Auth/RBAC E2E, API build/health PASS. Web typecheck/build and Orders UI Playwright 1/1 PASS.
- No deployment, Git commit or push. Existing uncommitted Milestones A–F work preserved.
- Local backup is not encrypted; BitLocker was previously Off. Encrypted off-host backup remains outstanding.
- Detailed evidence: `docs/operations/pos-local-sales-migration-activation-2026-11-11.md`.


## Priority update — 2026-11-13: POS UX/UI-first workstream

**เปลี่ยนลำดับการพัฒนา:** ให้ UX/UI ของการขายหน้าร้าน (POS) เป็นงานหลักถัดไป ก่อนขยาย Backend module อื่น, Online Store Checkout, CRM, Advanced Reports หรือ Payment Provider integrations

- แยกหน้าขายสำหรับพนักงานออกจากหน้า Back-office Orders โดยคง `/workspace/[slug]/orders` เป็นหน้าจัดการคำสั่งซื้อ และเพิ่มเป้าหมาย `/workspace/[slug]/pos` สำหรับ Cashier
- ลำดับงานใหม่: POS-0 Workflow/UX specification → POS-1 POS shell/responsive layout → POS-2 Product discovery & Cart → POS-3 Checkout & Payment UX → POS-4 Receipt/Print → POS-5 Sale lookup & exception recovery → POS-6 Test/RBAC/regression.
- ใช้ API Sales Orders, Reservation, Posting, Payment Ledger ที่มีอยู่เป็นฐาน โดย UI ต้องแสดงสถานะจริงของ flow create/reserve → post → record payment และรองรับ retry โดยไม่สร้าง Order ซ้ำ
- เริ่มด้วย fixture data เพื่อออกแบบและทดสอบ UX; ห้ามใช้ราคาหรือภาษีที่คำนวณจาก client เป็นค่าจริง และห้ามสร้างข้อมูลขายใน `pos-local` ระหว่างทำ UI
- Cashier Shift, Cash Drawer Reconciliation, durable Suspended Bills, receipt/reprint audit และ Payment Provider verification เป็น backend gaps ที่ต้องออกแบบ/ทำให้เสร็จก่อนเปิดใช้งานหน้าร้านเต็มรูปแบบ ไม่สร้าง UI หลอกว่ารองรับแล้ว
- Product/Store listing/Price/Tax/Opening Stock จริงของ `pos-local` และ encrypted off-host backup ยังคงเป็น Production Readiness gates
- งานถัดไปทันทีคือ POS-0 และ POS-1 เท่านั้น ยังไม่มีการเปลี่ยน DB, migration, RBAC, deployment, commit หรือ push ในการปรับแผนครั้งนี้

รายละเอียด: `docs/architecture/pos-ux-ui-first-plan-2026-11-13.md`.


## Checkpoint — 2026-11-13: POS UX/UI-first — POS-0 / POS-1

- Added dedicated cashier route `/workspace/[slug]/pos`; retained `/workspace/[slug]/orders` for back-office Order management.
- Added "ขายหน้าร้าน" navigation from Workspace home and Orders.
- Implemented responsive light POS shell: header/context, Store/Branch placeholder, product discovery/search and barcode visual areas, category controls, fixture product cards, cart empty state, totals and disabled checkout.
- Fixture data is clearly marked as demo-only. Product search, barcode scan, cart actions and checkout are not connected; no actual product, price, tax, stock or payment data is presented.
- Added Playwright `pos-shell.spec.ts`: Desktop, Tablet and Mobile PASS 3/3.
- Web `npm run typecheck` PASS; `npm run build` PASS and route compiled.
- `npm run lint` could not run because the existing project uses ESLint 9 but has no `eslint.config.js/.mjs/.cjs`; this is a repository configuration blocker, not a reported source lint failure.
- No API/database/migration/RBAC/business-record changes, deployment, commit or push.
- Next: POS-2 product discovery and Cart interactions using existing API contracts; then POS-3 checkout/payment with safe idempotent retry and explicit handling of reserve → post → payment states.


## Checkpoint — 2026-11-13: POS-2 Product Discovery & Cart

- Replaced POS demo fixture catalog with Workspace-scoped Store / Branch / Warehouse selection and live Catalog search.
- Added read-only POS catalog API endpoint guarded by `commerce.product.view`; it requires an active Store/Branch/Warehouse and active Tax Profile, then returns only ACTIVE + PUBLISHED sellable product variants with a current price and required tax setup.
- Returned data includes current price/currency, tax rate/mode, sell UOM and conversion, and Warehouse available quantity converted into the selected sell UOM.
- POS supports search by product name/SKU/title/barcode, barcode-scanner keyboard input, add-to-cart, quantity edits/increment/decrement and remove. Quantity is capped at displayed available stock; the Order API remains authoritative and will revalidate during POS-3.
- Cart amount display is an estimate from server-returned price/tax context. Checkout remains disabled; POS-2 creates no Orders, reservations, payments or business records.
- API typecheck/build and Web typecheck/build PASS; POS Playwright PASS 5/5 (catalog, search, cart quantity/totals, out-of-stock guard, empty state, mobile); Orders UI regression PASS 1/1.
- No database writes/migrations/RBAC changes/deployment/commit/push.
- Next: proceed to POS-3 checkout with idempotent reserve → post → payment retry and explicit partial-failure recovery.


## Checkpoint — 2026-11-13: POS-3 Checkout & Payment

- Added POS checkout review and payment method selection (CASH / BANK_TRANSFER / CARD).
- Integrated existing Sales API sequence: create Order and reserve stock → post Order and consume stock → record full Order total in Payment Ledger.
- Each stage has its own stable UUID Idempotency Key. Retries and reload recovery reuse the same key and payload; no fresh key is generated for an already-started stage.
- Checkout state is stored in tab-scoped sessionStorage before the first write and after each successful stage. If the browser reloads during a request, the last confirmed stage is retried idempotently.
- The amount sent to Payment API comes from the server-created Order response, never from the client-side estimate.
- UI distinguishes a RESERVED Order with posting failure (stock remains reserved; authorized cancellation may be needed) from a POSTED Order awaiting Payment Ledger completion.
- CASH/CARD/BANK_TRANSFER only create internal Payment Ledger records. No card gateway charge, bank transfer/slip verification, or cash drawer reconciliation is implemented; the UI discloses this.
- POS checkout E2E PASS 3/3: payment retry after reload with same key, payment occurs only after posting, and posting retry reuses the same key. POS discovery/cart PASS 5/5. Orders UI regression PASS 1/1. Web typecheck/build PASS; git diff --check PASS.
- Tests use mocked API responses. No live Order, reservation, stock posting, payment, DB write, migration, RBAC change, deployment, commit or push.
- Next: POS-4 receipt/print UX and sale completion details; keep gateway integration and cash drawer reconciliation as separate readiness work.


## 2026-11-13 — POS-4 Receipt & Print UX checkpoint

- Implemented shared persisted-data receipt preview and 80 mm browser print layout.
- POS checkout fetches saved Order + Payment rows after payment succeeds; Orders detail supports reprint for POSTED Orders with recorded payments.
- Receipt includes order/store context, line quantities/prices/tax/totals, payment ledger entries, references and refunds; explicitly not a tax invoice.
- No seller legal identity, tax ID, receipt/tax invoice numbering, gateway or physical printer integration invented or implemented.
- Verification: web typecheck PASS, web build PASS, POS checkout + Orders UI Playwright PASS 4/4.
- No live business data writes, migrations, RBAC changes, deployment, commit or push.

## Product Media Upload — 4 Milestones (2026-11-13)

Implementation checkpoint: docs/architecture/product-media-upload-implementation-2026-11-13.md

- [x] **Milestone A — Media Storage & API (code):** configurable local filesystem storage, multipart upload, JPEG/PNG/WebP decoding validation, 5 MB and 40 MP limits, SHA-256, ORIGINAL/MAIN/THUMBNAIL derivatives, authenticated Workspace-scoped media reads, RBAC.
- [x] **Milestone B — Product & Variant Images (code):** ProductImage/VariantImage upload/list/update/delete APIs, primary image, gallery sortOrder, altText, audit events, one-primary partial unique indexes in migration candidate.
- [x] **Milestone C — Admin UI Integration (code):** optional primary image on create, persisted product gallery on detail, Variant image controls, compact product cards showing stored thumbnails.
- [x] **Milestone D — Bulk Image Upload (code):** OWNER/ADMIN ZIP preview and commit, optional Manifest CSV, filename-to-SKU mapping, checksum/staging/row outcomes/audit, ZIP traversal/symlink/encryption/ratio/size protections.

**Activation and acceptance gates remain open:**
- [ ] Rehearse and approve Tenant migration candidate 20261113000100_tenant_media_images; it has **not** been applied to any Tenant DB.
- [ ] Configure MEDIA_STORAGE_ROOT to a durable shared volume; include it in encrypted backup/restore and verify multi-instance access.
- [ ] Run DB-backed upload/gallery/delete and ZIP preview/commit E2E after migration activation.
- [ ] Add retention/expiry for abandoned staging batches and storage quota/monitoring.
- [ ] Public Store image publishing and public-read security (Roadmap 1.6f) remain out of scope and unimplemented.

No Tenant DB writes, migration deployment, Prisma Client generation, commit, or push were performed in this checkpoint.


## Plan Update — 2026-11-13: แยก POS Workspace และ Online Commerce Workspace

- [x] ปรับ Product Vision ให้เป็น 2 Product Tracks และ Platform/Control Plane
- [x] ระบุ Tenant Database และ business data isolation ระหว่าง POS/Online อย่างชัดเจน
- [x] แยก route/navigation, Catalog, Pricing, Inventory, Customer, Order, Payment, Fulfillment, RBAC และ Reports ตาม Workspace Type
- [x] เพิ่ม POS-A0 ถึง POS-A7 และ ONL-B0 ถึง ONL-B7 เป็น Milestone roadmap แยกกัน
- [x] กำหนด Cross-Workspace Catalog Import/Export เป็น explicit workflow; live sync เป็น Future/Opt-in
- [x] ระบุ pos-local เป็น POS candidate เท่านั้น; Online ต้องใช้ Workspace/Tenant DB ใหม่
- [x] บันทึกว่า Decision เดิมเรื่อง shared Omnichannel data ถูก supersede โดย Architecture Decision ล่าสุด

**Scope ของการแก้ไขครั้งนี้:** แก้เอกสารแผนเท่านั้น ไม่มีการแก้ Source Code, Workspace Registry, Tenant Database, Migration, RBAC, Provisioning, Business Data, Deployment, Commit หรือ Push.

**หมายเหตุ:** Phase checklist เดิมคงไว้เป็นรายละเอียดงาน/ประวัติ backlog; การจัดลำดับและขอบเขตการทำงานต่อจากนี้ให้ยึด Product Tracks POS-A และ ONL-B รวมถึง Workspace Boundary ใหม่เป็นหลัก.
