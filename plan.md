# SyncUp — Product & Engineering Master Plan

**ฉบับ:** 2.41
**ปรับปรุงล่าสุด:** 2026-11-16
**สถานะ:** Architecture direction approved for planning; implementation is staged
**หลักการสูงสุด:** POS และ Online เป็นคนละ Workspace ที่แยกขอบเขตธุรกิจและข้อมูลอย่างเด็ดขาด

---

## 0. เป้าหมายของเอกสาร

เอกสารนี้เป็นแผนหลักฉบับใหม่ของ SyncUp ใช้แทน roadmap เดิมที่วาง POS และ Online เป็น Omnichannel ภายใน Workspace/ชุดข้อมูลเดียวกัน

เป้าหมายคือสร้างแพลตฟอร์มที่มีผลิตภัณฑ์ธุรกิจ 2 ระบบแยกจากกัน:

1. **SyncUp POS** — ระบบขายหน้าร้าน
2. **SyncUp Online** — ระบบร้านค้าออนไลน์

ทั้งสองระบบใช้ Platform กลางและ Source Code บางส่วนร่วมกันได้ แต่ไม่ใช้ Business Workspace, Tenant Database, Catalog, Stock, Order, Payment หรือวงจรปฏิบัติงานร่วมกัน

เอกสารนี้กำหนด Target Architecture, ขอบเขตผลิตภัณฑ์, ลำดับพัฒนา, วิธีเปลี่ยนจากระบบเดิม และเงื่อนไขก่อน Production

> การแก้ไขแผนนี้ไม่ใช่การอนุมัติให้เปลี่ยน Workspace จริง, สร้างฐานข้อมูล, ย้ายข้อมูล, Apply Migration, เปลี่ยน RBAC หรือ Deploy

---

## 1. Product Vision

### 1.1 SyncUp Platform

SyncUp เป็นแพลตฟอร์ม Multi-Workspace สำหรับผู้ประกอบการและองค์กร โดยผู้ใช้หนึ่งบัญชีสามารถเป็นสมาชิกได้หลาย Workspace แต่ละ Workspace เป็นพื้นที่ธุรกิจที่แยกจากกันโดยสมบูรณ์

ตัวอย่างการใช้งาน:
- เจ้าของกิจการใช้บัญชีเดียว Login แล้วเลือกเข้า POS Workspace
- เจ้าของคนเดิมสามารถเป็นสมาชิก Online Workspace อีกแห่งหนึ่งได้
- พนักงาน Cashier ของ POS ไม่ได้สิทธิ์เข้าถึง Online Workspace โดยอัตโนมัติ
- สินค้า SKU, ราคา, สต๊อก, ลูกค้า และยอดขายของสอง Workspace ไม่เชื่อมกัน เว้นแต่มี Integration ที่เปิดใช้งานอย่างชัดเจนในอนาคต

### 1.2 ผลิตภัณฑ์ที่อยู่ในขอบเขต

| มิติ | SyncUp POS | SyncUp Online |
|---|---|---|
| เป้าหมาย | ขายหน้าร้าน | ขายผ่านเว็บไซต์ |
| ผู้ใช้หลัก | Owner, Admin, Manager, Cashier, Inventory Staff | Owner, Admin, Manager, Catalog Staff, Order Staff |
| ประสบการณ์หลัก | ค้นหาสินค้า สแกน Barcode ตะกร้า Checkout | Storefront, Product Detail, Cart, Checkout |
| Catalog | Catalog สำหรับ POS Workspace | Catalog สำหรับ Online Workspace |
| ราคา | ราคาหน้าร้าน/สาขา | ราคาออนไลน์/โปรโมชั่นออนไลน์ |
| Stock | คลังและสาขาหน้าร้าน | Stock สำหรับ Online Fulfillment |
| Payment | เงินสด, QR, บัตร และ Tender หน้าร้าน | Payment Gateway และ Webhook |
| Order | POS Sale และ Receipt | Online Order และ Order Tracking |
| Fulfillment | รับสินค้าหน้าร้าน/จัดการงานขาย | Picking, Packing, Shipping |
| Hardware | Barcode Scanner, Receipt Printer, Cash Drawer | Web Browser และระบบขนส่ง/ชำระเงิน |
| รายงาน | ยอดขายรายกะ เงินสด สต๊อก และกำไร | ยอดขายออนไลน์ Conversion Payment และ Shipping |

### 1.3 Non-goals ในรุ่นแรก

- ไม่มี Shared Catalog หรือ Shared Inventory ระหว่าง POS กับ Online
- ไม่มี Order Inbox กลางที่รวมสองระบบ
- ไม่มีการ Sync ราคา สต๊อก ลูกค้า หรือคำสั่งซื้อโดยอัตโนมัติ
- ไม่มี Marketplace Connector เป็นค่าเริ่มต้น
- ไม่มีการย้าย POS Workspace ให้กลายเป็น Online Workspace
- ไม่มี Offline POS แบบเต็มรูปแบบใน MVP
- ไม่มี Accounting/General Ledger เต็มรูปแบบใน MVP

---

## 2. หลักการออกแบบ Workspace — ข้อกำหนดที่ห้ามละเมิด

### 2.1 Workspace คือ Business Boundary

POS และ Online ต้องเป็นคนละ Workspace Record, คนละ Workspace ID และคนละ Tenant Database

- POS Workspace หนึ่งชุดมีข้อมูลและการตั้งค่าของ POS เอง
- Online Workspace หนึ่งชุดมีข้อมูลและการตั้งค่าของ Online เอง
- Workspace แต่ละประเภทมี Module Profile, Navigation, Permission Profile และ Provisioning Template ของตนเอง
- ผู้ใช้คนเดียวเป็นสมาชิกของทั้งสอง Workspace ได้ แต่ Membership และ Role แยกจากกัน
- การลบ/ระงับ/เปลี่ยนสมาชิกใน Workspace หนึ่งไม่มีผลต่อ Membership ของอีก Workspace
- ห้ามใช้ Store ID, Product ID, User ID หรือ URL เป็นหลักฐานอนุญาตให้ข้าม Workspace

### 2.2 ข้อมูลที่ต้องแยก 100%

ข้อมูลต่อไปนี้เป็นข้อมูลภายใน Workspace เท่านั้น:

- Store, Branch, Warehouse, Register และ Shift
- Product, Variant, SKU, Barcode, UOM, Category และ Product Image
- Price List, Promotion, Discount และ Tax Configuration
- Stock Balance, Stock Movement, Reservation, Cost และ Valuation
- Customer, Address, Cart และ Customer Session
- Order, Order Item, Payment, Refund, Return และ Receipt
- Shipment, Fulfillment, Tracking และ Delivery Configuration
- Business Audit Log, Import Batch, Idempotency Key และ Document Sequence
- Workspace Settings, Business Files และ Media Metadata

ไม่มี Foreign Key ข้าม Tenant Database และไม่มี Query ที่อ่านตารางธุรกิจจาก Workspace อื่นโดยตรง

### 2.3 สิ่งที่ใช้ร่วมกันได้

ใช้ร่วมกันได้เฉพาะ Platform Capability และ Software Components ที่ไม่ทำให้ Business Data ปะปนกัน:

- User Identity, Authentication และ Session
- Workspace Registry และ Membership
- Workspace Provisioning Orchestrator
- Module Catalog และ Module Package Registry
- Shared UI Components, Types, Validation และ API Contracts
- Common Libraries เช่น Money, Decimal, Date/Time และ Address primitives
- Deployment Pipeline, Monitoring และ Logging Infrastructure

การใช้ Shared Code ไม่ได้หมายถึงการใช้ Shared Business Database

### 2.4 Cross-Workspace Access

ค่าเริ่มต้นคือ **DENY ALL**

หากอนาคตต้องส่งข้อมูลระหว่าง Workspace ให้ทำผ่าน Integration ที่กำหนด:
- Workspace ต้นทางและปลายทางอย่างชัดเจน
- Entity และ Field ที่อนุญาตให้ส่ง
- Mapping และ External ID
- Preview และ Approval ก่อน Import
- Idempotency, Retry, Dead-letter และ Audit
- Source of Truth และ Conflict Resolution
- การเพิกถอน Credential และหยุด Integration

---

## 3. Target Architecture

### 3.1 Logical Architecture

```text
                         SYNCUP PLATFORM
                 Identity / Login / Workspace Registry
                    Module Catalog / Provisioning
                               |
                    Workspace Selection / Membership
                               |
                 +-------------+-------------+
                 |                           |
          POS WORKSPACE                ONLINE WORKSPACE
          Type = POS                   Type = ONLINE
                 |                           |
          POS Tenant DB                Online Tenant DB
                 |                           |
          POS Modules                  Online Modules
          - POS Sales                  - Storefront
          - POS Catalog                - Online Catalog
          - Inventory                  - Cart / Checkout
          - Cashier / Shift            - Online Orders
          - POS Payments               - Gateway Payments
          - Receipt                    - Fulfillment / Shipping
                 |                           |
          POS Media Storage            Online Media Storage
          POS Configuration            Online Configuration

             No shared business tables / no implicit sync
```

### 3.2 Platform / Control Plane

รับผิดชอบเฉพาะ:
- User และ Authentication
- Workspace Registry: ID, Slug, Name, Type, Status
- Membership และ Platform-level administration
- Tenant Database Registry และ Credential Reference
- Module Catalog, Version และ Provisioning Profile
- Workspace Lifecycle: PROVISIONING, ACTIVE, SUSPENDED, FAILED
- Platform Audit และ Operational Metadata

ห้ามเก็บข้อมูลธุรกิจ เช่น Product, Price, Stock, Customer, Order หรือ Payment ไว้ใน Control Database

### 3.3 Workspace / Data Plane

แต่ละ Workspace มี:
- PostgreSQL Database ของตนเอง
- Runtime DB Role ของตนเองและ Least Privilege
- Tenant Migration Ledger และ Schema Version ของตนเอง
- Module Installation/Configuration ตาม Workspace Type
- Business RBAC และ Audit Log ของตนเอง
- Media Namespace / Storage Policy ของตนเอง
- Backup, Restore และ Retention Policy ของตนเอง

### 3.4 Workspace Type และ Provisioning Profile

กำหนด Workspace Type ที่ Control Plane:
- `POS`
- `ONLINE`

Workspace Type ต้องถูกกำหนดตั้งแต่การสร้าง Workspace และแก้ไขได้เฉพาะผ่านกระบวนการ Migration/Conversion ที่ออกแบบและอนุมัติแยกต่างหาก ห้ามแก้ Type ด้วยการเปลี่ยนค่าใน UI หรือ SQL แบบเฉพาะหน้า

Provisioning Profile เป็นตัวกำหนด:
- Tenant Schema Baseline
- Module Set
- Default Roles/Permissions
- Default Settings
- Navigation และ Workspace Landing Page
- Seed Data ที่เป็น System Defaults เท่านั้น

ห้าม Seed ข้อมูลธุรกิจตัวอย่างลง Workspace ที่จะใช้งานจริงโดยไม่มีการระบุว่าเป็นข้อมูลทดสอบ

---

## 4. Product Architecture — SyncUp POS

### 4.1 POS Workspace Modules

| Module | หน้าที่ |
|---|---|
| POS Foundation | Store, Branch, Register, Terminal และ Shift |
| POS Catalog | Product, Variant, Barcode, UOM และ POS Price |
| POS Inventory | Warehouse, Stock, Receiving, Transfer, Adjustment และ Stocktake |
| POS Checkout | Product Search, Cart, Discount, Tax และ Sale Posting |
| POS Tender | Cash, Card, QR และการบันทึกการรับชำระ |
| POS Returns | Void, Return, Refund และ Permission Control |
| POS Receipt | Receipt Number, Print, Reprint และ Audit |
| POS Reports | Sales Summary, Shift Summary, Cash Reconciliation และ Stock Reports |
| POS Settings | Store, Tax, Pricing, Register, Receipt และ Staff |

