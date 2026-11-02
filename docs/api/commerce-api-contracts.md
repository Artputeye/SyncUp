# SyncUp Commerce API Contracts

สถานะ: API Contract Draft v7 — ยืนยัน Quantity สูงสุด 3 ตำแหน่ง, Custom UOM และ Unit Conversion; รองรับราคาขายหลายหน่วยต่อ Variant; ยังไม่มี Endpoint ตามเอกสารนี้จนกว่าจะพัฒนา
วันที่: 2026-11-02

## 1. ขอบเขตและหลักการ

- API prefix ปัจจุบันของแอปคือ `/api`; Contract นี้ไม่เพิ่ม `/v1` เพื่อให้สอดคล้องกับ API ที่มีอยู่
- Authenticated API ใช้ Session/Cookie และ AuthGuard ตามระบบปัจจุบัน
- Business data ทั้งหมดอยู่ใน Tenant DB ของ Workspace; ห้ามรับ tenant database name/connection จาก client
- ทุก Workspace endpoint ต้องตรวจ Membership/Permission ก่อน resolve tenant context
- Store, Branch, Category, StoreProduct และ Warehouse ต้องตรวจ ownership/scope ภายใน Workspace และ Store ทุกครั้ง
- Public API resolve `storeSlug` ผ่าน StorePublicRoute ใน Control DB ก่อนเชื่อม Tenant DB
- ใช้ UUID เป็น resource ID; monetary fields และ Quantity ส่งเป็น decimal string เพื่อป้องกัน precision loss
- Quantity ทุกหน่วยรองรับจำนวนเต็มและทศนิยม สูงสุด 3 ตำแหน่ง; ค่าที่เกิน 3 ตำแหน่งต้องถูกปฏิเสธด้วย validation error
- List endpoints ใช้ cursor pagination; default limit 20, maximum 100
- Mutations ที่สร้างธุรกรรม/เปลี่ยนสต๊อกหรือชำระเงินต้องเพิ่ม Idempotency-Key เมื่อระบุใน contract เฉพาะ
- ห้ามส่ง cost, average cost, stock ledger, internal stock balance หรือข้อมูลภายในไปยัง Public API

## 2. Resource และ Scope

| Resource | Scope | ความหมาย |
|---|---|---|
| Workspace | Control DB | Tenant boundary |
| Store | Tenant DB | ช่องทาง/หน้าร้านที่มี assortment และการตั้งค่าของตนเอง |
| Branch | Tenant DB | สาขาปฏิบัติการของ Store |
| Product | Workspace Tenant DB | Master Catalog กลาง ใช้ซ้ำได้หลาย Store |
| UnitOfMeasure | Workspace Tenant DB | หน่วยมาตรฐาน/หน่วยกำหนดเองของ Workspace |
| ProductVariant | Workspace Tenant DB | SKU/Barcode และหน่วยฐานสำหรับนับสต๊อก |
| VariantUOM | Workspace Tenant DB | หน่วยขาย/รับซื้อของ Variant และ Conversion Factor ไปหน่วยฐาน |
| StoreProduct | Store | เปิด Product ใน Store พร้อมสถานะและการจัดเรียง |
| StoreProductVariant | StoreProduct + Variant | เลือก Variant ที่เปิดขายใน Store และกำหนดสถานะ/ลำดับราย Variant |
| StoreCategory | Store | หมวดหมู่และลำดับชั้นเฉพาะ Store |
| StoreProductCategory | Store | เชื่อม StoreProduct กับ StoreCategory ใน Store เดียวกัน |
| ProductPrice | StoreProductVariant + VariantUOM | ราคาเฉพาะ Store, Variant, หน่วยขาย และช่วงเวลาที่มีผล |

ตัวอย่าง: Store หน้าร้านสร้างหมวด อาหาร/เครื่องดื่ม/ของใช้; Store ออนไลน์สร้างหมวด บอร์ดควบคุม/เซนเซอร์/ระบบสื่อสาร/Smart Home ได้อย่างอิสระ แม้ Product จะมาจาก Catalog กลางเดียวกัน

## 3. Authenticated API — Store & Branch

### 3.1 List Stores

`GET /api/workspaces/:workspaceId/stores?status=ACTIVE&cursor=&limit=20`

Permission: `store.read`

