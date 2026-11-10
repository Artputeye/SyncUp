const assert = require("node:assert/strict");
const { test } = require("node:test");
const { ProductCommandService } = require("../dist/core/products/product-command.service");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCT_ID = "33333333-3333-4333-8333-333333333333";
const VARIANT_ID = "44444444-4444-4444-8444-444444444444";

function harness({ primaryBarcode = "OLD-PRIMARY", extraBarcodes = ["EXTRA-KEEP"] } = {}) {
  const state = {
    product: { id: PRODUCT_ID, name: "Test product", description: null, status: "ACTIVE" },
    variant: { id: VARIANT_ID, sku: "TEST-SKU", title: "Test variant", barcode: primaryBarcode, status: "ACTIVE" },
    barcodes: [primaryBarcode, ...extraBarcodes].filter(Boolean).map((barcode) => ({
      variantId: VARIANT_ID,
      barcode,
      normalized: barcode.toLowerCase(),
      symbology: "CODE128",
    })),
  };

  const db = {
    async $transaction(work) {
      const snapshot = structuredClone(state);
      try {
        return await work(db);
      } catch (error) {
        state.product = snapshot.product;
        state.variant = snapshot.variant;
        state.barcodes = snapshot.barcodes;
        throw error;
      }
    },
    async $queryRaw(strings, ...values) {
      const sql = strings.join(" ");
      if (sql.includes("FROM products") && sql.includes("FOR UPDATE")) return [{ ...state.product }];
      if (sql.includes("FROM product_variants") && sql.includes("FOR UPDATE")) return [{ ...state.variant }];
      if (sql.includes("FROM variant_barcodes")) {
        const normalized = values[0];
        return state.barcodes
          .filter((row) => row.normalized === normalized)
          .map((row) => ({ variantId: row.variantId }));
      }
      throw new Error("Unexpected query in barcode regression test: " + sql);
    },
    async $executeRaw(strings, ...values) {
      const sql = strings.join(" ");
      if (sql.includes("DELETE FROM variant_barcodes")) {
        const [, normalized] = values;
        state.barcodes = state.barcodes.filter((row) => row.normalized !== normalized);
      } else if (sql.includes("INSERT INTO variant_barcodes")) {
        const [, barcode, normalized, symbology] = values;
        state.barcodes.push({ variantId: VARIANT_ID, barcode, normalized, symbology });
      } else if (sql.includes("UPDATE variant_barcodes")) {
        const [barcode, symbology, , normalized] = values;
        const row = state.barcodes.find((item) => item.normalized === normalized);
        if (row) {
          row.barcode = barcode;
          row.symbology = symbology;
        }
      } else if (sql.includes("UPDATE product_variants")) {
        state.variant = { ...state.variant, sku: values[0], title: values[2], barcode: values[3], status: values[4] };
      } else if (sql.includes("UPDATE products")) {
        state.product = { ...state.product, name: values[0], description: values[1], status: values[2] };
      } else if (!sql.includes("INSERT INTO audit_logs")) {
        throw new Error("Unexpected write in barcode regression test: " + sql);
      }
      return 1;
    },
  };

  const databases = { forMembership: async () => db };
  const queries = { getProduct: async () => ({ product: state.product, variant: state.variant, barcodes: state.barcodes }) };
  return { service: new ProductCommandService(databases, queries), state };
}

function input(barcode) {
  return {
    name: "Updated test product",
    description: "Regression test",
    status: "ACTIVE",
    variant: { id: VARIANT_ID, sku: "TEST-SKU", title: "Test variant", barcode },
  };
}

test("changing primary barcode removes only the previous primary and preserves additional barcodes", async () => {
  const { service, state } = harness();
  await service.updateProduct(USER_ID, WORKSPACE_ID, PRODUCT_ID, input("NEW-PRIMARY"));

  assert.equal(state.variant.barcode, "NEW-PRIMARY");
  assert.deepEqual(state.barcodes.map((row) => row.normalized).sort(), ["extra-keep", "new-primary"]);
});

test("clearing primary barcode preserves all additional barcodes", async () => {
  const { service, state } = harness();
  await service.updateProduct(USER_ID, WORKSPACE_ID, PRODUCT_ID, input(null));

  assert.equal(state.variant.barcode, null);
  assert.deepEqual(state.barcodes.map((row) => row.normalized), ["extra-keep"]);
});

test("keeping the same primary barcode does not delete additional barcodes", async () => {
  const { service, state } = harness();
  await service.updateProduct(USER_ID, WORKSPACE_ID, PRODUCT_ID, input("OLD-PRIMARY"));

  assert.equal(state.variant.barcode, "OLD-PRIMARY");
  assert.deepEqual(state.barcodes.map((row) => row.normalized).sort(), ["extra-keep", "old-primary"]);
});

test("using a barcode owned by another variant is rejected without changing stored barcodes", async () => {
  const { service, state } = harness();
  state.barcodes.push({
    variantId: "55555555-5555-4555-8555-555555555555",
    barcode: "TAKEN",
    normalized: "taken",
    symbology: "CODE128",
  });
  const before = structuredClone(state.barcodes);

  await assert.rejects(
    service.updateProduct(USER_ID, WORKSPACE_ID, PRODUCT_ID, input("TAKEN")),
    (error) => error.getStatus?.() === 409,
  );
  assert.deepEqual(state.barcodes, before);
});
