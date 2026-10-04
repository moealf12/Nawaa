# NAWAA — نواة

## Verified code update — 2026-10-04

Current code supersedes the older snapshots below. `npm test` discovers every
`tests/*.test.mjs` file, including Amazon and crawler regressions. CI installs
locked dependencies before testing.

- Amazon cards support heading-only names, select the current price rather than
  a crossed-out list price, and keep URLs on the matching Amazon listing.
- eXtra follows catalog pagination within a shared 6.5-second acquisition budget;
  collected results survive later-page errors. Missing prices are not zero.
- Structured-price storefront results are no longer cut to four. Product-page
  resolution remains bounded separately. This is not exhaustive crawling.
- Runtime source coverage includes enabled direct storefronts, including Amazon
  and GCC stores; configured does not mean live-certified.
- Persisted/indexed recall retains its provenance and observation timestamp and
  is not written back as a new live observation.
- Public diagnostics include isolated Amazon failures, per-provider counts and
  acquisition limits. `coverage.truncated` describes final selection only;
  `coverage.exhaustive` is false because upstream acquisition is bounded.
- URL resolution rejects IPv4-mapped private addresses, multicast and non-global
  IPv6 destinations. This does not constitute a complete security audit.

Implemented in the 2026-10-04 hardening merge:
- Signed cursor-based remote expansion now requests progressively deeper acquisition from the backend.
- Search depth is cache-aware and increases Amazon pages, storefront fanout, product-page verification budget, and response window.
- Request-level rate limiting protects search, URL resolution, ingest, and source-audit paths.
- Product-page HTTPS resolution pins the validated public DNS address for the connection and revalidates redirects.
- The frontend can automatically deepen an empty first pass and exposes a real remote expansion action instead of only revealing already-acquired cards.
- Public source audit is disabled unless explicitly enabled.

Still intentionally bounded: Amazon/Jarir/storefront acquisition is progressive rather than exhaustive, and each live merchant remains subject to source-by-source production certification because external storefront behavior can change.


Saudi-first product discovery, sourcing, and price-comparison prototype.

## Current production state — 2026-10-01

### Live frontend
- GitHub Pages: https://moealf12.github.io/Nawaa/
- Search: https://moealf12.github.io/Nawaa/search.html
- Product details: https://moealf12.github.io/Nawaa/product.html
- Same-origin Render search fallback: https://nawaa-search-api.onrender.com/search.html

### Live backend
- Render service: https://nawaa-search-api.onrender.com
- Health: /health
- Search: /api/search?q=...
- URL resolver: /api/resolve-url?url=...

### Active live providers
These adapters are currently enabled without extra paid APIs:
- eXtra Saudi — Unbxd site-search adapter
- Jarir Saudi — Constructor site-search adapter with HTML fallback
- Sharaf DG Saudi — Algolia catalog adapter
- Swarovski Saudi — direct official storefront search adapter

### Implemented but gated / not active
- Amazon Creators API — official catalog adapter supports SA, AE, US, CA, UK, DE, FR, IT, ES, JP, IN, SG, AU and EG; requires Creators API credentials plus a Partner Tag for each enabled marketplace
- Zero-cost storefront discovery — public search pages from supported stores are queried directly; discovered pages become offers only after NAWAA verifies structured product/price data on the product page
- Noon Saudi — adapter exists; disabled until reliable Saudi-safe egress is available
- Carrefour KSA — adapter exists; disabled until reliable free egress is available
- eBay — official API adapter exists; requires approved credentials
- Shopify — adapter exists; requires configured store list

### Federated universal search
NAWAA does not trust search-engine snippets as prices. Search is layered:

1. Direct merchant/marketplace APIs and catalog adapters.
2. Official Amazon Creators API when eligible credentials are configured; no paid search provider is required.
3. Zero-cost direct storefront discovery across supported public store search pages such as SHEIN, AliExpress, Temu, iHerb, IKEA, ASOS, Farfetch, Etsy, Newegg, B&H, Walmart, Best Buy, adidas, Nike and Sephora.
4. Every discovered URL must pass the product-page resolver and expose structured price data before it becomes a comparable offer.
5. All candidates are scored against the original customer query even when a broader fallback query was needed to discover them.
6. If a public storefront blocks automated access or exposes no verifiable product price, NAWAA skips it rather than inventing or trusting a search snippet.

This keeps broad coverage separate from product identity and price integrity.

