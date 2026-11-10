const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { Client } = require("pg");
const { chromium } = require(require.resolve("@playwright/test", { paths: [path.resolve(__dirname, "../../web")] }));
const prisma = new PrismaClient();
const base = "http://127.0.0.1:" + (process.env.API_PORT || "4000");
const web = process.env.WEB_ORIGIN || "http://localhost:3000";
const slug = "e2e-commerce-20261106";
const workspaceId = "e65ca36b-8068-4506-a90f-59820a2ede6d";
const suffix = Date.now().toString();
const ids = { uom: randomUUID(), product: randomUUID(), variant: randomUUID() };
let tenant;
let browser;
let stocktakeId;
let movementIds = [];

function loadEnv(file) {
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}
async function cleanup() {
  if (!tenant) return;
  await tenant.query("BEGIN");
  try {
    if (stocktakeId) {
      await tenant.query("DELETE FROM audit_events WHERE (resource_type='StocktakeSession' AND resource_id=$1) OR (resource_type='StocktakeLine' AND resource_id IN (SELECT id::text FROM stocktake_lines WHERE session_id=$1::uuid))", [stocktakeId]);
      await tenant.query("DELETE FROM audit_events WHERE resource_type='StockMovement' AND resource_id IN (SELECT id::text FROM stock_movements WHERE variant_id=$1)", [ids.variant]);
      await tenant.query("DELETE FROM stock_movements WHERE variant_id=$1", [ids.variant]);
      await tenant.query("DELETE FROM stocktake_lines WHERE session_id=$1::uuid", [stocktakeId]);
      await tenant.query("DELETE FROM stocktake_sessions WHERE id=$1::uuid", [stocktakeId]);
    } else {
      await tenant.query("DELETE FROM stock_movements WHERE variant_id=$1", [ids.variant]);
    }
    await tenant.query("DELETE FROM inventory_costs WHERE variant_id=$1", [ids.variant]);
    await tenant.query("DELETE FROM stock_balances WHERE variant_id=$1", [ids.variant]);
    await tenant.query("DELETE FROM product_variants WHERE id=$1", [ids.variant]);
    await tenant.query("DELETE FROM products WHERE id=$1", [ids.product]);
    await tenant.query("DELETE FROM unit_of_measures WHERE id=$1", [ids.uom]);
    await tenant.query("COMMIT");
  } catch (error) {
    await tenant.query("ROLLBACK");
    throw error;
  }
}
async function main() {
  loadEnv(path.resolve(__dirname, "../.env"));
  try {
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug }, include: { database: true } });
    assert.equal(workspace.id, workspaceId, "E2E workspace identity mismatch");
    assert.equal(workspace.status, "ACTIVE");
    assert.equal(workspace.database.databaseName, "syncup_ws_e65ca36b8068");
    const adminUrl = new URL(process.env.WORKSPACE_DATABASE_ADMIN_URL);
    assert.ok(["127.0.0.1", "localhost", "::1"].includes(adminUrl.hostname), "Only local E2E DB is allowed");
    adminUrl.pathname = "/" + workspace.database.databaseName;
    tenant = new Client({ connectionString: adminUrl.toString() });
    await tenant.connect();
    const ledger = await tenant.query("SELECT 1 FROM tenant_migrations WHERE version='20261107000100_tenant_inventory_stocktake'");
    assert.equal(ledger.rowCount, 1, "Stocktake migration is not applied to E2E tenant");

    const warehouse = await tenant.query("SELECT id::text,branch_id::text FROM warehouses WHERE status='ACTIVE' ORDER BY is_default DESC,created_at LIMIT 1");
    assert.equal(warehouse.rowCount, 1, "E2E warehouse missing");
    const warehouseId = warehouse.rows[0].id;
    const uomCode = "U" + suffix.slice(-9);
    await tenant.query("INSERT INTO unit_of_measures (id,code,normalized_code,name,symbol,dimension,updated_at) VALUES ($1,$2,$3,$4,$5,'COUNT',NOW())",
      [ids.uom, uomCode, uomCode.toLowerCase(), "UI E2E Each " + suffix, "u" + suffix.slice(-4)]);
    await tenant.query("INSERT INTO products (id,name,normalized_name,updated_at) VALUES ($1,$2,$3,NOW())",
      [ids.product, "UI E2E Stocktake " + suffix, ("ui e2e stocktake " + suffix).toLowerCase()]);
    await tenant.query("INSERT INTO product_variants (id,product_id,base_uom_id,sku,normalized_sku,title,status,updated_at) VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',NOW())",
      [ids.variant, ids.product, ids.uom, "UI-" + suffix, ("ui-" + suffix).toLowerCase(), "UI Stocktake Variant"]);
    await tenant.query("INSERT INTO stock_balances (warehouse_id,variant_id,on_hand,reserved,available,updated_at) VALUES ($1,$2,10,0,10,NOW())",
      [warehouseId, ids.variant]);
    await tenant.query("INSERT INTO inventory_costs (warehouse_id,variant_id,quantity,average_unit_cost,inventory_value,updated_at) VALUES ($1,$2,10,5,50,NOW())",
      [warehouseId, ids.variant]);
    console.log("UI_E2E_FIXTURE_CREATED=PASS");

    const health = await fetch(base + "/api/health");
    assert.equal(health.status, 200, "API health check failed");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ baseURL: web });
    const page = await context.newPage();
    page.on("dialog", dialog => dialog.accept());
    page.on("response", async response => {
      if (response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/inventory/stocktakes") && response.status() === 201) {
        try { stocktakeId = (await response.json()).stocktakeId; } catch {}
      }
    });
    await page.goto("/login");
    await page.getByLabel("อีเมล").fill(process.env.E2E_MANAGER_EMAIL);
    await page.locator("#password").fill(process.env.E2E_MANAGER_PASSWORD);
    await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
    await page.waitForURL(/\/workspaces\/?(?:\?.*)?$/, { timeout: 20000 });
    await page.getByRole("button", { name: /E2E Commerce Workspace/ }).click();
    await page.waitForURL(new RegExp("/workspace/" + slug + "$"));
    await page.getByRole("button", { name: "คลังสินค้า" }).click();
    await page.getByRole("button", { name: "ตรวจนับสต็อก", exact: true }).click();
    await page.waitForURL(new RegExp("/workspace/" + slug + "/inventory/stocktakes$"));
    await page.getByLabel("คลังสินค้า").selectOption(warehouseId);
    await page.getByLabel("เลขที่ / อ้างอิง (ไม่บังคับ)").fill("UI-ST-" + suffix);
    await page.getByLabel("หมายเหตุ (ไม่บังคับ)").fill("Real API browser E2E");
    await page.getByRole("button", { name: "สร้างรอบตรวจนับ" }).click();
    await page.getByText("สร้างรอบตรวจนับแล้ว").waitFor({ timeout: 15000 });
    assert.ok(stocktakeId, "Stocktake create response did not return an ID");
    await page.getByText("UI E2E Stocktake " + suffix, { exact: true }).waitFor();
    await page.getByLabel("ยอดตรวจนับจริง").fill("11");
    await page.getByLabel("ต้นทุนต่อหน่วย (เมื่อยอดเพิ่ม)").fill("7");
    await page.getByLabel("หมายเหตุ", { exact: true }).fill("Browser physical count");
    await page.getByRole("button", { name: "บันทึกยอด" }).click();
    await page.getByText("บันทึกยอดตรวจนับ UI-" + suffix + " แล้ว").waitFor();
    await page.getByText("+1.000").waitFor();
    console.log("UI_CREATE_AND_COUNT_REAL_API=PASS");

    await page.getByRole("button", { name: "ปิดรอบและปรับสต็อก" }).click();
    await page.getByText(/ปิดรอบตรวจนับสำเร็จ/).waitFor({ timeout: 15000 });
    await page.getByText("ปิดรอบแล้ว").first().waitFor();
    const state = await tenant.query("SELECT b.on_hand::text,ic.quantity::text,ic.average_unit_cost::text,ic.inventory_value::text FROM stock_balances b JOIN inventory_costs ic ON ic.warehouse_id=b.warehouse_id AND ic.variant_id=b.variant_id WHERE b.warehouse_id=$1 AND b.variant_id=$2",
      [warehouseId, ids.variant]);
    assert.equal(state.rowCount, 1);
    assert.deepEqual(state.rows[0], { on_hand: "11.000", quantity: "11.000", average_unit_cost: "5.181818", inventory_value: "57.000000" });
    const movements = await tenant.query("SELECT id::text,movement_type,quantity_delta::text,unit_cost::text,total_cost::text FROM stock_movements WHERE variant_id=$1 AND reference_type::text='STOCKTAKE' AND reference_id=$2::uuid", [ids.variant, stocktakeId]);
    assert.equal(movements.rowCount, 1);
    assert.equal(movements.rows[0].movement_type, "ADJUSTMENT_IN");
    assert.equal(movements.rows[0].quantity_delta, "1.000");
    movementIds = movements.rows.map(row => row.id);
    console.log("UI_FINALIZE_REAL_API=PASS; WAC=5.181818; INVENTORY_VALUE=57.000000; MOVEMENT=ADJUSTMENT_IN");
    await context.close();
  } finally {
    if (browser) await browser.close();
    if (tenant) {
      await cleanup();
      const check = await tenant.query("SELECT (SELECT count(*)::int FROM products WHERE id=$1) AS products,(SELECT count(*)::int FROM product_variants WHERE id=$2) AS variants,(SELECT count(*)::int FROM stock_balances WHERE variant_id=$2) AS balances,(SELECT count(*)::int FROM inventory_costs WHERE variant_id=$2) AS costs,(SELECT count(*)::int FROM stock_movements WHERE variant_id=$2) AS movements,(SELECT count(*)::int FROM stocktake_sessions WHERE id=$3::uuid) AS sessions",
        [ids.product, ids.variant, stocktakeId || "00000000-0000-4000-8000-000000000000"]);
      assert.deepEqual(check.rows[0], { products: 0, variants: 0, balances: 0, costs: 0, movements: 0, sessions: 0 });
      const auditCheck = await tenant.query("SELECT count(*)::int AS count FROM audit_events WHERE (resource_type='StocktakeSession' AND resource_id=$1) OR (resource_type='StockMovement' AND resource_id=ANY($2::text[]))", [stocktakeId || "", movementIds]);
      assert.equal(auditCheck.rows[0].count, 0, "Stocktake or movement audit events were not cleaned up");
      console.log("UI_E2E_FIXTURE_CLEANUP=PASS; AUDIT=0");
      await tenant.end();
    }
    await prisma.$disconnect();
  }
}
main().catch(error => {
  console.error("STOCKTAKE_UI_REAL_API_E2E_FAILED=" + (error?.stack || error?.message || String(error)));
  process.exitCode = 1;
});
