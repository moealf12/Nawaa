# Shopify vendor, accessory matching and page variants

## Goal and evidence
Continue backend source readiness from production revision `4817d7775df20e50b74658af6be1109112ad75ed`. Spigen and tentree each passed only 3/9 probes in the preceding 72-probe run. Do not change the UI or claim all configured sources are ready.

Current public pages and Ajax product JSON establish these independent defects:

- Spigen charger SKU `ACH10398`, variant `44817398595631`: Ajax `vendor` is `Power`, while JSON-LD `brand` is `Spigen`. The provider incorrectly treats vendor as manufacturer brand. True known brand conflicts must still fail identity checks.
- Spigen case handle `iphone-17-series-case-ultra-hybrid-magfit`: the first available variants are Pro Max; base iPhone 17 variants `44458194370607`, `44458360045615`, `44458370793519` occur later. Matching must happen before the existing three-variant cap.
- That case has product type `Clear Cases`. Current matching classifies it as a phone, and also mistakes `Ultra` in the accessory line `Ultra Hybrid` for an unrequested device variant. A generic `iPhone 17 Series` family prefix must not hide a later explicit `iPhone 17 Pro Max` compatibility label.
- tentree's public page for `forest-flannel-shirt-meteorite-black-rustic-plaid` exposes valid JSON in `initData.productVariants`. Requested variant `43940667982010` has SKU `TCM4546-3560-L`, price amount `58.8`, currency `USD`, and label `METEORITE BLACK RUSTIC PLAID / L`. This is a decimal major-unit amount, not Ajax cents. Its availability is not established by this data.

## Required behavior
1. Preserve Shopify vendor in its own field. Manufacturer brand is null unless explicitly supplied as product brand; never infer it from vendor or merchant name. Vendor-only searches must continue to work.
2. Apply shared strict query matching to available, valid-price variant candidates before selecting at most three per product. Keep existing store/product discovery limits and FX behavior. Do not describe cap exclusions as query mismatches.
3. Recognize plural case/cover product types as accessories. Distinguish a device-model suffix from a word in an accessory's line name. Inspect every explicit model occurrence, excluding only an explicitly labelled generic `Series` family prefix; differing explicit models remain conflicts. A family prefix alone cannot prove an explicitly requested variant.
4. Parse only bounded literal JSON from relevant script `initData` objects; never execute JavaScript. Extract only product variants, not customer/cart/checkout data. Require exactly one requested variant across qualifying blocks, a matching HTTPS merchant/path, no credentials or nonstandard port, and a finite nonnegative price with supported currency. Duplicate IDs, unrelated URLs, malformed JSON, missing IDs, unsupported currencies and unknown variants fail closed.
5. Emit the requested variant's own SKU, title, image if present, price, currency and variant URL into existing `storefront_data` selection. Keep SKU distinct from MPN, retain actual fetched URL provenance and redirect checks, and do not invent availability, shipping, tax or delivery time. Existing JSON-LD and non-Shopify behavior must retain their strict identity rules.

## Acceptance and scope
- Every changed behavior has RED→GREEN regression evidence; the full `npm test` suite is green.
- One fresh whole-branch review, followed by at most one Important/Critical fix pass with regression proof.
- CI, merge and deploy use the existing GitHub repository and free Render service only. No new paid services, permanent audit keys, credentials or scraper-block bypasses.
- Run the unchanged matrix subset for `jarir`, `extra`, `decathlon-sa`, `asos-global`, `shopify:native-union`, `shopify:spigen-us`, `shopify:death-wish-coffee`, `shopify:tentree`: 8 sources × 3 queries × 3 rounds = 72 probes; >=60-second round gaps; same revision and environment.
- Report actual results, including HTTP 503 or any other external failures. A source passes only 9/9; six previously passing sources are regression controls, not assumed passes. Other 21 configured sources remain untested on the new revision.
- Remove the temporary audit key and confirm the private route returns 404 after evidence collection.

## Primary references
- Shopify ProductVariant and MoneyV2 types: https://shopify.dev/docs/api/web-pixels-api/standard-api/init
- Shopify vendor information: https://help.shopify.com/en/manual/products/managing-vendor-info
- Product vendor/variant semantics: https://shopify.dev/docs/api/liquid/objects/product

The specific `initData.productVariants` wrapper is observed merchant-page evidence, not a promised stable Shopify public API.
