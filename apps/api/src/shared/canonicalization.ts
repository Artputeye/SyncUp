import { createHash } from "node:crypto";

/** Canonical keys shared by API, CSV import and image-folder mapping. */
export function canonicalizeStoreSlug(value: string): string {
  const result = value.trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(result)) throw new Error("Store slug may contain only a-z, 0-9 and hyphens.");
  return result;
}
export const canonicalizeCategorySlug = canonicalizeStoreSlug;
export function canonicalizeSku(value: string): string { return value.trim().toLowerCase(); }
/** Barcode is text: never parse it as a number or remove leading zeroes. */
export function canonicalizeBarcode(value: string): string { return value.trim().toLowerCase(); }
/** QR payload is opaque: preserve every character, case and whitespace. */
export function canonicalizeQrPayload(value: string): string {
  if (value.length === 0) throw new Error("QR payload must not be empty.");
  return value;
}
/** Stable unique lookup key for arbitrarily long QR payloads. */
export function hashQrPayload(value: string): string {
  return createHash("sha256").update(canonicalizeQrPayload(value), "utf8").digest("hex");
}
export function canonicalizeUomCode(value: string): string { return value.trim().toLowerCase(); }
export function canonicalizeBranchCode(value: string): string { return value.trim().toUpperCase(); }
export const canonicalizeWarehouseCode = canonicalizeBranchCode;