Response:
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "ร้านหน้าร้าน",
      "slug": "retail",
      "storeType": "PHYSICAL",
      "status": "ACTIVE",
      "currency": "THB",
      "timezone": "Asia/Bangkok"
    }
  ],
  "page": { "nextCursor": null, "hasMore": false }
}
```

### 3.2 Create Store

`POST /api/workspaces/:workspaceId/stores`

Permission: `store.create`

Request:
```json
{
  "name": "ร้านอุปกรณ์ IoT",
  "slug": "iot",
  "storeType": "ONLINE",
  "currency": "THB",
  "timezone": "Asia/Bangkok"
}
```

storeType: `PHYSICAL | ONLINE | OMNICHANNEL`

Rules:
- slug unique แบบ case-insensitive ใน Control DB public route และ Store ภายใน Tenant DB
- currency/timezone default จาก Workspace policy แต่ override ได้ระดับ Store
- การสร้าง Store ต้องสร้าง Default Branch ชื่อ `สำนักงานใหญ่` (code เช่น `HQ`) และ Default Warehouse ชื่อ `คลังหลัก` (code เช่น `MAIN`) ให้อัตโนมัติ พร้อม StorePublicRoute โดยต้องจัดการ partial failure ให้ไม่มี Store ที่สร้างไม่ครบชุดหรือ public route ชี้ไป Store ที่สร้างไม่สำเร็จ
- Branch ที่สร้างอัตโนมัติต้องมี `isDefault: true`; Warehouse เริ่มต้นต้องมี `isDefault: true`
- ค่า code ตัวอย่างเป็นข้อเสนอ implementation; ต้อง normalize และ unique ภายใน parent scope

### 3.3 Store Detail / Update

- `GET /api/workspaces/:workspaceId/stores/:storeId` — `store.read`
- `PATCH /api/workspaces/:workspaceId/stores/:storeId` — `store.update`

PATCH รับเฉพาะ fields ที่อนุญาต เช่น `name`, `status`, `timezone`, `currency`; การเปลี่ยน slug ใช้ flow เฉพาะเพื่อ sync StorePublicRoute และป้องกัน route collision

### 3.4 Branches

- `GET /api/workspaces/:workspaceId/stores/:storeId/branches` — `branch.read`
- `POST /api/workspaces/:workspaceId/stores/:storeId/branches` — `branch.create`
- `PATCH /api/workspaces/:workspaceId/stores/:storeId/branches/:branchId` — `branch.update`

Create request:
```json
{ "code": "MAIN", "name": "สาขาหลัก" }
```

branch.code unique ภายใน Store; branchId ต้องเป็นของ storeId ที่ระบุ; Store มี Default Branch ได้เพียงหนึ่งแห่ง และ Branch ที่สร้างเพิ่มภายหลังเป็น non-default เว้นแต่มีการเปลี่ยน Default ผ่าน endpoint/flow เฉพาะ

### 3.5 Warehouses

- `GET /api/workspaces/:workspaceId/stores/:storeId/branches/:branchId/warehouses` — `warehouse.read`
- `POST /api/workspaces/:workspaceId/stores/:storeId/branches/:branchId/warehouses` — `warehouse.create`
- `PATCH /api/workspaces/:workspaceId/stores/:storeId/branches/:branchId/warehouses/:warehouseId` — `warehouse.update`

Warehouse ทุกแห่งต้องสังกัด Branch เดียว; Branch ที่สร้างใหม่ต้องมี Warehouse อย่างน้อยหนึ่งแห่ง โดยให้ผู้ใช้สร้างเองหรือใช้ flow สร้าง Branch พร้อม Warehouse ตาม UX ที่กำหนด ส่วน Store ที่สร้างใหม่จะมี Default Branch/Default Warehouse ให้แล้ว

Rules:
- Warehouse เริ่มต้นของ Default Branch ใช้ชื่อ `คลังหลัก`, `isDefault: true`; Warehouse ที่สร้างเพิ่มเป็น `false` โดยปริยาย
- Branch หนึ่งมี Default Warehouse ได้เพียงหนึ่งแห่ง; Store มี Default Branch ได้เพียงหนึ่งแห่ง
- การเปลี่ยน Default ต้องเป็น atomic operation และตรวจว่า Branch/Warehouse อยู่ใน Store เดียวกัน
- ห้าม Archive Default Branch/Warehouse จนกว่าจะกำหนดรายการทดแทน; resource ที่มีธุรกรรมแล้วให้ Archive แทน hard delete

## 4. Authenticated API — Workspace Catalog

### 4.1 List/Create Products

- `GET /api/workspaces/:workspaceId/catalog/products?query=&status=ACTIVE&cursor=&limit=20` — `catalog.product.read`
- `POST /api/workspaces/:workspaceId/catalog/products` — `catalog.product.create`

Create request:
```json
{
  "name": "ESP32 Dev Board",
  "description": "Development board",
  "variants": [
    {
      "title": "Standard",
      "sku": "ESP32-DEV-001",
      "baseUnitId": "uom-piece-uuid",
      "barcodes": ["8850000000012"]
    }
  ]
}
```

Rules:
- Product/Variant เป็น master data ระดับ Workspace ไม่ได้เปิดขายใน Store โดยอัตโนมัติ
- SKU ต้อง unique ทั้ง Workspace (ยืนยันแล้ว) แม้ Variant จะยังไม่ถูกเปิดขายใน Store ใด; บังคับด้วย unique constraint ใน Tenant DB และ normalize SKU (เช่น trim + case-fold) ให้กติกาเดียวกันทั้ง API และ DB
- Product ที่มีธุรกรรมแล้วใช้ Archive ไม่ hard delete

### 4.2 Unit of Measure และ Variant Units

- `GET /api/workspaces/:workspaceId/catalog/units` — `catalog.uom.read`
- `POST /api/workspaces/:workspaceId/catalog/units` — `catalog.uom.create`
- `PATCH /api/workspaces/:workspaceId/catalog/units/:unitId` — `catalog.uom.update`
- `POST /api/workspaces/:workspaceId/catalog/units/:unitId/deactivate` — `catalog.uom.archive`
- `GET /api/workspaces/:workspaceId/catalog/products/:productId/variants/:variantId/units` — `catalog.product.read`
- `PUT /api/workspaces/:workspaceId/catalog/products/:productId/variants/:variantId/units` — `catalog.product.update`

Create UOM request ตัวอย่าง:
```json
{
  "code": "BOTTLE",
  "name": "ขวด",
  "symbol": "ขวด",
  "dimension": "COUNT",
  "decimalPlaces": 0
}
```

กำหนดหน่วย Variant ตัวอย่าง (หน่วยฐานเป็นขวด; 1 ลัง = 12 ขวด):
```json
{
  "baseUnitId": "uom-bottle-uuid",
  "units": [
    { "unitId": "uom-bottle-uuid", "usage": ["SALE", "PURCHASE"], "conversionToBase": "1" },
    { "unitId": "uom-carton-uuid", "usage": ["SALE", "PURCHASE"], "conversionToBase": "12" }
  ]
}
```

Rules:
- UOM มี scope ระดับ Workspace; code ต้อง unique หลัง normalize ภายใน Workspace; รองรับหน่วยเริ่มต้นและหน่วยที่ผู้ใช้สร้างเอง
- `decimalPlaces` รับค่า 0–3; Quantity ยังคงใช้ Decimal string และ `NUMERIC(20,3)` ตามกติกากลาง
- Variant ต้องมี base UOM หนึ่งหน่วย; conversion factor เป็น Decimal string (แนะนำ precision `NUMERIC(20,9)`) และมีความหมายว่า 1 หน่วยที่เลือก = conversionToBase หน่วยฐาน
- Conversion factor เป็นค่าระดับ Variant + UOM ไม่ใช่ค่ากลางของ UOM เพราะ “1 ลัง” อาจมีจำนวนชิ้นต่างกันตามสินค้า; ต้องตรวจ dimension/group ที่เข้ากันได้ หรือให้ผู้ใช้กำหนดกลุ่มการแปลงแบบชัดเจน
- การแปลงต้องคำนวณด้วย Decimal; base quantity ที่ได้ต้องไม่เกิน 3 ตำแหน่ง มิฉะนั้น reject หรือใช้ rounding policy ที่ระบุชัดเจน
- UOM ที่ถูกใช้อ้างอิงใน Variant/ธุรกรรมแล้วห้าม hard delete; ใช้ deactivate; ห้ามเปลี่ยน dimension/decimalPlaces หากกระทบความหมายข้อมูลเดิม

### 4.3 Product Detail / Update

- `GET /api/workspaces/:workspaceId/catalog/products/:productId` — `catalog.product.read`
- `PATCH /api/workspaces/:workspaceId/catalog/products/:productId` — `catalog.product.update`
- `POST /api/workspaces/:workspaceId/catalog/products/:productId/archive` — `catalog.product.archive`

การเพิ่ม/แก้ Variant ต้องตรวจว่า Product อยู่ใน Workspace เดียวกัน; SKU/Barcode ต้องไม่ชน resource อื่นใน Workspace

## 5. Authenticated API — Store Assortment และ Category

### 5.1 Store Product Assortment

- `GET /api/workspaces/:workspaceId/stores/:storeId/products?query=&publishStatus=&categoryId=&cursor=&limit=20` — `store-product.read`
- `POST /api/workspaces/:workspaceId/stores/:storeId/products` — `store-product.create`
- `GET /api/workspaces/:workspaceId/stores/:storeId/products/:storeProductId` — `store-product.read`
- `PATCH /api/workspaces/:workspaceId/stores/:storeId/products/:storeProductId` — `store-product.update`
- `DELETE /api/workspaces/:workspaceId/stores/:storeId/products/:storeProductId` — `store-product.archive`

Attach request:
```json
{
  "productId": "uuid",
  "publishStatus": "DRAFT",
  "sortOrder": 100
}
```

Rules:
- Product ต้องอยู่ใน Workspace เดียวกัน
- unique(store_id, product_id); การเพิ่ม Product เดิมซ้ำให้ตอบ Conflict หรือคืน resource เดิมตาม idempotency policy ที่กำหนด
- StoreProduct เป็นตัวกำหนดว่าสินค้าจาก Catalog กลางเปิดขายที่ Store ใด
- การนำออกจาก Store เป็นการ Archive/Unpublish ไม่ลบ Product กลาง
- StoreProductCategory ต้องอ้าง StoreProduct และ StoreCategory ที่มี store_id เดียวกัน

### 5.2 Store Product Variants

- `GET /api/workspaces/:workspaceId/stores/:storeId/products/:storeProductId/variants` — `store-product.read`
- `PUT /api/workspaces/:workspaceId/stores/:storeId/products/:storeProductId/variants` — `store-product.variant.manage`

Request (replace enabled Variant set atomically):
```json
{
  "variants": [
    { "variantId": "uuid", "publishStatus": "PUBLISHED", "sortOrder": 10 },
    { "variantId": "uuid", "publishStatus": "DRAFT", "sortOrder": 20 }
  ]
}
```

Rules:
- Store เลือกเปิดขาย Variant ได้เป็นรายตัว; Variant ที่ไม่อยู่ในชุดนี้ถือว่าไม่เปิดขายใน Store
- ทุก variantId ต้องเป็น Variant ของ Product ที่ StoreProduct อ้างถึง และต้องอยู่ใน Workspace เดียวกัน
- unique(store_product_id, variant_id); การ replace ต้องทำแบบ atomic และปฏิเสธ ID ซ้ำใน request
- Public API ส่งเฉพาะ Variant ที่เปิดขายและ PUBLISHED; ห้ามแสดง Variant ที่ถูกปิดหรือเป็น DRAFT
- ชื่อ คำอธิบาย และข้อมูล Master ของ Product/Variant ใช้จาก Workspace Catalog ร่วมกันทุก Store; ไม่มี Store-specific override ในขอบเขตนี้

### 5.3 Store Categories

- `GET /api/workspaces/:workspaceId/stores/:storeId/categories?tree=true&status=ACTIVE` — `store-category.read`
- `POST /api/workspaces/:workspaceId/stores/:storeId/categories` — `store-category.create`
- `PATCH /api/workspaces/:workspaceId/stores/:storeId/categories/:categoryId` — `store-category.update`
- `DELETE /api/workspaces/:workspaceId/stores/:storeId/categories/:categoryId` — `store-category.archive`

Create request:
```json
{
  "name": "เซนเซอร์",
  "slug": "sensors",
  "parentId": null,
  "sortOrder": 20
}
```

Rules:
- Category เป็นของ Store เท่านั้น; ไม่แชร์หมวดหมู่ระหว่าง Store โดยอัตโนมัติ
- unique(store_id, normalized_slug)
- parentId ต้องเป็น Category ของ Store เดียวกัน และต้องป้องกันการสร้าง parent cycle
- หาก Category มีสินค้าใช้งานอยู่ ให้ย้าย/ถอดการเชื่อมโยงก่อน Archive หรือใช้ policy ที่กำหนด
- Product หนึ่งรายการอยู่ได้หลาย Category ภายใน Store เดียวกัน

### 5.4 Assign Categories to Store Product

- `PUT /api/workspaces/:workspaceId/stores/:storeId/products/:storeProductId/categories` — `store-product-category.manage`

Request:
```json
{ "categoryIds": ["uuid", "uuid"] }
```

Contract: replace category assignments ทั้งชุดแบบ atomic; categoryIds ทุกตัวต้องเป็นของ Store เดียวกัน; array ว่างหมายถึงถอดหมวดหมู่ทั้งหมด

### 5.5 Store-specific Variant Pricing

- `GET /api/workspaces/:workspaceId/stores/:storeId/products/:storeProductId/variants/:storeProductVariantId/prices` — `pricing.read`
- `PUT /api/workspaces/:workspaceId/stores/:storeId/products/:storeProductId/variants/:storeProductVariantId/prices` — `pricing.manage` (upsert ราคาแยกตาม VariantUOM)

Request:
```json
{
  "prices": [
    { "variantUomId": "unit-bottle-uuid", "amount": "40.00", "currency": "THB", "validFrom": "2026-11-02T00:00:00+07:00", "validTo": null },
    { "variantUomId": "unit-carton-uuid", "amount": "450.00", "currency": "THB", "validFrom": "2026-11-02T00:00:00+07:00", "validTo": null }
  ]
}
```

Rules:
- amount เป็น decimal string; currency ต้องตรงกับ Store หรือผ่าน policy ที่อนุญาต
- StoreProductVariant ต้องเป็นความสัมพันธ์ที่เปิดใช้งานอยู่ของ StoreProduct นั้น
- variantUomId ต้องเป็นหน่วยที่เปิดใช้งานของ Variant เดียวกับ StoreProductVariant; ห้ามอ้างหน่วยของ Variant อื่น
- ห้ามมีช่วงเวลาราคาซ้อนกันสำหรับ StoreProductVariant + VariantUOM + currency
- การเปลี่ยนราคาห้ามเปลี่ยน Snapshot ของ Order เก่า

### 5.6 Inventory — Opening Stock และ Direct Receiving

สิทธิ์ที่ใช้: `inventory.read`, `inventory.opening-stock.create`, `inventory.receipt.create`, `inventory.movement.read` (ชื่อ Permission เป็น Draft)

**Opening Stock** — บันทึกยอดตั้งต้นเป็นชุดต่อ Warehouse:
- `POST /api/workspaces/:workspaceId/stores/:storeId/branches/:branchId/warehouses/:warehouseId/opening-stock-sessions` — สร้าง Draft Session
- `GET /api/workspaces/:workspaceId/stores/:storeId/branches/:branchId/warehouses/:warehouseId/opening-stock-sessions` — `inventory.read`
- `GET /api/workspaces/:workspaceId/stores/:storeId/branches/:branchId/warehouses/:warehouseId/opening-stock-sessions/:sessionId` — `inventory.read`
- `POST /api/workspaces/:workspaceId/stores/:storeId/branches/:branchId/warehouses/:warehouseId/opening-stock-sessions/:sessionId/post` — Post ยอดตั้งต้น

ตัวอย่างรายการใน Session:
```json
{
  "items": [
    { "variantId": "uuid", "quantity": "25.000", "unitCost": "120.00" },
    { "variantId": "uuid", "quantity": "10.000", "unitCost": "0.00" }
  ]
}
```

**Direct Receiving** — รับสินค้าเข้าโดยไม่ต้องมี Supplier หรือ PO:
- `POST /api/workspaces/:workspaceId/stores/:storeId/branches/:branchId/warehouses/:warehouseId/receipts` — `inventory.receipt.create`
- `GET /api/workspaces/:workspaceId/stores/:storeId/branches/:branchId/warehouses/:warehouseId/receipts/:receiptId` — `inventory.read`
- `POST /api/workspaces/:workspaceId/stores/:storeId/branches/:branchId/warehouses/:warehouseId/receipts/:receiptId/post` — Post รับสินค้า

Request:
```json
{
  "supplierId": null,
  "purchaseOrderId": null,
  "referenceNumber": "รับสินค้า-001",
  "items": [
    { "variantId": "uuid", "quantity": "5.000", "unitCost": "125.00" }
  ]
}
```

Rules:
- ทุก item ต้องระบุ Variant, quantity มากกว่า 0 และ unitCost เป็น Decimal string; Warehouse มาจาก route และต้องอยู่ใน Store/Branch ที่ระบุ
- quantity เป็น Decimal string ที่มีทศนิยมได้ไม่เกิน 3 ตำแหน่ง เช่น `1`, `1.250`, `1.500`; ปฏิเสธค่าที่มีทศนิยมเกิน 3 ตำแหน่งและค่าที่ไม่ใช่ตัวเลข
- กติกาเดียวกันนี้ใช้กับ StockBalance, StockMovement, Reservation, Transfer, Adjustment, OrderItem และทุก API ที่รับ/ส่ง Quantity
- ห้ามใช้ JSON floating-point number สำหรับ Quantity; Backend แปลงเป็น Prisma Decimal และบันทึก PostgreSQL NUMERIC(20,3)
- การแปลงหน่วยผ่าน VariantUOM.conversionToBase ต้องคำนวณด้วย Decimal; ผลลัพธ์ base quantity เกิน 3 ตำแหน่งให้ Validation ปฏิเสธ (ห้ามปัดเศษโดยไม่แจ้ง)
- Opening Stock ใช้ได้หนึ่ง Session ที่ Post สำเร็จต่อ Warehouse; หากต้องเพิ่มยอดภายหลังให้ใช้ Direct Receiving ไม่สร้าง Opening Stock ซ้ำ
- Direct Receiving อนุญาต supplierId และ purchaseOrderId เป็น null; หากส่งมา ต้องตรวจ ownership และสถานะของเอกสารที่อ้างถึง
- ทั้งสอง flow เริ่มจาก Draft และไม่เปลี่ยน StockBalance จนกว่าจะ Post สำเร็จ
- Post ต้องทำ atomic transaction: ตรวจ idempotency, บันทึก StockMovement, อัปเดต StockBalance และ InventoryCost/Moving Weighted Average
- ส่ง `Idempotency-Key` ในคำขอ Post; การ retry ด้วย key เดิมต้องไม่สร้าง movement/เพิ่มยอดซ้ำ
- หลัง Post ห้ามแก้ไขหรือลบรายการ; ใช้ Reversal/Adjustment พร้อม reason และ Audit Trail
- Supplier และ Purchase Order เป็น Optional Module/Reference; Commerce Core ต้องรับสินค้าได้เมื่อไม่ได้เปิด Procurement
- API นี้เป็น Authenticated API เท่านั้น; ห้ามเปิดเผย unitCost/InventoryCost ผ่าน Public Store API

### 5.7 Stock Adjustment ผ่าน CSV (OWNER only)

สิทธิ์: Workspace Owner เท่านั้น โดยใช้ `Membership.isOwner = true` เป็นตัวตัดสินสิทธิ์หลักจาก Control DB ทุก Request; Platform Admin ไม่ถือเป็น Workspace Owner โดยอัตโนมัติ และห้ามอาศัยการซ่อนปุ่ม/Role จาก Client แทนการตรวจฝั่ง Server

**Download**
- `GET /api/workspaces/:workspaceId/stores/:storeId/branches/:branchId/warehouses/:warehouseId/inventory/stock-balances.csv` — ดาวน์โหลด Snapshot ยอดคงเหลือปัจจุบัน โดย OWNER เท่านั้น
- `GET /api/workspaces/:workspaceId/inventory/stock-adjustments/csv/template?warehouseId=:warehouseId` — ดาวน์โหลด CSV Template สำหรับนับสต๊อก/ปรับยอด
- Stock Snapshot และ Template ใช้ Header Version เดียวกัน: `sku,productName,variantName,systemQuantity,countedQuantity,uomCode,reason`; `systemQuantity` เป็นข้อมูลอ้างอิงแบบ read-only, `countedQuantity` เว้นว่างให้ผู้ตรวจนับกรอก และเป็นคอลัมน์เดียวที่ใช้คำนวณ Adjustment

**Upload และ Preview**
- `POST /api/workspaces/:workspaceId/inventory/stock-adjustments/csv/imports` — Upload CSV แบบ multipart/form-data; OWNER เท่านั้น; สร้าง Import Draft และตรวจสอบข้อมูลโดยยังไม่เปลี่ยน Stock
- `GET /api/workspaces/:workspaceId/inventory/stock-adjustments/csv/imports/:importId` — ดูผล Preview, จำนวนแถวผ่าน/ไม่ผ่าน และ Error รายแถว; OWNER เท่านั้น
- `POST /api/workspaces/:workspaceId/inventory/stock-adjustments/csv/imports/:importId/commit` — ยืนยัน Import และ Post Stock Adjustment; OWNER เท่านั้น; ต้องส่ง Idempotency-Key

CSV columns (UTF-8; รองรับ UTF-8 BOM):
| Column | Required | Meaning |
|---|---:|---|
| sku | Yes | SKU ที่ unique ภายใน Workspace |
| countedQuantity | Yes | จำนวนที่นับได้จริง เป็น Decimal string สูงสุด 3 ตำแหน่ง |
| uomCode | Yes | หน่วยนับของ Variant; ระบบแปลงเป็น Base UOM ผ่าน VariantUOM |
| reason | Yes | เหตุผลการปรับยอด |

Rules:
- Import ทุกครั้งผูกกับ Workspace + Store + Branch + Warehouse เดียว; ห้ามรับ workspace/database/store scope จาก CSV
- `countedQuantity` เป็นยอดนับจริง ไม่ใช่ delta; Preview อ่าน on_hand ปัจจุบันและคำนวณ `delta = countedQuantity(base UOM) - on_hand`; แสดง before/count/delta และผลกระทบต้นทุนก่อน Commit
- SKU ต้อง resolve ได้ใน Workspace และ Variant ต้องอยู่ใน scope ที่อนุญาต; UOM ต้องเป็น Base UOM หรือ VariantUOM ที่ Active ของ Variant นั้น; Conversion ต้องได้ base quantity ไม่เกิน 3 ตำแหน่ง
- Reject แถวซ้ำ SKU+UOM, SKU ไม่พบ, UOM ไม่ถูกต้อง, จำนวนติดลบ, decimal เกิน 3 ตำแหน่ง, reason ว่าง และแถวที่มีข้อมูลผิดรูปแบบ; ไม่แก้ไข/ปัดเศษข้อมูลเงียบ ๆ
- Commit ต้องตรวจว่า StockBalance ยังตรงกับค่าที่ Preview ใช้คำนวณ หากมี Movement แทรกระหว่าง Preview กับ Commit ให้ปฏิเสธด้วย stale snapshot และให้ Preview ใหม่
- Commit สร้าง StockAdjustment + StockAdjustmentItems + StockMovement และปรับ StockBalance/InventoryCost ภายใน transaction; ใช้ Moving Weighted Average ตามกฎ Inventory และห้ามยอดติดลบเป็นค่าเริ่มต้น
- ถ้ามีแถวใดไม่ผ่าน Validation จะ Commit ไม่ได้ทั้ง Batch; ไม่มี partial commit
- Import Batch เก็บ file name, checksum, uploader, createdAt, row counts, status, error summary และผลลัพธ์; ไม่จำเป็นต้องเก็บไฟล์ต้นฉบับถาวร
- Idempotency-Key ป้องกัน Commit ซ้ำ; CSV เดิมที่ Upload ใหม่ถือเป็น Batch ใหม่และต้องผ่าน Preview/Commit ใหม่
- Export เป็น Snapshot read-only; ห้าม Export หรือ Import ผ่าน Public API; ป้องกัน CSV formula injection ในค่าข้อความที่เริ่มด้วย `=`, `+`, `-` หรือ `@` โดย escape ก่อนส่งออก
- จำกัดขนาดไฟล์/จำนวนแถว, ตรวจ MIME และนามสกุลร่วมกับการ parse จริง, ไม่เชื่อ Content-Type จาก Client เพียงอย่างเดียว; Audit Log บันทึกผู้เริ่ม Upload/Commit และ Warehouse scope

ตัวอย่าง CSV:
```csv
sku,countedQuantity,uomCode,reason
BEER-001,18.000,BOTTLE,ตรวจนับสิ้นวัน
BEER-002,2.000,CARTON,สินค้าชำรุด/ตรวจนับใหม่
```

### 5.8 Bulk Product Image Upload ผ่าน Folder (ADMIN/OWNER)

สิทธิ์: `catalog.images.import` สำหรับ Workspace ADMIN และ OWNER; ตรวจ Membership/Role จาก Control DB ฝั่ง Server ทุก Endpoint; ผู้ใช้ทั่วไปและ Store Public API ไม่มีสิทธิ์ Upload/แก้ไขรูป

**วิธีนำเข้า**
- หน้า Admin เลือก Folder จากเครื่องด้วย directory upload (เช่น browser `webkitdirectory`) หรือเลือกไฟล์ ZIP; Backend รับหลายไฟล์ใน Import Batch เดียว
- รองรับจับคู่รูปด้วยชื่อไฟล์ (Filename Mapping) หรือ Manifest CSV เพื่อจับคู่ด้วย Product ID / Variant ID; ห้ามเชื่อ ID หรือ Store scope จากไฟล์โดยไม่ตรวจว่าเป็นของ Workspace เดียวกัน
- โหมด Filename Mapping ต้องกำหนดกติกาชื่อไฟล์แน่นอน เช่น `<SKU>__main.jpg`, `<SKU>__2.jpg`, `<SKU>__variant_<variantSKU>.jpg`; ชื่อ SKU ต้อง normalize ก่อน resolve และชื่อซ้ำที่ resolve ได้หลายรายการต้องเป็น Error ไม่เดาเป้าหมาย
- Manifest CSV columns: `imagePath,productId,variantId,sku,role,sortOrder,altText`; ระบุ `productId` หรือ `variantId` อย่างใดอย่างหนึ่ง (หรือ SKU ที่ resolve ได้); หากระบุหลายตัวต้องตรวจว่าตรงกัน
- รูป Product ใช้ `productId`/SKU; รูป Variant ใช้ `variantId`/Variant SKU; `role` รองรับ `MAIN`, `GALLERY`, `VARIANT`; sortOrder คุมลำดับรูป

**Preview / Commit**
- `POST /api/workspaces/:workspaceId/catalog/images/imports` — Upload folder files/ZIP + mapping options/manifest; ADMIN/OWNER
- `GET /api/workspaces/:workspaceId/catalog/images/imports/:importId` — ดูสถานะ Batch และผลตรวจสอบ; ADMIN/OWNER
- `POST /api/workspaces/:workspaceId/catalog/images/imports/:importId/commit` — ยืนยันนำเข้ารูป; ADMIN/OWNER; Idempotency-Key
- Preview แสดงไฟล์ทั้งหมด, target Product/Variant, role, duplicate, unsupported format, unmatched file, ambiguous mapping และ validation error; ไม่มีการแก้ Catalog จนกว่า Commit
- Commit แบบ atomic เฉพาะ metadata/database; ไฟล์เก็บใน Object Storage ผ่าน temporary/staging prefix แล้ว Promote หลังผ่าน Validation; cleanup staging เมื่อ Batch ยกเลิก/หมดอายุ
- เก็บ metadata ของ logical image ใน MediaAsset (purpose, status, altText, uploader); เก็บไฟล์จริงแยกใน MediaAssetDerivative ชนิด ORIGINAL/MAIN/THUMBNAIL พร้อม object key, MIME, byte size, width/height, checksum และ processing status; ProductImage/VariantImage อ้าง logical MediaAsset เพียงรายการเดียว; DB ไม่เก็บ binary รูป
- รองรับ JPEG, PNG, WebP (กำหนด allowlist); ตรวจ magic bytes จริง, file size, pixel dimensions และ decode image; ปฏิเสธ SVG/HTML/ไฟล์ executable ใน MVP
- ป้องกัน path traversal, zip-slip, archive bomb, decompression bomb, duplicate filename และไฟล์นอก root; normalize path และไม่ใช้ path จาก Client เป็น storage key
- ใช้ checksum เพื่อตรวจรูปซ้ำ; นโยบายค่าเริ่มต้นคือไม่สร้าง Image record ซ้ำใน Product/Variant เดียวกันหาก checksum เดิม
- จำกัดจำนวนไฟล์/ขนาดรวม/ขนาดต่อไฟล์/ความละเอียด และ rate limit; ประมวลผลเป็น Batch แบบ resumable/status-tracked สำหรับชุดใหญ่
- การแทนที่ MAIN image ต้องระบุชัดเจนใน Preview และยืนยันก่อน Commit; รูปเดิมไม่ถูกลบจนกว่า Promote สำเร็จและผ่าน retention window
- Audit Trail เก็บ uploader, Workspace, target IDs, mapping mode, file checksum และผล Commit; Public Store API ส่งเฉพาะ URL/metadata ของรูปที่เผยแพร่แล้ว

ตัวอย่าง Filename Mapping:
```text
folder/
  SKU-001__main.jpg
  SKU-001__2.webp
  SKU-002__main.png
  SKU-003__variant_VAR-003__main.jpg
