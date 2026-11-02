# Tenant Schema Review — Composite Constraints, Defaults, Pricing และ Inventory

สถานะ: **Review Draft — ยังไม่อนุมัติ Migration**
วันที่ตรวจ: 2026-11-02

> เอกสารนี้เป็นผลการตรวจแบบอ่านอย่างเดียว ไม่ได้แก้ Prisma Schema, ไม่ได้สร้าง/รัน Migration และไม่เชื่อมต่อหรือเปลี่ยนแปลงฐานข้อมูลจริง

## 1. Executive Summary

| หัวข้อ | ผลตรวจ | สถานะ |
|---|---|---|
| StoreProductVariant -> StoreProduct | เพิ่ม three-column composite FK และ Prisma validation ผ่าน; approved fix อยู่ในข้อ 9 | ปิดช่องโหว่ระดับ Schema |
| StoreProductVariant -> ProductVariant | Composite FK `(productId, variantId)` ถูกต้อง | ผ่าน |
| ProductPrice -> StoreProductVariant | Composite FK `(storeProductVariantId, variantId)` ถูกต้อง | ผ่าน |
| ProductPrice -> VariantUom | Composite FK `(variantId, variantUomId)` ถูกต้อง | ผ่าน |
| API DTO / Contracts | Contracts ระบุกฎ ownership ชัด แต่ Commerce controller/service/DTO ยังไม่พบใน `apps/api/src` | **ยังไม่มี implementation ให้ตรวจ** |
| Default Branch/Warehouse | Schema มี flag และ unique ภายใน parent; unique แบบ partial อยู่ใน SQL draft ไม่ใช่ Prisma schema | ต้องมี SQL migration + service workflow |
| Price History | Schema มี validFrom/validTo/index; interval check และ exclusion ยังอยู่ใน SQL draft/ข้อเสนอ | ยังไม่ enforce ครบ |
| Stock | Schema มี ledger/balance/cost/reservation; check constraints และ immutability ส่วนใหญ่เป็น SQL/service policy | ต้องเพิ่ม enforcement |
| CSV / Image / Provisioning tests | จัดทำแผนทดสอบในเอกสารนี้ | พร้อมนำไปแตกเป็น automated tests |

**ข้อสรุปหลัก:** ช่องโหว่ StoreProductVariant product ownership ได้รับการแก้ใน Prisma Schema และ validate ผ่านแล้ว; ยังต้องมี Commerce service/DTO และ automated tests ที่ตรวจ scope ซ้ำที่ฝั่ง Server

## 2. Composite Constraints Review

### 2.1 StoreProductVariant

**ตรงกัน**
- ERD กำหนด `unique(store_product_id, variant_id)` และระบุว่า Variant ต้องเป็นของ Product ที่ StoreProduct อ้างถึง
- Prisma มี `@@unique([storeProductId, variantId])` และ `@@unique([id, variantId])`
- Prisma มี FK `[storeId, storeProductId] -> StoreProduct[storeId, id]` ป้องกันการอ้าง StoreProduct ข้าม Store
- Prisma มี FK `[productId, variantId] -> ProductVariant[productId, id]` ป้องกันการจับคู่ Product/Variant ที่ไม่ตรงกันในฝั่ง ProductVariant
- API Contract ระบุว่า variantId ทุกตัวต้องเป็น Variant ของ Product ที่ StoreProduct อ้างถึงและอยู่ใน Workspace เดียวกัน; การ replace ต้อง atomic และ reject ID ซ้ำ

**ไม่ตรงกัน / ช่องโหว่**
- FK สองชุดข้างต้นตรวจ parent แยกจากกัน แต่ไม่ได้เชื่อม `StoreProductVariant.productId` ให้เท่ากับ `StoreProduct.productId`
- จึงยังมีกรณีที่ row ระบุ `storeProductId` ของ Product A แต่ใส่ `productId + variantId` ของ Product B ได้ หากทั้งสอง FK อ้าง parent ที่มีอยู่จริง
- นี่ขัดกับ ERD และ API Contract แม้ Service จะตรวจถูกต้องก็ตาม เพราะ direct DB write หรือ bug ใน Service ยังสร้าง row ที่ผิดความสัมพันธ์ได้

**ข้อเสนอแก้ Schema (ยังไม่ apply)**
- เพิ่ม candidate key บน StoreProduct: `@@unique([storeId, id, productId])`
- เปลี่ยน relation `StoreProductVariant.storeProduct` ให้ใช้ fields `[storeId, storeProductId, productId]` references `[storeId, id, productId]`
- คง relation ไป ProductVariant เป็น `[productId, variantId] -> [productId, id]`
- ตรวจ Prisma validate และ generated migration SQL ในขั้นตอนหลังอนุมัติเท่านั้น
- ทางเลือกเชิงออกแบบ: ถ้าต้องการลด denormalized `productId` อาจออกแบบ relation/key ใหม่ แต่ต้องให้ DB ตรวจ product ownership ได้จริง ไม่พึ่ง Service อย่างเดียว

