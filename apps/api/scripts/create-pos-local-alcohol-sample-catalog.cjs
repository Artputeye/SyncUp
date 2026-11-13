"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomBytes } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { Client } = require("pg");

const TARGET = {
  slug: "pos-local",
  workspaceId: "c0130bf3-c1c0-4dfa-a915-7ca5155cacfd",
  database: "syncup_ws_c0130bf3c1c0",
  storeSlug: "main-store",
  storeName: "Main Store",
  managerEmail: "manager-e2e@syncup.local",
};
const CATEGORY = {
  name: "เครื่องดื่มแอลกอฮอล์",
  slug: "alcoholic-beverages",
  description: "หมวดหมู่ตั้งต้นสำหรับสินค้าเครื่องดื่มแอลกอฮอล์; ต้องตรวจสอบข้อมูลสินค้าและข้อกำหนดก่อนเปิดใช้งาน",
};
const ITEMS = [
  { name: "เบียร์ (รอระบุยี่ห้อ/ขนาด)", sku: "ALC-BEER-DRAFT", title: "หน่วยตัวอย่าง (ยังไม่กำหนดขนาด)" },
  { name: "ไวน์ (รอระบุยี่ห้อ/ขนาด)", sku: "ALC-WINE-DRAFT", title: "หน่วยตัวอย่าง (ยังไม่กำหนดขนาด)" },
  { name: "วิสกี้ (รอระบุยี่ห้อ/ขนาด)", sku: "ALC-WHISKY-DRAFT", title: "หน่วยตัวอย่าง (ยังไม่กำหนดขนาด)" },
  { name: "สุรา (รอระบุยี่ห้อ/ขนาด)", sku: "ALC-SPIRIT-DRAFT", title: "หน่วยตัวอย่าง (ยังไม่กำหนดขนาด)" },
];
const BACKUP_DIR = "D:\\Back up\\SyncUp\\Backups";
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const confirmWorkspace = args.find(x => x.startsWith("--confirm-workspace="))?.split("=")[1];
const confirmItems = args.find(x => x.startsWith("--confirm-skus="))?.split("=")[1]?.split(",") || [];
function must(v, message) { assert.ok(v, message); }
function urlForDatabase(base, database) { const u = new URL(base); u.pathname = "/" + database; return u; }
function hashFile(file) { return createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function pgDump(url, output) {
  const u = new URL(url);
  const r = spawnSync("pg_dump", [
    "--format=custom", "--no-owner", "--no-privileges",
    "--host", u.hostname, "--port", u.port || "5432",
    "--username", decodeURIComponent(u.username),
    "--dbname", decodeURIComponent(u.pathname.slice(1)),
    "--file", output,
  ], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, PGPASSWORD: decodeURIComponent(u.password) },
    maxBuffer: 16 * 1024 * 1024,
  });
  must(!r.error && r.status === 0, "pg_dump failed: " + (r.error?.message || r.stderr || r.stdout));
}
async function main() {
  must(process.platform === "win32", "This guarded script is intended for the approved Windows local environment.");
  must(process.env.CONTROL_DATABASE_URL && process.env.WORKSPACE_DATABASE_ADMIN_URL, "Required DB environment is missing.");
  if (apply) {
    must(confirmWorkspace === TARGET.slug, "Live apply requires --confirm-workspace=pos-local.");
    must(confirmItems.join(",") === ITEMS.map(x => x.sku).join(","), "Live apply requires the exact approved sample SKU list.");
  }
  const controlUrl = new URL(process.env.CONTROL_DATABASE_URL);
  must(["localhost", "127.0.0.1", "::1"].includes(controlUrl.hostname), "Control DB must be local.");
  must(decodeURIComponent(controlUrl.pathname.slice(1)) === "syncup_control", "Unexpected Control DB.");
  const control = new Client({ connectionString: controlUrl.toString(), application_name: "pos-local-alcohol-catalog-guard" });
  await control.connect();
  let tenant;
  try {
    const registration = await control.query(
      "SELECT w.id,d.database_name FROM workspaces w JOIN workspace_databases d ON d.workspace_id=w.id WHERE w.slug=$1 AND w.status::text='ACTIVE'",
      [TARGET.slug],
    );
    must(registration.rowCount === 1, "Expected exactly one ACTIVE pos-local registration.");
    must(registration.rows[0].id === TARGET.workspaceId, "Workspace ID mismatch.");
    must(registration.rows[0].database_name === TARGET.database, "Tenant database mismatch.");
    const manager = await control.query(
      "SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id " +
      "JOIN membership_roles mr ON mr.membership_id=m.id JOIN roles r ON r.id=mr.role_id " +
      "WHERE m.workspace_id=$1 AND u.email=$2 AND u.status::text='ACTIVE' AND r.key='manager'",
      [TARGET.workspaceId, TARGET.managerEmail],
    );
    must(manager.rowCount === 1, "Expected one ACTIVE pos-local Manager actor.");
    const tenantUrl = urlForDatabase(process.env.WORKSPACE_DATABASE_ADMIN_URL, TARGET.database);
    must(["localhost", "127.0.0.1", "::1"].includes(tenantUrl.hostname), "Tenant DB must be local.");
    tenant = new Client({ connectionString: tenantUrl.toString(), application_name: "pos-local-alcohol-catalog-guard" });
    await tenant.connect();
    const target = await tenant.query(
      "SELECT id,name,status::text AS status FROM stores WHERE slug=$1",
      [TARGET.storeSlug],
    );
    must(target.rowCount === 1 && target.rows[0].name === TARGET.storeName && target.rows[0].status === "ACTIVE",
      "Expected the approved ACTIVE Main Store.");
    const storeId = target.rows[0].id;
    const uom = await tenant.query("SELECT id FROM unit_of_measures WHERE code='EA' AND status='ACTIVE'");
    must(uom.rowCount === 1, "Expected exactly one ACTIVE EA UOM.");
    const ledger = await tenant.query("SELECT count(*)::int AS n FROM tenant_migrations");
    must(ledger.rows[0].n === 6, "Unexpected Tenant migration ledger.");
    const existingCategory = await tenant.query(
      "SELECT id,name,status::text AS status FROM store_categories WHERE store_id=$1 AND normalized_slug=$2",
      [storeId, CATEGORY.slug],
    );
    if (existingCategory.rowCount) must(existingCategory.rows[0].name === CATEGORY.name, "Category slug already belongs to a different category.");
    const existing = await tenant.query(
      "SELECT v.sku,p.name,p.status::text AS product_status,v.status::text AS variant_status " +
      "FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.normalized_sku = ANY($1::text[])",
      [ITEMS.map(x => x.sku.toLowerCase())],
    );
    must(existing.rowCount === 0 || existing.rowCount === ITEMS.length, "Only part of the sample SKU set already exists; refusing a partial/conflicting apply.");
    for (const item of existing.rows) {
      const expected = ITEMS.find(x => x.sku === item.sku);
      must(expected && expected.name === item.name && item.product_status === "DRAFT" && item.variant_status === "DRAFT",
        "Existing SKU conflicts with the approved draft catalog.");
    }
    const preview = {
      workspace: TARGET.slug,
      database: TARGET.database,
      store: TARGET.storeName,
      category: CATEGORY.name,
      items: ITEMS.map(x => ({ name: x.name, sku: x.sku, status: "DRAFT", uom: "EA", price: null, tax: null, stock: null })),
      existingCategory: existingCategory.rowCount === 1,
      existingProducts: existing.rowCount,
      apply,
    };
    console.log(JSON.stringify({ preview }, null, 2));
    if (!apply) {
      console.log("DRY_RUN_PASS: no database writes performed.");
      return;
    }
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    const backupFile = path.join(BACKUP_DIR, "pos-local_pre_alcohol_catalog_" + stamp + ".dump");
    pgDump(tenantUrl.toString(), backupFile);
    const backupHash = hashFile(backupFile);
    const manifest = {
      workspace: TARGET.slug,
      workspaceId: TARGET.workspaceId,
      database: TARGET.database,
      createdAt: new Date().toISOString(),
      format: "pg_dump custom",
      file: backupFile,
      sizeBytes: fs.statSync(backupFile).size,
      sha256: backupHash,
      encryption: "not encrypted; local backup only",
    };
    fs.writeFileSync(backupFile + ".manifest.json", JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
    const list = spawnSync("pg_restore", ["--list", backupFile], { encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    must(!list.error && list.status === 0 && list.stdout.includes("TABLE DATA"), "Backup archive verification failed.");
    must(hashFile(backupFile) === backupHash, "Backup hash changed after verification.");
    await tenant.query("BEGIN");
    try {
      await tenant.query("SET LOCAL lock_timeout='5s'");
      const locked = await tenant.query("SELECT id FROM stores WHERE id=$1 FOR UPDATE", [storeId]);
      must(locked.rowCount === 1, "Store lock failed.");
      let categoryId;
      if (existingCategory.rowCount) {
        categoryId = existingCategory.rows[0].id;
      } else {
        const inserted = await tenant.query(
          "INSERT INTO store_categories (id,store_id,parent_id,name,slug,normalized_slug,description,status,sort_order,created_at,updated_at) " +
          "VALUES (gen_random_uuid(),$1,NULL,$2,$3,$3,$4,'ACTIVE',0,NOW(),NOW()) RETURNING id",
          [storeId, CATEGORY.name, CATEGORY.slug, CATEGORY.description],
        );
        categoryId = inserted.rows[0].id;
        await tenant.query(
          "INSERT INTO audit_logs (id,store_id,actor_user_id,action,entity_type,entity_id,reason,\"after\") " +
          "VALUES (gen_random_uuid(),$1,$2,'STORE_CATEGORY_CREATED','StoreCategory',$3,'Create draft alcohol product category',$4::jsonb)",
          [storeId, manager.rows[0].id, categoryId, JSON.stringify({ name: CATEGORY.name, slug: CATEGORY.slug, status: "ACTIVE" })],
        );
      }
      const created = [];
      for (const item of ITEMS) {
        const prior = await tenant.query("SELECT id FROM product_variants WHERE normalized_sku=$1 FOR UPDATE", [item.sku.toLowerCase()]);
        let productId, variantId, storeProductId;
        if (prior.rowCount) {
          const row = await tenant.query(
            "SELECT p.id AS product_id,p.name,p.status::text AS product_status,v.id AS variant_id,v.status::text AS variant_status " +
            "FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id=$1",
            [prior.rows[0].id],
          );
          productId = row.rows[0].product_id;
          variantId = row.rows[0].variant_id;
          const sp = await tenant.query("SELECT id FROM store_products WHERE store_id=$1 AND product_id=$2", [storeId, productId]);
          must(sp.rowCount === 1, "Existing draft SKU is missing its Main Store catalog association.");
          storeProductId = sp.rows[0].id;
        } else {
          const p = await tenant.query(
            "INSERT INTO products (id,name,description,status,normalized_name,created_at,updated_at) " +
            "VALUES (gen_random_uuid(),$1,$2,'DRAFT',$3,NOW(),NOW()) RETURNING id",
            [item.name, "ข้อมูลตั้งต้นเท่านั้น: ต้องระบุยี่ห้อ ขนาด/ปริมาตร รายละเอียด และตรวจสอบข้อกำหนดก่อนเปิดใช้งาน", item.name.toLowerCase()],
          );
          productId = p.rows[0].id;
          const v = await tenant.query(
            "INSERT INTO product_variants (id,product_id,base_uom_id,tax_category_id,sku,normalized_sku,title,barcode,status,updated_at) " +
            "VALUES (gen_random_uuid(),$1,$2,NULL,$3,$4,$5,NULL,'DRAFT',NOW()) RETURNING id",
            [productId, uom.rows[0].id, item.sku, item.sku.toLowerCase(), item.title],
          );
          variantId = v.rows[0].id;
          await tenant.query(
            "INSERT INTO variant_uoms (id,variant_id,uom_id,usage,conversion_to_base,status,created_at,updated_at) " +
            "VALUES (gen_random_uuid(),$1,$2,'BASE',1,'ACTIVE',NOW(),NOW())",
            [variantId, uom.rows[0].id],
          );
          const sp = await tenant.query(
            "INSERT INTO store_products (id,store_id,product_id,publish_status,sort_order,featured,created_at,updated_at) " +
            "VALUES (gen_random_uuid(),$1,$2,'DRAFT',0,false,NOW(),NOW()) RETURNING id",
            [storeId, productId],
          );
          storeProductId = sp.rows[0].id;
          await tenant.query(
            "INSERT INTO store_product_variants (id,store_id,product_id,store_product_id,variant_id,publish_status,sort_order,created_at,updated_at) " +
            "VALUES (gen_random_uuid(),$1,$2,$3,$4,'DRAFT',0,NOW(),NOW())",
            [storeId, productId, storeProductId, variantId],
          );
          await tenant.query(
            "INSERT INTO audit_logs (id,store_id,actor_user_id,action,entity_type,entity_id,reason,\"after\") " +
            "VALUES (gen_random_uuid(),$1,$2,'PRODUCT_CREATED','Product',$3,'Create draft alcohol catalog placeholder',$4::jsonb)",
            [storeId, manager.rows[0].id, productId, JSON.stringify({ name: item.name, status: "DRAFT", sku: item.sku, uomCode: "EA", taxCategoryId: null, placeholder: true })],
          );
        }
        await tenant.query(
          "INSERT INTO store_product_categories (store_id,store_product_id,category_id,created_at) " +
          "VALUES ($1,$2,$3,NOW()) ON CONFLICT DO NOTHING",
          [storeId, storeProductId, categoryId],
        );
        created.push({ name: item.name, sku: item.sku, productId, variantId, storeProductId });
      }
      const verify = await tenant.query(
        "SELECT count(*)::int AS products," +
        "(SELECT count(*)::int FROM store_products WHERE store_id=$1 AND publish_status='DRAFT' AND product_id IN (SELECT id FROM products WHERE name LIKE '%(รอระบุยี่ห้อ/ขนาด)')) AS draft_store_products," +
        "(SELECT count(*)::int FROM store_product_categories WHERE store_id=$1 AND category_id=$2) AS category_links," +
        "(SELECT count(*)::int FROM product_prices pp JOIN store_product_variants spv ON spv.id=pp.store_product_variant_id WHERE spv.store_id=$1 AND spv.product_id IN (SELECT id FROM products WHERE name LIKE '%(รอระบุยี่ห้อ/ขนาด)')) AS prices," +
        "(SELECT count(*)::int FROM stock_balances sb JOIN product_variants v ON v.id=sb.variant_id WHERE v.sku=ANY($3::text[])) AS stock_rows " +
        "FROM products WHERE name LIKE '%(รอระบุยี่ห้อ/ขนาด)' AND status='DRAFT'",
        [storeId, categoryId, ITEMS.map(x => x.sku)],
      );
      must(verify.rows[0].products === 4 && verify.rows[0].draft_store_products === 4 && verify.rows[0].category_links === 4,
        "Post-insert draft catalog verification failed.");
      must(verify.rows[0].prices === 0 && verify.rows[0].stock_rows === 0, "Unexpected price or stock records.");
      await tenant.query("COMMIT");
      console.log(JSON.stringify({
        result: "POS_LOCAL_ALCOHOL_SAMPLE_CATALOG_APPLY_PASS",
        category: CATEGORY,
        items: created,
        verification: verify.rows[0],
        backup: manifest,
      }, null, 2));
    } catch (error) {
      await tenant.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  } finally {
    if (tenant) await tenant.end().catch(() => undefined);
    await control.end();
  }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