```

ตัวอย่าง Manifest CSV:
```csv
imagePath,productId,variantId,sku,role,sortOrder,altText
images/a.jpg,PRODUCT_UUID,,SKU-001,MAIN,0,ภาพสินค้าหลัก
images/b.webp,,VARIANT_UUID,SKU-002,GALLERY,1,ภาพเพิ่มเติม
```

## 6. Orders, Partial Payments, Refunds และ Returns

### Order Payment API

- `POST /api/stores/:storeId/orders` — สร้าง Order; response มี `grandTotal`, `paidTotal`, `balanceDue`, `paymentStatus`
- `POST /api/orders/:orderId/payments` — บันทึกรายการรับชำระ/มัดจำเพิ่ม รองรับหลาย Payment และหลายวิธีใน Order เดียว
- `POST /api/payments/:paymentId/confirm` — ยืนยันเงินสด/โอน/QR แบบ manual หรือบันทึกผล Gateway หลังตรวจ signature/reference
- `GET /api/orders/:orderId/payments` — รายการรับชำระและยอดคงค้าง
- `POST /api/payments/:paymentId/refunds` — คืนเงินโดยอ้างอิง Payment ต้นทาง

Payment request example:
```json
{
  "method": "BANK_TRANSFER",
  "amount": "500.00",
  "currency": "THB",
  "isDeposit": true,
  "dueAt": null,
  "reference": "TRANSFER-001"
}
```

Payment rules:
- Partial Payment/Deposit เป็นความสามารถ MVP; Order หนึ่งรายการมี Payment หลายรายการ/หลายวิธีได้
- `amount` เป็น Decimal string; ห้ามใช้ JSON floating-point number; ยอดชำระที่ยืนยันแล้วรวมเป็น `paidTotal`, `balanceDue = max(grandTotal - paidTotal, 0)`
- `paymentStatus`: `UNPAID`, `PARTIALLY_PAID`, `PAID`, `OVERPAID`; สถานะ Refund แยกจาก paymentStatus
- Deposit คือ Payment ที่ `isDeposit=true`; ไม่สร้าง Order status ใหม่ และไม่บังคับให้ตัด/จองสต๊อกทันที (Reservation policy แยกต่างหาก)
- ทุกการรับชำระ/ยืนยันต้องใช้ `Idempotency-Key`; retry ต้องไม่เพิ่มยอดซ้ำ; เก็บ actor, timestamp, method, reference และ audit trail
- Manual transfer/QR เริ่ม `PENDING_CONFIRMATION`; ยังไม่นับใน paidTotal จนกว่าจะยืนยัน
- Refund ต้องอ้าง Payment เดิม; ยอด Refund สะสมต้องไม่เกินยอดรับชำระที่สำเร็จและยังไม่คืน; ใช้ idempotency และ audit

### Tax Calculation & Rounding

- Tax Profile/Store ตั้งค่า `priceTaxMode` (`INCLUSIVE`/`EXCLUSIVE`) และ `roundingLevel` โดย MVP กำหนด `DOCUMENT` เท่านั้น; `roundingMethod` กำหนด `HALF_UP`
- Tax Category กำหนดประเภทภาษี เช่น STANDARD, ZERO_RATED, EXEMPT, NON_VAT; Tax Rate ผูกกับ Tax Profile + Tax Category และมี effective date; Variant อ้าง Tax Category เริ่มต้นได้
- รวม taxable base ของ Order ทั้งเอกสารแยกตาม Tax Category/Rate ก่อนคำนวณภาษี; ปัด Tax Amount ต่อกลุ่มภาษีระดับเอกสารด้วย HALF_UP ตาม currency minor unit (THB = 2 ตำแหน่ง) แล้วรวมเป็น `taxTotal`
- เก็บ Taxable Base, Tax Rate, Tax Amount ก่อน/หลังปัด, Tax Category, `roundingLevel`, `roundingMethod` และ `priceTaxMode` snapshot ใน OrderTaxLine; การแก้ Tax Profile/Rate ภายหลังไม่มีผลกับ Order เก่า
- MVP fix `roundingLevel=DOCUMENT` และ `roundingMethod=HALF_UP`; ไม่เปิดให้ Store เปลี่ยนค่าเหล่านี้ผ่าน API
- ส่วนลดต้องถูกจัดสรรเข้า taxable base ก่อนคำนวณภาษี; Inclusive/Exclusive ใช้สูตรที่สอดคล้องกับ mode และเก็บผลคำนวณใน snapshot
- Return/Refund ใช้ราคา ส่วนลด และภาษีจาก OrderItem/OrderTaxLine snapshot เดิม ไม่คำนวณด้วยอัตราปัจจุบัน

### Partial Return API

- `POST /api/orders/:orderId/returns` — สร้าง Return แบบ Draft จาก OrderItem เดิม
- `POST /api/returns/:returnId/inspect` — ระบุจำนวนรับคืนและจำนวนที่นำกลับเข้าสต๊อกตามสภาพ
- `POST /api/returns/:returnId/post` — Post Return, StockMovement และ Refund/Credit transaction แบบ atomic ตามนโยบาย

Return request example (ขายเบียร์ 1 ลัง = 12 ขวด แล้วคืน 2 ขวด):
```json
{
  "reason": "CUSTOMER_RETURN",
  "items": [
    {
      "orderItemId": "original-order-item-uuid",
      "returnUom": "BOTTLE",
      "returnQuantity": "2.000",
      "restockQuantity": "2.000",
      "condition": "SELLABLE"
    }
  ]
}
```

Return rules:
- `returnQuantity` เป็น Decimal string สูงสุด 3 ตำแหน่งในหน่วยที่รับคืน; `restockQuantity` ใน API เป็นจำนวนหน่วยฐาน Decimal string สูงสุด 3 ตำแหน่ง และต้องไม่เกิน `returnBaseQuantity`
- OrderItem ที่ขาย 1 ลังต้องเก็บ snapshot `soldUom`, `soldQuantity`, `conversionToBase`, `baseQuantity`; ReturnItem ต้องระบุ `returnUom` และแปลง `returnQuantity` เป็น `returnBaseQuantity` ด้วย factor ของ VariantUOM ณ เวลารับคืน จากนั้นเก็บ `conversionToBaseSnapshot` ไว้
- `restockQuantity` ต้องเป็นหน่วยฐานของ Variant เสมอ; ตัวอย่างคืน 2 ขวดเมื่อ base UOM = ขวด ให้ส่ง `returnUom="BOTTLE"`, `returnQuantity="2.000"`, `restockQuantity="2.000"`
- ยอดคืนสะสมของ OrderItem ห้ามเกินยอดขาย; คืน 2 ขวดจาก 12 ขวดแล้วคงเหลือขายสุทธิ 10 ขวด
- คืนเงินคำนวณจากราคาขาย ส่วนลด และภาษี snapshot เดิมของจำนวนที่คืน; ไม่ใช้ราคา/Tax Rate ปัจจุบัน
- สินค้าขายต่อได้: `restockQuantity` เท่ากับจำนวนที่รับเข้าสต๊อก; เสียหาย: `restockQuantity="0.000"` แต่ยังคืนเงินได้ตามนโยบาย
- Post ต้อง atomic, มี `Idempotency-Key`, บันทึก Return/ReturnItem, StockMovement เฉพาะ restock quantity, InventoryCost/Moving Weighted Average และ Refund; ห้ามแก้ Return ที่ Post แล้ว ใช้ Reversal/Adjustment
- Default return-cost policy สำหรับสินค้าสภาพ SELLABLE: รับกลับด้วย unit cost snapshot จาก OrderItem เดิม แล้วคำนวณ WAC ใหม่จากมูลค่าสต๊อกเดิม + มูลค่ารับคืนที่ต้นทุนเดิม; สินค้า DAMAGED/UNSELLABLE ไม่เพิ่ม on_hand และบันทึก disposition/write-off แยกต่างหาก
- Return response ต้องแสดง `returnBaseQuantity`, `restockBaseQuantity`, `refundSubtotal`, `refundDiscount`, `refundTax`, `refundAmount` เพื่อ audit และ reconcile

## 7. Public Store API (ไม่ต้อง Login)

- `GET /api/public/stores/:storeSlug` — ข้อมูล Store ที่เผยแพร่
- `GET /api/public/stores/:storeSlug/categories` — เฉพาะหมวดหมู่ ACTIVE ที่มีสินค้าที่เผยแพร่
- `GET /api/public/stores/:storeSlug/products?query=&category=&cursor=&limit=20` — เฉพาะ StoreProduct ที่ PUBLISHED พร้อมเฉพาะ StoreProductVariant ที่ PUBLISHED

Public Store response:
```json
{
  "data": {
    "name": "ร้านอุปกรณ์ IoT",
    "slug": "iot",
    "storeType": "ONLINE",
    "currency": "THB",
    "timezone": "Asia/Bangkok"
  }
}
```

Public Product response (name/description มาจาก Workspace Catalog; variants มีเฉพาะรายการที่ Store เปิดขายและ PUBLISHED):
```json
{
  "id": "store-product-uuid",
  "productId": "product-uuid",
  "name": "ESP32 Dev Board",
  "description": "Development board",
  "categories": [{ "id": "uuid", "name": "บอร์ดควบคุม", "slug": "controller-boards" }],
  "variants": [
    {
      "id": "variant-uuid",
      "title": "Standard",
      "sku": "ESP32-DEV-001",
      "price": { "amount": "1290.00", "currency": "THB" }
    }
  ]
}
```

Store ไม่สามารถ override ชื่อหรือรายละเอียด Product/Variant ใน Store response ได้; หากแก้ข้อมูล Master จะมีผลกับทุก Store ที่ใช้ Product เดียวกัน

Public API MUST NOT expose unpublished products, draft categories, average cost, purchase price, stock movements, private customer data, internal IDs unrelated to the public resource, or exact stock balance. Availability may be exposed only as a coarse purchasable flag if Store policy enables it.

## 8. Permission Keys (Draft)

| Permission | Scope |
|---|---|
| store.read / store.create / store.update | Workspace |
| branch.read / branch.create / branch.update | Store |
| catalog.product.read / create / update / archive | Workspace Catalog |
| store-product.variant.manage | Store assortment |
| store-product.read / create / update / archive | Store assortment |
| store-product.variant.manage | Store assortment |
| store-category.read / create / update / archive | Store taxonomy |
| store-product-category.manage | Store assortment |
| pricing.read / pricing.manage | Store pricing |

Owner bypasses permission checks according to current Workspace membership policy. Admin/other roles receive explicit permissions; do not assume every role has all commerce permissions.

## 9. Validation, Errors and Pagination

- Invalid input: HTTP 400; resource not found in the requested tenant/scope: HTTP 404; insufficient permission: HTTP 403; duplicate slug/SKU/assignment: HTTP 409.
- Follow NestJS exception conventions already used by the API; a normalized global error envelope can be introduced separately if required.
- List response shape: `{ data: T[], page: { nextCursor: string | null, hasMore: boolean } }`.
- Validate UUID, enum, string length, slug normalization, decimal precision, array uniqueness and pagination bounds at DTO boundary.
- Never trust workspaceId/storeId/productId/categoryId supplied by client without re-checking ownership and composite scope.
- For public slug lookup, reject DISABLED routes and verify Store is ACTIVE and published before returning content.
- Do not leak whether a resource exists in another Workspace/Store; return scoped 404.

## 10. Acceptance Tests ก่อน Implement

- User จาก Workspace A เรียก Store/Product/Category ของ Workspace B ไม่ได้
- Store หน้าร้านไม่เห็น StoreCategory/StoreProduct ของ Store ออนไลน์ และกลับกัน
- Product กลางหนึ่งตัว attach ไปสอง Store ได้ โดยตั้งราคา/สถานะเผยแพร่/Category และชุด Variant ที่เปิดขายแยกกัน
- แต่ละ Store เปิดขายเฉพาะบาง Variant ของ Product ได้ และ Public API ต้องไม่แสดง Variant ที่ไม่ได้เปิดขาย
- ชื่อและรายละเอียด Product/Variant ใช้จาก Catalog กลางเหมือนกันทุก Store ไม่มี Store override
- Category ของ Store A ไม่สามารถ assign ให้ Store B ได้ แม้ส่ง UUID ที่ถูกต้อง
- Parent Category จาก Store อื่นถูกปฏิเสธ และการสร้าง cycle ถูกปฏิเสธ
- Public API แสดงเฉพาะ PUBLISHED assortment และ ACTIVE category ที่เกี่ยวข้อง
- Public API ไม่คืนต้นทุนหรือยอดคงเหลือจริง
- Price history และ Order snapshot เดิมไม่เปลี่ยนหลังแก้ราคา
- Slug duplicate แบบ case-insensitive ถูกปฏิเสธทั้ง Store route
- การสร้าง Store สร้าง Default Branch `สำนักงานใหญ่` และ Default Warehouse `คลังหลัก` ครบถ้วน; หากขั้นตอนใดล้มเหลวต้อง rollback/compensate และไม่เหลือ Store หรือ Public Route ที่ไม่สมบูรณ์
- Store มี Default Branch ได้หนึ่งแห่ง และแต่ละ Branch มี Default Warehouse ได้หนึ่งแห่ง; การเปลี่ยน Default ต้องไม่ทำให้เกิดรายการ Default ซ้ำ
- Pagination และ filters ทำงานภายใต้ Store scope เท่านั้น
- Opening Stock Post สร้าง Movement/Balance/Cost ครบใน transaction เดียว; retry ด้วย Idempotency-Key เดิมไม่เพิ่มยอดซ้ำ
- Warehouse เดียวกันไม่สามารถ Post Opening Stock Session สำเร็จได้มากกว่าหนึ่งครั้ง; Session ซ้ำถูกปฏิเสธ
- Direct Receiving ทำงานได้เมื่อ supplierId และ purchaseOrderId เป็น null และไม่เปิด Procurement Module
- Direct Receiving ที่อ้าง Supplier/PO ต้องตรวจ scope; reference ที่อยู่นอก Workspace หรือไม่ถูกต้องต้องถูกปฏิเสธ
- Moving Weighted Average ถูกคำนวณถูกต้องเมื่อมี Opening Stock และ Direct Receiving ต่อเนื่องกัน
- สร้าง Order แล้วรับมัดจำบางส่วนได้; paidTotal/balanceDue/paymentStatus ถูกต้อง และ Order เดิมยังเปิดค้างยอดชำระ
- รับชำระหลายครั้ง/หลายวิธีจนเต็มยอดแล้ว paymentStatus เปลี่ยนเป็น PAID; overpayment ต้องแสดง OVERPAID และไม่ทำให้รับชำระซ้ำจาก Idempotency-Key
- Manual transfer/QR ที่ยัง PENDING_CONFIRMATION ต้องไม่ถูกรวมใน paidTotal; เมื่อ confirm แล้วจึงเพิ่ม paidTotal หนึ่งครั้ง
- Refund สะสมต้องไม่เกินยอด Payment ที่สำเร็จและยังไม่คืน; retry ด้วย Idempotency-Key เดิมไม่คืนเงินซ้ำ
- Tax Document Level: รวมฐานภาษีแยกตาม category/rate ก่อนปัด HALF_UP 2 ตำแหน่ง; ทดสอบกรณีผลรวม line-level rounding ต่างจาก document-level
- Tax Inclusive/Exclusive, discount allocation และ tax snapshot คงเดิมแม้เปลี่ยน Tax Rate/Tax Profile ภายหลัง
- ขาย Variant หน่วยลัง 1.000 โดย conversion snapshot 12 ขวด/ลัง แล้ว Return 2.000 ขวด: สต๊อกเพิ่ม 2 ขวด, ยอดขายสุทธิคง 10 ขวด และ refund ใช้ราคา/ส่วนลด/ภาษี snapshot เดิม
- Return สินค้าขายต่อได้ต้องเพิ่มมูลค่าสต๊อกด้วย original unit_cost_snapshot และคำนวณ WAC ใหม่; ทดสอบยอด quantity/value/average cost ก่อนและหลัง Return
- Return ขวดที่เสียหาย: returnQuantity=2.000, restockQuantity=0.000; คืนเงินตาม snapshot แต่ไม่เพิ่ม StockBalance
- Partial Return สะสมหลายครั้งต้องไม่เกินจำนวนที่ขาย; ปฏิเสธการคืนเกิน, OrderItem อื่น, Store/Workspace อื่น และ quantity เกิน 3 decimal places
- Partial Return Post ต้องสร้าง Return/StockMovement/InventoryCost/Refund แบบ atomic; retry Idempotency-Key เดิมไม่เพิ่มสต๊อกหรือคืนเงินซ้ำ
- WAC หลังคืนสินค้าต้องถูกต้องตามต้นทุน snapshot/นโยบาย return costing ที่กำหนด; ledger ต้อง reconcile กับ StockBalance
- Posted stock movement แก้ไข/ลบไม่ได้; Reversal/Adjustment ต้องอ้างอิงรายการเดิมและบันทึกเหตุผล/ผู้กระทำ

## 11. Open Decisions ก่อน Migration / Implementation

1. SKU unique ทั้ง Workspace — ยืนยันแล้ว; ต้องสร้าง DB constraint และทดสอบ duplicate แบบ case-insensitive
2. Store เลือกเปิดขาย Variant เป็นรายตัว — ยืนยันแล้ว; ใช้ StoreProductVariant
3. ข้อมูลชื่อ/รายละเอียด Product ใช้ Catalog กลางร่วมกันทุก Store ไม่มี override — ยืนยันแล้ว
4. Quantity/Custom UOM/Unit Conversion — ยืนยันแล้ว; รองรับทุกหน่วย สูงสุด 3 ตำแหน่ง, UOM scope Workspace และราคาต่อหน่วยขาย
5. StoreType มีผลเฉพาะ UX/ช่องทางเริ่มต้น หรือจะบังคับไม่ให้ PHYSICAL ใช้ Online checkout / ONLINE ใช้ POS? (ข้อเสนอ: ใช้เป็นค่าเริ่มต้น UX ไม่ใช่ข้อจำกัดทางข้อมูล)

Partial Payment/Deposit และ Tax Rounding ไม่ใช่ Open Decision แล้ว: ยืนยัน Partial Payment/Deposit ตั้งแต่ MVP และ Tax Document Level + HALF_UP ตามหัวข้อ 6