**API implication**
- Request ตาม Contract ไม่จำเป็นต้องรับ `productId` จาก Client; Server ควรอ่าน StoreProduct ภายใต้ `workspaceId + storeId + storeProductId`, อ่าน Variant ภายใต้ Product เดียวกัน แล้ว derive `productId` จาก StoreProduct ก่อนเขียน
- ห้ามเชื่อ `productId`, `storeId` หรือ Workspace scope ที่ส่งมาจาก body โดยไม่ตรวจ route scope และ Membership
- Replace variant set ต้องอยู่ใน transaction เดียว: validate ทั้งชุดก่อน, reject duplicates, ตรวจ references ทั้งหมด, แล้ว replace; failure ต้อง rollback ทั้งชุด
- ป้องกันการลบ/ถอด Variant ที่มีราคา/Order/ธุรกรรมอ้างอิงโดยใช้ archive/unpublish policy ไม่ hard delete

### 2.2 ProductPrice

**ตรงกันและผ่าน**
- Prisma มี FK `[storeProductVariantId, variantId] -> StoreProductVariant[id, variantId]`
- Prisma มี FK `[variantId, variantUomId] -> VariantUom[variantId, id]`
- ทั้งสอง FK ใช้ `variantId` ร่วมกัน จึงบังคับว่า Price ต้องอ้าง StoreProductVariant และ VariantUom ของ Variant เดียวกัน
- ERD และ API Contract กำหนดราคาแยกตาม StoreProductVariant + VariantUom + currency
- API Contract ระบุให้ VariantUom ต้อง Active และห้ามอ้างหน่วยของ Variant อื่น

**ประเด็นที่ยังต้อง enforce**
- FK ตรวจความเป็นเจ้าของ Variant แต่ไม่ตรวจว่า VariantUom มี `status=ACTIVE`; ต้องตรวจใน Service/transaction และทดสอบ race ระหว่าง deactivate กับ price write
- Schema มี `validFrom`, `validTo` และ index แต่ไม่เห็น check constraint `validTo IS NULL OR validTo > validFrom` ใน Prisma model
- การห้ามช่วงเวลาทับซ้อนยังเป็น exclusion constraint ใน SQL draft แบบ comment เท่านั้น
- ต้องกำหนด semantics ของช่วงเวลาให้ชัดเป็น half-open interval `[validFrom, validTo)` เพื่อให้ราคาเดิมจบตรงเวลาที่ราคาใหม่เริ่มได้
- ควรมี check `amount >= 0` (หรือ `amount > 0` หากธุรกิจไม่อนุญาตราคาศูนย์) และ validate currency ให้ตรง Store policy
- API Contract ใช้คำว่า upsert แต่ Price History ต้องไม่ overwrite แถวราคาเดิมที่มีผลแล้ว; การเปลี่ยนราคาควรปิดช่วงเดิมและเพิ่มแถวใหม่ใน transaction

**ข้อเสนอ**
- เพิ่ม check interval และ exclusion constraint โดย business key `(store_product_variant_id, variant_uom_id, currency)` กับ `tstzrange(valid_from, valid_to, '[)')`
- ทบทวนการใช้ PostgreSQL `btree_gist` และวิธี deploy index/extension ก่อน migration
- กำหนด policy สำหรับ backdate, future-dated price, ราคา 0, currency mismatch และการแก้/ยกเลิกราคาที่เริ่มมีผลแล้ว
- Order ต้องเก็บ price snapshot; การเปลี่ยน ProductPrice ไม่แก้ Order เก่า

### 2.3 API Implementation Status

ตรวจ `apps/api/src` แล้วพบเฉพาะ Core Auth, Workspace, RBAC, Platform Admin และ Database; ยังไม่พบ Commerce Store/Catalog/Pricing controllers, services หรือ DTOs ที่ implement Contracts ในรอบนี้

ดังนั้น API Contract ถือเป็นข้อกำหนดที่เขียนไว้ แต่ยังไม่สามารถยืนยัน behavior จาก implementation ได้ รายการ acceptance ก่อนเปิด API:
- Workspace membership และ permission ตรวจจาก Control DB ก่อน resolve Tenant DB
- Store/Product/Variant/UOM ทุก ID ต้อง resolve ภายใน Tenant DB และ route scope ที่ระบุ
- ห้ามใช้ Prisma error เป็นกลไก authorization; ตรวจ scope ก่อน write และ normalize error เป็น 404/409 ตาม Contract
- Write operations ที่แก้ชุดข้อมูลใช้ transaction; ใช้ unique constraint เป็น final guard
- Concurrent update และ retry ต้องไม่สร้างข้อมูลซ้ำ; ใช้ Idempotency-Key ใน operation ที่มีผลต่อธุรกรรม
- Tests ต้องยิง API จริงพร้อม fixture ของ Workspace/Store/Product/Variant อย่างน้อย 2 ชุด เพื่อพิสูจน์ cross-scope rejection

