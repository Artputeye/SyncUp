import {
  canonicalizeBarcode, canonicalizeBranchCode, canonicalizeCategorySlug,
  canonicalizeQrPayload, canonicalizeSku, canonicalizeStoreSlug,
  canonicalizeUomCode, canonicalizeWarehouseCode, hashQrPayload,
} from "./canonicalization";

function equal(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}`);
}

// Executable contract checks; no test framework dependency is required.
equal(canonicalizeStoreSlug("  My-Store  "), "my-store", "store slug");
equal(canonicalizeCategorySlug(" FOOD "), "food", "category slug");
equal(canonicalizeSku(" Ab-C_01 "), "ab-c_01", "SKU");
equal(canonicalizeBarcode(" 001234567890 "), "001234567890", "barcode leading zeroes");
equal(canonicalizeBarcode(" AbC-01 "), "abc-01", "barcode case");
equal(canonicalizeQrPayload(" 0012/AbC?x=Y "), " 0012/AbC?x=Y ", "QR payload exact preservation");
equal(hashQrPayload("0012"), hashQrPayload("0012"), "QR payload hash determinism");
equal(hashQrPayload("0012") === hashQrPayload("12"), false, "QR leading zeroes affect identity");
equal(canonicalizeUomCode(" Kg "), "kg", "UOM code");
equal(canonicalizeBranchCode(" bkk-01 "), "BKK-01", "branch code");
equal(canonicalizeWarehouseCode(" wh-01 "), "WH-01", "warehouse code");
