# Sales & Orders — Implementation Plan

วันที่: 2026-11-11
สถานะ: Milestones A–F implemented and verified on disposable PostgreSQL/Workspace; all Sales Orders, Sales Returns and Payments/Refund migrations remain candidates and have not been applied to any registered workspace.
ขอบเขต: Phase 3 — Sales, Orders & Payments Core โดยเริ่มจาก Order + Inventory Reservation เป็น vertical slice แรก

## 1. ผลตรวจโค้ดปัจจุบัน

- API มี Orders, Sales Returns และ Payments/Refund Ledger services/controllers/models แล้ว; Orders UI/POS อยู่ที่ `/workspace/[slug]/orders` และมี HTTP/Auth/RBAC E2E แล้ว
- Tenant schema มี `StockReservation`, `StockBalance`, `StockMovement` และ `InventoryCost` อยู่แล้ว
- Inventory มี reservation create/release/consume และ direct issue; consume/issue คำนวณ WAC และเขียน Stock Movement ได้ แต่แต่ละ operation เปิด transaction ของตัวเอง จึงยังไม่สามารถนำมาเรียกทีละรายการจาก Order แล้วรับประกัน atomicity ทั้ง Order ได้
- Module manifest ประกาศ permission ที่จำเป็นไว้แล้ว ได้แก่ `commerce.orders.view`, `commerce.orders.manage`, `commerce.sales.create`, `commerce.sales.void` และ `commerce.inventory.reservation.manage`; ยังต้องทดสอบ role matrix กับ endpoint จริง
- Tenant ERD มี Order/OrderItem/Payment/Return design อยู่แล้ว แต่ยังเป็น design artifact ไม่ใช่ deployed schema
- Product/Store pricing และ TaxProfile/TaxRate มีอยู่ใน Tenant schema; ProductVariant ยังไม่มี tax-category reference ที่ชัดเจนตาม ERD จึงต้องปิดช่องว่างนี้ก่อนคำนวณ tax snapshot
- Order numbering policy (branch + year + document type) ยังเป็นรายการค้างใน `plan.md`.

## 2. หลักการที่ต้องรักษา

1. Order และทุก OrderItem ต้องอยู่ใน Store/Branch เดียวกัน; Warehouse ต้องเป็นของ Branch ที่ Order อ้างถึง
2. ราคาขาย, ชื่อสินค้า, SKU, UOM, conversion factor, currency และ tax calculation ต้อง resolve จาก Tenant DB ฝั่ง Server แล้ว snapshot; ห้ามเชื่อราคา/ต้นทุน/ภาษีจาก Browser
3. ใช้ Decimal เท่านั้น: เงิน NUMERIC/Prisma Decimal และจำนวน NUMERIC(20,3); ห้าม Float/Double
4. การสร้าง Order พร้อม Reservation หลายรายการต้องเป็น transaction เดียว; หากบรรทัดใดจองไม่สำเร็จ ต้อง rollback ทั้ง Order และ Reservation
5. การ Post/Confirm Sale ต้อง lock Order, Reservation, StockBalance และ InventoryCost ตามลำดับที่กำหนด; consume ทุก reservation, สร้าง SALE StockMovement และบันทึก `unit_cost_snapshot` / `total_cost_snapshot` ใน OrderItem ภายใน transaction เดียว
6. การ Cancel Order ต้อง release เฉพาะ ACTIVE reservation; ห้ามแก้ Order ที่ Post แล้ว ให้ใช้ Void/Refund/Return workflow
7. Idempotency key ต้องผูกกับ normalized payload; key เดิมและ payload ต่างกันต้องตอบ Conflict (409)
8. Order status, payment status และ fulfillment status เป็นคนละ lifecycle; ห้ามอนุมาน Order status จาก Payment อย่างเดียว
9. ทุก transition ต้องมี Audit Trail และ actor/time; Public response ห้ามเปิดเผยต้นทุนหรือข้อมูลภายใน
10. ห้ามเรียก Reservation/Issue API แบบแยก transaction ภายใน Order workflow; ให้ใช้ transaction service ร่วมกันหรือ internal transaction-scoped helpers

## 3. ลำดับการพัฒนา

### Milestone A — Order foundation + reservation