## 3. Default Branch / Warehouse Review

**ตรงกัน**
- ERD และ API Contract กำหนดสร้าง Store พร้อม Default Branch `สำนักงานใหญ่` และ Default Warehouse `คลังหลัก`
- Prisma มี `Branch.isDefault` และ `Warehouse.isDefault`, unique code ภายใน parent และ relation Branch -> Warehouse
- Constraints draft มี partial unique indexes:
  - `branches(store_id) WHERE is_default = TRUE`
  - `warehouses(branch_id) WHERE is_default = TRUE`

**ยังไม่ enforce / ต้องตัดสินใจ**
- Prisma schema ปกติไม่แสดง partial unique index นี้ จึงต้องใช้ reviewed SQL migration หรือกลไก DB ที่เทียบเท่า
- Unique partial ป้องกัน Default ซ้ำ แต่ไม่รับประกันว่า Store/Branch มี Default อย่างน้อยหนึ่งรายการ
- การสร้าง Store + Branch + Warehouse + Public Route ข้าม Control DB/Tenant DB เป็น distributed workflow ไม่ใช่ DB transaction เดียว ต้องกำหนด state machine, retry, compensation และการซ่อน route จนกว่าจะพร้อม
- การเปลี่ยน Default ต้อง atomic: ตั้งรายการใหม่และถอดรายการเดิมโดยไม่เกิดช่วงเวลาที่มี Default สองรายการ; ห้าม archive ตัวสุดท้ายก่อนมีตัวแทน
- Contract ระบุทุก Branch ต้องมี Warehouse อย่างน้อยหนึ่งแห่ง แต่ต้องกำหนดว่า Branch ที่สร้างใหม่ต้อง auto-create Warehouse ด้วยหรือให้ API สร้างพร้อมกัน

**ข้อเสนอ**
- Provision Store เป็น PROVISIONING/ไม่เผยแพร่ก่อน; สร้าง Store, Default Branch, Default Warehouse ใน Tenant DB transaction; จัดการ Public Route ใน Control DB แบบ retryable saga; เปิด Store ACTIVE/published หลัง health check ผ่าน
- สร้าง Branch ใหม่พร้อม Default Warehouse หรือกำหนด endpoint/workflow สร้าง Branch+Warehouse เป็นชุดเดียว
- เปลี่ยน Default ผ่าน service เฉพาะและ audit actor/reason; ห้ามแก้ `isDefault` แบบ PATCH ทั่วไป

## 4. Price History Review

- Composite FK ถูกต้องตามข้อ 2.2
- Index ปัจจุบัน `[storeProductVariantId, variantUomId, currency, validFrom]` สนับสนุน lookup ตาม business key/time
- SQL draft มี valid interval check แต่ต้องตรวจว่ามีการรวมใน migration จริงภายหลัง
- Exclusion constraint ป้องกัน overlapping intervals ยังเป็น comment ใน draft จึง **ยังไม่ enforce**
- ต้องเพิ่ม concurrency test ที่สร้างราคาสองรายการ business key เดียวกันและเวลาทับกันพร้อมกัน; อย่างน้อยหนึ่ง request ต้อง fail
- กำหนด update contract ให้เป็น append/history-safe: ห้ามแก้แถวที่มีผลย้อนหลังโดยไม่ audit; การเปลี่ยนราคาใหม่ให้ปิด `validTo` เดิมและ insert ใหม่ใน transaction
- ตรวจ timezone/offset: API รับ ISO-8601 พร้อม offset; เก็บเป็น timestamptz/UTC และเปรียบเทียบ instant ไม่ใช่ string
- ตัดสินใจเรื่อง backdate และการเปลี่ยนราคา future-dated ก่อน migration

## 5. Stock Constraints Review

**ตรงกัน**
- ERD กำหนด stock per Variant + Warehouse; Prisma ใช้ composite primary key `[warehouseId, variantId]` ใน StockBalance และ InventoryCost
- Quantity ใช้ Decimal(20,3); StockMovement เป็น ledger, StockBalance เป็น summary, InventoryCost ใช้ Moving Weighted Average
- Reservation มี quantity/status/idempotency key; StockMovement มี idempotency key และ reversal reference
- SQL draft มี checks สำหรับ on_hand/reserved ไม่ติดลบ, reserved <= on_hand, available = on_hand - reserved, quantity positive และ cost nonnegative ใน receiving/opening/reservation

