"use strict";

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { Client } = require("pg");
const { PrismaClient } = require("@prisma/client");
const { ProductQueryService } = require("../dist/core/products/product-query.service");
const { ProductCommandService } = require("../dist/core/products/product-command.service");

const adminUrl = process.env.TEST_POSTGRES_ADMIN_URL;
if (!adminUrl) throw new Error("TEST_POSTGRES_ADMIN_URL is required");

const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = "/syncup_product_it";

const userId = randomUUID();
const uomId = randomUUID();
const uomCode = "IT" + randomUUID().replace(/-/g, "").slice(0, 18).toUpperCase();
const uomNormalized = uomCode.toLowerCase();
const pg = new Client({ connectionString: databaseUrl.toString() });
const prisma = new PrismaClient({ datasourceUrl: databaseUrl.toString() });
let pgConnected = false;

const databaseRegistry = {
  async forMembership() {
    return prisma;
  },
};
const queries = new ProductQueryService(databaseRegistry);
const commands = new ProductCommandService(databaseRegistry, queries);

function productInput(name, sku, barcode) {
  return {
    name,
    description: "PostgreSQL integration test",
    status: "ACTIVE",
    variant: { sku, title: name, barcode, uomCode },
  };
}

function errorMessage(error) {
  return [error?.message, error?.cause?.message, error?.meta?.message]
    .filter(Boolean)
    .join(" | ");
}

async function expectConflict(label, operation, expectedMessage) {
  let error;
  try {
    await operation();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, label + ": expected a conflict but operation succeeded");
  const status =
    typeof error.getStatus === "function" ? error.getStatus() : error.status;
  assert.equal(status, 409, label + ": expected HTTP 409, got " + errorMessage(error));
  assert.ok(
    errorMessage(error).includes(expectedMessage),
    label + ": expected message containing " + expectedMessage + ", got " + errorMessage(error),
  );
  return error;
}

async function count(sql, values = []) {
  const result = await pg.query(sql, values);
  return Number(result.rows[0].count);
}

async function variantRow(variantId) {
  const result = await pg.query(
    "SELECT sku, normalized_sku, barcode FROM product_variants WHERE id = $1::uuid",
    [variantId],
  );
  assert.equal(result.rowCount, 1, "expected test variant row to exist");
  return result.rows[0];
}

async function barcodeValues(variantId) {
  const result = await pg.query(
    "SELECT barcode, normalized FROM variant_barcodes WHERE variant_id = $1::uuid ORDER BY normalized",
    [variantId],
  );
  return result.rows;
}

function updateInput(product, variantId, sku, barcode) {
  return {
    name: product.name,
    description: product.description,
    status: product.status,
    variant: {
      id: variantId,
      sku,
      title: product.variants[0].title,
      barcode,
    },
  };
}

async function cleanup() {
  await pg.query("DROP TRIGGER IF EXISTS test_reject_rollback_probe ON audit_logs");
  await pg.query("DROP FUNCTION IF EXISTS test_reject_rollback_probe()");
  await pg.query("DELETE FROM audit_logs WHERE actor_user_id = $1::uuid", [userId]);
  await pg.query(
    "DELETE FROM variant_barcodes WHERE variant_id IN (" +
      "SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id " +
      "WHERE p.name LIKE 'IT-%')",
  );
  await pg.query(
    "DELETE FROM variant_uoms WHERE variant_id IN (" +
      "SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id " +
      "WHERE p.name LIKE 'IT-%')",
  );
  await pg.query(
    "DELETE FROM product_variants WHERE product_id IN " +
      "(SELECT id FROM products WHERE name LIKE 'IT-%')",
  );
  await pg.query("DELETE FROM products WHERE name LIKE 'IT-%'");
  await pg.query("DELETE FROM unit_of_measures WHERE id = $1::uuid", [uomId]);
}