### 4.2 POS User Roles

- Owner — เจ้าของ Workspace และผู้อนุมัติการตั้งค่าระดับสูง
- Admin — ผู้ดูแลระบบหน้าร้าน
- Manager — ดูแลการขาย พนักงาน และอนุมัติรายการตามสิทธิ์
- Cashier — ขาย รับชำระ และปิดกะตามสิทธิ์
- Inventory Staff — รับเข้า โอน ปรับปรุง และตรวจนับสต๊อกตามสิทธิ์
- Viewer — อ่านข้อมูลที่ได้รับอนุญาต

Role และ Permission ทั้งหมดผูกกับ POS Workspace เท่านั้น

### 4.3 POS Core Workflow

1. เปิดกะ (Open Shift) และบันทึกเงินทอนเริ่มต้น
2. ค้นหาสินค้า/สแกน Barcode
3. เพิ่มสินค้าและปรับจำนวนใน Cart
4. ตรวจสอบราคา ส่วนลด ภาษี และ Stock ฝั่ง Server
5. ยืนยันการขายและสร้าง Sale Order แบบ Idempotent
6. บันทึก Tender/Payment และสถานะการชำระ
7. ออก Receipt และพิมพ์ซ้ำตาม Permission
8. ปิดกะและกระทบยอดเงินสด/ช่องทางชำระเงิน
9. จัดการ Return/Refund โดยอ้างอิงรายการเดิมและ Audit

### 4.4 POS Production Requirements

- ข้อมูลสินค้า Variant UOM Barcode และราคา POS จริง
- Tax Category/Profile/Rate ที่ได้รับการตรวจสอบ
- Opening Stock และ Inventory Reconciliation
- Seller/Branch/Receipt Identity
- Shift และ Cash Reconciliation
- Printer/Scanner/Cash Drawer Compatibility Test
- Backup เข้ารหัสและ Restore Rehearsal
- RBAC และ E2E สำหรับ Owner/Manager/Cashier/Inventory
- ไม่มีการคิดเงินผ่าน Gateway หากยังไม่ได้เชื่อมต่อและทดสอบจริง

---

## 5. Product Architecture — SyncUp Online

### 5.1 Online Workspace Modules

| Module | หน้าที่ |
|---|---|
| Online Store | Storefront, Theme, Domain, Store Status |
| Online Catalog | Product, Variant, Category, SEO และ Publish |
| Media Library | Product Images, Gallery, Derivatives และ Bulk Import |
| Online Pricing | Online Price List, Promotion และ Discount |
| Cart | Guest Cart, Session และ Cart Validation |
| Checkout | Customer, Address, Shipping Option, Tax และ Order Creation |
| Online Payment | Gateway Adapter, Payment Intent, Webhook และ Refund |
| Online Orders | Order Management, Cancellation และ Return |
| Fulfillment | Picking, Packing, Shipment และ Tracking |
| Customer | Online Customer Profile และ Order History |
| Online Reports | Conversion, Sales, Payment และ Shipping |
| Online Settings | Domain, SEO, Tax, Payment, Shipping และ Policy |

### 5.2 Online User Roles

- Owner
- Admin
- Manager
- Catalog Staff
- Order Staff
- Fulfillment Staff
- Customer Support
- Viewer

Role และ Permission ของ Online Workspace ไม่เชื่อมกับ POS Workspace

### 5.3 Online Customer Workflow

1. ผู้เข้าชมเปิด Public Store โดยไม่ต้อง Login
2. อ่านเฉพาะ Product/Variant ที่ Published
3. เลือก Variant และเพิ่ม Cart
4. ตรวจสอบราคา Promotion Tax และ Availability ฝั่ง Server
5. กรอกข้อมูลผู้ซื้อและที่อยู่จัดส่ง
6. เลือก Shipping Option
7. สร้าง Order และ Payment Intent
8. รับผลชำระผ่าน Gateway Webhook ที่ตรวจ Signature
9. ดำเนินการ Picking/Packing/Shipping
10. แสดง Order Tracking ผ่าน Token ที่เดายาก
11. จัดการ Cancel/Return/Refund ตาม Policy

### 5.4 Online Security Requirements

- Public API เปิดเฉพาะ Published Catalog และข้อมูลที่อนุญาต
- ห้ามเปิดเผย Cost, Internal Stock, Private Customer Data และข้อมูล POS
- ราคากับภาษีคำนวณใหม่จาก Server ห้ามเชื่อค่าจาก Browser
- Webhook ต้องตรวจ Signature, Replay และ Idempotency
- Guest Order ต้องใช้ Unpredictable Access Token
- Rate Limit, Bot/Abuse Protection และ Input Validation
- Privacy, Consent, Retention และ Data Export/Delete Policy
- Domain/SSL และ Public Media Delivery ต้องแยกตาม Online Workspace

---

## 6. Shared Platform Contracts และ Module Boundary

### 6.1 Shared Contracts

อนุญาตให้ใช้ Shared Contract สำหรับ:
- Money/Decimal/Quantity
- Tax Calculation Interface (แต่ Tax Configuration เป็นข้อมูลเฉพาะ Workspace)
- Product Read Model Interface (แต่ Product Record ไม่แชร์)
- Inventory Command/Query Interface (แต่ Stock Ledger ไม่แชร์)
- Order State Machine primitives (แต่ Order Record ไม่แชร์)
- Payment Provider Adapter Interface (แต่ Payment Account/Transaction ไม่แชร์)
- Media Storage Interface (แต่ Asset/Namespace ไม่แชร์)

### 6.2 Module Isolation

- Module ต้องประกาศ Workspace Type ที่รองรับ
- Module ที่เป็น POS-only ห้ามติดตั้งใน Online Workspace
- Module ที่เป็น Online-only ห้ามติดตั้งใน POS Workspace
- Shared Platform Module ไม่มีสิทธิ์ Query Tenant Business Data โดยตรง
- Module API ทุกตัวต้องรับ Workspace Context จาก Trusted Server Context
- Module ไม่สามารถเลือก Tenant DB จาก Client-supplied database name
- Module Upgrade ต้องมี Version, Migration, Rollback/Forward Plan และ Compatibility Check

### 6.3 Suggested Module Profiles

**POS Profile**
- platform.identity
- platform.workspace
- platform.rbac
- platform.audit
- pos.foundation
- pos.catalog
- pos.inventory
- pos.sales
- pos.tender
- pos.receipt
- pos.reporting

**ONLINE Profile**
- platform.identity
- platform.workspace
- platform.rbac
- platform.audit
- online.store
- online.catalog
- online.media
- online.pricing
- online.cart
- online.checkout
- online.payment
- online.fulfillment
- online.reporting

รายการนี้เป็น Target Module Profile ไม่ใช่คำยืนยันว่า Module ทั้งหมดมี Implementation พร้อมแล้ว

---

## 7. Identity, Membership และ Authorization

### 7.1 Identity

- หนึ่ง User Account ใช้ Login ได้หลาย Workspace
- User Account ไม่ใช่ Business Customer Record
- Customer ของ Online Workspace เป็นข้อมูลธุรกิจภายใน Online Tenant
- POS Customer (ถ้ามี) เป็นข้อมูลภายใน POS Tenant
- การปิด User Account ระดับ Platform อาจกระทบการ Login ทุก Workspace แต่การ Remove Membership กระทบเฉพาะ Workspace เป้าหมาย

### 7.2 Authorization Layers

1. Platform Authentication — ยืนยันตัวตนผู้ใช้
2. Workspace Membership — ตรวจว่าผู้ใช้เป็นสมาชิก Workspace นั้น
3. Workspace Status — ตรวจ ACTIVE/SUSPENDED
4. Workspace Type — ตรวจว่า Module/API รองรับ Type นั้น
5. Tenant Context — Resolve Database จาก Registry ฝั่ง Server
6. Workspace RBAC — ตรวจ Permission ของ Membership ใน Workspace นั้น
7. Resource Scope — ตรวจว่า Resource อยู่ใน Tenant/Store/Branch ที่อนุญาต

การซ่อนเมนูใน Frontend ไม่ใช่มาตรการรักษาความปลอดภัย

### 7.3 Workspace Switching

- ผู้ใช้เลือก Workspace จาก Workspace Selector
- Server ตรวจ Membership ใหม่ทุกครั้งที่เปลี่ยน Workspace
- API Request ต้องมี Trusted Workspace Context
- Cache Key, Session Context, Idempotency Key และ Audit ต้องมี Workspace Scope
- ห้ามใช้ข้อมูล Cache ของ Workspace ก่อนหน้าใน Workspace ใหม่

---

## 8. Database, Storage และ Operations

### 8.1 Database Isolation

- Control DB แยกจาก Tenant DB ทุกตัว
- POS Tenant DB และ Online Tenant DB แยกจากกัน
- แต่ละ Tenant DB มี Runtime Role เฉพาะและ Least Privilege
- Migration Ledger และ Schema Version แยกตาม Tenant
- ห้าม Runtime Role เข้าถึง Database ของ Tenant อื่น
- ห้าม Foreign Key ข้าม Database
- Backup/Restore ต้องระบุ Workspace ID และ Database เป้าหมายอย่างชัดเจน

### 8.2 Media / File Isolation

- POS Media และ Online Media ต้องมี Namespace/Storage Policy แยกกัน
- Object Key ต้องไม่อิงชื่อไฟล์จากผู้ใช้โดยตรง
- ตรวจ MIME จากเนื้อหาไฟล์จริง, จำกัดขนาด/Pixel, สร้าง Derivative และ Checksum
- Private Media ต้องอ่านผ่าน Authorized Endpoint
- Public Media อนุญาตเฉพาะ Asset ที่ Published โดย Online Workspace
- Storage Root/Bucket ต้องเป็น Durable Storage ไม่ใช่ Ephemeral Container Disk
- Backup/Restore ต้องรวม Metadata และไฟล์จริงให้สอดคล้องกัน
- Local Filesystem Adapter ที่มีอยู่เป็น Implementation เริ่มต้น; Production ต้องตรวจ Shared Volume, Multi-instance และ Backup/Restore ก่อนเปิดใช้

### 8.3 Audit / Observability

ทุก Business Event สำคัญต้องบันทึก:
- Workspace ID
- Actor / Service Identity
- Action และ Entity
- Correlation ID / Idempotency Key
- Timestamp
- Outcome และเหตุผลที่ปฏิเสธ

ห้ามเขียน Secret, Password, Access Token หรือข้อมูลชำระเงินที่ละเอียดอ่อนลง Log

### 8.4 Backup / Recovery

- Control DB และ Tenant DB มี Backup Policy แยก
- Backup ต้องเข้ารหัสและมีสำเนา Off-host
- Media Storage ต้องอยู่ใน Backup/Restore Scope
- กำหนด RPO/RTO ตามระดับบริการ
- ทดสอบ Restore จริงเป็นระยะ
- การ Restore ต้องป้องกันการเขียนทับ Workspace ผิดตัว

---

## 9. Workspace Lifecycle

### 9.1 Create Workspace

1. ผู้ใช้เลือก Create POS Workspace หรือ Create Online Workspace
2. ตรวจสิทธิ์/Entitlement และ Slug
3. สร้าง Workspace Registry Record พร้อม Type ที่เลือก
4. Provision Database ใหม่จาก Profile ที่ตรงประเภท
5. สร้าง Runtime Role/Credential แบบเฉพาะ Workspace
6. Apply Baseline Migration และ Module Migrations ตามลำดับ
7. ติดตั้ง Module Profile และ Default RBAC
8. สร้าง Owner Membership
9. ตรวจ Health/Schema/Permissions/Storage
10. เปลี่ยน Status เป็น ACTIVE เมื่อทุก Gate ผ่าน