**ช่องว่าง / ข้อควรระวัง**
- Check constraints อยู่ใน SQL draft ไม่ใช่ Prisma schema; ต้องย้ายเข้า migration หลังอนุมัติและทดสอบกับข้อมูลเดิม
- `StockMovement` ยังไม่มี DB-level protection against UPDATE/DELETE; ต้องจำกัด DB privileges และ/หรือ trigger ป้องกันการแก้ posted ledger; correction ใช้ reversal เท่านั้น
- `StockMovement.quantityDelta` ควรห้ามเป็นศูนย์; กำหนด sign convention ตาม movement type และตรวจ reversal อ้างรายการเดิม
- `StockReservation.status` เป็น String ไม่ใช่ enum; ควรกำหนด enum/check allowed states และ transition ที่ถูกต้อง
- Reservation หลายรายการต้องรวมยอด reserved ให้ตรง StockBalance; ต้องใช้ transaction/row lock/conditional update เพื่อป้องกัน oversell และ release ซ้ำ
- StockBalance และ InventoryCost เป็น summary; ต้องมี reconciliation job/query เทียบกับ StockMovement ledger และ audit discrepancy
- Opening Stock มี `postedWarehouseId @unique` ช่วยกันมากกว่าหนึ่ง posted session ต่อ Warehouse แต่ Service ต้อง set เฉพาะตอน Post สำเร็จใน transaction และ retry-safe
- `InventoryCost.quantity` ควร reconcile กับ StockBalance.onHand; `inventoryValue = quantity * averageUnitCost` ต้องกำหนด precision/rounding และ tolerance ชัดเจน
- Direct Receiving และ Opening Stock ต้อง update Movement + Balance + Cost ใน transaction เดียว; test rollback เมื่อ step ใดล้มเหลว
- ควรพิจารณา composite FK เพื่อบังคับว่า Variant ที่รับเข้าเป็น Variant ของ Workspace (Tenant DB แยกต่อ Workspace อยู่แล้ว) และ Warehouse/Branch/Store scope ไม่ข้ามกันผ่าน route/service

## 6. Test Plan Drafts

### 6.1 CSV Stock Adjustment Import

| ID | Scenario | Expected |
|---|---|---|
| CSV-01 | Upload valid UTF-8 CSV และ UTF-8 BOM | Parse ได้และแสดง Preview ครบ |
| CSV-02 | Missing column / invalid header / malformed CSV | Reject พร้อม row/column error; ไม่มี DB mutation |
| CSV-03 | SKU ไม่พบ, SKU ซ้ำในไฟล์, SKU resolve ambiguous | แสดง error; Commit ไม่ได้ |
| CSV-04 | UOM ไม่ใช่ Base UOM หรือ Active VariantUom ของ Variant | Reject แถวนั้น; ไม่ convert แบบเดา |
| CSV-05 | Quantity เป็น float JSON, negative, invalid decimal หรือเกิน 3 decimals | Reject; ไม่ปัดเศษเงียบ |
| CSV-06 | Workspace/Store/Branch/Warehouse scope ปลอมใน CSV | Ignore/reject scope field; ใช้ scope จาก authenticated route เท่านั้น |
| CSV-07 | Duplicate SKU+UOM rows | Reject duplicate rows |
| CSV-08 | Preview แล้วมี StockMovement เกิดก่อน Commit | Commit fail ด้วย stale snapshot; ต้อง Preview ใหม่ |
| CSV-09 | มี invalid row อย่างน้อยหนึ่งแถว | All-or-nothing; ไม่มี partial commit |
| CSV-10 | DB error ระหว่าง Commit | Rollback Adjustment/Movement/Balance/Cost ทั้งชุด |
| CSV-11 | Retry ด้วย Idempotency-Key เดิม | ไม่สร้าง Movement หรือเพิ่มยอดซ้ำ |
| CSV-12 | Concurrent commits บน Warehouse/Variant เดียวกัน | ไม่ oversell; lock/conditional update ทำให้ผล deterministic |
| CSV-13 | Export cell ขึ้นต้นด้วย =, +, -, @ | Escape ป้องกัน CSV formula injection |
| CSV-14 | ไฟล์/แถวเกิน limit หรือ MIME ไม่ตรงเนื้อหา | Reject และบันทึก audit/security event |

### 6.2 Bulk Image Upload

