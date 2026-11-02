# Tenant Prisma Schema — Design Review Draft

วันที่: 2026-11-02  
สถานะ: Draft 1 — Prisma validation ผ่าน; ยังไม่อนุมัติ Migration  
Schema: `apps/api/prisma/tenant/schema.prisma`

## Boundary

- Control DB ยังคงเป็นแหล่งข้อมูล User, Workspace, Membership, Session, Role, Permission และ Tenant DB Registry
- Tenant schema มีเฉพาะข้อมูลธุรกิจของ Workspace หนึ่งแห่ง ไม่ทำ FK ข้าม Control DB
- Tenant Prisma Client ใช้ generator output แยกที่ `apps/api/generated/tenant-client`; datasource ใช้ `TENANT_DATABASE_URL`
- Runtime role ต้องไม่มี DDL privilege; migration/provisioning ใช้ privileged path แยกจาก runtime
- การสร้าง/แก้ Schema นี้ไม่ได้สร้างหรือใช้ Migration และไม่ได้เชื่อมต่อฐานข้อมูลจริง

## Model groups

- Store/Branch/Warehouse: ร้านหลายแห่งต่อ Workspace, หลายสาขาต่อ Store และหลายคลังต่อ Branch
- Workspace Catalog: Product, ProductVariant, VariantBarcode, UnitOfMeasure และ VariantUom
- Store assortment/pricing: StoreProduct, StoreProductVariant, StoreCategory, StoreProductCategory และ ProductPrice
- Images: MediaAsset, ProductImage, VariantImage, ImageImportBatch และ ImageImportItem; binary object อยู่ใน Object Storage ไม่เก็บใน DB
- Inventory/costing: StockBalance, StockMovement, StockReservation, InventoryCost, OpeningStockSession/Item และ DirectReceiving/Item
- Stock adjustment CSV: StockAdjustmentImportBatch/Row เก็บ snapshot, checksum, row validation, idempotency, actor และผล commit
- Tax/Audit: TaxCategory, TaxProfile, TaxRate และ AuditLog

## Invariants ที่ API/transaction ต้องบังคับ

1. User/Workspace membership และ permissions ตรวจจาก Control DB ทุก request; ห้ามเชื่อ Workspace/Store ID จาก client อย่างเดียว
2. CSV stock snapshot/download/upload/commit จำกัด OWNER เท่านั้นตาม plan; ทุก batch ต้องบันทึก uploader, checksum, snapshot checksum, row-level validation และ audit
3. CSV commit ต้องตรวจ snapshot ว่ายังไม่ stale และทำ stock ledger, balance, cost และผล row แบบ atomic + idempotent
4. Quantity ทุก API รับ/ส่ง Decimal string; validate scale ไม่เกิน 3 และเก็บ quantity เป็น PostgreSQL NUMERIC(20,3)/Prisma Decimal
5. เงิน/ต้นทุนใช้ Decimal; ห้าม Float/Double; StockBalance/StockMovement/InventoryCost ใช้ base UOM เท่านั้น
6. การรับ Opening Stock และ Direct Receiving ต้องสร้าง StockMovement และอัปเดต StockBalance/InventoryCost ใน transaction เดียว; Posted documents ห้ามแก้/ลบ ใช้ reversal/adjustment
7. Opening Stock ให้ Post สำเร็จได้เพียงหนึ่ง Session ต่อ Warehouse; `postedWarehouseId` ใช้เป็น nullable unique guard โดย set เมื่อ Post สำเร็จ
8. SKU/Barcode/UOM code/category slug ต้อง normalize ที่ service boundary ก่อนตรวจ uniqueness
9. รูปภาพต้องผ่าน allowlist MIME/type, ตรวจ signature, size/pixel limits, malware policy และใช้ staging object key ที่ไม่เชื่อ path จาก client; ZIP ต้องป้องกัน path traversal และ archive bomb
10. Public endpoints แสดงเฉพาะ Store/Product/Variant/Image ที่ publish แล้ว และห้ามคืนต้นทุน, stock movement, stock balance จริง หรือข้อมูลภายใน
11. Audit actor IDs อ้างถึง Control DB แบบ external ID จึงไม่สร้าง FK ข้าม database
12. Default Branch/Warehouse ต้องถูกสร้างพร้อม Store ใน transaction/workflow ที่มี compensation; ห้ามลบ Default จนกว่าจะตั้งค่าทดแทน

