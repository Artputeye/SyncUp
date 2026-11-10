# Inventory Operational Readiness — Remediation Plan

วันที่: 2026-11-10
สถานะ: **แผนแก้ไขที่จัดทำจาก Read-only review; ยังไม่มีการอนุมัติให้เปลี่ยนข้อมูลหรือ Apply Migration**
เป้าหมาย: เตรียม Inventory ของ Workspace `pos-local` ให้ผ่าน RBAC, Schema, Costing และ Recovery gates ก่อนเปิดใช้งานจริง

## 1. ขอบเขตและข้อห้าม

Target ที่ตรวจแล้ว:

- Workspace: `pos-local`
- Workspace ID: `c0130bf3-c1c0-4dfa-a915-7ca5155cacfd`
- Tenant DB: `syncup_ws_c0130bf3c1c0`
- Runtime Role: `syncup_rt_c0130bf3c1c0`

ข้อกำหนดระหว่าง Remediation:

- ใช้ Read-only inspection เป็นค่าเริ่มต้น
- ห้าม Apply Control/Tenant migration, seed หรือแก้ Permission/Role assignment โดยไม่มีการอนุมัติแยก
- ห้ามสร้างข้อมูลสินค้า/ยอดสต็อก/ต้นทุนทดสอบใน `pos-local` โดยพลการ
- ห้ามเปลี่ยน Store, Branch, Warehouse, Module status หรือเปิด Store
- ห้ามแก้ Migration Ledger ย้อนหลังหรือเพิ่ม ledger row เพื่อทำให้ประวัติดูครบ
- ห้ามใช้ Runtime Role ทำ DDL; การเปลี่ยน Schema ต้องผ่าน Provisioner และขั้นตอนอนุมัติ
- ไม่แตะ Production Workspace อื่น, ไม่ Deploy, ไม่ Commit/Push ในงานเตรียมแผนนี้

## 2. Findings จาก Read-only Review

### 2.1 Store / Branch / Warehouse

- Main Store, HQ Branch และ MAIN Warehouse เป็น Active
- HQ เป็น Default Branch และ MAIN เป็น Default Warehouse
- Store ใช้ THB / Asia/Bangkok และ `is_published=false`
- Commerce Module เป็น ENABLED อยู่ก่อนเริ่ม Review

สถานะ: โครงสร้างพื้นฐานผ่าน; Store ยังไม่เผยแพร่

### 2.2 Workspace RBAC

- พบสมาชิก Owner 1 ราย และ Manager 1 รายใน Workspace ที่ตรวจ
- ยังไม่มีสมาชิกที่ได้รับมอบหมายบทบาท Admin, Cashier หรือ Inventory Staff; อย่าสร้างหรือเปลี่ยน assignment โดยอัตโนมัติ
- Owner ได้สิทธิ์ผ่าน ownership bypass
- Manager มีสิทธิ์ Inventory operation ตามที่ตรวจพบ
- Admin role มี Permission grants 12 รายการ ซึ่งยังไม่ตรงกับข้อกำหนด Admin = ทุก Permission ใน `DEFAULT_WORKSPACE_ROLES`
- Permission Catalog ปัจจุบันกำหนด 30 keys; ต้องเปรียบเทียบ grants จริงครบทุก key ก่อนสรุปการแก้ไข
- Cashier denial และ Inventory Staff authorization มีหลักฐานจาก E2E workspace เท่านั้น ไม่ใช่หลักฐานว่ามีผู้ใช้/Role assignment เหล่านี้ใน `pos-local`

Migration candidate ที่เกี่ยวข้อง:

- `202611060005_inventory_role_matrix_alignment` เพิ่ม/อัปเดต Permission `commerce.inventory.adjust`, `commerce.inventory.transfer`, `commerce.inventory.stocktake` และให้ grants แก่ Role `admin`, `manager`, `inventory_staff` หาก Role เหล่านั้นมีอยู่
- Candidate นี้ไม่ได้สร้าง Role ที่ขาด, ไม่สร้าง membership assignment และไม่ได้ reconcile Admin grants ให้ครบทุก Permission Catalog key ด้วยตัวเอง
- ห้ามถือว่าการ Apply candidate 005 เพียงอย่างเดียวทำให้ Admin matrix สมบูรณ์