| ID | Scenario | Expected |
|---|---|---|
| IMG-01 | ADMIN/OWNER upload folder/ZIP ที่ถูกต้อง | สร้าง Batch และ Preview ได้ |
| IMG-02 | Non-admin / user จาก Workspace อื่น upload | 403/404 ตาม scope; ไม่มี object หรือ DB record |
| IMG-03 | Filename mapping SKU ที่ normalize แล้วตรงกัน | Resolve target ได้ตรง Product/Variant |
| IMG-04 | Filename ซ้ำหรือ SKU resolve ได้หลายรายการ | Ambiguous error; ห้ามเดา target |
| IMG-05 | Manifest ระบุ productId + variantId/sku ที่ไม่ตรงกัน | Reject manifest row |
| IMG-06 | ID จาก Workspace อื่นหรือ target ที่ไม่มีอยู่ | Reject; ไม่เปิดเผยข้อมูลข้าม Workspace |
| IMG-07 | Path traversal, absolute path, ../, zip-slip | Reject; ไม่มีไฟล์เขียนนอก staging root |
| IMG-08 | ZIP bomb/decompression bomb หรือจำนวนไฟล์เกิน limit | Abort safely; quota/resource limit ทำงาน |
| IMG-09 | SVG/HTML/executable, spoofed MIME, magic bytes mismatch | Reject |
| IMG-10 | JPEG/PNG/WebP เสียหรือ decode ไม่ได้ / dimensions เกิน limit | Reject ก่อน Commit |
| IMG-11 | Duplicate checksum ใน Product/Variant เดียวกัน | ไม่สร้าง image relation ซ้ำตาม default policy |
| IMG-12 | Replace MAIN image โดยไม่ confirm | ไม่เปลี่ยนภาพหลัก |
| IMG-13 | Commit DB สำเร็จแต่ Object Storage promote fail | Batch ไม่เป็น READY; retry/compensation ได้; ไม่มี URL เสียเผยแพร่ |
| IMG-14 | DB transaction fail หลัง staging upload | ไม่มี relation ค้าง; staging cleanup ตาม lifecycle |
| IMG-15 | Retry Commit ด้วย Idempotency-Key เดิม | ไม่สร้าง Image/Relation ซ้ำ |
| IMG-16 | Batch cancel/expire | ลบ staging ตาม retention; ห้ามลบ asset ที่ถูกใช้งานแล้ว |
| IMG-17 | Public API อ่านรูป | คืนเฉพาะ asset ที่ READY และสัมพันธ์กับ content ที่เผยแพร่ |

### 6.3 Tenant Provisioning

| ID | Scenario | Expected |
|---|---|---|
| TEN-01 | Create Workspace พร้อม Owner Membership | State เริ่ม PROVISIONING; ยังไม่เปิดใช้งาน |
| TEN-02 | Derive DB name จาก immutable Workspace UUID | ไม่ใช้ slug/user input เป็น identifier |
| TEN-03 | DB name มีอักขระผิดรูปแบบ/identifier injection | ปลอดภัยจาก injection; ใช้ safe identifier quoting |
| TEN-04 | Provision DB สำเร็จและ baseline migration ผ่าน | Health check ผ่านแล้วจึง ACTIVE |
| TEN-05 | CREATE DATABASE ล้มเหลว | Workspace FAILED; retry ได้โดยไม่สร้าง metadata กำพร้า |
| TEN-06 | Baseline migration ล้มเหลวกลางทาง | ไม่ ACTIVE; migration status ชัด; retry/recovery ปลอดภัย |
| TEN-07 | Control DB metadata write ล้มเหลวหลังสร้าง DB | Compensation/reconciliation ตรวจพบ orphan DB |
| TEN-08 | Retry provisioning request | Idempotent; ไม่สร้าง DB/Owner/Membership ซ้ำ |
| TEN-09 | User ไม่มี active membership ขอ Tenant connection | Denied ก่อน resolve DB |
| TEN-10 | User จาก Workspace A ขอ Workspace B | Denied; ไม่มี client/connection leak |
| TEN-11 | Runtime DB credentials ทดลอง CREATEDB/DDL | Permission denied; provisioning role แยกต่างหาก |
| TEN-12 | Tenant client cache hit/miss/shutdown | Client แยกตาม Workspace, disconnect ได้; มี eviction/connection limits |
| TEN-13 | Secret/connection string ใน API response/log | ไม่ปรากฏ; secrets ถูก encrypt/จัดการผ่าน secret manager |
| TEN-14 | Backup/restore tenant หนึ่งราย | Restore ได้โดยไม่กระทบ tenant อื่น; ตรวจ schema/migration version |
| TEN-15 | Migration version mismatch ระหว่าง Tenant DB | Registry/health check แจ้งสถานะ; ไม่ route ไป tenant ที่ไม่พร้อม |

### 6.4 Test Execution Strategy and Acceptance Gates

The scenarios in 6.1-6.3 are designed test plans, not test execution results. Before Migration Sign-off, convert them into automated tests and attach results from an isolated test environment.

#### Shared fixtures
- Create Workspace A and B with separate Tenant DBs and Owner, Admin, and Member identities for authorization and cross-tenant tests.
- In Workspace A create Store, Branch, Warehouse, Product/Variant, Base UOM, and Active/Inactive VariantUom fixtures.
- Prepare StockBalance fixtures for zero, positive, partially reserved, and stale-snapshot cases.
- Use an isolated Object Storage test bucket with staging/promoted prefixes; prepare valid, corrupt, duplicate, and malicious JPEG/PNG/WebP/archive fixtures.
- Add fault injection for DB transactions, Object Storage, migration, and health-check failures.