## Database-level constraints ที่ต้องทบทวน/เพิ่มก่อน Migration sign-off

Prisma schema validation ไม่ได้ยืนยัน business constraints ต่อไปนี้ จึงต้องทำ integration/DB review และเพิ่ม SQL constraints/indexes ใน migration เมื่อได้รับอนุมัติ:

- Partial unique index: Store มี Default Branch ได้หนึ่งแห่ง และ Branch มี Default Warehouse ได้หนึ่งแห่ง
- Cross-model invariant: `ProductPrice.variantUomId` ต้องเป็น UOM ของ Variant ที่อยู่ใน `StoreProductVariant` นั้น ไม่ใช่ UOM ของ Variant อื่น
- `StoreProductVariant.variantId` ต้องเป็น Variant ของ Product ที่ `StoreProduct` อ้างถึง
- ห้ามช่วงเวลา ProductPrice หรือ TaxProfile/TaxRate ซ้อนกันสำหรับ key เดียวกัน; ควรใช้ PostgreSQL exclusion constraint/range strategy ที่เหมาะสม
- `conversionToBase > 0`; `decimalPlaces` อยู่ในช่วง 0–3; quantity ต้องไม่เกิน scale 3 และต้องไม่ติดลบในบริบทที่ห้าม
- `onHand/reserved/available` ต้อง reconcile กัน; `available = onHand - reserved`; ห้ามยอดติดลบตาม policy
- Stock ledger ที่ Posted ต้อง immutable; uniqueness ของ idempotency key ต้องมี scope และ lifecycle ที่ตกลงชัดเจน
- `Store.defaultBranchId` (ถ้าคงไว้ใน model) ต้องเป็น Branch ที่อยู่ Store เดียวกัน; หากไม่ทำ composite FK ให้ลบ field นี้และใช้ `Branch.isDefault` เป็น source of truth พร้อม partial unique index
- ต้องป้องกัน Category parent cycle ด้วย service/transaction validation หรือ PostgreSQL trigger/closure strategy
- ต้องกำหนด DB check constraints สำหรับจำนวนเงิน/ต้นทุน/ขนาดไฟล์และ checksum format ตาม policy

## ก่อน Migration

- [ ] Review ความสัมพันธ์และ composite FK โดยเฉพาะ Store scope และ UOM/Variant scope
- [ ] ตัดสินใจแหล่งอ้างอิง Default Branch (field relation หรือ `isDefault` + partial unique index)
- [ ] Review numeric precision ของ money/cost และ rounding policy กับ accounting
- [ ] ทำ ERD diff ให้ตรงกับ Prisma models
- [ ] ทำ Tenant provisioning/migration versioning และ rollback/recovery plan
- [ ] ทดสอบ OWNER-only CSV flow, stale snapshot, atomic commit, retry และ reconciliation
- [ ] ทดสอบ bulk image preview/mapping/checksum/security และ object cleanup
- [ ] อนุมัติ schema review ก่อนสร้าง Migration

## Validation

คำสั่งตรวจ schema แบบไม่เชื่อมต่อ DB:

```powershell
$env:TENANT_DATABASE_URL = 'postgresql://user:password@localhost:5432/tenant'
corepack pnpm exec prisma validate --schema prisma/tenant/schema.prisma
corepack pnpm exec prisma format --schema prisma/tenant/schema.prisma
```

ห้ามรัน `prisma migrate dev`, `prisma migrate deploy` หรือคำสั่งใดที่แก้ฐานข้อมูลจริงจนกว่าจะได้รับอนุมัติ
\n\n