**งานที่ต้องทำก่อนเสนอ Migration:**

1. สร้าง Read-only diff ของ Permission Catalog ทั้ง 30 keys เทียบกับ Control DB permissions, role_permissions และ role keys ของ Workspace
2. ตรวจว่า Role `admin`, `manager`, `cashier`, `inventory_staff` มีอยู่ครบหรือไม่ และตรวจ grants ราย key
3. เปรียบเทียบ grants กับ `docs/architecture/workspace-permission-matrix.md` และ `DEFAULT_WORKSPACE_ROLES`
4. จัดทำ forward-only migration candidate สำหรับเฉพาะความต่างที่พิสูจน์แล้ว; Admin ต้องได้สิทธิ์ครบตาม matrix, Manager ได้สิทธิ์งานปฏิบัติการ, Cashier ไม่มี Inventory mutation, Inventory Staff ไม่มี movement.reverse
5. ไม่เปลี่ยนสมาชิก/การมอบหมาย Role; การ assign ผู้ใช้งานต้องเป็นการอนุมัติแยก
6. ทดสอบ authorization ด้วย role fixtures ครบทุก Role และยืนยัน 403/allowed behavior โดยไม่ทำ Business mutation

### 2.3 Inventory Schema / Stocktake

- `pos-local` มี Tenant Ledger เฉพาะ Baseline และ Commerce
- ตาราง `stocktake_sessions`, `stocktake_lines` และ enum `StocktakeStatus` ยังไม่มีใน `pos-local`
- API `GET /inventory/stocktakes` ที่เรียกด้วย Manager ได้ HTTP 500 เนื่องจาก Schema ของ Tenant ยังไม่มี Stocktake objects
- Stocktake Migration candidate `apps/api/prisma/tenant/migrations/20261107000100_tenant_inventory_stocktake.sql` ถูก Apply และทดสอบแล้วเฉพาะ E2E tenant ไม่ใช่ `pos-local`
- SHA-256 ของ candidate ที่บันทึกไว้: `a32e90622cac76ea16a3bdb16ceb74bb34da048004911cfe1c68fd9c5f255ae9`

**งานที่ต้องทำก่อน Apply:**

1. ตรวจ Candidate SQL, Tenant Prisma schema, generated API expectations, FK/index/enum และ migration runner compatibility
2. ตรวจ Tenant identity, migration ledger, schema objects และ absence/presence ของ partial objects แบบ Read-only อีกครั้งก่อนวันดำเนินการ
3. ทบทวน Control/Tenant migration reconciliation; ห้าม rerun migrations ที่มี schema effects อยู่แล้วและห้ามสร้าง ledger rows ปลอม
4. จัดทำ pre-migration backup และ restore verification ที่ตรงกับ Tenant ล่าสุด
5. รอ encrypted off-host backup/restore gate และ maintenance/rollback plan
6. ขออนุมัติแบบระบุ Workspace, database, migration version, SHA-256, เวลา, operator และ rollback procedure ก่อน Apply
7. หลังอนุมัติจึง Apply ด้วย Provisioner; ตรวจ Ledger, objects, Runtime Role grants และ API smoke test
8. ทดสอบ Create Draft → Count → Finalize/Cancel, WAC/Stock Movement/Audit reconciliation และ idempotent replay ด้วยข้อมูลที่ได้รับอนุมัติ

### 2.4 Inventory Quantity / Costing