#### Test layers
| Layer | Coverage | Evidence |
|---|---|---|
| Unit | CSV parser/normalizer, filename/manifest resolver, checksum, decimal conversion, state transitions | Test report and edge-case coverage |
| Integration | PostgreSQL constraints, rollback, idempotency, row locks, object staging/promote, migration runner | Isolated PostgreSQL and Object Storage results |
| API / Authorization | Owner/Admin, membership, tenant scope, upload/preview/commit, audit | Request/response and audit assertions |
| Concurrency | Duplicate commits, stock changed between Preview/Commit, repeated provisioning/image commit | Deterministic result; no duplicate or partial state |
| Recovery | Retry, orphan/staging cleanup, reconciliation, migration mismatch | Recovery log and final resource inventory |

#### Acceptance gates
1. CSV: any invalid row blocks Commit; stale snapshot requires a new Preview; retry with the same key creates no duplicate Movement or stock change; transaction failure leaves no partial writes.
2. Image: mapping must be unambiguous; content validation must pass; retry creates no duplicate relation; non-READY assets are never exposed by Public API; promotion failure is recoverable without broken public URLs.
3. Tenant: Workspace cannot become ACTIVE before migration and health check pass; retry creates no duplicate DB/role/membership; Tenant A cannot access B; every failure has a verified retry or compensation/reconciliation path.
4. Security: every endpoint checks permission and Workspace scope server-side; credentials never appear in logs/responses; ZIP/path/file validation passes.
5. Regression: run Composite FK, Stock constraints, Price History, and tenant-isolation tests alongside these flows.

#### Workspace provisioning versus Store provisioning
The existing WorkspaceProvisioningService covers Tenant DB/runtime role creation, routing metadata, migration, health check, and Workspace ACTIVE/FAILED. It is not a Store Provisioning Saga.

Add Store Saga tests for: Store remains PROVISIONING and hidden from Public Route; Store + Default Branch + Default Warehouse are created in one Tenant transaction; Public Route is created/enabled in Control DB only after Tenant data is ready; Store becomes ACTIVE only after health check; failures at each boundary are retried idempotently or compensated; concurrent default creation preserves one default per Store/Branch.

#### Implementation readiness
- Schema exists for StockAdjustmentImportBatch/Row and ImageImportBatch/Item; API contracts define endpoints and validation behavior.
- No CSV Import or Image Import controller/service was found in apps/api/src.
- WorkspaceProvisioningService exists for Workspace/Tenant DB lifecycle; no Store Provisioning Saga/Public Route orchestration was found in inspected source.
- CSV/Image and Store Saga tests are blocked pending implementation. Tenant DB provisioning tests can target the existing service, but require automated test results before being considered passed.
- This review did not run test suites, create test code, or connect to Object Storage or a live database.

## 7. Required Decisions Before Sign-off

1. อนุมัติแนวทาง composite FK เพิ่ม `productId` เข้า StoreProduct relation ตามข้อ 2.1 หรือให้เสนอแบบ key design ทางเลือก
2. กำหนด Price policy: amount = 0, backdate, future-dated price, interval boundary และการแก้ราคาที่มีผลแล้ว
3. ยืนยันว่า Branch ใหม่ต้อง auto-create Warehouse หรือสร้างผ่าน workflow คู่
4. ยืนยัน Reservation state machine และ movement sign convention
5. กำหนด stock costing precision/rounding และ reconciliation tolerance
6. กำหนด Object Storage promotion/cleanup/retention policy และ limits ของ bulk upload
7. กำหนด provisioning retry/compensation/cleanup ownership และ migration version policy

## 8. Migration Sign-off Gate

ยัง **ไม่อนุมัติ** ให้สร้างหรือ apply Tenant migration จนกว่าจะ:
- ยืนยันการแก้ Critical finding เรื่อง StoreProductVariant product ownership (ดำเนินการแล้วในข้อ 9)
- ตกลง decisions ในข้อ 7
- แปลง default/price/stock constraints จาก draft ให้เป็น reviewed migration plan
- มี automated tests ครอบคลุม CSV/Image/Tenant Provisioning และ Commerce composite writes
- ตรวจ Prisma validation และ migration SQL ใน isolated test database
- Review rollback/recovery, index strategy (โดยเฉพาะ `CREATE INDEX CONCURRENTLY` ที่ห้ามอยู่ใน transaction block), backup และ per-tenant rollout
- ผู้ใช้อนุมัติ Schema + Constraints + Migration Plan อย่างชัดเจน

**ผลการดำเนินการรอบนี้:** เพิ่มเอกสาร Review Draft เท่านั้น; ไม่มีการแก้ `schema.prisma`, ไม่มี migration, ไม่มีการเปลี่ยนฐานข้อมูล และไม่มีการแก้ Commerce API implementation
\n\n## 10. Final Review+�u���T pre-approval assessment (2026-11-02)