- เพิ่ม Tenant schema / SQL migration candidate สำหรับ SalesOrder, SalesOrderItem, per-line tax snapshots และ document sequence
- เพิ่ม tax category reference ให้ ProductVariant หรือกำหนดวิธี resolve category ที่ตรวจสอบได้
- กำหนด Order number แบบ per Branch + fiscal/calendar year + document type; ข้อเสนอเริ่มต้น: `SO-{BRANCHCODE}-{YYYY}-{000001}` โดย sequence แยก Branch/ปี/ประเภทเอกสารและ lock row ภายใน transaction
- API:
  - `POST /api/tenant/:workspaceId/orders` — สร้าง Order และจองสต๊อกทุกบรรทัดแบบ atomic + idempotent
  - `GET /api/tenant/:workspaceId/orders` — list/filter/pagination
  - `GET /api/tenant/:workspaceId/orders/:orderId` — detail พร้อม item/tax snapshots และ reservation status
  - `POST /api/tenant/:workspaceId/orders/:orderId/cancel` — cancel ก่อน post และ release reservations แบบ atomic
- Server ต้อง resolve StoreProductVariant, ProductPrice, VariantUom, active Branch/Warehouse และ TaxProfile/TaxRate ณ เวลาสร้าง Order
- Cost snapshot ยังไม่ตรึงใน Draft; จะตรึงเมื่อ Post Sale เท่านั้น เพื่อให้ตรงกับ WAC ณ เวลาตัดสต๊อก

### Milestone B — Post Sale + Cost Snapshot

- `POST /tenant/:workspaceId/orders/:orderId/post`
- Lock Order และ reservations ทั้งหมดด้วย stable ordering เพื่อป้องกัน deadlock
- ตรวจสถานะและ expiry ของ reservations, ตรวจ balance/cost reconciliation และยืนยัน available/on_hand
- Consume reservations ทั้งหมด, ลด on_hand/reserved, สร้าง SALE movements, ปรับ InventoryCost ด้วย WAC และ snapshot ต้นทุนลง OrderItem แบบ atomic
- Retry ด้วย idempotency key ต้องไม่สร้าง movement ซ้ำ; stale/expired reservation ต้องไม่ post
- เพิ่ม concurrency tests: order เดียวกัน post พร้อมกัน, stock แย่งกันหลาย order, duplicate key และ payload conflict

### Milestone C — Sales Return / Inventory Restock

- Implemented inventory Return against POSTED Sales Orders with partial/multiple returns and cumulative sold-quantity cap.
- Return quantities use original Order Item base units; original SALE movement and unit cost snapshot are retained as the source of truth.
- Restore StockBalance and InventoryCost atomically using historical sale WAC; write SALE_RETURN movement and audit.
- Return net/tax/gross amounts are prorated from the original line snapshot; final partial return takes the exact remaining amounts.
- Idempotency is payload-bound; return posting and list APIs are permission-gated.
- Cash/card refund ledger is implemented in Milestone D; external payment/refund execution remains out of scope.

### Milestone D — Payments & Refund Ledger

- Implemented `SalesPayment` / `SalesRefund` tables and APIs linked to POSTED Orders and Sales Returns.
- Supports split tenders: CASH, CARD, BANK_TRANSFER, OTHER; cumulative recorded payments cannot exceed Order total.
- Refund references both the original Return and a Payment from the same Order; cumulative refunds cannot exceed either Return total or unrefunded Payment balance.
- Payment status transitions: CAPTURED → PARTIALLY_REFUNDED → REFUNDED. Order status remains independent.
- Payment/refund records, status updates and audit events are atomic and payload-idempotent.
- Manual confirmation is represented as an internal ledger record only. No gateway charge/refund, bank verification, provider webhook, settlement or external disbursement is implemented.

### Milestone E — Orders UI + POS entry point

- Implemented `/workspace/[slug]/orders`: create Order, select Store/Branch/Warehouse, Product Variant and sellable UOM; list/search/filter/detail; cancel/post; payment, return and refund ledger workflows.
- Workspace home and Product Catalog link to Orders. UI submits idempotency keys and leaves price/tax/stock validation to the server.
- Browser UI E2E covers create/reserve, post, payment, return and refund presentation; full HTTP/Auth/RBAC is covered separately in Milestone F.

### Milestone F — HTTP / Auth / RBAC E2E

- Added `apps/api/scripts/verify-sales-orders-http-rbac-e2e.cjs` and `npm run test:sales-orders-http`.
- Uses a temporary Workspace provisioned through the normal service, applies commerce plus Sales Orders candidate migrations only to its disposable Tenant, starts a separate API process, and tests real login/session-cookie HTTP requests.
- Owner/Manager/Cashier/Viewer matrix verified: Manager can create/post/cancel/record payment/return/refund; Cashier can read/create/post/record payment but receives 403 for cancel/return/refund; Viewer receives 403 for Orders read/create. Unauthenticated and invalid-Origin requests receive 401.
- HTTP business flows verified: create/reserve, idempotent replay and 409 changed payload, list/detail, cancel, post/WAC, payment, 409 overpayment, partial return, refund and ledger reads.
- Cleanup verifies temporary Tenant database/runtime role, Workspace and users are removed and shared Control permission catalog remains unchanged. Evidence: `docs/architecture/sales-orders-http-auth-rbac-e2e-2026-11-11.md`.