### Search intelligence implemented
- Query normalization and exact/probable match confidence
- Unrequested variant demotion (Pro / Pro Max / Air / accessories)
- Offer normalization and deduplication
- Variant grouping by brand + model + storage + color + condition
- SKU-aware grouping so materially different model numbers are not merged
- Multi-variant configurator: model → storage → color → condition → SKU
- Canonical product profile merging specs across merchants, with conflicts exposed
- Offer Intelligence: price delta, availability, Jeddah stock where known, delivery/pickup signals, incomplete-cost warnings
- Saudi landed-cost guardrails: never call an offer “cheapest final” if shipping/tax/mandatory fees are unknown
- Local device price history for live/verified offers
- Visible “all exact matches” grid plus the smart configurator
- Product detail snapshot page
- Quote handoff remains a local draft only

### Comparison integrity
Comparable total:

```
product price
+ shipping
+ import cost
+ tax
+ mandatory fees
- confirmed discount
```

An incomplete advertised price must not be described as the final cheapest delivered price.

### Current live example
For the query `iPhone 17 256GB`, the live API currently returns results from Sharaf DG, eXtra, and Jarir. Exact matches are separated by SKU where model numbers differ.

### Reliability note
GitHub Pages calls the Render API cross-origin. Some embedded iOS browsers may interrupt that request before it reaches Render. The backend now also serves the search frontend directly from the Render origin so the page and API can operate same-origin. When GitHub Pages cannot reach the live API, the UI must show an explicit error and must never silently substitute Demo data.

### Tests / CI
`npm test` runs:
- search-core tests
- provider parser/normalization tests

GitHub Actions also syntax-checks browser modules and all active/gated provider modules.

### Not implemented yet
- Shared server-side price-history database
- Price-drop notifications
- Real checkout/payment/order flow
- Persistent server-side quotation workflow on this public GitHub implementation
- Fully confirmed shipping/tax/duty for every merchant
- Global live provider coverage
- eBay live traffic until credentials are approved/configured

### Near-term priorities
1. Stabilize same-origin mobile search path.
2. Increase reliable Saudi live sources without paid dependencies.
3. Improve merchant availability/shipping confirmation.
4. Move price history from local device storage to shared persistence when a zero-cost durable option is selected.
5. Keep SKU/product identity stricter than price ranking.

## Stabilization update — 2026-10-01

- Arabic product aliases, Arabic/Persian digits, colors and capacities are normalized before provider calls and identity checks.
- Identity matching uses whole tokens; `iPhone 170` is not a match for `iPhone 17`.
- `/api/search?url=...` resolves a product URL, searches the available retailers, retains the source offer and demotes conflicting SKUs or conditions.
- `discount` is an additional confirmed deduction. Already-applied sale savings are stored as `advertisedDiscount`, avoiding double subtraction.
- Unknown shipping eligibility or stock cannot earn a confirmed-total badge.
- Homepage search and deep links open the same live comparison UI. The original private Site serves this UI with a fixed same-origin proxy and retains its existing request/admin database.
- Quote buttons prefill the original Site's request form. They never submit an order automatically.
- Search history storage is optional; blocked browser storage does not prevent search.
- `npm test` includes regression and UI-controller integration checks.


### Optional production environment variables

Global discovery:
- No paid search API key is required. Direct public storefront adapters are the default discovery layer.

Amazon Creators API:
- `AMAZON_CREATORS_CLIENT_ID`
- `AMAZON_CREATORS_CLIENT_SECRET`
- `AMAZON_CREATORS_VERSION` (3.1, 3.2 or 3.3 according to the issued credential)
- Marketplace Partner Tags as needed: `AMAZON_PARTNER_TAG_SA`, `AMAZON_PARTNER_TAG_AE`, `AMAZON_PARTNER_TAG_US`, `AMAZON_PARTNER_TAG_CA`, `AMAZON_PARTNER_TAG_UK`, `AMAZON_PARTNER_TAG_DE`, `AMAZON_PARTNER_TAG_FR`, `AMAZON_PARTNER_TAG_IT`, `AMAZON_PARTNER_TAG_ES`, `AMAZON_PARTNER_TAG_JP`, `AMAZON_PARTNER_TAG_IN`, `AMAZON_PARTNER_TAG_SG`, `AMAZON_PARTNER_TAG_AU`, `AMAZON_PARTNER_TAG_EG`.

No credential is ever exposed to the browser.


### Zero-cost constraint

NAWAA's default search stack is designed to run without paid search/data APIs. Direct merchant adapters, public storefront discovery, structured product-page verification, configured Shopify storefronts, and approved free-access marketplace APIs are preferred. A source that requires a paid subscription is not part of the default search path.