### Review outcome

| Area | Assessment | Status |
|---|---|---|
| Tenant Prisma Schema | Prisma validation passed for apps/api/prisma/tenant/schema.prisma | PASS (schema syntax/relations only) |
| StoreProductVariant composite ownership | Three-column composite FK fix is present and previously approved | CLOSED |
| ProductPrice composite ownership | Both composite FKs bind the same Variant; interval/overlap/amount policy still needs DB enforcement | PARTIAL |
| Default Branch/Warehouse | Partial unique indexes exist only in review SQL; at-least-one and lifecycle transitions need service/DB policy | OPEN |
| Stock | Composite keys and ledger structure are present; checks, immutability, state transitions and WAC consistency are not fully enforced | OPEN |
| CSV / Image | Test plans documented; no import controller/service or automated tests found in inspected API source | BLOCKED |
| Workspace Provisioning | WorkspaceProvisioningService exists; automated tests were not found/run | PARTIAL |
| Store Provisioning Saga | Store + defaults + Public Route orchestration not found | BLOCKED |

### Index and constraint review notes

- The draft uses CREATE INDEX CONCURRENTLY for default uniqueness. PostgreSQL does not permit this inside a transaction block; deployment must explicitly support non-transactional index creation and preflight existing duplicate defaults.
- The ProductPrice exclusion constraint remains commented out and depends on btree_gist availability. Do not treat overlap prevention as enforced.
- The SQL draft is design material, not executable migration SQL. Check constraints must be reviewed for existing data, exact numeric semantics and rollout/rollback before adoption.
- StockMovement ledger immutability, non-zero delta/sign rules, reservation state transitions, StockBalance/InventoryCost reconciliation and WAC rounding require explicit implementation and tests; current indexes alone do not enforce these invariants.
- Partial unique indexes guarantee at most one default, not at least one. Preventing removal/archive of the last default requires a transactional service rule or a carefully designed deferred database mechanism.
- Prisma validation is not migration validation: no migration SQL was generated, reviewed against a database, or applied in this review.

### Remaining decisions requiring user approval

1. **Branch/Warehouse lifecycle:** Should creating a Branch automatically create its Default Warehouse, or must both be created by one explicit workflow? Current design documents the default pair for Store creation but this branch-level behavior remains unresolved.
2. **Price policy:** Permit amount = 0? Allow backdated price changes? Permit future-dated prices? Confirm half-open interval [validFrom, validTo), currency policy and correction/audit semantics for already-effective prices.
3. **Reservation and movement semantics:** Confirm allowed Reservation states/transitions and the quantityDelta sign convention for every StockMovementType, including reversal.
4. **Costing policy:** Confirm WAC precision, rounding mode, zero-stock behavior, negative-stock policy and reconciliation tolerance between InventoryCost and StockBalance.
5. **Image storage policy:** Confirm object promotion strategy, cleanup/retention window, maximum files/bytes/pixels, duplicate checksum scope and MAIN image replacement behavior.
6. **Provisioning recovery:** Confirm retry ownership, compensation versus reconciliation policy, orphan DB/role cleanup, migration version registry and operational retry limits.
7. **Constraint rollout:** Confirm whether database-level immutability/triggers are required for direct DB writes, and approve the planned partial/exclusion/check constraints only after a reviewed SQL plan.

### Migration Sign-off decision

**NOT READY+�u���T Migration Sign-off is withheld.** The StoreProductVariant composite FK decision is closed and Prisma validation passes, but the remaining policy decisions, SQL constraint plan, automated test coverage, Store Provisioning Saga and migration/rollback review are incomplete.

No Tenant migration was created or applied. No Tenant database was changed. No Prisma Client was generated. The validation command only checked the Prisma schema definition.

## 9. Implementation status - approved StoreProductVariant composite FK (2026-11-02)

The user approved the three-column composite foreign key and the Tenant Prisma Schema was updated: StoreProduct has @@unique([storeId, id, productId]); StoreProductVariant.storeProduct uses [storeId, storeProductId, productId] -> [storeId, id, productId]; the ProductVariant FK and existing unique constraints remain. Prisma validation passed. No migration was created/applied, no Client was generated, and no live database was changed.

## 10. Final Review - pre-approval assessment (2026-11-02)

### Review outcome