หากขั้นตอนล้มเหลวต้องเป็น FAILED และไม่อนุญาตให้เข้าใช้งานจนกว่าจะ Reconcile สำเร็จ

### 9.2 Suspend / Resume / Delete

- Suspend ต้องปิดการเข้าถึง Business API แต่ไม่ลบข้อมูล
- Resume ต้องตรวจ Tenant Health, Schema และ Credential
- Delete ต้องมี Retention, Approval, Backup และ Irreversible Confirmation
- ห้ามลบ Tenant DB จากการลบ Membership ของ User
- การลบ Workspace เป็น Platform Lifecycle Operation แยกต่างหาก

### 9.3 Workspace Type Change

ไม่รองรับการเปลี่ยน POS เป็น ONLINE หรือกลับกันด้วยการแก้ Type ตรง ๆ

หากต้องการอีกระบบ ให้สร้าง Workspace ใหม่และนำเข้าข้อมูลผ่าน Controlled Import ในอนาคตเท่านั้น

---

## 10. Roadmap ใหม่ — ลำดับการพัฒนา

Roadmap นี้เป็นลำดับหลักแทน Phase/Omnichannel Roadmap เดิม

### Track 0 — Platform Separation Foundation (P0)

**เป้าหมาย:** ทำให้ Platform สร้างและควบคุม Workspace ที่เป็นคนละผลิตภัณฑ์ได้จริง

- [x] P0.1 กำหนด Workspace Type: POS / ONLINE ใน Control Plane — DONE (implementation + disposable migration rehearsal PASS; persistent DB migration ยังไม่ Apply)
- [x] P0.2 เพิ่ม Provisioning Profile และ Module Compatibility — DONE (POS/ONLINE code-backed profiles, manifest Workspace Type allowlist, API Install/Enable guard, legacy untyped fail-closed, disposable Control DB integration PASS; Profile ID/Version persistence remains P0.3)
- [x] P0.3 Workspace Registry เก็บ Type, Profile Version และ Lifecycle Metadata — DONE (nullable profile ID/version + provisioning lifecycle fields, type/profile validation, persisted-profile compatibility, disposable migration rehearsal PASS; persistent Control DB migration/backfill not applied)
- [x] P0.4 Workspace Selector แสดงประเภทและ Landing Page ตาม Workspace Type — DONE (persisted Profile/lifecycle display, legacy NULL fail-closed, POS/ONLINE landing separation, authenticated workspace switching, Playwright selector + POS shell regression 8/8 PASS; no persistent DB changes)
- [x] P0.5 API Guard ตรวจ Workspace Type และ Module Capability — DONE (route-scoped Membership, ACTIVE status, Type/Profile compatibility, enabled Module capability, POS business controllers guarded, unit/wiring 13/13 PASS, disposable integration PASS; no persistent DB changes)
- [x] P0.6 แยก Navigation/Default Roles/Permission Catalog ตาม Type — DONE (typed Core/Commerce Permission Catalog, POS/ONLINE role matrix, GET Roles read-only, cross-type permission/role guards, server-composed navigation, disposable Control DB integration PASS, Playwright 10/10 PASS; no persistent DB changes)
- [x] P0.7 ทดสอบ Cross-Workspace IDOR, Tenant Routing, Cache และ Media Access — DONE (route-scoped RBAC, Tenant client identity/single-flight and two-Tenant integration PASS; authenticated HTTP tests PASS for 46 non-member cross-Workspace mutations, 13 foreign nested Store/Branch/Warehouse/Product/Membership mutations, 3 foreign Product Media mutations, 3 foreign Variant Media mutations and 6 Platform Admin denials; foreign Inventory mutations 9/9 returned 404; foreign Sales mutations 6/6 returned 404 plus foreign Order Item generic 400; two-Workspace disposable Control/Tenant migrations and cleanup PASS; Media derivatives/Image Import ownership PASS; DB failure-matrix PASS; mutation-route inventory documented; mocked Workspace/POS UI regression 10/10 PASS; disposable authenticated Chromium Browser E2E PASS 7/7 with no skips; API-wide private/no-store response middleware and Next authenticated Workspace/Admin page no-store headers verified at local application origin; API build, Web typecheck and disposable DB/runtime-role/media cleanup PASS. External CDN/load-balancer/reverse-proxy cache acceptance is explicitly moved to final Deployment Track and is not claimed as tested here)
- [x] P0.8 สร้าง Workspace ใหม่แบบ POS-only และ ONLINE-only บน Disposable DB เพื่อทดสอบ Provisioning — DONE (real WorkspacesService/WorkspaceProvisioningService path; fresh disposable Control DB + two isolated Tenant DBs; POS/ONLINE profile identity, ACTIVE lifecycle, separate least-privilege runtime roles, type-specific RBAC/Commerce grants and baseline schema verified; exact test DBs/roles cleanup verified; no persistent DB changes)
- [x] P0.9 กำหนด Module Migration Order, Upgrade และ Failure Recovery — DONE (ordered Core/POS Tenant migration catalog; transactional/ledger/advisory-lock runner; POS receives Commerce/Inventory/Sales/Media, ONLINE receives Core-only; default module install/enable + audit after migration; runtime DDL/ledger denied; rollback/retry and Owner-only FAILED Workspace retry API/UI; disposable migration recovery PASS; authenticated Browser E2E 8/8 PASS including POS/ONLINE creation and retry; no persistent DB changes)
- [x] P0.10 ปรับ README/Architecture Docs ให้ตรงกับ Runtime จริง — DONE (README Local setup/tests/safety; database tenancy, authentication/RBAC, module activation, POS/ONLINE permission matrix, Core runtime boundaries, foundation scope and ADRs reconciled; stale active-doc claims removed; API/Web typecheck+build PASS; provisioning/migration recovery tests PASS; authenticated Browser E2E 8/8 PASS; Local API/Web HTTP 200; no persistent DB changes)

**Acceptance Gate:** สร้าง POS และ Online Workspace บน Disposable DB แล้วพิสูจน์ได้ว่าแต่ละตัวมี Database, Module Profile, RBAC และ API Scope แยกจากกัน

### Track 1 — SyncUp POS Product (P1)

**เป้าหมาย:** ทำ POS ให้พร้อมใช้งานจริงโดยไม่พึ่ง Online Modules

- [x] POS.1 ยืนยัน POS Provisioning Profile และ Tenant Schema — DONE (POS Standard Profile and seven ordered Tenant migrations verified on disposable POS Tenant; Commerce installed/enabled with audit; ONLINE remains Core-only; no persistent DB migration)
- [x] POS.2 Store/Branch/Warehouse/Register Configuration — DONE (Store/Branch/Warehouse CRUD + defaults; POS-only Register migration/API/UI; Branch-owned unique Register code; Admin/Manager manage, Cashier view-only; create/update/archive audit; Branch archive guard; cross-Tenant IDOR 404; duplicate code 409; authenticated Browser E2E 8/8; no persistent DB migration)
- [x] POS.3 Product/Variant/Barcode/UOM และ Store Assortment — DONE (multi-Variant create/update/archive; multiple normalized Barcodes; Tenant UOM master create/disable; Variant UOM conversion upsert/disable with Dimension + BASE guards; Store Assortment read/upsert UI/API; Product/Variant/Store Tenant ownership; audit; HTTP RBAC/IDOR/uniqueness tests; Browser E2E 9/9; no new migration or persistent DB change)
- [x] POS.4 POS Price/Promotion/Tax Configuration — DONE (effective-dated Store Variant/UOM prices with safe period replacement/history; Tax Category/Profile/Rate management and effective periods; Store Promotion code/automatic percentage/fixed discounts; checkout applies discount before tax and snapshots order/line discounts; POS Catalog preview and checkout code input; Pricing RBAC/Cashier denial; Tenant audit; new POS-only migration 20261115000200; existing Tenant backward-compatible reads; HTTP security/order math tests; Browser E2E 9/9; API/Web Typecheck+Build; migration recovery/provisioning isolation PASS; disposable cleanup PASS)
- [x] POS.5 Product Images ใน POS Workspace และ Storage Isolation — DONE (POS Catalog returns primary READY thumbnail from the same Tenant only; POS product cards render thumbnails with initials fallback; backward-compatible when media tables are absent; authenticated media reads remain membership/Tenant-scoped; disposable HTTP verifies own thumbnail URL, cross-Tenant 404, non-member 403 and no-store; path tests cover Workspace prefixes, traversal, absolute paths, Windows separators, symlinks and cleanup; API/Web Typecheck+Build PASS; disposable Browser E2E 9/9; no new migration, persistent DB changes, deployment, commit or push)
- [x] POS.6 Inventory Opening Stock/Receiving/Adjustment/Transfer/Stocktake — DONE (existing Tenant inventory ledger/API retained; Opening Stock draft/post/cancel and prior-activity guard; receiving, issue, counted-quantity adjustment, inter-Warehouse transfer; Stocktake UI finalize/cancel; Movement History; Inventory landing navigation to Opening Stock/Stocktake/History; disposable HTTP verifies posted opening balance, cancel, guard, receipt/adjust/issue/transfer and source/destination balances; foreign mutation IDs 9/9 return 404; Browser E2E 9/9; API/Web Typecheck+Build PASS; disposable cleanup PASS; no new migration or persistent DB changes)
- [x] POS.7 Costing/WAC และ Stock Availability — DONE (ใช้ WAC/InventoryCost per Warehouse+Variant และ immutable movement ledger เดิม; Balance API เพิ่ม average_unit_cost, inventory_value และ cost_reconciled พร้อม fail-closed UI เมื่อข้อมูลต้นทุนไม่สอดคล้อง; Inventory UI แสดง On-hand/Reserved/Available/WAC/Inventory Value; POS Catalog label ระบุ Available-after-reservation เป็น “พร้อมขาย”; Disposable concurrency/WAC test ตรวจ weighted receipt, NUMERIC rounding, reversal, reconciliation mismatch/recovery, reservation availability และ HTTP RBAC; Sales Orders service E2E ตรวจ reservation/posting WAC snapshots/returns/refunds/concurrency/rollback; disposable authenticated Browser E2E 9/9; API/Web Typecheck+Build PASS; no new migration, persistent DB changes, deployment, commit or push)
- [x] POS.8 POS Catalog Search และ Barcode Scanner Workflow — DONE (POS Catalog exact alternate Barcode matching returns the actual matched barcode and UOM usage; exact barcode results rank first; keyboard-wedge USB/Bluetooth scanner Enter adds exactly one item, queues while catalog search is in flight, clears/refocuses scanner input; BASE UOM selected deterministically where barcode maps to multiple sell UOMs; ambiguous/no-match/out-of-stock feedback; repeated scans capped by Available; manual name/SKU/partial Barcode search preserved; disposable API HTTP asserts alternate barcode/exact match/BASE UOM/no fuzzy unknown match; Browser E2E 10/10 PASS; API/Web Typecheck+Build PASS; disposable cleanup PASS; no new migration or persistent DB changes, no deploy/commit/push)
- [x] POS.9 Cart/Discount/Tax/Checkout — DONE (POS Cart แสดงยอดก่อนส่วนลด/ส่วนลดโปรโมชั่น/ยอดหลังส่วนลดก่อนภาษี/ภาษี/ยอดสุทธิ; Checkout แสดง estimated breakdown และแยก authoritative Server Order totals หลังสร้าง Order; รองรับ automatic promotion discount และแจ้งชัดเจนว่า Promotion Code คำนวณจริงจาก Server; ปรับ quantity editor ไม่ลบ line ระหว่างพิมพ์และ clamp ตาม Available; ปัดเศษยอดรวมตาม currency minor units; Browser E2E 15/15 PASS ครอบคลุม inclusive/exclusive tax, discount, quantity editing, code discount notice และ Server totals; Sales Orders service E2E PASS (idempotency/reservation/tax/WAC/rollback/concurrency/payment); API/Web Typecheck+Build PASS; no new migration or persistent DB changes; no deploy/commit/push)
- [x] POS.10 Sale Posting/Idempotency/Payment Ledger — DONE (ยืนยัน Order/Stock Movement/WAC snapshot ใน transaction เดียว; payload-bound idempotency และ replay/conflict; Payment/Refund บังคับ currency minor-unit precision ตาม Order; รองรับ CASH/CARD/BANK_TRANSFER/OTHER และ split tender ledger; เพิ่ม disposable E2E สำหรับ sub-minor-unit rejection, concurrent tender ป้องกัน overpayment, concurrent refund ป้องกัน over-refund และ ledger reconciliation; API Typecheck/Build + Sales Orders service E2E PASS, disposable cleanup PASS; Web Typecheck/Build PASS, POS Browser E2E 15/15 PASS; Orders management Browser E2E 1 test SKIPPED by runner; no new migration or persistent DB changes; no deploy/commit/push)
- [x] POS.11 Cashier Register/Shift/Open Float/Cash Movement — DONE (POS Tenant migration cashier_shifts/cash_movements; one OPEN Shift per Register/Cashier; Opening Float, Cash In/Out, payload-bound idempotency/audit and expected cash from CASH payment ledger; prevent overdraw and block close for RESERVED/unpaid POSTED Orders; Register archive guard; POS checkout requires active Shift; Cashier management UI; API/Web Typecheck+Build PASS; disposable Sales Orders/Cashier Shift E2E PASS with cleanup; POS Browser E2E 16/16 PASS; no persistent DB changes, no deploy/commit/push)
- [x] POS.12 Receipt/Print/Reprint — DONE (software acceptance: persisted Order/Payment receipt, discount/tax/refund totals, 58/80 mm layout, browser print and Orders reprint; Web Typecheck/Build PASS; POS Browser E2E 17/17 PASS. Direct printer transport, cutter and physical acceptance are DEFERRED to independent Hardware Integration Backlog; not a blocker for POS milestones)
- [x] POS.13 Return/Void/Refund และ Approval — DONE (API/Web Typecheck+Build PASS; disposable Sales Orders service E2E PASS with cleanup; RBAC matrix PASS; Sales Approval Browser E2E 1/1 และ POS Browser E2E 17/17 PASS; เพิ่ม authenticated HTTP E2E ผ่าน Nest guards/controllers ครอบคลุม login/session cookie, unauthenticated/invalid-Origin rejection, Owner/Manager/Cashier/Viewer RBAC, create/idempotency, cancel/post/payment/return/refund และ ledger; PASS พร้อม Disposable Control/Tenant DB และ runtime role cleanup; harness เพิ่ม stage-by-stage progress logs, Prisma connect/pool/socket/statement/lock timeouts, Prisma lifecycle/permission snapshot อยู่ภายใน cleanup scope; แก้การ replay tenant schema migrations และทดสอบ Module Activation ผ่าน WorkspacesService ให้ตรง runtime behavior; no persistent DB migration, no deploy/commit/push)

