# pos-local Alcohol Sample Catalog Setup — 2026-11-11

## Result

**PASS — draft catalog placeholders created** in Workspace `pos-local`, Tenant DB `syncup_ws_c0130bf3c1c0`, Store `Main Store`.

Created category:
- Name: `เครื่องดื่มแอลกอฮอล์`
- Slug: `alcoholic-beverages`
- Category status: `ACTIVE`

Created four placeholder products and linked each to the Store category:
| Product placeholder | SKU | Product / Variant / Store status |
|---|---|---|
| เบียร์ (รอระบุยี่ห้อ/ขนาด) | `ALC-BEER-DRAFT` | DRAFT |
| ไวน์ (รอระบุยี่ห้อ/ขนาด) | `ALC-WINE-DRAFT` | DRAFT |
| วิสกี้ (รอระบุยี่ห้อ/ขนาด) | `ALC-WHISKY-DRAFT` | DRAFT |
| สุรา (รอระบุยี่ห้อ/ขนาด) | `ALC-SPIRIT-DRAFT` | DRAFT |

## Safety boundaries

- Product, variant, Store Product and Store Product Variant remain `DRAFT`; not sellable and not published.
- `EA` is a temporary base UOM only. Actual package/unit and conversion must be confirmed.
- No brand, barcode, volume, ABV, price, tax category, tax profile, tax rate, or opening stock was invented.
- Product prices: 0; stock balance rows for these SKUs: 0.
- Audit log contains one `PRODUCT_CREATED` event per product; category creation is also audited.
- No schema migration, permission change, deployment, commit or push was performed.

## Backup

- File: `D:\Back up\SyncUp\Backups\pos-local_pre_alcohol_catalog_20261111094345.dump`
- Format: pg_dump custom
- Size: 166,715 bytes
- SHA256: `052606b66991bb8ece1d837e6c4594c9375acfcad638248bcb9a459ed1998829`
- `pg_restore --list`: PASS
- Backup is local and **not encrypted**. Off-host encrypted backup remains a Production Go-Live blocker.

## Implementation and verification

- Guarded script: `apps/api/scripts/create-pos-local-alcohol-sample-catalog.cjs`
- Default execution is dry-run. Live execution requires explicit workspace and exact SKU confirmations.
- Live apply: `POS_LOCAL_ALCOHOL_SAMPLE_CATALOG_APPLY_PASS`
- Independent post-apply read-only verification: 4/4 products, all DRAFT, all linked to the category, 0 prices, 0 stock rows, audit present.
- `node --check`: PASS
- `git diff --check`: PASS

## Required before activation

Replace placeholder names/SKUs with actual brands, package sizes and business SKU codes; confirm UOM/conversion, tax treatment, lawful sale conditions and required age/sales controls, then set prices and opening stock. Review the final change list and obtain approval before activating or publishing any product.
