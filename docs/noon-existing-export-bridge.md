# Noon existing-export bridge (Noon integration, staged)

## Reason for this branch

Noon management approval for automated retrieval has been reported by the project owner. Cloud transport trials on GitHub Ubuntu, macOS and Windows returned HTTP 403, while Floot's separate project VM made one direct live search request that timed out after 10 seconds. Those results do not prove that Noon blocks every independent network.

Our earlier `nawaa.noon-sa.approved-feed.v1` JSON **design** would force a merchant to transform its export to our proprietary format. That contradicts the user's requirement that Noon must not need to change its application code. This bridge instead accepts an **existing** CSV, TSV, or JSON export, using schema mapping **inside NAWAA**.

The official Noon affiliate program advertises a detailed product catalog in its dashboard: https://affiliates.noon.com/ar . This does NOT establish the availability of an API or downloadable file, a marketplace-wide product feed, or verified live offer prices. Seller Lab exports are only of the seller's products, not the entire Noon marketplace: https://helpcenter.noon.partners/en/category/product-listing/listing-products-on-noon-faq .

## Source acquisition

Run `node scripts/noon-sa-existing-export-live.mjs` on an approved, genuinely accessible export URL when it exists.

The script uses exactly one HTTPS GET. It never follows redirects; the exact domain must match the configured allowlist. No paid proxies, retry storms, private Noon endpoints, or arbitrary URL fetching. It has a 15s deadline and maximum 8MB download per execution. A real export larger than 8MB will need a streaming multi-part ingestion design **after source access is established**, not silent truncation.

Set the following variables via a secure secret manager, not source code:
- `NOON_EXISTING_EXPORT_URL`: actual authorized HTTPS export/download URL (can contain an existing signed query token).
- `NOON_EXISTING_EXPORT_HOST`: exact hostname from that URL; no wildcards or redirects.
- `NOON_EXISTING_EXPORT_TOKEN`: optional existing Bearer token, not necessary for signed links.
- `NOON_EXISTING_EXPORT_FORMAT`: one of `csv`, `tsv`, `json`.
- `NOON_EXISTING_EXPORT_COLUMNS`: optional JSON mapping from NAWAA's canonical column names to the export's **actual** column names. Canonical keys: `title`, `product_url`, `price`, `currency`, `sku`, `offer_code`, `image_url`, `observed_at`.

CSV/TSV must have a header row. The importer also recognizes common names like `product_name`, `product_link`, `sale_price`, `currency_code`, `noon_sku` and `image_url`. JSON may be an array or an object with an `items`, `products`, `records`, or `data` array. No claim is made that these are Noon's actual export columns.

## Strict integrity

- Only valid Saudi Noon SKU product URLs are accepted. Existing Arabic Saudi locale URLs are canonicalized for identity.
- Product variants with contradictions between title and URL slug are rejected.
- If SKU is included it must match the Noon SKU in the product link.
- An offer-linked price is considered *observed in an export* only with an exact `?o=<offer code>`, positive decimal price and `currency: SAR`.
- A product without exact offer evidence may be counted as discovery evidence but **never as a verified priced offer**.
- A feed observation timestamp is accepted only if explicitly present; importing a file now does **not** prove an old price is current.
- Duplicate conflicting prices or titles for one exact offer are discarded.
- Seller and shipping fields are not read or included in output.
- No offer can be published to NAWAA customers by this code. All records are read-only diagnostics. Source scope, up-to-date prices, buybox parity and Saudi delivery remain unproven until independently verified.

## Execution

`Noon Existing Merchant Export Ingestion` GitHub workflow validates the parser and deliberately confirms that a **missing URL is reported as missing**, without invented data. Once a real export exists, configure GitHub Actions secrets securely, select the workflow and run `workflow_dispatch` on the experimental PR branch. The **live** job fails if access or data validation fails, and archives only counts/error classes and a SHA256 body hash.

No self-asserted approval, successful CI syntax check, feed URL or product discovery proves live integration or customer-publication readiness.

### Stop conditions

No valid export URL, HTTP 401/403/429, invalid host, invalid currency, missing product identity, conflicting offers, stale or unverified offer price, and merchant feed restricted to one seller are all reasons **not to enable** the source. The existing production Noon provider and normal customer search remain untouched.

## Release rule

**No merge/deploy** until multiple live Saudi searches can be answered from a valid, source-authenticated and appropriately scoped catalog, with consistent SKU/variant, offer and price evidence. We do not claim completeness of the Noon marketplace by parsing a limited export.