- [ ] POS.14 Shift Close/Cash Reconciliation — IN PROGRESS (เพิ่ม Expected Cash reconciliation โดยหัก CASH Refunds, ตรวจ Cash Out เทียบ Expected Cash ด้วย NUMERIC, validate จำนวนเงินแบบ positive decimal string; เพิ่ม Shift History API พร้อม scope ตาม role (Manager/Admin/Owner เห็นทั้งหมด, Cashier เห็นเฉพาะของตน) และ permission `commerce.shift.view`; เพิ่ม Cashier History UI แสดง Expected/Counted/Variance/Status/Timestamps/Note; Service E2E และ authenticated HTTP/RBAC E2E PASS บน Disposable DB พร้อม cleanup, API Build และ CJS syntax check PASS; Browser E2E/Regression, full acceptance review และ Documentation ยัง PENDING; no persistent DB migration, no deploy)
- [ ] POS.15 Sales/Inventory/Profit Reports
- [ ] POS.16 RBAC, Security, Backup/Restore และ Full E2E
- [ ] POS.17 Local Product Acceptance Review และเตรียม Release Evidence

**Acceptance Gate:** ทำธุรกรรมจำลองครบตั้งแต่เปิดกะจนปิดกะ ตรวจเงิน/สต๊อก/ภาษี/Receipt ได้ และผ่าน Backup/Restore + Security + E2E

### Hardware Integration Backlog (แยกจาก POS Milestone)

งานฮาร์ดแวร์ไม่เป็น Dependency ที่ขวาง POS.13–POS.17 และจะเริ่มเมื่อมีอุปกรณ์จริงและทราบรุ่น/การเชื่อมต่อ
- [ ] H1 Receipt Printer — Printer Capability Contract, Adapter/Transport (เลือก ESC/POS/USB/Serial/Network ตามรุ่น), Register pairing, print job/retry/audit, Thai glyph/58/80 mm/feed/cut physical acceptance
- [ ] H2 Cash Drawer — Drawer Capability Contract, printer-pulse/direct interface ตามอุปกรณ์, Register pairing, permission-gated explicit open command, audit/failure handling และ physical acceptance
- รายละเอียด: `docs/architecture/hardware-integration-backlog-2026-11-16.md`

### Track 2 — SyncUp Online Product (P2)

**เป้าหมาย:** สร้างระบบร้านค้าออนไลน์ใน Workspace ใหม่ โดยไม่มี Dependency กับ POS Workspace

- [ ] ONL.1 สร้าง Online Workspace จาก Online Provisioning Profile และ Tenant DB ใหม่
- [ ] ONL.2 Online Store Identity/Domain/Theme/Publish Lifecycle
- [ ] ONL.3 Product/Variant/Category และ Online Catalog
- [ ] ONL.4 Media Library/Gallery/ZIP Import/SEO
- [ ] ONL.5 Online Pricing/Promotion/Tax/Availability
- [ ] ONL.6 Public Storefront/Search/Filter/Product Detail
- [ ] ONL.7 Guest Cart และ Session Management
- [ ] ONL.8 Checkout/Address/Shipping Options
- [ ] ONL.9 Online Order Creation และ Reservation Policy
- [ ] ONL.10 Payment Gateway Adapter/Payment Intent/Webhook
- [ ] ONL.11 Order Management/Cancel/Return/Refund
- [ ] ONL.12 Picking/Packing/Shipping/Tracking
- [ ] ONL.13 Customer Notification/Order Tracking
- [ ] ONL.14 Online Reports/Conversion/Payment/Shipping
- [ ] ONL.15 Privacy/Security/Performance/Backup/Restore/E2E
- [ ] ONL.16 Local Product Acceptance Review และเตรียม Release Evidence

**Acceptance Gate:** ลูกค้าทดลองเข้าหน้า Public Store → เลือกสินค้า → Checkout → ชำระผ่าน Gateway Sandbox → Fulfillment → Tracking ได้ โดยไม่เข้าถึง POS Tenant หรือข้อมูลภายใน

### Track 3 — Explicit Workspace Data Transfer (P3 / Optional)

- [ ] กำหนด Use Cases ที่ต้องส่งข้อมูลระหว่าง POS และ Online
- [ ] ออกแบบ Export/Import Format และ External ID Mapping
- [ ] รองรับ Preview, Duplicate Detection, Validation และ Approval
- [ ] Import แบบ Idempotent พร้อม Row-level Result และ Audit
- [ ] กำหนด Data Ownership และ Conflict Policy
- [ ] ทดสอบการส่งข้อมูลโดยไม่เปิด Cross-Database Query

เริ่มจาก Catalog Export/Import แบบผู้ใช้สั่งงานเท่านั้น ยังไม่ทำ Live Sync

### Track 4 — Optional Integration (P4 / Future)

พิจารณาเมื่อ POS และ Online แยกอิสระและผ่าน Local Product Acceptance แล้วเท่านั้น:
- Outbox/Inbox Event Integration
- Selected Stock Availability Feed
- Order/Customer Reference Integration
- Consolidated Analytics Projection

ทุก Integration ต้อง Opt-in, มี Workspace Pair, Contract, Permission, Audit, Retry และ Kill Switch

### Track 5 — Final Release & Deployment (LAST)

**เงื่อนไขเริ่ม:** Track 0–4 และทุก Module ใน Release Scope พัฒนาเสร็จ ผ่าน Local Acceptance, Security, Regression, Backup/Restore, Operational Readiness และเอกสารครบแล้วเท่านั้น

- [ ] DEPLOY.1 Freeze Scope และจัดทำ Release Candidate
- [ ] DEPLOY.2 Full Local Regression: POS + Online + Workspace Isolation + API/Web + Database Migration/Upgrade
- [ ] DEPLOY.3 Backup/Restore และ Disaster Recovery Acceptance
- [ ] DEPLOY.4 Security/Privacy/Performance/Observability Final Review
- [ ] DEPLOY.5 ตรวจ Deployment Architecture, Secrets, TLS, CDN/Reverse Proxy/Load Balancer และ Edge Cache Rules
- [ ] DEPLOY.6 Staging Rehearsal ด้วยข้อมูลทดสอบและ Migration/Rollback Plan
- [ ] DEPLOY.7 Production Approval, Backup Confirmation และ Change Window
- [ ] DEPLOY.8 Deploy และตรวจ Post-deployment Health/Cache/Isolation/Smoke Tests
- [ ] DEPLOY.9 Release Sign-off และ Handoff/Operations Runbook

**Acceptance Gate:** ห้าม Deploy ก่อน Track 0–4 เสร็จและผ่านเกณฑ์ทั้งหมด รวมถึงอนุมัติ Target, Backup, Migration, Security, Rollback และ Change Window อย่างชัดเจน

---

## 11. แผนแยกจากระบบเดิม (Legacy Separation & Migration)

### 11.1 สถานะระบบเดิมที่ทราบ

- Platform ปัจจุบันมี Control Database และ Tenant Database แยกกันแล้ว
- Control Schema มี User, Workspace, WorkspaceDatabase, Membership, RBAC และ ModuleInstallation
- Control Schema ปัจจุบันยังไม่มี Workspace Type/Provisioning Profile ตาม Target Architecture นี้
- Tenant Schema ปัจจุบันมี Commerce/Store/Product/Media/Inventory/Sales หลาย Domain อยู่ใน Schema เดียว
- มี POS implementation และข้อมูลทดสอบ/ข้อมูลตั้งต้นใน Workspace ชื่อ `pos-local`
- มี Sales Orders/Returns/Payments และ Product Media Upload implementation ใน Repository
- Migration สำหรับ Product Media เป็น Candidate ที่ยังไม่ได้ Apply กับ Tenant DB
- การมี Workspace Database แยกอยู่แล้วไม่ได้แปลว่า POS กับ Online แยกเป็น Workspace Type และ Module Profile แล้ว

### 11.2 Target Mapping

| ระบบ/ข้อมูลเดิม | แนวทาง |
|---|---|
| Control DB | คงเป็น Platform Control Plane และเพิ่ม Type/Profile ผ่าน Migration ที่ออกแบบ |
| pos-local | ใช้เป็น POS Candidate ต่อไป; ห้ามเปลี่ยนเป็น Online |
| Tenant Schema เดิม | ตรวจ Module Dependency และแยก POS/Online Provisioning Baseline |
| POS Code | จัดเป็น POS Modules และจำกัด Workspace Type |
| Online Code ที่มี/พัฒนาใหม่ | จัดเป็น Online Modules และ Online Tenant ใหม่ |
| Product/Media Data | ไม่ Copy ข้าม Workspace อัตโนมัติ |
| Orders/Payments/Inventory | คงอยู่ใน Workspace ต้นทาง; ไม่ย้ายหรือรวมโดยไม่มีแผนเฉพาะ |

### 11.3 Migration Strategy

