# SyncUp Commerce Domain ERD

สถานะ: Design Review v8 — ยืนยัน Quantity สูงสุด 3 ตำแหน่ง, Custom UOM/Unit Conversion และราคาขายหลายหน่วย; ยังไม่ใช่ Migration หรือ Schema ที่นำไป Deploy
วันที่: 2026-11-02

## 1. ข้อกำหนดที่ยืนยันแล้ว

- หนึ่ง Workspace มีหลาย Store ได้
- หนึ่ง Store มีหลาย Branch ได้
- เมื่อสร้าง Store ระบบสร้าง Default Branch ชื่อ `สำนักงานใหญ่` และ Default Warehouse ชื่อ `คลังหลัก` ให้อัตโนมัติ
- แต่ละ Branch มี Warehouse ได้หลายแห่ง และมี Default Warehouse ได้หนึ่งแห่ง
- Product Catalog เป็นระดับ Workspace แต่ละ Store เลือกเปิดขายสินค้าเองได้ และกำหนดราคา/การเผยแพร่แยกกัน
- Store หน้าร้านและ Store ออนไลน์สามารถมี Sortiment ต่างกันโดยสิ้นเชิง เช่น ของชำทั่วไปสำหรับหน้าร้าน และอุปกรณ์ IoT สำหรับออนไลน์
- Product Variant เป็นหน่วยที่ขายและนับสต๊อก โดยแต่ละ Variant มี SKU และ Barcode ได้
- VAT Profile ตั้งค่าแยกตาม Store และมีผลตามช่วงวันที่
- ต้นทุนใช้ Moving Weighted Average แยกตาม Variant + Warehouse
- รองรับเงินสด/โอน/QR แบบพนักงานยืนยัน และ Payment Gateway
- ลูกค้าเข้าดู Public Store ได้โดยไม่ Login
- เงินใช้ PostgreSQL NUMERIC/Prisma Decimal ไม่ใช้ Float/Double
- Quantity รองรับจำนวนเต็มและทศนิยมทุกหน่วย สูงสุด 3 ตำแหน่ง; ใช้ PostgreSQL NUMERIC(20,3)/Prisma Decimal ไม่ใช้ Float/Double

## 2. Tenant boundary และ Store routing

### Control Database

คงข้อมูลระดับแพลตฟอร์มเดิม ได้แก่ User, Workspace, Membership, Session, Role, Permission และ ModuleInstallation

เพิ่มแนวคิด StorePublicRoute ใน Control Database สำหรับ Public Store Resolver:

- id UUID
- workspace_id UUID
- store_id UUID (external reference ไปยัง Tenant DB; ไม่มี FK ข้าม Database)
- slug VARCHAR และ UNIQUE แบบ case-insensitive
- status: ACTIVE / DISABLED
- created_at, updated_at

เหตุผล: Public request เริ่มต้นจาก slug จึงยังไม่ทราบ Workspace ID และไม่ควรไล่ค้นทุก Tenant Database
Resolver อ่าน route จาก Control DB แล้ว resolve tenant connection จาก workspace_id ก่อนอ่านข้อมูล Store ที่เผยแพร่จริง
การเปลี่ยน slug ต้องป้องกัน route เก่าชี้ผิดร้าน และตรวจ slug ซ้ำแบบไม่สนตัวพิมพ์เล็ก/ใหญ่

### Tenant Database

ข้อมูลธุรกิจทั้งหมดอยู่ใน Tenant DB ของ Workspace เดียวกัน ไม่ใส่ workspace_id ซ้ำทุกตารางโดยไม่จำเป็น
ตารางที่เป็นข้อมูลของร้านต้องมี store_id หรือมีความสัมพันธ์ที่บังคับขอบเขต Store อย่างชัดเจน
Catalog เป็นระดับ Workspace ตามการตัดสินใจแล้ว และ StoreProduct เป็นตัวกำหนดว่าสินค้าใดเปิดขายในร้านใด แต่ละ Store กำหนดสถานะเผยแพร่ ราคา หมวดหมู่หน้าร้าน และการตั้งค่าการขายของตนเองได้ โดยไม่จำเป็นต้องเปิดเผยสินค้าทั้งหมดจาก Catalog

ตัวอย่างการใช้งานของ Workspace นี้:
- Store หน้าร้าน: เปิดขายสินค้าของชำทั่วไป
- Store ออนไลน์: เปิดขายอุปกรณ์ IoT เช่น ESP32, Sensor และ Smart Switch
- สินค้ารายการใดที่ต้องขายทั้งสองช่องทาง ให้เชื่อม Product เดียวกันกับ StoreProduct ของทั้งสอง Store

## 3. ERD — Store, Catalog และ Pricing