| Area | Assessment | Status |
|---|---|---|
| Tenant Prisma Schema | Prisma validation passed for apps/api/prisma/tenant/schema.prisma | PASS (schema syntax/relations only) |
| StoreProductVariant composite ownership | Three-column composite FK fix is present and previously approved | CLOSED |
| ProductPrice composite ownership | Both composite FKs bind the same Variant; interval/overlap/amount policy still needs DB enforcement | PARTIAL |
| Default Branch/Warehouse | Partial unique indexes exist only in review SQL; at-least-one and lifecycle transitions need service/DB policy | OPEN |
| Stock | Composite keys and ledger structure are present; checks, immutability, state transitions and WAC consistency are not fully enforced | OPEN |
| CSV / Image | Test plans documented; no import controller/service or automated tests found in inspected API source | BLOCKED |
| Workspace Provisioning | WorkspaceProvisioningService exists; automated tests were not found/run | PARTIAL |
| Store Provisioning Saga | Store + defaults + Public Route orchestration not found | BLOCKED |

### Index and constraint review notes

- The draft uses CREATE INDEX CONCURRENTLY for default uniqueness. PostgreSQL does not permit this inside a transaction block; deployment must explicitly support non-transactional index creation and preflight existing duplicate defaults.
- The ProductPrice exclusion constraint remains commented out and depends on btree_gist availability. Do not treat overlap prevention as enforced.
- The SQL draft is design material, not executable migration SQL. Check constraints must be reviewed for existing data, exact numeric semantics and rollout/rollback before adoption.
- StockMovement ledger immutability, non-zero delta/sign rules, reservation state transitions, StockBalance/InventoryCost reconciliation and WAC rounding require explicit implementation and tests; current indexes alone do not enforce these invariants.
- Partial unique indexes guarantee at most one default, not at least one. Preventing removal/archive of the last default requires a transactional service rule or a carefully designed deferred database mechanism.
- Prisma validation is not migration validation: no migration SQL was generated, reviewed against a database, or applied in this review.

### Remaining decisions requiring user approval

1. **Branch/Warehouse lifecycle:** Should creating a Branch automatically create its Default Warehouse, or must both be created by one explicit workflow? Current design documents the default pair for Store creation but this branch-level behavior remains unresolved.
2. **Price policy:** Permit amount = 0? Allow backdated price changes? Permit future-dated prices? Confirm half-open interval [validFrom, validTo), currency policy and correction/audit semantics for already-effective prices.
3. **Reservation and movement semantics:** Confirm allowed Reservation states/transitions and the quantityDelta sign convention for every StockMovementType, including reversal.
4. **Costing policy:** Confirm WAC precision, rounding mode, zero-stock behavior, negative-stock policy and reconciliation tolerance between InventoryCost and StockBalance.
5. **Image storage policy:** Confirm object promotion strategy, cleanup/retention window, maximum files/bytes/pixels, duplicate checksum scope and MAIN image replacement behavior.
6. **Provisioning recovery:** Confirm retry ownership, compensation versus reconciliation policy, orphan DB/role cleanup, migration version registry and operational retry limits.
7. **Constraint rollout:** Confirm whether database-level immutability/triggers are required for direct DB writes, and approve the planned partial/exclusion/check constraints only after a reviewed SQL plan.

### Migration Sign-off decision

**NOT READY - Migration Sign-off is withheld.** The StoreProductVariant composite FK decision is closed and Prisma validation passes, but the remaining policy decisions, SQL constraint plan, automated test coverage, Store Provisioning Saga and migration/rollback review are incomplete.

No Tenant migration was created or applied. No Tenant database was changed. No Prisma Client was generated. The validation command only checked the Prisma schema definition.\n

## 11. MediaAsset Derivative Schema Update (2026-11-02)
- Approved representation applied to Tenant Prisma schema: `MediaAsset` is the logical image; physical files are `MediaAssetDerivative` rows with kinds `ORIGINAL`, `MAIN`, `THUMBNAIL`.
- `ProductImage` and `VariantImage` continue referencing `MediaAsset.id`; gallery uniqueness, `isPrimary` and `sortOrder` remain unchanged. Derivatives do not create extra gallery relations.
- File metadata and object keys moved from `MediaAsset` to `MediaAssetDerivative`; `MediaAsset` retains purpose, lifecycle status, alt text, uploader and timestamps.
- `MediaAssetDerivative` has unique `objectKey`, unique `(mediaAssetId, kind)`, parent FK with RESTRICT, and status/createdAt index.
- Updated final plan, Commerce ERD, API contract, approved decisions, custom constraint candidate and clean-install Prisma SQL candidate. Historical baseline migration remains unchanged.
- Prisma validation: PASS (`prisma validate --schema prisma/tenant/schema.prisma`).
- Upgrade/backfill requirement: legacy `media_assets` file metadata must be copied into an `ORIGINAL` derivative for every existing asset; create MAIN/THUMBNAIL outputs and verify readiness before dropping legacy physical columns. Public API must switch to derivative URLs in the same controlled rollout.
- This is a schema edit and candidate SQL only. No migration was created/applied, no DB was changed, and no Prisma Client was generated. Migration Sign-off remains withheld pending backfill/upgrade design and isolated PostgreSQL verification.