1. Inventory ตาราง, API, Module และ Permission ที่มีอยู่จริง
2. ทำ Dependency Map ระหว่าง Domain และ Migration
3. แยก Core Tenant Baseline ออกจาก POS/Online Module Schema
4. สร้าง Disposable POS Database และ Online Database ใหม่
5. Rehearse Provisioning/Migrations/Module Install ทั้งสองแบบ
6. ทดสอบ Runtime Role และ Cross-Tenant Denial
7. วางแผน Cutover สำหรับ Workspace เดิมแยกเป็นราย Workspace
8. สำรองข้อมูลและกำหนด Rollback/Forward Recovery
9. ขออนุมัติ Workspace เป้าหมายและ Migration แต่ละครั้งก่อน Apply

**ข้อห้าม:** ห้าม Drop ตารางเดิม, ห้าม Split Tenant Database จริงโดยอัตโนมัติ, ห้ามเปลี่ยน Type ของ Workspace เดิม, ห้าม Copy/Move Business Data โดยไม่มี Mapping/Preview/Approval

---

## 12. Security & Quality Gates

ทุก Workspace ต้องผ่านรายการต่อไปนี้ก่อน Production:

### Isolation
- [ ] Cross-Workspace API Access ถูกปฏิเสธ
- [ ] Tenant Database Routing มาจาก Trusted Registry
- [ ] Runtime DB Role เข้า DB อื่นไม่ได้
- [ ] Cache/Queue/Object Storage แยก Workspace
- [ ] Media URL และ Download ตรวจ Permission/Publish State
- [ ] Logs และ Audit มี Workspace Context

### Business Integrity
- [ ] Money ใช้ Decimal/NUMERIC ไม่ใช้ Floating Point
- [ ] Stock/Payment/Refund ใช้ Transaction และ Idempotency
- [ ] Document Sequence ไม่ชนกันข้าม Workspace
- [ ] Audit Log ครบและแก้ย้อนหลังไม่ได้ตามนโยบาย
- [ ] API ตรวจราคา/ภาษี/สิทธิ์/Availability ฝั่ง Server

### Operational Readiness
- [ ] Encrypted Backup และ Off-host Copy
- [ ] Restore Rehearsal
- [ ] Migration Rehearsal
- [ ] Runtime Privilege Audit
- [ ] Monitoring/Alert/Log Redaction
- [ ] Incident และ Recovery Runbook
- [ ] E2E ตาม Role และ Workflow
- [ ] Owner Acceptance Sign-off

---

## 13. Definition of Done

งานหนึ่ง Milestone ถือว่าเสร็จเมื่อ:
1. ขอบเขต Workspace และ Module ชัดเจน
2. API และ UI ทำงานตาม Permission
3. ไม่มี Cross-Workspace Data Leakage
4. Migration มี Candidate, Review และ Rehearsal
5. Unit/Integration/E2E ผ่านตามขอบเขต
6. Audit/Idempotency/Failure Handling ครบตามความเสี่ยง
7. Documentation และ Operational Runbook อัปเดต
8. ไม่มีการอ้างว่า Production-ready หากยังขาดข้อมูลจริง, Backup, Security หรือ Approval

การ Build ผ่านอย่างเดียวไม่ถือว่า Milestone ผ่าน Production Acceptance

---

## 14. ลำดับงานถัดไปที่แนะนำ

**เริ่มจาก Track 0 — Platform Separation Foundation**

ลำดับย่อย:
1. ตรวจ Workspace Registry, Control Schema และ Provisioning Flow ปัจจุบัน
2. ออกแบบ Control DB Migration เพิ่ม `workspace_type` และ `provisioning_profile` แบบ Backward-compatible
3. ออกแบบ POS/ONLINE Module Compatibility และ Provisioning Manifest
4. สร้าง Disposable Database Templates แยก POS/ONLINE
5. ทดสอบสร้าง Workspace ใหม่ทั้งสองประเภทและพิสูจน์ Isolation
6. จึงเริ่ม POS Hardening บน `pos-local` และสร้าง Online Workspace ใหม่ในขั้นตอนที่แยกอนุมัติ

**ห้ามเริ่มด้วยการย้ายข้อมูลหรือแก้ Tenant Database จริงก่อนผ่าน Disposable Rehearsal**

---

## 15. Current Project Status — Baseline ณ 2026-11-13

สถานะนี้เป็น Snapshot จากงานที่มีอยู่ ไม่ใช่การรับรอง Production:

| Area | สถานะปัจจุบัน | หมายเหตุ |
|---|---|---|
| Platform Identity / Workspace | มี Implementation | Workspace Type and persisted Profile ID/Version + provisioning lifecycle metadata implemented (P0.1–P0.3); persistent Control DB migration remains pending approval |
| Tenant DB per Workspace | มี Implementation | Type-aware Profile ID/Version persisted for newly created Workspaces (P0.3); automatic module installation and type-specific Tenant schema baselines remain future milestones |
| POS Inventory | มี Implementation บางส่วน | Inventory workflows และ UI มี แต่ต้องตรวจแยก Module/Profile |
| POS Sales | มี Implementation บางส่วน | Orders/Returns/Payments มี Migration ใน pos-local แล้ว |
| POS UX | มี Implementation บางส่วน | POS Shell/Catalog/Cart/Checkout/Receipt มี แต่ Production Gates ยังไม่ครบ |
| Product Media | Code Implemented | Migration Candidate ยังไม่ Apply; Storage ต้องใช้ Durable Shared Volume และทดสอบจริง |
| Online Workspace Type | Registry + persisted profile/lifecycle implemented (P0.1–P0.3 DONE) | Online profile intentionally has no eligible modules yet; dedicated Online modules/provisioning and persistent Control DB migration remain future gates |
| Online Storefront/Checkout | ยังไม่ผ่านการยืนยันเป็นผลิตภัณฑ์แยก | ห้ามถือว่า POS/Commerce code ปัจจุบันเป็น Online Product พร้อมใช้ |
| Cross-Workspace Security | Service/DB/filesystem + authenticated HTTP isolation tests PASS on disposable DBs; Store/Branch/Warehouse/Product/Membership + Product/Variant Media nested mutation IDs PASS; Inventory 9/9 foreign mutation IDs return 404; Sales 6/6 foreign Order/Payment/Return IDs return 404 and foreign Order Item returns generic 400; mocked Workspace/POS UI regression 10/10 PASS; disposable authenticated Chromium Browser E2E: 6/6 PASS, no skips (real disposable Control/Tenant DB/API for Owner login, POS catalog/cart, Product CRUD/Cashier RBAC, Manager + Inventory Staff Inventory UI, Orders create/post/payment; stocktake API mocked) | Store/Branch/Warehouse management, Orders Return/Refund browser workflows and deployment edge-cache acceptance remain open; P0.7 IN PROGRESS |
| Cross-Workspace Integration | ยังไม่มีและไม่ใช่ Default | เป็น Optional Future Track |
| Production Readiness | ยังไม่ผ่าน | Backup encryption/off-host, ข้อมูลจริง, hardware/payment และ acceptance ยังเป็น Gate |

### Workspace ที่มีอยู่ในบริบทของโครงการ

- `pos-local` — Candidate สำหรับ POS; ไม่ใช่ Online Workspace
- `e2e-commerce-20261106` — Workspace สำหรับ E2E/ทดสอบ; ห้ามนำไปใช้เป็น Production Online โดยอนุมาน
- Workspace ใหม่สำหรับ Online Production ต้องสร้างใหม่หลัง Track 0 ผ่านและได้รับอนุมัติ

---

## 16. Decision Log

| วันที่ | การตัดสินใจ | ผล |
|---|---|---|
| 2026-11-13 | รื้อ Master Plan ใหม่และแยก POS/Online เป็นคนละ Workspace | ใช้เป็น Architecture Direction ล่าสุด |
| 2026-11-13 | แต่ละ Workspace ต้องมี Tenant DB และ Business Data ของตนเอง | ห้าม Shared Business Tables/Implicit Sync |
| 2026-11-13 | Shared ได้เฉพาะ Platform Identity และ Software Components | Shared Code ไม่เท่ากับ Shared Data |
| 2026-11-13 | ผู้ใช้คนเดียวเป็นสมาชิกหลาย Workspace ได้ | Membership/RBAC แยกต่อ Workspace |
| 2026-11-13 | `pos-local` คงเป็น POS Candidate | ห้าม Convert เป็น Online |
| 2026-11-13 | Online ต้องเป็น Workspace และ Tenant DB ใหม่ | ไม่ Reuse POS Tenant |
| 2026-11-13 | Cross-Workspace Integration เป็น Optional/Opt-in | Default = ไม่มีการ Sync |

---

## 17. Change Control

- การแก้ Master Plan ไม่ได้อนุญาตให้เปลี่ยนระบบจริง
- Control DB Migration ต้องระบุ Target Environment, Backup, Rehearsal และ Approval
- Tenant Migration ต้องระบุ Workspace ID, Database และ Migration Version
- Data Import/Export ต้องมี Preview, Mapping, Approval และ Audit
- Production Activation ต้องมี Readiness Report และ Owner Sign-off
- ห้าม Commit, Push หรือ Deploy เว้นแต่ได้รับคำสั่งอย่างชัดเจน
- ต้องรักษา Uncommitted Changes ที่มีอยู่เดิม และห้าม Reset/Clean เพื่อให้ Working Tree สะอาด

---

## 18. Plan Revision History