\`\`\`mermaid
erDiagram
    STORE ||--o{ BRANCH : has
    STORE ||--o{ STORE_PRODUCT : publishes
    PRODUCT ||--o{ PRODUCT_VARIANT : has
    UNIT_OF_MEASURE ||--o{ PRODUCT_VARIANT : base_unit
    UNIT_OF_MEASURE ||--o{ VARIANT_UOM : selectable_unit
    PRODUCT_VARIANT ||--o{ VARIANT_UOM : defines_units
    PRODUCT ||--o{ STORE_PRODUCT : listed_as
    STORE ||--o{ STORE_CATEGORY : organizes
    STORE_CATEGORY ||--o{ STORE_CATEGORY : parent_of
    STORE_PRODUCT ||--o{ STORE_PRODUCT_CATEGORY : assigned_to
    STORE_CATEGORY ||--o{ STORE_PRODUCT_CATEGORY : classifies
    PRODUCT_VARIANT ||--o{ VARIANT_BARCODE : identifies
    PRODUCT_VARIANT ||--o{ STORE_PRODUCT_VARIANT : enabled_as
    STORE_PRODUCT ||--o{ STORE_PRODUCT_VARIANT : selects
    STORE_PRODUCT_VARIANT ||--o{ PRODUCT_PRICE : priced
    VARIANT_UOM ||--o{ PRODUCT_PRICE : price_unit
    STORE ||--o{ TAX_PROFILE : configures
    TAX_PROFILE ||--o{ TAX_RATE : defines
    TAX_CATEGORY ||--o{ TAX_RATE : classifies
    TAX_CATEGORY ||--o{ PRODUCT_VARIANT : default_tax

    STORE {
      uuid id PK
      string name
      string slug
      string store_type
      string status
      string timezone
      string currency
    }
    BRANCH {
      uuid id PK
      uuid store_id FK
      string code
      string name
      string status
      boolean is_default
    }
    PRODUCT {
      uuid id PK
      string name
      string description
      string status
    }
    UNIT_OF_MEASURE {
      uuid id PK
      uuid workspace_id FK
      string code
      string name
      string symbol
      string dimension
      int decimal_places
      string status
      boolean is_system
    }
    PRODUCT_VARIANT {
      uuid id PK
      uuid product_id FK
      uuid base_uom_id FK
      uuid tax_category_id FK
      string sku UK
      string title
      string status
    }
    VARIANT_UOM {
      uuid id PK
      uuid variant_id FK
      uuid uom_id FK
      string usage
      decimal(20,9) conversion_to_base
      string status
    }
    VARIANT_BARCODE {
      uuid id PK
      uuid variant_id FK
      string barcode UK
      string symbology
    }
    STORE_CATEGORY {
      uuid id PK
      uuid store_id FK
      uuid parent_id FK
      string name
      string slug
      string status
      int sort_order
    }
    STORE_PRODUCT_CATEGORY {
      uuid store_id FK
      uuid store_product_id FK
      uuid category_id FK
    }
    STORE_PRODUCT {
      uuid id PK
      uuid store_id FK
      uuid product_id FK
      string publish_status
      int sort_order
    }
    STORE_PRODUCT_VARIANT {
      uuid id PK
      uuid store_product_id FK
      uuid product_id FK
      uuid variant_id FK
      string publish_status
      int sort_order
    }
    PRODUCT_PRICE {
      uuid id PK
      uuid store_product_variant_id FK
      uuid variant_uom_id FK
      decimal amount
      string currency
      datetime valid_from
      datetime valid_to
    }
    TAX_PROFILE {
      uuid id PK
      uuid store_id FK
      string tax_mode
      string price_tax_mode
      string rounding_level
      string rounding_method
      int currency_minor_units
      datetime valid_from
      datetime valid_to
    }
    TAX_CATEGORY {
      uuid id PK
      string code UK
      string name
      string status
    }
    TAX_RATE {
      uuid id PK
      uuid tax_profile_id FK
      uuid tax_category_id FK
      decimal(9,6) rate
      datetime valid_from
      datetime valid_to
    }
\`\`\`

### กฎและ Constraints

- store.slug unique ใน Tenant DB และมี route mapping ที่ unique ใน Control DB
- branch.code unique ภายใน Store
- การสร้าง Store ต้องสร้าง Branch เริ่มต้น `สำนักงานใหญ่` และ Warehouse เริ่มต้น `คลังหลัก` ใน workflow เดียวกัน; ต้องจัดการ partial failure ให้ไม่มี Store ที่สร้างสำเร็จแต่ขาด Default Branch/Warehouse
- Store มี Default Branch ได้เพียงหนึ่งรายการ (เช่น partial unique index บน store_id เมื่อ is_default = true); Branch ที่สร้างเพิ่มภายหลังไม่เป็น Default โดยอัตโนมัติ
- ทุก Branch ต้องมีอย่างน้อยหนึ่ง Warehouse; Warehouse เริ่มต้นของ Default Branch เป็น `คลังหลัก` และเป็น Default Warehouse ของ Branch นั้น
- Branch หนึ่งมี Default Warehouse ได้เพียงหนึ่งแห่ง (เช่น partial unique index บน branch_id เมื่อ is_default = true); Warehouse เพิ่มเติมไม่เป็น Default โดยอัตโนมัติ
- ห้าม Archive Default Branch/Warehouse หากยังไม่ได้กำหนดรายการทดแทน และห้าม Archive Branch ที่ยังมี Warehouse/ธุรกรรมอ้างอิงโดยไม่ผ่าน workflow ที่กำหนด
- store_category.slug unique ภายใน Store (case-insensitive); parent_id ต้องอยู่ Store เดียวกันและห้ามเกิด cycle
- store_product unique (store_id, product_id); store_category และ store_product ต้องมี unique (store_id, id) เพื่อใช้ composite FK จาก store_product_category
- store_product_variant unique (store_product_id, variant_id); variant ต้องเป็นของ Product ที่ StoreProduct อ้างถึง โดยใช้ composite FK/constraint ตรวจ product_id ให้ตรงกัน
- StoreProductVariant เป็นตัวกำหนดว่า Variant ใดเปิดขายใน Store นั้นได้; ProductPrice อ้าง StoreProductVariant + VariantUOM เพื่อกำหนดราคาแยกตามหน่วยขาย
- store_product_category unique (store_id, store_product_id, category_id); composite FK ทั้งสองฝั่งต้องใช้ store_id เดียวกัน
- product_variant.sku ต้อง unique ทั้ง Workspace (ยืนยันแล้ว); เนื่องจาก Tenant DB แยกต่อ Workspace ให้ enforce ด้วย UNIQUE บน normalized_sku หรือ unique index บน lower(btrim(sku)) เพื่อกัน SKU ซ้ำต่างตัวพิมพ์/ช่องว่าง
- Barcode unique ภายใน Workspace; Variant หนึ่งตัวมี Barcode ได้หลายค่า และควร normalize ก่อนบังคับ unique
- Product เป็นข้อมูลหลักระดับ Workspace; StoreProduct เปิดเผยสินค้าแยกแต่ละร้าน และไม่บังคับให้ทุก Store ใช้สินค้าชุดเดียวกัน
- ข้อมูลชื่อ คำอธิบาย และข้อมูลสินค้า Master ใช้ร่วมกันทุก Store ไม่มี Store-specific override ในขอบเขตที่ยืนยันแล้ว
- แต่ละ Store เลือกเปิดขาย/ปิดขายเป็นราย Variant ผ่าน StoreProductVariant ได้ โดยไม่จำเป็นต้องเปิดทุก Variant ของ Product
- Category เป็นระดับ Store (StoreCategory) ไม่ใช่ระดับ Workspace; ชื่อ/ลำดับชั้น/slug ของหมวดหมู่จึงเป็นอิสระต่อกัน
- StoreProductCategory เชื่อมสินค้าใน Store กับหมวดหมู่ของ Store นั้นเท่านั้น; Product เดียวกันจัดอยู่คนละหมวดในแต่ละ Store ได้
- ใช้ composite FK/unique เช่น (store_id, id) บน StoreCategory และ StoreProduct แล้วบังคับ StoreProductCategory(store_id, store_product_id, category_id) ให้อ้างถึงทั้งคู่ด้วย store_id เดียวกัน ป้องกันการผูกสินค้าข้าม Store
- Store หน้าร้านสามารถมีหมวดอาหาร เครื่องดื่ม ของใช้ ส่วน Store ออนไลน์มีหมวดบอร์ดควบคุม เซนเซอร์ ระบบสื่อสาร และ Smart Home
- Public API ห้ามส่งต้นทุน ราคาทุน หรือ Stock Balance ภายใน
- ProductPrice ต้องมี currency และช่วงเวลามีผล; ป้องกันช่วงเวลาราคาซ้อนกันสำหรับ StoreProductVariant + VariantUOM + currency เดียวกัน
- ใช้หน่วยฐานของ Variant สำหรับ Stock Ledger; การขายแพ็ก/ลังแปลงเป็นหน่วยฐานผ่าน VariantUOM.conversion_to_base แบบ Decimal และผลลัพธ์ต้องอยู่ในความละเอียดสูงสุด 3 ตำแหน่ง
- Product ที่มีธุรกรรมแล้วให้ Archive ไม่ hard delete

## 4. ERD — Inventory และ Weighted Average Cost

\`\`\`mermaid
erDiagram
    BRANCH ||--o{ WAREHOUSE : owns
    WAREHOUSE ||--o{ STOCK_BALANCE : holds
    PRODUCT_VARIANT ||--o{ STOCK_BALANCE : counted
    WAREHOUSE ||--o{ STOCK_MOVEMENT : records
    PRODUCT_VARIANT ||--o{ STOCK_MOVEMENT : moves
    WAREHOUSE ||--o{ STOCK_RESERVATION : reserves
    PRODUCT_VARIANT ||--o{ STOCK_RESERVATION : reserved
    WAREHOUSE ||--o{ INVENTORY_COST : values
    PRODUCT_VARIANT ||--o{ INVENTORY_COST : costed

    WAREHOUSE {
      uuid id PK
      uuid branch_id FK
      string code
      string name
      boolean is_default
    }
    STOCK_BALANCE {
      uuid warehouse_id FK
      uuid variant_id FK
      decimal(20,3) on_hand
      decimal(20,3) reserved
      decimal(20,3) available
      datetime updated_at
    }
    STOCK_MOVEMENT {
      uuid id PK
      uuid warehouse_id FK
      uuid variant_id FK
      string movement_type
      decimal(20,3) quantity_delta
      decimal unit_cost
      decimal total_cost
      string reference_type
      uuid reference_id
      uuid idempotency_key
      datetime occurred_at
    }
    STOCK_RESERVATION {
      uuid id PK
      uuid warehouse_id FK
      uuid variant_id FK
      decimal(20,3) quantity
      string status
      string reference_type
      uuid reference_id
      datetime expires_at
    }
    INVENTORY_COST {
      uuid warehouse_id FK
      uuid variant_id FK
      decimal(20,3) quantity
      decimal average_unit_cost
      decimal inventory_value
      datetime updated_at
    }
\`\`\`

### กฎ Unit of Measure และการตั้งราคาขายหลายหน่วย

- UnitOfMeasure เป็นข้อมูลระดับ Workspace; มีหน่วยเริ่มต้น เช่น ชิ้น/อัน/กล่อง/แพ็ก/ลัง, กรัม/กิโลกรัม, มิลลิเมตร/เซนติเมตร/เมตร และมิลลิลิตร/ลิตร และผู้ใช้เพิ่มหน่วยเองได้ เช่น ม้วน/เส้น/ขวด/ถุง/แผ่น
- หน่วยมี code, name, symbol, dimension/group, decimal_places (0–3), status และ is_system; code ต้อง unique แบบ normalize ภายใน Workspace
- ProductVariant กำหนด base UOM หนึ่งหน่วย; VariantUOM กำหนดหน่วยขาย/รับซื้อเพิ่มเติมและ conversion_to_base ต่อ Variant เพราะ 1 ลังของสินค้าแต่ละชนิดอาจมีจำนวนขวดไม่เท่ากัน
- conversion_to_base เป็น Decimal factor (แนะนำ NUMERIC(20,9)); ความละเอียดของ factor ไม่ใช่ความละเอียด Quantity และต้องแปลงแล้วได้ base quantity ที่ไม่เกิน 3 ตำแหน่ง มิฉะนั้น reject หรือใช้ rounding policy ที่ประกาศชัดเจน
- ตัวอย่างเบียร์: base UOM = ขวด; VariantUOM = ลัง โดย conversion_to_base = 12 หมายถึง 1 ลัง = 12 ขวด; Store ตั้งราคาแยกได้ เช่น 1 ขวด = 40 บาท และ 1 ลัง = 450 บาท
- ProductPrice ต้องอ้าง StoreProductVariant + VariantUOM เพื่อเก็บราคาต่อหน่วยขายแยกกัน; POS/Online เลือกหน่วยขายและจำนวนได้ แต่ก่อนตัดสต๊อกต้องแปลงเป็น base UOM
- StockBalance, StockMovement และ InventoryCost เก็บปริมาณใน base UOM เท่านั้น; OrderItem เก็บ snapshot ของหน่วยขาย, จำนวนที่ลูกค้าซื้อ, conversion factor ณ เวลาขาย และ base quantity เพื่อรักษาประวัติ
- UOM ที่มีธุรกรรมหรือถูกอ้างอิงแล้วห้ามลบ; เปลี่ยนเป็น Inactive; ห้ามแก้ dimension หรือ precision จนทำให้ความหมายของธุรกรรมเก่าเปลี่ยน
- หน่วยมาตรฐานและหน่วยที่ผู้ใช้สร้างอยู่ภายใต้ Workspace เพื่อให้ Catalog กลางใช้ร่วมกันได้ทุก Store

### กฎ Inventory

- Quantity ทุกหน่วยรองรับจำนวนเต็มและทศนิยม โดยกำหนดความละเอียดสูงสุด 3 ตำแหน่ง; ตัวอย่าง `1`, `1.250` และ `1.500`
- ฟิลด์ปริมาณใน StockBalance, StockMovement, StockReservation, Transfer, Adjustment, Receiving, Opening Stock และ OrderItem ใช้ PostgreSQL `NUMERIC(20,3)` / Prisma `Decimal`; ห้ามใช้ Float/Double
- API รับและส่ง Quantity เป็น Decimal string เพื่อป้องกัน precision loss; ตรวจค่ามากกว่า 0 ในรายการรับเข้า และปฏิเสธค่าที่มีทศนิยมเกิน 3 ตำแหน่ง
- การแปลงหน่วยขาย/แพ็กเป็นหน่วยฐานต้องใช้ VariantUOM conversion factor แบบ Decimal; ผลลัพธ์ base quantity ต้องไม่เกิน 3 ตำแหน่ง; หากเกินให้ปฏิเสธหรือใช้ rounding policy ที่ระบุชัดเจน ห้ามปัดเงียบ
- StockMovement เป็น Ledger ต้นทาง; StockBalance เป็นยอดสรุปที่ต้อง Reconcile ได้
- available = on_hand - reserved; ห้ามใช้ available เป็นยอด on_hand
- ทุก Movement มี type, quantity, cost, reference document, actor และ timestamp; quantity ใช้ NUMERIC(20,3)
- ห้ามแก้หรือลบ Movement ที่ Post แล้ว; แก้ด้วย Reversal Movement
- Opening Stock และ Direct Receiving รองรับตั้งแต่ Commerce Core โดยไม่บังคับ Supplier หรือ Purchase Order
- Opening Stock ใช้บันทึกยอดตั้งต้นของ Variant + Warehouse พร้อมจำนวนและ unit cost; แต่ละ Warehouse มี Opening Stock Session ที่ Post สำเร็จได้เพียงหนึ่ง Session และห้าม Post ซ้ำใน Session เดิม
- Direct Receiving รับสินค้าเข้า Warehouse ได้โดยตรง; supplier_id และ purchase_order_id เป็น optional reference และไม่เป็นเงื่อนไขของการ Post
- ทั้ง Opening Stock และ Direct Receiving ต้องสร้าง StockMovement และ InventoryCost/StockBalance ใน DB transaction เดียวกัน พร้อมคำนวณ Moving Weighted Average
- ทุกการเพิ่มสต๊อกต้องระบุ Warehouse, Variant, quantity และ unit_cost; รองรับ unit_cost = 0 เฉพาะกรณีที่ธุรกิจอนุญาตและต้องผ่าน validation/policy
- Movement ที่ Post แล้วแก้ไข/ลบไม่ได้; ความผิดพลาดแก้ด้วย Reversal หรือ Adjustment ที่อ้างอิงรายการเดิม พร้อม reason, actor และ Audit Trail
- การ Post ต้องรองรับ Idempotency-Key และป้องกันการ Post ซ้ำ/ยอดซ้ำจาก retry หรือ concurrent request
- รับสินค้า: คำนวณ Moving Average ภายใน transaction
- ขายสินค้า: ตัดต้นทุนด้วย average cost ณ เวลาที่ Post และเก็บ Cost Snapshot ใน OrderItem
- โอนคลัง: สร้าง Transfer Out/Transfer In ที่เชื่อมกัน และส่งต่อมูลค่าต้นทุนจากคลังต้นทาง
- การจองสต๊อกไม่ตัด on_hand; เปลี่ยน reserved เท่านั้น
- Adjustment ต้องมีเหตุผล ผู้สร้าง และผู้อนุมัติตามสิทธิ์
- ใช้ atomic transaction/row lock หรือ conditional update ป้องกัน oversell/race condition
- Weighted Average ต่อ Variant + Warehouse:
  new average = (old inventory value + received total cost) / (old quantity + received quantity)
- สินค้าติดลบไม่อนุญาตเป็นค่าเริ่มต้น; Override ต้องมี Permission และ Audit

## 5. ERD — Orders, Payments และ Tax Snapshot

\`\`\`mermaid
erDiagram
    STORE ||--o{ SALES_ORDER : receives
    BRANCH ||--o{ SALES_ORDER : fulfills
    SALES_ORDER ||--|{ SALES_ORDER_ITEM : contains
    SALES_ORDER ||--o{ PAYMENT : paid_by
    PAYMENT ||--o{ PAYMENT_TRANSACTION : attempts
    PAYMENT ||--o{ REFUND : refunded
    SALES_ORDER ||--o{ ORDER_TAX_LINE : snapshots
    SALES_ORDER ||--o{ FULFILLMENT : fulfilled
    SALES_ORDER_ITEM ||--o{ RETURN_ITEM : returned
    SALES_ORDER ||--o{ SALES_RETURN : has
    SALES_RETURN ||--|{ RETURN_ITEM : contains

    SALES_ORDER {
      uuid id PK
      uuid store_id FK
      uuid branch_id FK
      string order_number
      string channel
      string status
      string currency
      decimal subtotal
      decimal discount_total
      decimal tax_total
      decimal shipping_total
      string payment_status
      decimal paid_total
      decimal balance_due
      decimal grand_total
      string idempotency_key
      datetime placed_at
    }
    SALES_ORDER_ITEM {
      uuid id PK
      uuid order_id FK
      uuid variant_id FK
      string product_name_snapshot
      string variant_name_snapshot
      string sku_snapshot
      decimal(20,3) quantity
      string sold_uom_snapshot
      decimal conversion_to_base_snapshot
      decimal(20,3) base_quantity
      decimal unit_price
      decimal discount_amount
      decimal tax_amount
      string tax_category_snapshot
      decimal(9,6) tax_rate_snapshot
      decimal unit_cost_snapshot
      decimal line_total
    }
    PAYMENT {
      uuid id PK
      uuid order_id FK
      string method
      string status
      decimal amount
      string currency
      boolean is_deposit
      datetime due_at
      datetime confirmed_at
      uuid confirmed_by
      string idempotency_key UK
      datetime created_at
    }
    PAYMENT_TRANSACTION {
      uuid id PK
      uuid payment_id FK
      string provider
      string provider_reference
      string status
      decimal amount
      datetime processed_at
    }
    REFUND {
      uuid id PK
      uuid payment_id FK
      decimal amount
      string reason
      string status
      string idempotency_key UK
      uuid processed_by
      datetime processed_at
    }
    ORDER_TAX_LINE {
      uuid id PK
      uuid order_id FK
      string tax_category_code_snapshot
      string tax_name_snapshot
      decimal(9,6) tax_rate_snapshot
      decimal taxable_amount_unrounded
      decimal tax_amount_unrounded
      decimal tax_amount_rounded
      string rounding_level_snapshot
      string rounding_method_snapshot
      string price_tax_mode_snapshot
    }
    FULFILLMENT {
      uuid id PK
      uuid order_id FK
      string status
      string carrier
      string tracking_number
    }
    SALES_RETURN {
      uuid id PK
      uuid order_id FK
      string return_number
      string status
      string reason
      decimal refund_total
      string idempotency_key UK
      uuid posted_by
      datetime posted_at
    }
    RETURN_ITEM {
      uuid id PK
      uuid return_id FK
      uuid order_item_id FK
      decimal(20,3) return_quantity
      string return_uom_snapshot
      decimal(20,9) conversion_to_base_snapshot
      decimal(20,3) return_base_quantity
      decimal(20,3) restock_base_quantity
      decimal refund_subtotal
      decimal refund_discount
      decimal refund_tax
      decimal refund_amount
      decimal(20,9) original_unit_cost_snapshot
      string condition
    }
\`\`\`

### Order และ Financial Rules

- Order เป็นธุรกรรมหลัก มี channel: POS, ONLINE, MANUAL (future)
- OrderItem เก็บ Snapshot ชื่อสินค้า Variant SKU ราคา ส่วนลด ภาษี ต้นทุน หน่วยและจำนวน ณ เวลาขาย
- Order totals แยกยอดก่อนภาษี ส่วนลด ภาษี ค่าจัดส่ง/ค่าบริการ และยอดสุทธิ
- ใช้ Decimal; Tax Rounding เป็น Document Level โดยรวม Taxable Base ตาม Tax Category/Rate ก่อนคำนวณภาษี และปัดยอดภาษีต่อกลุ่มภาษีในเอกสารด้วย HALF_UP ตาม minor unit ของ Currency (THB = 2 ตำแหน่ง); เก็บค่าฐาน/ภาษีก่อนปัดและยอดหลังปัดใน OrderTaxLine Snapshot
- TaxCategory เป็นรหัสประเภทภาษีที่ ProductVariant อ้างเป็นค่าเริ่มต้น; TaxRate ผูกกับ TaxProfile + TaxCategory และมี effective date; ตอนสร้าง Order ต้อง resolve rate ที่มีผลแล้ว snapshot ทั้ง category, rate, mode และผลคำนวณ ห้ามแก้ Order เก่าย้อนหลัง
- TaxProfile ต้องระบุ rounding_level=DOCUMENT และ rounding_method=HALF_UP; ใน MVP ไม่เปิดให้ Store เปลี่ยนสองค่านี้ แม้เก็บเป็น field เพื่อ version/configuration ในอนาคต
- Payment แยกจาก Order รองรับ Partial Payment/Deposit ตั้งแต่ MVP; หนึ่ง Order มี Payment หลายรายการและหลายวิธีได้
- Payment แต่ละรายการเก็บ amount, method, status และ optional due_at; เงินมัดจำเป็น Payment ที่ระบุ is_deposit=true ไม่ใช่สถานะ Order แยก
- Order payment_status คำนวณจากยอด Payment ที่ยืนยันแล้วเทียบ grand_total: UNPAID, PARTIALLY_PAID, PAID, OVERPAID; ยอดคืนเงินติดตามแยกจากสถานะชำระ
- การรับชำระแต่ละครั้งต้องมี idempotency และ audit actor/time; Refund อ้างอิง Payment เดิมและคืนได้ไม่เกินยอดรับเงินจริงที่ยังไม่คืน
- PaymentTransaction เก็บ attempt/webhook/provider reference; ห้ามเก็บเลขบัตรหรือ secret payment data
- Gateway ต้องตรวจ signature, amount, currency, order reference และ idempotency ก่อน mark paid
- โอน/QR แบบ manual มีสถานะ PENDING_CONFIRMATION พร้อมผู้ยืนยัน/เวลา/หลักฐานตามนโยบาย
- Order status ไม่ควรถูกอนุมานจาก Payment อย่างเดียว; ใช้ State Transition Service
- Refund คือคืนเงิน; Return คือรับสินค้ากลับ เป็นคนละกระบวนการ; ReturnItem อ้าง OrderItem เดิมและบันทึก return_quantity/restock_quantity แยกกัน
- Return สะสมต่อ OrderItem ต้องไม่เกิน base_quantity ที่ขาย; การคืนบางส่วนคิดคืนเงินจากราคา/ส่วนลด/ภาษี Snapshot เดิม ไม่ใช้ราคาปัจจุบัน
- ReturnItem บันทึก return_quantity ในหน่วยที่รับคืน, return_uom_snapshot, conversion_to_base_snapshot, return_base_quantity และ restock_base_quantity; StockMovement ใช้หน่วยฐานเท่านั้น
- ReturnItem ต้องเก็บ refund_subtotal, refund_discount, refund_tax แยกกันเพื่อ audit การคำนวณคืนเงินจาก OrderItem Snapshot; refund_amount เป็นยอดสุทธิที่ต้องคืน
- Return ที่ตรวจแล้วว่าสินค้าขายต่อได้ให้รับกลับเข้าสต๊อกด้วยต้นทุนต่อหน่วยจาก unit_cost_snapshot ของ OrderItem เดิม (ข้อเสนอ Default Cost Policy); WAC ใหม่คำนวณจากมูลค่าสต๊อกเดิมบวกมูลค่ารับคืนที่ต้นทุนเดิม หารด้วยจำนวนหลังรับคืน
- สินค้าเสียหาย/ไม่พร้อมขายให้ restock_base_quantity=0; การคืนเงินยังอ้างอิงราคา/ส่วนลด/ภาษี Snapshot เดิม และบันทึก disposition/write-off แยกจาก Stock Movement
- Return Post สร้าง StockMovement/InventoryCost/Refund แบบ atomic และ idempotent; ห้ามแก้ Return ที่ Post แล้ว ใช้ Reversal/Adjustment
- Order ที่ Post แล้วห้ามแก้ Snapshot เดิม; ใช้ Cancel/Refund/Credit Note
- Public tracking ใช้ random token ที่เดายาก เก็บ hash หรือ opaque token; ห้ามใช้ order number เป็น access token

## 6. ERD — POS Register, Shifts และ Receipts

\`\`\`mermaid
erDiagram
    BRANCH ||--o{ POS_REGISTER : operates
    POS_REGISTER ||--o{ CASHIER_SHIFT : has
    CASHIER_SHIFT ||--o{ CASH_MOVEMENT : records
    CASHIER_SHIFT ||--o{ SALES_ORDER : creates
    SALES_ORDER ||--o{ RECEIPT : issues

    POS_REGISTER {
      uuid id PK
      uuid branch_id FK
      string code
      string name
      string status
    }
    CASHIER_SHIFT {
      uuid id PK
      uuid register_id FK
      uuid cashier_user_id
      decimal opening_cash
      decimal closing_cash
      decimal expected_cash
      string status
      datetime opened_at
      datetime closed_at
    }
    CASH_MOVEMENT {
      uuid id PK
      uuid shift_id FK
      string movement_type
      decimal amount
      string reason
    }
    RECEIPT {
      uuid id PK
      uuid order_id FK
      string document_number
      string document_type
      datetime issued_at
    }
\`\`\`

POS Order ผูก Register/Shift และ Branch; user ID เป็น external UUID จาก Control DB ไม่มี FK ข้าม Database

## 7. Entity inventory — ตารางที่เสนอ

### Store & Catalog (Phase 1)
- stores, branches, store_categories, products, product_variants
- variant_barcodes, store_product_categories, store_products, store_product_variants
- product_prices, product_images, variant_images
- bulk_image_imports, bulk_image_import_rows

### Inventory & Cost (Phase 2)
- warehouses, stock_balances, stock_movements, stock_reservations
- stock_transfers, stock_transfer_items
- stock_adjustments, stock_adjustment_items, inventory_costs
- stock_adjustment_imports (Import Batch: warehouse_id, status, file_name, file_checksum, uploaded_by, previewed_at, committed_at, idempotency_key, row_count, valid_row_count, invalid_row_count)
- stock_adjustment_import_rows (Import Row: import_id, row_number, sku_snapshot, variant_id, input_quantity, input_uom_code, counted_base_quantity, on_hand_snapshot, delta_snapshot, reason, validation_status, error_details)
- product_images (Product Image: product_id, media_asset_id, is_primary, sort_order, created_at)
- variant_images (Variant Image: variant_id, media_asset_id, is_primary, sort_order, created_at)
- bulk_image_imports (Import Batch: status, mapping_mode, manifest_key, uploaded_by, total_files, valid_files, invalid_files, committed_at, idempotency_key)
- bulk_image_import_rows (Import Row: import_id, relative_path, checksum, detected_mime, byte_size, product_id, variant_id, resolved_by, role, sort_order, validation_status, error_details)

### ความสัมพันธ์ Logical MediaAsset และ Derivatives
- `MediaAsset` คือ Logical Image หนึ่งภาพ เก็บ purpose, publication status, altText, uploader และ timestamps เท่านั้น
- `MediaAssetDerivative` เป็นไฟล์จริงแบบ 1:N มี `kind=ORIGINAL|MAIN|THUMBNAIL`; เก็บ object key, storage provider/bucket, filename, MIME, extension, bytes, checksum, width/height และ processing status
- Unique `(mediaAssetId, kind)` และ unique `objectKey`; `ORIGINAL` เป็นไฟล์ส่วนตัว, `MAIN` เป็นภาพ 800×800 WebP, `THUMBNAIL` เป็นภาพ 150×150 WebP
- `ProductImage` และ `VariantImage` อ้าง `MediaAsset.id` ต่อไป และเก็บ `isPrimary`/`sortOrder`; ไม่สร้าง relation เพิ่มสำหรับแต่ละ derivative
- Public API ใช้ derivative MAIN หรือ THUMBNAIL ตามบริบท; ห้ามเผยแพร่ ORIGINAL
- Parent `MediaAsset` เป็น READY เมื่อ ORIGINAL, MAIN และ THUMBNAIL พร้อมทั้งหมดใน permanent storage
- การเปลี่ยน Schema ครั้งนี้ยังต้องมี migration backfill ย้าย metadata จาก media_assets เดิมไป ORIGINAL derivative; ห้ามลบ legacy data ก่อน backfill สำเร็จ

### กฎ Bulk Image Upload (ADMIN/OWNER)
- Workspace ADMIN/OWNER ที่มี `catalog.images.import` เท่านั้นจึง Download/Upload/Preview/Commit ได้; ตรวจสิทธิ์จาก Control DB ฝั่ง Server ทุกครั้ง
- รับ Folder Upload จาก Browser หรือ ZIP; Mapping ใช้ Filename Convention หรือ Manifest CSV ที่ระบุ Product ID/Variant ID/SKU; ID ต้อง resolve ภายใน Tenant Workspace เดียว
- Filename Mapping ต้อง deterministic; SKU/ID ที่หาไม่พบหรือ match ได้หลายรายการต้องแสดง Error; ห้ามเดา target
- Preview แสดงทุกไฟล์และเป้าหมายก่อน Commit; ไม่มีการเปลี่ยน Product/Variant Image จนกว่าจะยืนยัน
- Image Binary อยู่ Object Storage ไม่เก็บใน PostgreSQL; Tenant DB เก็บ storage key, checksum, MIME, dimensions, size, role, alt text, sort order และ uploader
- Batch/Rows เก็บ mapping mode, manifest reference, file checksum, uploader, status, per-file validation/error และ idempotency; retry ต้องไม่สร้าง image relation ซ้ำ
- ตรวจ magic bytes และ decode จริง, allowlist JPEG/PNG/WebP, จำกัดไฟล์/ขนาดรวม/จำนวน/มิติภาพ; ป้องกัน path traversal, zip-slip และ archive/decompression bomb
- Commit metadata แบบ atomic; Promote ไฟล์จาก staging ไป permanent storage หลัง Validation; ห้ามลบ/แทนที่รูปหลักเดิมจน Promote สำเร็จ; cleanup staging เมื่อหมดอายุ
- checksum ซ้ำใน Product/Variant เดียวกันไม่สร้าง relation ซ้ำ; MAIN replacement ต้องแสดงชัดใน Preview และยืนยัน
- Public API ส่งเฉพาะรูปที่เผยแพร่แล้ว; Storage keys, staging paths และข้อมูล Import ภายในเป็น Private
- stock_adjustment_imports (Import Batch: warehouse_id, status, file_name, file_checksum, uploaded_by, previewed_at, committed_at, idempotency_key, row_count, valid_row_count, invalid_row_count)
- stock_adjustment_import_rows (Import Row: import_id, row_number, sku_snapshot, variant_id, input_quantity, input_uom_code, counted_base_quantity, on_hand_snapshot, delta_snapshot, reason, validation_status, error_details)

### กฎ CSV Stock Adjustment (OWNER only)
- CSV Import/Export สำหรับ Stock Adjustment เป็นฟังก์ชัน Workspace Admin; OWNER เท่านั้น ทั้ง Download Stock Snapshot/Template, Upload, Preview และ Commit; API ต้องตรวจ Membership Owner ฝั่ง Server ทุกครั้ง
- หนึ่ง Import Batch ผูก Workspace + Store + Branch + Warehouse เดียว; scope มาจาก route และ authorization context ไม่รับจาก CSV
- CSV ใช้ `countedQuantity` เป็นยอดนับจริง ไม่ใช่ delta; Preview snapshot on_hand แล้วคำนวณ delta ใน Base UOM
- Stock Snapshot/Template ใช้ Header Version เดียวกัน: `sku,productName,variantName,systemQuantity,countedQuantity,uomCode,reason`; `systemQuantity` เป็นข้อมูลอ้างอิงเท่านั้น, `countedQuantity` เว้นว่างให้กรอก และเป็นค่าที่ใช้คำนวณ Adjustment
- เก็บ row-level validation และ snapshot ที่ใช้คำนวณ เพื่อแสดง before/count/delta และตรวจ stale snapshot ก่อน Commit
- Commit ทั้ง Batch แบบ all-or-nothing; ถ้า StockBalance เปลี่ยนหลัง Preview ให้ปฏิเสธและบังคับ Preview ใหม่
- Commit สร้าง StockAdjustment/Items/Movements, ปรับ StockBalance และ InventoryCost ใน transaction เดียว; Moving Weighted Average และ Reversal rules ใช้เหมือน Adjustment ปกติ
- Import Batch ต้องมี checksum, uploader, timestamps, status, row counts, Idempotency-Key และ Audit Trail; retry ต้องไม่สร้าง StockMovement ซ้ำ
- CSV เป็น UTF-8 (รับ BOM ได้), มี header version, quantity เป็น Decimal string สูงสุด 3 ตำแหน่ง, UOM resolve ผ่าน VariantUOM; duplicate SKU rows และ invalid rows ถูกปฏิเสธ
- Export ต้องป้องกัน CSV Formula Injection; กำหนด file size/row limit และไม่ expose cost fields เว้นแต่ OWNER มีสิทธิ์ดูต้นทุนแยกต่างหาก

### Sales & Payments (Phase 3)
- sales_orders, sales_order_items, sales_order_addresses, order_tax_lines
- payments, payment_transactions, refunds
- returns, return_items, fulfillments, document_sequences
- idempotency_records (หากไม่รวมกับแต่ละ aggregate)

### POS (Phase 4)
- pos_registers, cashier_shifts, cash_movements, receipts

### Tax & Reporting (Phase 6)
- tax_profiles, tax_rates, tax_categories (TaxCategory เป็นค่าเริ่มต้นของ ProductVariant; TaxRate มี effective date ต่อ TaxProfile + TaxCategory)
- expenses (ภายหลัง), report snapshots/read models ตามความจำเป็น

### Tenant Prisma Client / Schema Boundary
- `apps/api/prisma/schema.prisma` เป็น Control DB เท่านั้น (Users, Workspaces, Memberships, Sessions, Roles/Permissions, ModuleInstallation และ WorkspaceDatabase); ห้ามเพิ่ม Commerce business models ลงไฟล์นี้
- Tenant DB ต้องมี Prisma schema แยกที่ `apps/api/prisma/tenant/schema.prisma` และ generate เป็น Tenant Prisma Client คนละ output จาก Control Prisma Client; Tenant datasource ใช้ `TENANT_DATABASE_URL` สำหรับ CLI/Validate และ runtime inject URL ของ Workspace ที่ผ่าน Membership authorization แล้ว
- `WorkspaceDatabaseRegistry` ปัจจุบันยัง import `PrismaClient` จาก `@prisma/client` (Control Client); ต้องเปลี่ยนให้ import Tenant Client จาก generated output เช่น `apps/api/generated/tenant-client` หลังสร้างและ Generate Tenant schema; ห้ามใช้ Control Prisma Client ที่ชี้ไป Tenant DB เพราะ Client นั้นไม่มี Commerce models
- User/Actor IDs จาก Control DB เป็น external UUID ใน Tenant DB; ห้ามสร้าง cross-database FK ไป users/workspaces/memberships; เก็บ actor_id และตรวจสิทธิ์จาก Control DB ก่อนเข้า Tenant DB
- Prisma Tenant schema เป็น Source of Truth ของ Tenant tables; migration SQL แยกจาก Control migrations และต้อง deploy ไปทุก Tenant DB ผ่าน versioned migration runner; ห้ามให้ Runtime DB role มีสิทธิ์ DDL
- ก่อน Migration Sign-off ต้องผ่าน `prisma validate` และ generate Tenant Client, ตรวจชื่อ mapping snake_case, Decimal precision, FK/composite unique/index, Delete behavior, และเทียบ ERD/API Contract; ยังไม่สร้าง Production Migration ในขั้น Design

## 8. Constraints และ technical decisions

1. Tenant DB ต่อ Workspace; Store/Branch/Warehouse เป็น business scope ภายใน Tenant
2. Catalog scope เป็น Workspace; แต่ละ Store ใช้ StoreProduct ควบคุม assortment การเผยแพร่ และราคาแยกกัน (ยืนยันแล้ว)
3. FK ทุกความสัมพันธ์อยู่ใน Tenant DB; Control DB user/workspace refs เป็น external UUID ไม่มี cross-database FK
4. ใช้ UUID PK; ใช้ NUMERIC precision ที่กำหนดชัดสำหรับ quantity, unit price, tax rate และ monetary totals ก่อน Migration
5. ใช้ TIMESTAMPTZ เก็บ UTC
6. ใช้ composite unique/FK ป้องกันข้อมูลข้าม Store เช่น (store_id, code), (store_id, order_number)
7. Document sequence ต้อง atomic และ unique ต่อ Store + document type + period
8. Idempotency key unique ตาม operation scope และ replay ผลลัพธ์เดิมได้
9. Ledger ที่ Post แล้วห้าม hard delete; master data ใช้ archive
10. ห้ามใส่ payment credentials, card data หรือ secrets ใน Tenant DB/logs

## 9. Decisions ที่ยังต้องยืนยันก่อน Migration

- SKU unique ทั้ง Workspace (ยืนยันแล้ว); ไม่อนุญาต SKU ซ้ำระหว่าง Store ภายใน Workspace เดียวกัน
- Store มี default branch/warehouse หนึ่งชุด หรือเลือก default แยกตาม channel?
- รับสินค้า Phase แรกต้องมี Supplier/Purchase Order หรือให้ตั้ง Opening Stock ได้ก่อน?
- รองรับขายเป็นทศนิยม (น้ำหนัก/เมตร) หรือเฉพาะจำนวนเต็ม? (ข้อเสนอ: Decimal quantity)
- VAT รองรับยกเว้น/0%/อัตรามาตรฐาน และ inclusive/exclusive ต่อ Store; ต้องตรวจข้อกำหนดไทยก่อนออกเอกสารภาษีจริง
- การแบ่งชำระหนึ่ง Order และการชำระมัดจำต้องอยู่ใน MVP หรือไม่?

## 10. Review checklist

- [x] Product/Variant/SKU/Barcode scope ได้รับการยืนยัน: SKU unique ทั้ง Workspace
- [x] StoreCategory และ StoreProductCategory ออกแบบให้ป้องกันการเชื่อมโยงข้าม Store ด้วย composite constraints
- [ ] Store/Branch/Warehouse boundaries และ composite constraints ได้รับการทบทวน
- [ ] Inventory Ledger และ Moving Average ผ่านกรณีรับเข้า/ขาย/โอน/คืน
- [ ] Order/Payment/Refund/Return lifecycle ได้รับการยืนยัน
- [x] Partial Payment/Deposit ตั้งแต่ MVP; Tax Rounding Document Level + HALF_UP; Partial Return มี Return/ReturnItem, UOM Snapshot และ Return Cost Policy
- [ ] Public route resolver และ Tenant isolation ได้รับการทบทวน
- [ ] Permission matrix และ Audit requirements ครบ
- [ ] ERD review sign-off ก่อนสร้าง Migration
