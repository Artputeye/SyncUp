# pos-local Production Data Intake

Workspace: pos-local. Prepared: 2026-11-11.

These files are intake and review templates, not a bulk-import feature. No live rows have been written.

## Files
- products.csv: product, SKU, barcode, variant, UOM and tax category.
- tax_setup.csv: tax profile, tax mode, rounding, categories, rates and effective dates.
- store_prices.csv: store, SKU, UOM, currency, selling price and effective dates.
- opening_stock.csv: SKU, opening quantity and unit cost.

## Offline preflight
From the repository root, run:

    node docs/operations/pos-local-data-intake-2026-11-11/validate-intake.cjs

Or pass another folder containing the four CSV files:

    node docs/operations/pos-local-data-intake-2026-11-11/validate-intake.cjs path/to/intake

The validator checks exact headers, CSV quoting/column counts, required values, enum values, numeric/date formats, duplicate keys, and SKU/UOM/tax-category references across files. It has no database connection and never changes the CSVs or application database. TEMPLATE_ONLY means only headers are present; VALIDATION_PASS means the supplied rows passed these local checks, not that they are approved or ready to import. BLOCKED means errors were found.

## Data rules
- Save as UTF-8 CSV; use dot decimals and ISO 8601 dates with timezone.
- tax_mode: VAT or NO_VAT; price_tax_mode: INCLUSIVE or EXCLUSIVE.
- rounding_level: DOCUMENT; rounding_method: HALF_UP.
- uom_type: BASE, SELL, PURCHASE or SELL_AND_PURCHASE. conversion_to_base is base units per selected UOM.
- Do not guess missing commercial or tax values. Confirm before submission.
- TEST-EA-001 is an existing test product, not approved live merchandise.

## Import limitation
opening_stock.csv uses the exact Opening Stock importer headers: sku,quantity,unitCost. Product, tax and price files are intake templates only; no bulk importer exists for them yet.

Sending completed files authorizes review only. Before any pos-local write, a validated preview and change list will be presented for explicit approval.

## Audit snapshot
Main Store, HQ and MAIN are ACTIVE. No Tax Category/Profile/Rate, Store Product/Variant, Product Price or Stock Balance exists. Two products exist: one ACTIVE test SKU and one ARCHIVED product. Sales tables are empty.

## Important
The validator performs structural and cross-file checks only. It does not verify live Store IDs, existing database records, tax/legal correctness, user authorization, available inventory, or whether a product should be published. A passing report is not permission to write production data.