- พบ Active Product 1 รายการและ Active Variant 1 รายการ (ข้อมูลทดสอบที่เคยได้รับอนุมัติ)
- ยังไม่มี Store Product mapping
- Stock Balance, Inventory Cost และ Stock Movement เป็น 0 แถว
- ไม่พบ negative balance หรือสมการ available ผิด แต่ไม่มีข้อมูลเพียงพอให้ยืนยัน WAC หรือ Inventory Value
- Inventory implementation ผ่าน E2E/Concurrency tests ใน E2E tenant แต่ไม่ใช่การรับรองต้นทุนจากธุรกรรมจริงของ `pos-local`

**งานก่อนเปิดใช้งาน:**

1. ยืนยัน Product/Variant ที่จะเปิดขายใน Store และกำหนด Store Product mapping ตามการอนุมัติ
2. เตรียม Opening Stock dataset ที่มี Warehouse, Variant, base UOM, quantity และ unit cost; ห้ามใช้ Stocktake แทน Opening Stock
3. ทบทวน Opening Stock workflow แยกจาก Direct Receiving และ Stocktake; ยืนยันว่า Opening Stock ต่อ Warehouse post ได้ครั้งเดียวตาม Business Rule
4. กระทบยอด Quantity, InventoryCost.quantity, inventory_value และ WAC ก่อน/หลังรับเข้า/ปรับยอด/โอน
5. ทดสอบ concurrency, idempotency, stale snapshot และ reserved-stock guards ด้วย isolated E2E data ก่อนทำรายการจริง

### 2.5 Backup / Recovery

- Control และ Tenant custom-format archives ที่สร้าง 2026-11-07 มี SHA-256 และผ่าน `pg_restore --list`
- Isolated Recovery DB ทั้งสองชุดผ่าน schema/data/ledger verification และตั้ง Default Read-only
- Backup/Recovery ชุดนี้เป็น Local-only; Off-host encrypted backup ยังไม่ผ่าน
- เอกสาร Backup ระบุว่า D: มี BitLocker Protection Off และไม่มี Key Protectors ณ วันที่ตรวจ 2026-11-07
- การตรวจล่าสุดไม่ได้ยืนยัน BitLocker ซ้ำด้วยสิทธิ์ Administrator

สถานะ: Local restore rehearsal ผ่าน แต่ยังไม่ผ่าน Off-site Recovery gate. การตั้งค่า NAS/Retention automation ยังคงเป็นงานแยก ไม่ได้เริ่มใน Remediation นี้

## 3. ลำดับการดำเนินงาน

| ลำดับ | งาน | ผลลัพธ์ที่ต้องส่งมอบ | Gate |
|---|---|---|---|
| R1 | Full RBAC reconciliation (read-only) | Diff 30 Permission keys และ Role grants เทียบ Matrix | ไม่เปลี่ยน Control DB |
| R2 | RBAC remediation candidate | Forward-only SQL + test plan + rollback/verification | ขออนุมัติก่อน Apply |
| R3 | Stocktake migration review | Candidate/schema/API compatibility report | ไม่ Apply Tenant DB |
| R4 | Backup & deployment preflight | Backup/restore proof, maintenance window, checksum, rollback plan | Off-host encrypted restore ต้องผ่าน |
| R5 | Apply RBAC/Stocktake changes | Ledger, grants, schema และ API smoke tests | ต้องมี explicit named-target approval |
| R6 | Opening Inventory readiness | Approved product mapping + opening quantity/cost reconciliation | ต้องอนุมัติข้อมูลตั้งต้น |
| R7 | Operational acceptance | Role-based UI/API tests, movement/cost audit และ operator sign-off | ก่อนเปิดใช้งานจริง |

## 4. Acceptance Criteria สำหรับ Inventory Readiness

