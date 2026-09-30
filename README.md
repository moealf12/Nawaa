# NAWAA — نواة

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

### Implemented but gated / not active
- Noon Saudi — adapter exists; disabled until reliable Saudi-safe egress is available
- Carrefour KSA — adapter exists; disabled until reliable free egress is available
- eBay — official API adapter exists; requires approved credentials
- Shopify — adapter exists; requires configured store list

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