- **v2.41 — 2026-11-16:** บันทึกความคืบหน้า POS.14: เพิ่ม Expected Cash/Reconciliation safeguards, Shift History API ที่ enforce role scope และ permission, Cashier History UI; `npm run test:sales-orders` และ `npm run test:sales-orders-http` PASS บน Disposable DB พร้อม cleanup, API Build/CJS syntax/git diff checks PASS; POS.14 คงสถานะ IN PROGRESS เนื่องจาก Browser E2E/Regression, Full Acceptance และ Documentation ยัง pending; ไม่มี Persistent DB migration, no deploy
- **v2.40 — 2026-11-16:** ปิด POS.13 หลัง authenticated HTTP E2E ผ่านจริงผ่าน Nest guards/controllers; ยืนยัน Auth/session, invalid Origin, Owner/Manager/Cashier/Viewer RBAC, Sales Order idempotency, cancel/post/payment/return/refund และ ledger; Disposable Control/Tenant DB และ runtime role cleanup PASS; ปรับ E2E harness เพิ่ม Progress Logs/Prisma timeouts/outer cleanup scope, ไม่ replay tenant schema migrations ที่ WorkspaceProvisioningService ใช้ไปแล้ว และ bootstrap/enable Commerce module ใน disposable workspace ให้ตรง production flow; API build + node syntax check PASS; no persistent DB migration, no deploy/commit/push
- **v2.39 — 2026-11-16:** สร้างและตรวจสอบ authenticated Sales Orders HTTP E2E harness; ตรวจ process ที่ timeout, แยก disposable database ออกจาก persistent data และปรับ Serena/TypeScript language server; HTTP E2E ยัง pending ใน revision นี้; ไม่มี Persistent DB changes, no deploy/commit/push
- **v2.38 — 2026-11-16:** แยก Receipt Printer และ Cash Drawer ออกจาก POS.12 เป็น Hardware Integration Backlog อิสระ; ปิด POS.12 เฉพาะ Software Acceptance และไม่ให้ Physical Hardware เป็น Gate ขวาง POS.13–POS.17; เริ่ม POS.13 ด้วย Tenant Approval Request ledger สำหรับ VOID/RETURN/REFUND, แยก Cashier request กับ Manager/Admin approve/reject, self-approval guard, deterministic idempotency, Orders UI approval queue/history; API/Web Typecheck+Build PASS, disposable Sales Orders service E2E PASS (VOID/RETURN/REFUND approval + cleanup), RBAC matrix PASS, Sales Approval Browser E2E 1/1 และ POS Browser E2E 17/17 PASS; ไม่มี Persistent DB changes, no deploy/commit/push
- **v2.37 — 2026-11-16:** POS.11 Cashier Register/Shift ปิดสมบูรณ์และมี Implementation Report; POS.12 Receipt/Print/Reprint software implementation complete โดยใช้ persisted Order/Payment data, แสดง order/line discount, tax, payment/refund/balance, รองรับ 58/80 mm, print-media styling และ reprint จาก Orders; Web Typecheck/Build PASS, POS Browser E2E 17/17 PASS และ git diff --check PASS; physical thermal printer acceptance ยัง PENDING เพราะไม่มี printer/driver จริงใน session; ไม่เพิ่ม API/DB/Migration และไม่มี Persistent DB changes; ไม่ Deploy/Commit/Push
- **v2.34 — 2026-11-15:** ปิด POS.9; POS Cart แสดง subtotal/automatic promotion discount/net/tax/total; Checkout แสดง estimated breakdown และ authoritative Server Order totals หลังสร้าง Order; แจ้งแยก Promotion Code ที่คำนวณโดย Server; quantity editor รองรับ transient empty input และ clamp ตาม Available; currency-minor-unit rounding; Browser E2E 15/15 PASS รวม inclusive/exclusive tax, discount, quantity edit, checkout breakdown และ Server totals; Sales Orders service E2E PASS ครอบคลุม idempotency, reservation, tax, WAC, rollback, concurrency และ payment; API/Web Typecheck+Build PASS; no new migration or persistent DB changes; POS.10 เป็นขั้นตอนถัดไป; ไม่ Deploy/Commit/Push
- **v2.33 — 2026-11-15:** ปิด POS.8; POS Catalog ค้นหา Alternate Barcode แบบ exact, ส่งกลับ matched barcode/UOM usage และจัดอันดับ Exact Match ก่อนผลค้นหาอื่น; POS Keyboard Wedge Scanner Enter เพิ่มสินค้าลง Cart, รองรับ pending catalog response, auto-clear/refocus, BASE UOM selection, unknown/ambiguous/out-of-stock feedback และ Available quantity cap; manual name/SKU/partial barcode search ยังทำงาน; Disposable HTTP ตรวจ Alternate Barcode/exact match/BASE UOM/no fuzzy unknown match; Browser E2E 10/10 PASS; API/Web Typecheck+Build PASS; Disposable POS Tenant cleanup PASS; ไม่มี Migration ใหม่หรือ Persistent DB changes; POS.9 เป็นขั้นตอนถัดไป; ไม่ Deploy/Commit/Push
- **v2.32 — 2026-11-15:** ปิด POS.7; Balance API เปิดเผย WAC/Inventory Value พร้อม cost reconciliation guard; Inventory UI แสดง On-hand/Reserved/Available/WAC/Inventory Value และ POS Catalog ใช้คำว่า “พร้อมขาย” สำหรับ Available หลังหัก Reservation; Disposable concurrency/WAC tests, Sales Orders service E2E และ authenticated Browser E2E 9/9 PASS; API/Web Typecheck+Build PASS; no new migration or persistent DB changes; POS.8 เป็นขั้นตอนถัดไป; ไม่ Deploy/Commit/Push
- **v2.31 — 2026-11-15:** ปิด POS.6; เชื่อม Navigation ของ Inventory ไปยัง Opening Stock/Stocktake/Movement History; เพิ่ม Disposable HTTP workflow tests สำหรับ Opening Stock post/cancel/guard, receipt, adjustment, issue และ inter-Warehouse transfer พร้อมตรวจ ledger balances; Browser E2E 9/9, API/Web Typecheck+Build, IDOR 9/9 และ disposable cleanup PASS; ไม่เพิ่ม Migration, ไม่แก้ Persistent DB, ไม่รัน pos-local หรือ existing Workspace migration, ไม่ Deploy/Commit/Push; POS.7 เป็นขั้นตอนถัดไป
- **v2.30 — 2026-11-15:** ปิด POS.5; POS Catalog แสดง Primary READY Product thumbnail จาก Tenant เดียวกันและ POS UI มี initials fallback; backward-compatible เมื่อ Tenant เก่าไม่มี Media tables; ตรวจ Media membership/Tenant authorization, cache headers, Workspace storage prefix, traversal/symlink protection และ cleanup; disposable HTTP ตรวจ own thumbnail URL, cross-Tenant 404, non-member 403; Browser E2E 9/9 PASS; API/Web Typecheck+Build PASS; ไม่มี Migration ใหม่, persistent DB changes, existing Workspace migration, deploy, commit หรือ push; POS.6 เป็นขั้นตอนถัดไป
- **v2.29 — 2026-11-15:** ปิด POS.4; เพิ่ม Store Variant/UOM effective-dated pricing, Tax Category/Profile/Rate management, Store Promotions (code/automatic, percent/fixed) และ Sales Order discount snapshots; POS Catalog/Checkout integration; RBAC, audit, existing Tenant compatibility; เพิ่ม POS-only migration 20261115000200; HTTP integration + Browser E2E 9/9 PASS; Sales Orders service E2E, migration failure recovery, POS/ONLINE provisioning isolation, API/Web Typecheck+Build และ disposable cleanup PASS; ไม่มี persistent DB changes, existing Workspace migration, deploy, commit หรือ push; POS.5 เป็นขั้นตอนถัดไป
- **v2.28 — 2026-11-15:** ปิด POS.3; เพิ่ม Multi-Variant API/UI, Barcode หลายรายการต่อ Variant, Tenant UOM master และ Variant UOM conversion, Store Assortment API/UI; เพิ่ม ownership/RBAC/duplicate/dimension/base-UOM/audit tests; authenticated Browser E2E 9/9 PASS; API/Web Typecheck+Build PASS; disposable Control/Tenant cleanup PASS; ใช้ Commerce schema เดิม ไม่เพิ่ม Migration, ไม่แก้ Persistent DB และไม่ Deploy; POS.4 เป็นขั้นตอนถัดไป
- **v2.27 — 2026-11-15:** ปิด POS.2; เพิ่ม POS-only Register Tenant migration/schema, API, RBAC permissions, audit lifecycle และ Register configuration UI; Cashier view-only, Manager manage; duplicate code/Branch archive guard/cross-Tenant IDOR tests PASS; POS/ONLINE migration isolation PASS; Browser E2E 8/8 PASS รวม Store/Branch/Warehouse/Register; no persistent DB changes or Deploy
- **v2.26 — 2026-11-15:** ปิด POS.1 ตามหลักฐาน POS Standard Profile + ordered Tenant migrations + Commerce activation บน Disposable DB; เริ่ม POS.2 Store/Branch/Warehouse/Register Configuration โดย Store/Branch/Warehouse เดิมมี workflow และ Browser E2E แล้ว ส่วน Register ยังไม่มี schema/API/UI; เพิ่ม POS.2 brief; Local-first, no persistent DB migration, no deploy
- **v2.25 — 2026-11-15:** ปิด P0.10; ปรับ README และ active architecture docs ให้ตรง Runtime Local ปัจจุบัน ครอบคลุม Database Tenancy, Provisioning, Authentication/RBAC, Module Activation, POS/ONLINE Permission Matrix, Core boundaries และ Local-first/Deployment-last ADR; stale active-doc audit ผ่าน; API/Web Typecheck+Build, Disposable provisioning/migration recovery, Browser E2E 8/8 และ Local HTTP 200 ผ่าน; ไม่มี Persistent DB changes หรือ Deploy
- **v2.24 — 2026-11-15:** เริ่ม P0.10; ปรับ README สำหรับ Local setup/tests/safety; อัปเดต Database Tenancy, Authentication/RBAC, Module Activation, Permission Matrix, Core Runtime README, Foundation Scope และ Architecture Decisions ให้ตรงกับ Runtime POS/ONLINE, ordered migrations, default module activation, Owner retry และ Deployment-last; กำลังตรวจ stale references และเตรียม final regression; ไม่มี Persistent DB changes หรือ Deploy
- **v2.23 — 2026-11-15:** ปิด P0.9; เพิ่ม Owner-only FAILED Workspace retry endpoint และ Workspace Selector retry action; disposable provisioning lifecycle/retry test PASS; migration failure rollback + retry PASS; POS/ONLINE module isolation, migration idempotency และ runtime privilege tests PASS; authenticated Chromium Browser E2E 8/8 PASS รวมสร้าง POS/ONLINE ผ่าน UI, ตรวจ Commerce navigation/Online isolation และ retry Workspace ที่ FAILED; cleanup Disposable Control/Tenant DB และ roles PASS; P0.10 เป็นขั้นตอนถัดไป; ไม่มี Persistent DB changes หรือ Deploy
- **v2.22 — 2026-11-15:** เริ่ม P0.9; เพิ่ม Tenant migration catalog แบบ ordered ตาม Provisioning Profile, promote Commerce incremental candidate เป็น versioned Tenant migration, ขยาย migration runner ให้ apply/ledger/transaction/advisory lock/runtime grants ตามลำดับ; POS ได้ Core+Commerce+Inventory/Sales/Media, ONLINE ได้ Core-only; Module manifest ตรวจ migration ครบและ Workspace creation ติดตั้ง/เปิด default modules หลัง Tenant provisioning พร้อม audit; เพิ่ม failure rollback/retry, runtime DDL/ledger privilege, P0.8/P0.9 disposable tests; P0.7 HTTP/Browser regression 7/7 PASS; P0.9 ยัง IN PROGRESS เพราะยังขาด user-facing FAILED Workspace retry workflow และ Browser E2E สร้าง POS/ONLINE ผ่าน UI; ไม่มี Persistent DB changes หรือ Deploy
- **v2.21 — 2026-11-15:** ย้าย Deployment เป็น Track 5 ขั้นตอนสุดท้ายหลัง Track 0–4 และ Local Acceptance ครบ; ย้าย external CDN/Reverse Proxy/Edge Cache acceptance ไป DEPLOY.5; ปิด P0.7 ตามหลักฐาน Local Origin cache headers + IDOR/Media/Tenant/Browser E2E; ปิด P0.8 หลัง Disposable POS/ONLINE provisioning ผ่านทั้งสอง Tenant DB, runtime roles, profiles, lifecycle และ RBAC; เพิ่ม provisioning isolation test harness และ implementation report; เริ่ม P0.9 เพื่อกำหนด Module Migration Order/Upgrade/Failure Recovery; ไม่ Apply Persistent Migration, ไม่แก้ Existing Workspace, ไม่ Deploy
- **v2.20 — 2026-11-15:** เปลี่ยนลำดับงานเป็น Local-first ตามคำสั่งผู้ใช้; เพิ่ม Windows Local Development prerequisites, startup, health URL, build/typecheck commands และ Database Safety ใน README; ยืนยัน Node.js/npm/pnpm, API `.env` local URLs, PostgreSQL readiness, API/Web typecheck และ API/Web build PASS; API/Web ยังไม่ได้เปิดเป็น long-running process ใน session นี้; ไม่ Apply Migration, ไม่แก้ Persistent DB, ไม่ Deploy
- **v2.19 — 2026-11-14:** เพิ่ม API-wide `Cache-Control: private, no-store, max-age=0`, `Pragma: no-cache` และ `Vary: Cookie, Authorization` เป็น default middleware; เพิ่ม Next.js no-store headers สำหรับ `/workspaces`, `/workspace` และ `/admin`; เพิ่ม disposable HTTP assertion สำหรับ API response และ authenticated Chromium assertion สำหรับ POS page response; API build, Web typecheck, Browser E2E 7/7, HTTP IDOR matrix และ disposable DB/runtime-role/media cleanup PASS; Repository ไม่มี CDN/Reverse Proxy/Load Balancer deployment config จึงยังไม่อ้างว่า external edge-cache acceptance ผ่าน
- **v2.18 — 2026-11-14:** เพิ่ม authenticated Store/Branch/Warehouse management Browser E2E บน Disposable Tenant ครอบคลุมสร้าง/แก้ไข Store, Branch, Warehouse และยืนยันการ provision Default Branch/Default Warehouse อัตโนมัติ; ขยาย Orders Browser E2E ให้สร้าง Order, Post, Cash Payment, Return และ Refund จริงใน Disposable Tenant DB; Chromium Browser E2E ผ่าน 7/7 ไม่มี Skip; API build, Web typecheck, HTTP IDOR matrix และ Disposable Control/Tenant DB/runtime-role/media cleanup PASS; P0.7 ยัง IN PROGRESS โดยเหลือ external CDN/load-balancer/reverse-proxy cache acceptance เท่านั้น
- **v2.17 — 2026-11-14:** เพิ่ม disposable Inventory Staff user โดยใช้ WorkspacesService.addMember สร้าง Inventory Staff role เฉพาะ Disposable POS Workspace; เพิ่ม authenticated Orders browser E2E ที่สร้าง Order จริง เลือก Store/Branch/Warehouse และ Product, Post ตัดสต็อก และบันทึก Cash Payment ใน Disposable Tenant DB; ขยาย Chromium Browser E2E เป็น 6/6 PASS ไม่มี Skip (POS catalog/cart, Product CRUD + Cashier RBAC, Manager Inventory modes/history, Inventory Staff Inventory modes/history, Manager stocktake UI แบบ mocked API, Orders create/post/payment); API build, Web typecheck, HTTP IDOR matrix และ Disposable DB/runtime-role/media cleanup PASS; ยังเปิด Store/Branch/Warehouse management, Orders Return/Refund browser workflows และ external edge-cache acceptance
- **v2.16 — 2026-11-14:** ขยาย disposable authenticated Chromium Browser E2E จาก POS smoke เป็น POS + Product Management + Inventory; แก้ Inventory navigation locator ให้ใช้ Link ตาม WorkspaceNavigation จริง และรอ Inventory ready/empty state ก่อนตรวจ UI; Manager Inventory modes/history และ stocktake workflow ผ่าน (stocktake API mocked), Product CRUD + Cashier read-only RBAC ผ่าน, POS catalog/cart ผ่าน รวม 4 passed / 1 Inventory Staff skipped; API build, Web typecheck และ Disposable Control/Tenant cleanup PASS; Harness เก็บ Playwright trace/screenshot/report เมื่อ browser test ล้มเหลว; ยังเปิด dedicated Inventory Staff, Store/Branch/Warehouse และ real Orders browser workflows รวมถึง external edge-cache acceptance
- **v2.15 — 2026-11-14:** เพิ่ม disposable authenticated Browser E2E runner: สร้าง API/Next server บนพอร์ตเฉพาะ, ใช้ Next distDir และ Playwright output/report directories ชั่วคราว, login ด้วย Owner ที่สร้างใน Disposable Control DB, เลือก POS Workspace และยืนยัน POS Catalog จริงจาก Tenant DB พร้อมเพิ่มสินค้าลงตะกร้า; Playwright 1/1 PASS; cleanup ลบ Control/Tenant DB, runtime roles, media root และ Browser E2E directories; ยังเปิด broader browser workflows และ external edge-cache acceptance
- **v2.14 — 2026-11-14:** ทำ authenticated HTTP harness ให้สร้าง Disposable Control DB จาก TEST_POSTGRES_ADMIN_URL (localhost /postgres) และ apply Control migrations ครบ 11 รายการ; เพิ่ม Tenant fixtures และ migrations สำหรับ Inventory/Stocktake/Sales/Returns/Payments/Refunds; foreign Inventory mutation IDs 9/9 ได้ 404; foreign Sales Order/Payment/Return IDs 6/6 ได้ 404 และ foreign Order Item ได้ generic 400; cleanup ตรวจยืนยันว่า Control/Tenant DB, runtime roles และ media temp root ถูกลบ; ยังเปิด full authenticated browser E2E และ external edge-cache acceptance
- **v2.13 — 2026-11-14:** ขยาย P0.7 authenticated HTTP fixture ให้มี Product Variant จริงใน Tenant DB ทั้งสองชุด; ทดสอบ Variant image upload/update/delete ด้วย foreign Variant/Media IDs เพิ่ม 3 กรณีผ่าน 404; route inventory และ Store/Branch/Warehouse/Product/Membership/Product Media isolation ยังคง PASS; เหลือ Inventory/Sales nested IDs, full authenticated E2E บน disposable fixture และ external edge-cache acceptance
- **v2.12 — 2026-11-14:** เพิ่ม P0.7 mutation-route inventory ครบตาม Controller ปัจจุบัน; ขยาย authenticated HTTP IDOR tests สำหรับ foreign nested Store/Branch/Warehouse/Product/Membership IDs, Product Media mutation และ Platform Admin denial; ผล Disposable HTTP PASS (46 non-member mutations, 13 nested resource mutations, 3 Media mutations, 6 Platform Admin denials); Playwright Workspace Selector/POS Shell mock regression 10/10 PASS; ยังเปิด Inventory/Sales nested IDs, full authenticated E2E บน disposable fixture และ external edge-cache acceptance
- **v2.11 — 2026-11-14:** ขยาย P0.7 authenticated HTTP isolation บน Disposable Control DB และ POS Tenant DB 2 ชุด ครอบคลุม Workspace list/member/navigation/module, Store/Branch/Warehouse/Product nested IDs, Media derivatives และ Image Import ownership; DB failure-matrix unit tests ผ่าน; แก้ Sharp CommonJS runtime import; P0.7 ยัง IN PROGRESS เพราะ mutation-route inventory, browser E2E และ external edge-cache acceptance ยังเปิดอยู่
- **v2.10 — 2026-11-14:** เตรียม isolated HTTP harness โดยบังคับใช้ TEST_POSTGRES_ADMIN_URL แบบ localhost-only, Control DB migrations ชั่วคราว และ cleanup ของ Tenant DB/runtime roles; ไม่แตะ persistent DB
- **v2.9 — 2026-11-13:** อัปเดต P0.7 หลังเพิ่ม Workspace-scoped media/staging filesystem helpers, symlink/path hardening, media ID Tenant lookup isolation และ Image Import Batch Tenant/uploader ownership regression; focused tests ผ่านตามรายงาน แต่ authenticated HTTP harness ยังไม่ได้ยืนยันผล; P0.7 ยังคง IN PROGRESS
- **v2.8 — 2026-11-13:** ขยาย P0.7 ด้วย route-scoped RBAC, Tenant Prisma client identity binding, membership recheck, stale-client eviction, single-flight initialization และ two-Tenant disposable DB integration; ยังเปิด HTTP IDOR และ edge-cache acceptance
- **v2.7 — 2026-11-13:** ปิด P0.6 หลังแยก Permission Catalog, Navigation และ Default Role Matrix ตาม POS/ONLINE; GET Roles เป็น read-only, cross-type permission/role guards และ disposable Control DB integration + Playwright 10/10 ผ่าน
- **v2.6 — 2026-11-13:** ปิด P0.5 หลังเพิ่ม Workspace Module Capability Guard บังคับ Membership, ACTIVE, Workspace Type, persisted Profile ID/Version และ ModuleInstallation ENABLED สำหรับ POS Commerce API; unit/wiring 13/13 และ disposable integration ผ่าน; ไม่มี persistent DB changes
- **v2.5 — 2026-11-13:** ปิด P0.4 หลังแยก Workspace Selector และ Landing ตาม POS/ONLINE พร้อม Profile/lifecycle display และ Playwright selector + POS shell regression 8/8 ผ่าน
- **v2.4 — 2026-11-13:** ปิด P0.3 หลังเพิ่ม Workspace Registry Profile ID/Version, provisioning lifecycle metadata, persisted-profile validation และ disposable PostgreSQL migration rehearsal PASS; ไม่มี persistent Control/Tenant DB migration หรือ legacy backfill
- **v2.3 — 2026-11-13:** ปิด P0.2 หลังเพิ่ม POS/ONLINE Provisioning Profiles, Manifest Type compatibility, API Install/Enable guards และ disposable Control DB integration PASS; Profile ID/Version persistence คงไว้ใน P0.3
- **v2.2 — 2026-11-13:** ปิด P0.1 หลัง implementation, automated verification และ disposable PostgreSQL migration rehearsal ผ่าน; ไม่ Apply Migration กับ persistent Control DB และไม่ backfill ประเภท Workspace เดิม
- **v2.1 — 2026-11-13:** เพิ่ม Development Methodology & Milestone Governance และเริ่ม Track 0 / P0.1 Workspace Type & Registry โดยเพิ่ม Workspace Type POS/ONLINE ใน Control Plane แบบ additive; ยังไม่ Apply Migration และไม่จัดประเภท Workspace เดิมโดยคาดเดา
- **v2.0 — 2026-11-13:** เขียน Master Plan ใหม่โดยยกเลิกแนวคิด Omnichannel Tenant เดียว แยก SyncUp POS และ SyncUp Online เป็นคนละ Workspace, Tenant Database, Module Profile, RBAC และ Business Lifecycle; เพิ่ม Platform Separation Foundation, Legacy Separation และ Roadmap ใหม่
- **v1.x:** เก็บเอกสารแผนเดิมและประวัติการทำงานไว้ที่ `docs/architecture/archive/plan-legacy-2026-11-13.md` เพื่ออ้างอิง ไม่ใช้เป็น Roadmap หลักอีกต่อไป