- Owner/Admin/Manager/Cashier/Inventory Staff ตรงกับ Permission Matrix ครบทุก key
- Cashier ไม่สามารถ Receive, Issue, Adjust, Transfer, Stocktake หรือ Reverse
- Inventory Staff ทำ Receive, Issue, Adjust, Transfer และ Stocktake ได้ แต่ Reverse ไม่ได้
- Manager/Admin ทำได้ตาม Matrix; Owner มีสิทธิ์เต็มเฉพาะ Workspace ของตน
- Stocktake endpoints ไม่คืน 500; Draft/Count/Finalize/Cancel และ replay ผ่าน
- Opening Stock/Direct Receiving/Adjustment/Transfer สร้าง Ledger และ Cost อย่าง atomic/idempotent
- Quantity, InventoryCost.quantity และ StockBalance กระทบยอดตรงกัน; WAC และ Inventory Value คำนวณซ้ำได้
- Backup นอกเครื่องเข้ารหัสแล้วและ Restore test ผ่านก่อน Migration จริง
- มี Maintenance/rollback operator และหลักฐานอนุมัติสำหรับทุก Production-like mutation

## 5. สถานะหลังจัดทำแผน — 2026-11-10

- จัดทำ Remediation Plan จาก Read-only findings แล้ว
- ไม่มี Control/Tenant DB mutation, Migration, Role assignment, Business data seed, deployment, commit หรือ push ในงานนี้
- `pos-local` ยังคง **NOT READY** จนกว่า R1–R7 และ deployment gates ที่เกี่ยวข้องจะผ่าน


## 6. R1 — Full RBAC reconciliation result (Read-only, 2026-11-10)

การเปรียบเทียบใช้ Permission Catalog จาก `permission-catalog.ts` และอ่าน Control DB ภายใน `BEGIN READ ONLY`:

| Role | Expected grants | Actual grants | Result |
|---|---:|---:|---|
| admin | 30 | 12 | Missing 19; has 1 legacy grant outside current catalog |
| manager | 27 | 27 | Exact match |
| cashier | 7 | Role row absent | Not provisioned in this Workspace |
| inventory_staff | 13 | Role row absent | Not provisioned; service intentionally creates it only when an authorized assignment requests it |

- Control DB `permissions` table มี 31 keys: 30 ตรงกับ Application Catalog และมี legacy `commerce.inventory.manage` เพิ่มอีก 1 key
- Admin มี `commerce.inventory.manage` เป็น unexpected legacy grant และขาด 19 keys ตาม Admin = ALL_PERMISSION_KEYS
- Manager มี 27/27 grants ตรงกับ `MANAGER_PERMISSION_KEYS`; ไม่พบ missing/unexpected grants
- Role rows ที่พบคือ `admin`, `manager`, `member`, `viewer`; ไม่มี `cashier` และ `inventory_staff`
- Membership มี Owner 1 ราย (ownership bypass, ไม่มี role assignment) และ Manager 1 ราย
- Inventory Staff absence สอดคล้องกับ `WorkspacesService.ensureDefaultRoles(workspaceId, includeInventoryStaff=false)`, ซึ่งตั้งใจ provision role นี้เมื่อมีการเพิ่มสมาชิก Inventory Staff ที่ผ่าน authorization/validation
- Control migration ledger มี 001/002 เป็น applied; 003/004 ยังไม่มี ledger entries แต่มี schema effects ที่เคยตรวจพบ; 005 ยังไม่ applied. ห้ามใช้ `prisma migrate deploy` แบบไม่ reconcile และห้ามสร้าง ledger rows ย้อนหลังโดยไม่มีหลักฐาน
- Candidate 005 เพิ่ม/ให้ grants เพียง `commerce.inventory.adjust`, `commerce.inventory.transfer`, `commerce.inventory.stocktake`. Manager มีทั้งสามอยู่แล้ว; Admin จะยังขาดอีก 16 grants หลัง candidate นี้; Inventory Staff role ไม่มีอยู่จึงไม่ได้ grants. Candidate 005 เพียงอย่างเดียวไม่ใช่ remediation ที่สมบูรณ์
- `WorkspacesService.listRoles()` เรียก `ensureDefaultRoles()` ซึ่งทำ INSERT/role seeding จาก read/list path; ห้ามเรียก endpoint นี้ใน Read-only audit. ควรแยก provisioning ออกจาก GET path และเพิ่ม test ยืนยันว่า listRoles ไม่มี database mutation

### R1 disposition

