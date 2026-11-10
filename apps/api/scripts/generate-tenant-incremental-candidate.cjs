"use strict";
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const normalize = (value) => value.replace(/\r\n/g, "\n").trim();
const baseline = read("apps/api/prisma/tenant/migrations/20261031000100_tenant_baseline.sql");
if (!baseline.includes("CREATE TABLE IF NOT EXISTS tenant_settings")
  || !baseline.includes("CREATE TABLE IF NOT EXISTS audit_events")
  || !baseline.includes("CREATE TABLE IF NOT EXISTS tenant_migrations")) {
  throw new Error("The known Tenant baseline does not match the expected foundation objects.");
}

const clean = read("docs/architecture/tenant-commerce-clean-install.candidate.sql");
const custom = read("docs/architecture/tenant-commerce-custom-constraints.candidate.sql");
const canonical = read("docs/architecture/tenant-canonicalization-constraints.candidate.sql");
const lifecycle = read("docs/architecture/tenant-branch-warehouse-lifecycle.candidate.sql");
const marker = "-- REVIEW CANDIDATE ONLY — CUSTOM INVARIANTS NOT REPRESENTED BY PRISMA.";
const markerIndex = clean.indexOf(marker);
if (markerIndex < 0) throw new Error("Clean-install candidate is missing its shared custom-constraints boundary.");

const commerceBase = clean.slice(0, markerIndex).trimEnd();
const cleanCustom = normalize(clean.slice(markerIndex));
if (cleanCustom !== normalize(custom)) {
  throw new Error("Clean-install custom suffix differs from tenant-commerce-custom-constraints.candidate.sql.");
}
const canonicalSql = normalize(canonical).slice(normalize(canonical).indexOf("DO $$"));
if (!normalize(custom).includes(canonicalSql)) {
  throw new Error("Shared custom candidate is missing the canonicalization constraint source.");
}
if (!normalize(custom).includes(normalize(lifecycle))) {
  throw new Error("Shared custom candidate is missing the Branch/Warehouse lifecycle source.");
}
if (!custom.includes("CREATE EXTENSION IF NOT EXISTS btree_gist")
  || !custom.includes("product_variants_sku_normalized_ck")
  || !custom.includes("variant_barcodes_normalized_ck")) {
  throw new Error("Shared custom candidate is missing required reviewed constraints.");
}

const preflight = `-- Incremental upgrade from the exact Tenant foundation baseline.
-- Review candidate only. It must never be applied to a real Tenant before sign-off.
DO $preflight$
BEGIN
  IF to_regclass('public.tenant_settings') IS NULL
     OR to_regclass('public.audit_events') IS NULL
     OR to_regclass('public.tenant_migrations') IS NULL THEN
    RAISE EXCEPTION 'Expected Tenant foundation baseline is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_migrations WHERE version = '20261031000100_tenant_baseline') THEN
    RAISE EXCEPTION 'Expected baseline migration version is not recorded';
  END IF;
  IF to_regclass('public.stores') IS NOT NULL
     OR to_regclass('public.branches') IS NOT NULL
     OR to_regclass('public.warehouses') IS NOT NULL
     OR to_regclass('public.products') IS NOT NULL THEN
    RAISE EXCEPTION 'Commerce objects already exist; refusing partial or duplicate upgrade';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_migrations WHERE version = '202611030001_tenant_commerce') THEN
    RAISE EXCEPTION 'Tenant Commerce migration version is already recorded';
  END IF;
END
$preflight$;

`;

const output = [
  "-- SYNCUP TENANT COMMERCE INCREMENTAL UPGRADE CANDIDATE",
  "-- Base: apps/api/prisma/tenant/migrations/20261031000100_tenant_baseline.sql",
  "-- Scope: add Commerce schema and reviewed custom invariants without recreating baseline tables.",
  "-- STATUS: REVIEW ONLY — NOT AUTHORIZED FOR REAL TENANT DATABASES.",
  "BEGIN;",
  preflight,
  commerceBase,
  custom.trim(),
  "INSERT INTO public.tenant_migrations(version) VALUES ('202611030001_tenant_commerce');",
  "COMMIT;",
  ""
].join("\n");

const target = path.join(root, "docs/architecture/tenant-commerce-incremental-upgrade.candidate.sql");
fs.writeFileSync(target, output, "utf8");
console.log(`Generated review candidate: ${path.relative(root, target)}`);