---

## 19. Development Methodology & Milestone Governance

หัวข้อนี้เป็นมาตรฐานบังคับสำหรับทุก Track และ Milestone เพื่อให้ทีมยึดเป้าหมายเดียวกัน ลดงานหลุด Scope และป้องกันการข้ามขั้นตอนที่มีความเสี่ยง

### 19.1 Development Approach

ใช้แนวทางผสม:
- **Milestone-based Development:** แบ่งงานเป็น Milestone ที่มีขอบเขตและผลส่งมอบชัดเจน
- **Vertical Slice:** พัฒนาให้ครบเส้นทางที่จำเป็นตั้งแต่ Database/Backend/Business Logic ถึง Frontend ใน Milestone เดียว ไม่ทำ Backend ทั้งหมดก่อนแล้วค่อยทำ UI
- **Acceptance Gate:** ทุก Milestone ต้องผ่านเกณฑ์ตรวจรับก่อนปิดงาน
- **Incremental & Backward-compatible Change:** เปลี่ยนทีละส่วน รักษาความเข้ากันได้และหลีกเลี่ยงการทำลายข้อมูลเดิม
- **Security-by-design:** ตรวจ Workspace Boundary, Authorization, Tenant Routing และ Data Privacy ตั้งแต่เริ่มออกแบบ

การแบ่ง Milestone ต้องสอดคล้องกับ Track 0–4 ในหัวข้อ 10 ห้ามสร้าง Roadmap ย่อยที่ขัดแย้งกับ Master Plan โดยไม่มี Decision Log

### 19.2 Milestone Levels

ระดับต่อไปนี้เป็นมุมมองจัดประเภทงาน ไม่ใช่ลำดับบังคับว่าทุก Milestone ต้องทำ 4 รอบแยกกัน:

| Level | จุดเน้น | ผลลัพธ์ |
|---|---|---|
| M0 — Foundation | Architecture, Infrastructure, Security, Contracts | รากฐานและขอบเขตระบบ |
| M1 — Core | Schema, API, Domain Logic, Authorization | ความสามารถหลัก |
| M2 — Experience | UX/UI, Workflow, Accessibility, Error/Empty States | ผู้ใช้ทำงานได้ครบ Workflow |
| M3 — Quality | Tests, Security, Performance, Operations, Documentation | หลักฐานพร้อมตรวจรับ |

Milestone ขนาดเล็กอาจรวมหลาย Level ได้ หาก Scope และ Acceptance Criteria ยังชัดเจน