async function main() {
  await pg.connect();
  pgConnected = true;
  await prisma.$connect();

  assert.equal(
    await count("SELECT COUNT(*)::int AS count FROM products"),
    0,
    "test database must start with no products",
  );

  await pg.query(
    "INSERT INTO unit_of_measures " +
      "(id, code, normalized_code, name, symbol, dimension, decimal_places, status, is_system, updated_at) " +
      "VALUES ($1::uuid, $2, $3, 'Integration Test Each', 'ea', 'COUNT', 0, 'ACTIVE', false, NOW())",
    [uomId, uomCode, uomNormalized],
  );

  // Inject a failure at the final audit write, after all catalog writes.
  await pg.query(
    "CREATE FUNCTION test_reject_rollback_probe() RETURNS trigger LANGUAGE plpgsql AS $$ " +
      "BEGIN IF NEW.action = 'PRODUCT_CREATED' AND NEW.after->>'name' = 'IT-Rollback Probe' " +
      "THEN RAISE EXCEPTION 'intentional integration-test rollback'; END IF; RETURN NEW; END; $$",
  );
  await pg.query(
    "CREATE TRIGGER test_reject_rollback_probe BEFORE INSERT ON audit_logs " +
      "FOR EACH ROW EXECUTE FUNCTION test_reject_rollback_probe()",
  );

  let rollbackError;
  try {
    await commands.createProduct(
      userId,
      "integration-test-workspace",
      productInput("IT-Rollback Probe", "IT-ROLLBACK-SKU", "IT-ROLLBACK-BC"),
    );
  } catch (error) {
    rollbackError = error;
  }
  assert.ok(rollbackError, "rollback probe must fail");
  assert.match(
    errorMessage(rollbackError),
    /intentional integration-test rollback/i,
    "rollback must be caused by the deliberate audit trigger",
  );
  assert.equal(await count("SELECT COUNT(*)::int AS count FROM products WHERE name = 'IT-Rollback Probe'"), 0);
  assert.equal(await count("SELECT COUNT(*)::int AS count FROM product_variants WHERE normalized_sku = 'it-rollback-sku'"), 0);
  assert.equal(await count("SELECT COUNT(*)::int AS count FROM variant_uoms WHERE variant_id IN (SELECT id FROM product_variants WHERE normalized_sku = 'it-rollback-sku')"), 0);
  assert.equal(await count("SELECT COUNT(*)::int AS count FROM variant_barcodes WHERE normalized = 'it-rollback-bc'"), 0);
  assert.equal(await count("SELECT COUNT(*)::int AS count FROM audit_logs WHERE actor_user_id = $1::uuid AND action = 'PRODUCT_CREATED'", [userId]), 0);
  console.log("PASS transaction rollback: deliberate audit failure rolled back every prior write");

  await pg.query("DROP TRIGGER test_reject_rollback_probe ON audit_logs");
  await pg.query("DROP FUNCTION test_reject_rollback_probe()");

  const skuOwner = await commands.createProduct(
    userId,
    "integration-test-workspace",
    productInput("IT-Duplicate SKU Owner", "IT-SKU-DUP", "IT-SKU-OWNER-BC"),
  );
  const skuTarget = await commands.createProduct(
    userId,
    "integration-test-workspace",
    productInput("IT-Duplicate SKU Target", "IT-SKU-TARGET", "IT-SKU-TARGET-BC"),
  );

  await expectConflict(
    "duplicate normalized SKU on create",
    () => commands.createProduct(
      userId,
      "integration-test-workspace",
      productInput("IT-Duplicate SKU Create Rejected", "it-sku-dup", "IT-SKU-CREATE-BC"),
    ),
    "SKU นี้มีอยู่ใน Workspace แล้ว",
  );
  assert.equal(await count("SELECT COUNT(*)::int AS count FROM products WHERE name = 'IT-Duplicate SKU Create Rejected'"), 0);

  const skuTargetVariantId = skuTarget.variants[0].id;
  await expectConflict(
    "duplicate normalized SKU on update",
    () => commands.updateProduct(
      userId,
      "integration-test-workspace",
      skuTarget.id,
      updateInput(skuTarget, skuTargetVariantId, "it-sku-dup", "IT-SKU-TARGET-BC"),
    ),
    "SKU นี้มีอยู่ใน Workspace แล้ว",
  );
  const skuTargetAfterConflict = await variantRow(skuTargetVariantId);
  assert.equal(skuTargetAfterConflict.normalized_sku, "it-sku-target");
  assert.equal(skuTargetAfterConflict.sku, "IT-SKU-TARGET");
  assert.deepEqual(await barcodeValues(skuTargetVariantId), [
    { barcode: "IT-SKU-TARGET-BC", normalized: "it-sku-target-bc" },
  ]);
  assert.equal(await count("SELECT COUNT(*)::int AS count FROM products WHERE id = $1::uuid", [skuOwner.id]), 1);
  console.log("PASS duplicate SKU: create and update reject case-insensitive duplicates without partial writes");

  const barcodeOwner = await commands.createProduct(
    userId,
    "integration-test-workspace",
    productInput("IT-Duplicate Barcode Owner", "IT-BC-OWNER-SKU", "IT-BC-DUP"),
  );
  const barcodeTarget = await commands.createProduct(
    userId,
    "integration-test-workspace",
    productInput("IT-Duplicate Barcode Target", "IT-BC-TARGET-SKU", "IT-BC-TARGET"),
  );

  await expectConflict(
    "duplicate normalized barcode on create",
    () => commands.createProduct(
      userId,
      "integration-test-workspace",
      productInput("IT-Duplicate Barcode Create Rejected", "IT-BC-CREATE-SKU", "it-bc-dup"),
    ),
    "บาร์โค้ดนี้ถูกใช้แล้ว",
  );
  assert.equal(await count("SELECT COUNT(*)::int AS count FROM products WHERE name = 'IT-Duplicate Barcode Create Rejected'"), 0);

  const barcodeTargetVariantId = barcodeTarget.variants[0].id;
  await expectConflict(
    "duplicate normalized barcode on update",
    () => commands.updateProduct(
      userId,
      "integration-test-workspace",
      barcodeTarget.id,
      updateInput(barcodeTarget, barcodeTargetVariantId, "IT-BC-TARGET-SKU", "it-bc-dup"),
    ),
    "บาร์โค้ดนี้ถูกใช้แล้ว",
  );
  const barcodeTargetAfterConflict = await variantRow(barcodeTargetVariantId);
  assert.equal(barcodeTargetAfterConflict.barcode, "IT-BC-TARGET");
  assert.deepEqual(await barcodeValues(barcodeTargetVariantId), [
    { barcode: "IT-BC-TARGET", normalized: "it-bc-target" },
  ]);
  assert.equal(await count("SELECT COUNT(*)::int AS count FROM variant_barcodes WHERE normalized = 'it-bc-dup'"), 1);
  assert.equal(await count("SELECT COUNT(*)::int AS count FROM products WHERE id = $1::uuid", [barcodeOwner.id]), 1);
  console.log("PASS duplicate barcode: create and update reject duplicates and preserve original barcode rows");

  const multi = await commands.createProduct(
    userId,
    "integration-test-workspace",
    productInput("IT-Multiple Barcode Preservation", "IT-MULTI-SKU", "IT-PRIMARY-OLD"),
  );
  const multiVariantId = multi.variants[0].id;
  await pg.query(
    "INSERT INTO variant_barcodes (id, variant_id, barcode, normalized, symbology) " +
      "VALUES ($1::uuid, $2::uuid, 'IT-SECONDARY-KEEP', 'it-secondary-keep', 'CODE128')",
    [randomUUID(), multiVariantId],
  );

  const updated = await commands.updateProduct(
    userId,
    "integration-test-workspace",
    multi.id,
    updateInput(multi, multiVariantId, "IT-MULTI-SKU", "IT-PRIMARY-NEW"),
  );
  assert.deepEqual(
    updated.variants[0].barcodes.map((item) => item.barcode).sort(),
    ["IT-PRIMARY-NEW", "IT-SECONDARY-KEEP"].sort(),
  );
  assert.deepEqual(
    (await barcodeValues(multiVariantId)).map((item) => item.normalized),
    ["it-primary-new", "it-secondary-keep"],
  );
  assert.equal(
    await count("SELECT COUNT(*)::int AS count FROM variant_barcodes WHERE variant_id = $1::uuid", [multiVariantId]),
    2,
  );
  console.log("PASS multiple barcodes: updating primary barcode preserved the secondary barcode");

  console.log("RESULT 6/6 PostgreSQL Product Management integration scenarios passed");
}

main()
  .catch((error) => {
    console.error("FAIL PostgreSQL Product Management integration:", error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (pgConnected) await cleanup();
    } catch (error) {
      console.error("CLEANUP_WARNING:", error.message);
      process.exitCode = 1;
    }
    await prisma.$disconnect().catch(() => {});
    await pg.end().catch(() => {});
  });