<badge>COMPLETE — READ ONLY</badge>

- Permission catalog/grants/membership/role existence diff ได้ผลครบ
- ไม่มี INSERT/UPDATE/DELETE, role assignment, migration หรือ business data mutation
- R2 ต้องออกแบบให้ reconcile Admin ครบ 30 grants, provision Cashier ตาม lifecycle ที่เหมาะสม และ provision Inventory Staff เฉพาะเมื่อมีการมอบหมายที่ได้รับอนุมัติ
- ก่อน R2 migration candidate ต้องทบทวน Control migration ledger reconciliation สำหรับ 003/004 และยืนยันแนวทางจัดการ 005 โดยไม่แก้ migration history ย้อนหลัง


## R2 - Control DB Migration Reconciliation (Read-only, 2026-11-10)

Target: local Control DB syncup_control. Inspection used postgres inside BEGIN READ ONLY; transaction_read_only=on was verified. No DDL, DML, grants, ledger repair, migration or deployment occurred.

| Migration | Ledger | Live effect | Result |
|---|---|---|---|
| 003 module_registration_activation | Missing | Enum, six columns, validated CHECK, status index, audit table, two FKs and two audit indexes present | Schema matches current SQL; history unrecorded |
| 004 module_audit_runtime_grants | Missing | syncup has module_installations SELECT/INSERT/UPDATE and audit SELECT/INSERT | Grants match current SQL; history unrecorded |
| 005 inventory_role_matrix_alignment | Missing | Not applied | Hold for RBAC redesign |

003 data invariant: 2 module_installations rows, 1 enabled, 0 status/enabled mismatches, 0 enabled rows missing enabled_at. Enum values: INSTALLED, ENABLED, DISABLED, FAILED.

004 role eligibility: syncup qualifies and has expected audit grants. pg_read_all_data has SELECT only on module_installations, lacks INSERT/UPDATE, and does not qualify for the dynamic grant.

Source SQL SHA-256:
- 003: 8a19a6ef57e08fc4f0f93bafb79843f6b6c77ccdb006e45ae8a5c9a31363219f
- 004: de0a182e4d9bb6bba4c5f5e2e4f9d844e9db174356f5a5f842911b8caf7c659b

Disposition:
1. Do not rerun 003/004; their non-idempotent DDL effects already exist.
2. Do not run prisma migrate deploy on Control DB while the 003/004 ledger gap remains.
3. Do not insert synthetic _prisma_migrations rows, fabricate checksums/timestamps, or alter historical migration files.
4. Under the current prohibition on historical ledger entries, Prisma Migrate has no native path that both respects that prohibition and makes this history deployable. prisma migrate resolve --applied for exactly 003/004 is the conventional repair only if the owner explicitly changes the constraint and approves those versions; it was not run.
5. If ledger backfill remains prohibited, pause Prisma Migrate for this database and design a separately approved migration-lineage/runner strategy, tested against a restored clone and a fresh Control DB.
6. Keep 005 and the new RBAC candidate on hold until the ledger strategy is decided. All Control/Tenant changes require separate named-target approval.

Read-only audit helper: apps/api/scripts/audit-control-migration-reconciliation.cjs. It targets localhost syncup_control, enforces read-only mode and performs SELECT-only inspection.


## 7. RBAC Remediation Candidate Design (Draft only; not applied)

Target scope: Workspace `pos-local` (`c0130bf3-c1c0-4dfa-a915-7ca5155cacfd`) in the Control DB. This is a design specification, not an executable migration. Do not add it to the active Prisma migrations directory until the 003/004 ledger strategy is decided.

| Role | Candidate action | Expected grants |
|---|---|---:|
| Admin | Add missing catalog grants only; preserve legacy `commerce.inventory.manage` grant | 30 current catalog keys |
| Manager | No grant changes; preflight must assert the existing reviewed set is still exact | 27 |
| Cashier | Create system role if absent, then grant the default read/sales set; do not assign any member | 7 |
| Inventory Staff | Do not create role; preserve on-demand provisioning. If present later, its approved matrix is 13 keys and excludes `commerce.inventory.movement.reverse` | 13 when provisioned |
| Member / Viewer | No changes | Existing minimal grants |