### 19.3 Required Milestone Brief

ก่อนเริ่ม Implementation ทุก Milestone ต้องมี Brief:
1. Milestone ID / Name / Track
2. **Objective:** ผลลัพธ์และเหตุผลทางธุรกิจ
3. **Scope / Out of Scope:** สิ่งที่รวมและไม่รวม
4. **Dependencies:** Milestone, Module, API และ Migration ที่ต้องพร้อม
5. **Architecture & Technical Design:** Data Model, API Contract, UI Flow, Permission และ Workspace Boundary
6. **Implementation Tasks:** งานย่อยและ Module/ไฟล์ที่เกี่ยวข้อง
7. **Test Plan:** Unit, Integration, E2E, Regression, Security และ Failure Cases ตามความเสี่ยง
8. **Acceptance Criteria:** เงื่อนไขตรวจสอบได้และหลักฐานที่ต้องแนบ
9. **Risk / Rollback:** ความเสี่ยงและ Recovery/Rollback หรือ Forward-fix
10. **Documentation:** เอกสารและ Runbook ที่ต้องอัปเดต
11. **Approval Boundary:** งานที่ทำได้ใน Local/Disposable และงานที่ต้องขออนุมัติก่อนแตะ Environment จริง

ห้ามเริ่ม Milestone ที่กระทบ Database, Data Migration, Credential, Permission หรือ Production โดยไม่มี Target Environment และ Approval Boundary ชัดเจน

### 19.4 Standard Execution Workflow

1. **Inspect:** ตรวจ Working Tree, Plan, Code, Schema, Tests และสถานะ Milestone ก่อนหน้า
2. **Plan:** จัดทำ Brief, Task Breakdown, Dependencies และ Acceptance Criteria
3. **Design:** ตรวจ Architecture, Data Ownership, Workspace Type, Tenant Routing, RBAC และ Migration Impact
4. **Implement:** พัฒนาเป็น Vertical Slice ตาม Scope และรักษา Uncommitted Changes
5. **Verify:** รัน Tests ที่สัมพันธ์กับการเปลี่ยนแปลง พร้อม Build/Typecheck/Lint ตามที่ Project รองรับ
6. **Review:** ตรวจ Diff, Security, Regression, Logs และผลข้างเคียง
7. **Document:** อัปเดต Plan, Decision Log, Technical Docs และ Runbook
8. **Accept:** เทียบผลจริงกับ Criteria และแยก Passed/Failed/Blocked/Not Run
9. **Report:** สรุปผล หลักฐาน Known Issues และความคืบหน้า
10. **Next:** เสนอ Milestone ถัดไปที่ Dependencies พร้อมแล้ว โดยไม่ข้าม Gate

### 19.5 Acceptance Gate — Definition of Done

Milestone จะปิดเป็น **DONE** ได้เมื่อ:
- Scope เสร็จครบ และไม่มีการแอบเพิ่ม Out of Scope
- Acceptance Criteria ทุกข้อมีหลักฐานตรวจสอบ
- Unit/Integration/E2E ผ่านตาม Test Plan; กรณีทดสอบไม่ได้ต้องระบุ BLOCKED/NOT RUN ห้ามนับเป็น PASS
- Regression ของ Module และ Workspace ที่ได้รับผลกระทบผ่าน
- Authorization, Workspace Isolation และ Tenant Routing ผ่านการตรวจตามความเสี่ยง
- Migration ผ่าน Review และ Rehearsal บน Disposable Environment
- Error Handling, Idempotency, Audit และ Recovery ครบตามขอบเขต
- Documentation/Runbook/Plan อัปเดต
- ไม่มี Critical/High issue ที่ยังไม่จัดการหรือยอมรับความเสี่ยงอย่างเป็นทางการ

สถานะที่อนุญาต:
- **DONE:** ผ่าน Acceptance Criteria ทั้งหมด
- **IN PROGRESS:** กำลังดำเนินการ
- **BLOCKED:** มี Dependency/สิทธิ์/Environment ขวาง
- **FAILED:** ทดสอบหรือ Acceptance ไม่ผ่าน
- **DEFERRED:** เลื่อนพร้อมเหตุผลและผลกระทบ
- **NOT STARTED:** ยังไม่เริ่ม

ห้ามใช้ DONE หรือ 100% หากมี Criteria ที่ยังไม่ผ่านหรือยังไม่ได้ทดสอบ

### 19.6 Progress Measurement & Reporting

- แตก Milestone เป็น Tasks ที่ตรวจสอบได้ก่อนเริ่ม
- คำนวณความคืบหน้าจาก Task ที่เสร็จและผ่าน Verification เทียบกับทั้งหมด (ใช้น้ำหนักได้เมื่อกำหนดล่วงหน้า)
- BLOCKED, FAILED หรือ NOT RUN ไม่นับเป็นงานเสร็จ
- รายงานแยก Platform, POS และ Online ห้ามรวมเป็นเปอร์เซ็นต์เดียวจนบดบังความเสี่ยง
- แสดง Implementation, Tests, Security Review, Documentation และ Acceptance แยกกัน
- ทุก Report ระบุช่วงเวลาหรือ Git/Working Tree Context และ Environment: Local, Disposable, Staging หรือ Production
- ระบุ Test Command/Result และข้อจำกัด ห้ามรายงานจากการคาดเดา

รูปแบบรายงาน:

| Dimension | Status | Evidence / Notes |
|---|---|---|
| Scope / Implementation | DONE / IN PROGRESS / BLOCKED | งานที่เสร็จจริง |
| Unit / Integration | PASS / FAIL / NOT RUN | คำสั่งและผล |
| E2E / Regression | PASS / FAIL / NOT RUN | Workflow ที่ครอบคลุม |
| Security / Isolation | PASS / FAIL / NOT RUN | ขอบเขตที่ตรวจ |
| Migration / Operations | PASS / BLOCKED / N/A | Target และ Rehearsal |
| Documentation | DONE / PENDING | ไฟล์ที่อัปเดต |
| Acceptance | DONE / BLOCKED / FAILED | Criteria ที่ผ่าน/ไม่ผ่าน |
| Overall Progress | 0–100% | คำนวณจาก Task ที่ตรวจรับแล้ว |

### 19.7 Change & Approval Control

ต้องขออนุมัติอย่างชัดเจนก่อน:
- Apply Migration หรือแก้ Control/Tenant Database ที่ไม่ใช่ Disposable
- สร้าง/ลบ/เปลี่ยน Workspace จริง หรือ Provision Tenant จริง
- Import, Move, Delete หรือแก้ Business Data จริง
- เปลี่ยน Role/Permission หรือ Runtime Credential ใน Environment จริง
- Deploy, เปิด Public Access, เปิดรับเงินจริง หรือเปิด Production Feature
- Commit, Push หรือเปลี่ยน Branch/Release หากไม่ได้สั่งไว้

การอนุมัติหนึ่งครั้งใช้เฉพาะ Target, Action และ Scope ที่ระบุ ไม่ขยายไป Environment หรือการกระทำอื่นโดยปริยาย

ระหว่างพัฒนา:
- ห้าม Reset/Clean/Checkout ทับ Uncommitted Changes
- ไม่แก้ไฟล์นอก Scope หากไม่จำเป็น; หากจำเป็นต้องบันทึกเหตุผล
- ใช้ Disposable Database สำหรับ Migration Rehearsal และ Integration Tests ที่ต้องเขียนข้อมูล
- ไม่ใช้ Production/Workspace จริงเป็น Test Fixture
- ห้ามพิมพ์ Secret ลง Report, Log หรือ Commit

### 19.8 Milestone Handoff

เมื่อปิด Milestone ต้องส่งต่อ:
1. สิ่งที่ทำเสร็จและยังไม่เสร็จ
2. รายการไฟล์/Module/Schema/API ที่เปลี่ยน
3. Test Evidence และ Test ที่ BLOCKED/NOT RUN
4. Migration/Environment ที่แตะและสถานะ Apply
5. Known Issues, Technical Debt และ Risk
6. Dependencies และ Milestone ถัดไป
7. Plan/Decision Log/Runbook ที่อัปเดต

Milestone ถัดไปต้องเริ่มจาก Handoff ล่าสุด ไม่เริ่มจากการคาดเดาหรือสร้าง Scope ซ้ำซ้อน

### 19.9 Source of Truth & Anti-Drift Rules

- `plan.md` เป็น Master Roadmap และ Source of Truth สำหรับ Track, Milestone, Status และ Acceptance Gate
- Milestone/Implementation Report เป็นหลักฐานประกอบ แต่ห้ามนิยาม Roadmap ขัดกับ `plan.md`
- เมื่อ Scope, Dependency หรือ Architecture เปลี่ยน ต้องอัปเดต `plan.md` และ Decision Log ในงานเดียวกัน
- งานที่พบระหว่างพัฒนาแต่นอก Scope ให้บันทึก Follow-up/Backlog ไม่แทรกเพิ่มโดยไม่ประเมินผลกระทบ
- ก่อนเริ่มงานใหม่ ตรวจ Milestone Status, Git Working Tree, Known Blockers และ Handoff ล่าสุด
- หาก Report ไม่ตรงกับ Code/Database/Test Result ให้ยึดหลักฐานจริงและแก้เอกสารให้ตรง

### 19.10 Default Milestone Operating Agreement

เมื่อผู้ใช้สั่ง "เริ่ม Milestone ถัดไป" หรือ "ทำตามแผนต่อ":
1. ตรวจ Status และ Dependencies ของ Milestone ถัดไปจาก `plan.md`
2. ตรวจ Code/Environment ที่เกี่ยวข้องก่อนแก้ไข
3. เริ่มงานใน Scope ที่ทำได้โดยปลอดภัย
4. หยุดและขออนุมัติเมื่อถึง Approval Boundary
5. ทดสอบและอัปเดต `plan.md` ตามผลจริง
6. รายงานสถานะและเสนอ Milestone ถัดไปเพียงหนึ่งรายการ

หากไม่ชัดว่าคำสั่งหมายถึงการแก้ระบบจริงหรือวางแผน ให้ถามเฉพาะประเด็นจำเป็นก่อนการกระทำที่ย้อนกลับยาก
### 19.11 Browser E2E Verification Handoff — 2026-11-17

**Environment:** E2E workspace `e2e-commerce-20261106` only; no `pos-local` or Production workspace was targeted by the browser tests.

| Verification | Result | Evidence |
|---|---|---|
| Targeted regression | PASS | 10 passed, 0 failed, 0 skipped; Run `e2e-20261117T081722Z-53d9de` |
| Full Browser E2E | PASS with skips | 37 passed, 0 failed, 4 skipped; Run `e2e-20261117T081827Z-27bc09`; exit code 0 |
| TypeScript | PASS | `pnpm exec tsc --noEmit` |
| Diff whitespace check | PASS | `git diff --check` |

**E2E changes:** Corrected POS workspace route expectations, preserved the enabled Commerce module state in its test, added mocked Register/Shift prerequisites for checkout, aligned inventory empty-state/navigation assertions with the UI, corrected order return/refund interactions, and moved affected specs to the dedicated E2E workspace credentials rather than `pos-local`.

**Remaining skips (not counted as PASS):** Three tests require `E2E_WORKSPACE_NAME`; Product Catalog Management requires `E2E_STORE_ID` and `E2E_PRODUCT_ID`. These fixtures are not currently configured. Do not point these tests at a live workspace or create/change fixture records until a disposable fixture and its safety boundary are confirmed.

**Acceptance:** Browser E2E has no failing tests in this run, but full acceptance remains **IN PROGRESS** because four tests are skipped and their fixture-dependent workflows are not verified.

**Next:** Prepare isolated disposable workspace/store/product fixtures, verify that the skipped tests cannot mutate shared or Production data, configure the required E2E variables, then run the full suite once (without overlapping runners).