## 4. API / permission contract เบื้องต้น

| Action | Permission |
|---|---|
| List / Detail Orders | `commerce.orders.view` |
| Create Order / reserve stock | `commerce.sales.create` |
| Cancel before posting | `commerce.sales.void` หรือ policy ที่กำหนด |
| Post Sale | `commerce.sales.create` (ต้องทบทวนแยก permission หากต้องการผู้อนุมัติ) |
| Add / record payment | `commerce.sales.create` (current API decorator; production policy review still required) |
| Refund ledger | `commerce.sales.void` (current API decorator; production policy review still required) |

ไม่เปลี่ยน role grants หรือ Control DB permissions ใน Milestone A โดยอัตโนมัติ; ต้องทำ permission matrix + E2E 403/200 ก่อนเปิดใช้งานจริง

## 5. Test gates

- Schema validate / generated tenant client / migration checksum
- API HTTP E2E: server-side price/tax snapshot, quantity/UOM conversion, duplicate line, unavailable variant, inactive store/branch/warehouse, insufficient stock rollback, idempotency replay/conflict
- Reservation: multiple lines atomicity, cancel releases all, expiry prevents post
- Post Sale: WAC snapshot matches InventoryCost at lock time, SALE movement matches OrderItem base quantity, inventory balance/cost reconcile
- Concurrency: parallel create against limited stock, parallel post, duplicate retries
- RBAC: Owner/Admin/Manager/Cashier/Inventory Staff/Viewer according to approved matrix
- Browser E2E after API stable: list/detail/create/cancel and then POS flow

## 6. Milestone A implementation result

- Tenant Prisma schema: added `SalesOrderStatus`, `OrderSequence`, `SalesOrder`, `SalesOrderItem`, tax-category linkage on `ProductVariant`, and reverse relations.
- Migration candidate: `apps/api/prisma/tenant/migrations/20261111000100_tenant_sales_orders.sql`; includes order sequence, sales order/item tables, reservation linkage, tax-category FK, hierarchy/UOM integrity constraints and indexes.
- API module: `POST /api/tenant/:workspaceId/orders`, `GET /api/tenant/:workspaceId/orders`, `GET /api/tenant/:workspaceId/orders/:orderId`, `POST /api/tenant/:workspaceId/orders/:orderId/cancel`.
- Creation resolves published catalog listing, active UOM, current server-side price, Store Tax Profile and Tax Rate; snapshots product/UOM/price/tax fields and reserves all lines in one transaction.
- Order numbers use `SO-{BRANCHCODE}-{YYYY}-{000001}` with a branch/year/document-type sequence row updated transactionally.
- Cancellation releases active reservations and updates Order state in one transaction. Posted Orders cannot use the pre-post cancellation route.
- Product create/update APIs accept optional `variant.taxCategoryId`; product query results include the category ID.
- Added `apps/api/scripts/verify-sales-orders-service-e2e.cjs` and `npm run test:sales-orders`.
- Verification PASS: Prisma schema validate, API typecheck/build, disposable PostgreSQL migration execution, controller RBAC metadata, exclusive/inclusive VAT totals, create/replay/conflict idempotency, concurrent same-key requests, multi-line rollback, cancel/release, stock oversubscription concurrency, list pagination, posted-state guard and disposable database cleanup.

## 7. Migration / production safety

- The migration was applied only to a disposable local PostgreSQL database created and dropped by the E2E script. No registered workspace Tenant DB was changed.
- No `pos-local` migration, live DB write, Control DB permission/role change, deployment, commit or push was performed.
- Do not apply `20261111000100_tenant_sales_orders`, `20261111000200_tenant_sales_returns` or `20261111000300_tenant_sales_payments_refunds` to `pos-local` or another registered Tenant DB until separate approval names the exact workspace and migration version.
- Milestones A–F are implemented and verified on disposable PostgreSQL/Workspace. Service E2E, real HTTP/Auth/RBAC E2E and Orders browser UI E2E have passed. Production activation and applying migrations to any registered Workspace remain separate approval gates.
