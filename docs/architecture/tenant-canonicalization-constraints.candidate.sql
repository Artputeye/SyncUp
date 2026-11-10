-- REVIEW CANDIDATE ONLY — merge into custom constraints after reconciliation.
-- QR payload hash is application-generated from exact UTF-8 bytes; no pgcrypto dependency.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stores_slug_canonical_ck') THEN
    ALTER TABLE public.stores ADD CONSTRAINT stores_slug_canonical_ck
      CHECK (normalized_slug = lower(btrim(slug)) AND normalized_slug ~ '^[a-z0-9-]+$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_categories_slug_canonical_ck') THEN
    ALTER TABLE public.store_categories ADD CONSTRAINT store_categories_slug_canonical_ck
      CHECK (normalized_slug = lower(btrim(slug)) AND normalized_slug ~ '^[a-z0-9-]+$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'branches_code_canonical_ck') THEN
    ALTER TABLE public.branches ADD CONSTRAINT branches_code_canonical_ck
      CHECK (code = upper(btrim(code)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouses_code_canonical_ck') THEN
    ALTER TABLE public.warehouses ADD CONSTRAINT warehouses_code_canonical_ck
      CHECK (code = upper(btrim(code)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'variant_qr_codes_payload_ck') THEN
    ALTER TABLE public.variant_qr_codes ADD CONSTRAINT variant_qr_codes_payload_ck
      CHECK (length(payload) > 0 AND payload_hash ~ '^[0-9a-f]{64}$');
  END IF;
END $$;