Candidate safety rules:
- Verify workspace ID + slug, exactly one system Admin and Manager role, current 30-key catalog, and the exact Manager 27-key grant set before any change.
- If Cashier already exists, require it to be a system role and reject unexpected grants rather than silently overwriting them.
- Use additive, idempotent `INSERT ... ON CONFLICT DO NOTHING` for grants. Do not delete grants, edit membership_roles, alter memberships, or revoke the legacy permission.
- Create only the Cashier role; do not create Inventory Staff because the service intentionally provisions it only when an authorized assignment requests that role.
- Verify Admin has all 30 catalog grants and Cashier has exactly 7 after the candidate. Manager must remain unchanged.
- Keep the existing 005 migration unapplied; the new candidate supersedes its incomplete three-permission scope rather than layering it blindly.
- Separately fix `WorkspacesService.listRoles()` so a GET/list operation does not call the mutating `ensureDefaultRoles()`. Preserve explicit provisioning during workspace creation and authorized Inventory Staff assignment, with tests proving GET has no DB writes.

This candidate is not yet executable/approved. It must be reviewed against the migration-ledger decision, tested on a restored disposable Control DB, and approved for the named target before it is converted into a migration.
R2 REHEARSAL OUTCOME - 2026-11-10

- Prisma-native ledger repair was rehearsed successfully on a disposable restore of the pinned Control backup. prisma migrate resolve --applied recorded exactly 003 and 004 with checksums matching current SQL. Prisma status reported 005 as the only pending migration.
- RBAC candidate passed on a separate disposable restore: Admin 30 catalog grants plus preserved legacy grant; Manager unchanged at 27; Cashier provisioned with 7 grants; Inventory Staff remained absent/on-demand.
- Membership-role assignments, global permissions, other-workspace roles/grants, and migration ledger were unchanged by the RBAC candidate. A second run produced identical role/grant state.
- Scripts: apps/api/scripts/rehearse-control-migration-ledger-reconciliation.cjs and apps/api/scripts/rehearse-pos-local-rbac-candidate.cjs.
- Candidate SQL: docs/operations/pos-local-rbac-remediation-candidate-2026-11-10.sql (documentation candidate only; not an active Prisma migration).
- Full evidence: docs/operations/r2-migration-rbac-rehearsal-2026-11-10.md.
- Live syncup_control and pos-local remain unchanged. Applying 003/004 ledger resolution to live Control DB and applying RBAC to pos-local require separate explicit approvals. Migration 005 and Stocktake remain on hold.

STOCKTAKE REHEARSAL - 2026-11-10

- Candidate SQL 20261107000100_tenant_inventory_stocktake passed on a disposable restore of pos-local Tenant backup. Backup SHA-256: 01be3ffae783f2c69bcd764c1cc670018675b96c6dd0ad27e0232e644eb9e53c. Candidate SHA-256: a32e90622cac76ea16a3bdb16ceb74bb34da048004911cfe1c68fd9c5f255ae9.
- Created two Stocktake tables, 12 session columns, 9 line columns, STOCKTAKE enum value, four StocktakeStatus values, seven named constraints and six indexes. Tables stayed empty; Tenant ledger was not changed.
- Read-only live pos-local audit: Stocktake tables and ledger absent; two existing tenant ledger rows, one warehouse, two variants. Runtime role can connect and use public schema; provisioner default privileges grant CRUD on newly created tables.
- TenantMigrationRunner currently provisions only baseline, not incremental Stocktake SQL. A dedicated approved executor must take advisory lock, verify exact target and pre-change backup, apply SQL and insert tenant_migrations version in the same transaction, then verify runtime grants.
- Stocktake remains a separate approval gate. No live database changed. Evidence: docs/operations/r2-migration-rbac-rehearsal-2026-11-10.md.
