# Google Shopping first — NAWAA staged discovery integration (2026-11-05)

**Priority:** Google Shopping before Banggood. Banggood remains independent Draft PR #320, deferred.

**Scope:** Browser-initiated external Shopping discovery using the customer's precise NAWAA product query, **not** server-side crawling, merchant-offer ingestion, or price comparison. No production activation or merge is authorized.

## Current verification
- Google public robots: https://www.google.com/robots.txt
  - `User-agent: *` blocks `/search`, `/shopping/search`, and most `/shopping` paths for automated crawlers.
- Google Search machine-generated traffic policies: https://developers.google.com/search/docs/essentials/spam-policies
- Official Merchant API: https://developers.google.com/merchant/api/overview
  - Operates on accessible Merchant Center accounts and their product/inventory data. It is **not** a public Google Shopping cross-merchant product search API.
- Shopping prices may be location-sensitive and should be confirmed with the merchant: https://support.google.com/googleshopping/answer/15456476

## Implemented stage
- `src/google-shopping-discovery.mjs`: canonical query normalization, output encoded with `URLSearchParams`, fixed Google domain, Arabic/Saudi localization, rejects pasted URLs/control characters/overlong strings.
- `search.html`: optional Google Shopping discovery lane, distinguished from NAWAA's priced offers. Visible only for meaningful valid query text; a user must click the external link to navigate.
- `src/search-page.mjs`: keeps the link in sync with text input and submitted query; no fetch to Google, no SSE or search registry coupling.
- `tests/google-shopping-discovery.test.mjs`, `tests/google-shopping-search-ui.test.mjs` and `scripts/google-shopping-browser-smoke.mjs`: pure URL safety tests, DOM/source isolation contracts, and real mobile+desktop browser smoke with **all outbound external traffic blocked**.
- No new provider registration, no false price assertions, no image/merchant scraping, no database changes, no dependence on a paid API/proxy.

## Next engineering path for source-backed Google-like shopping comparison
A link to Google's results is useful exploration, but does not satisfy the product requirement of in-NAWAA ranked merchant prices. To attain that, implement direct merchant authorized catalog/product feeds and first-party PDP parity with actual verified SKU, price, currency and timestamp. Google Merchant API alone will not supply a general public Shopping search result set. Any actual Google Shopping product data integration needs a separate legitimate source/license or official approved access scope; no unsupported endpoint assumptions.

## Release acceptance
1. Tests run against exact PR head SHA. Browser must confirm mobile and desktop lane appears on valid query and hides on a product URL.
2. Link target must be `https://www.google.com/search`; `tbm=shop`; exact query; locale `gl=sa,hl=ar`. It is an outbound *manual* discovery link only.
3. Never include `google-shopping` in `configuredProviders`, normalized offers, observed prices, or source coverage totals. No cached Shopping snippets.
4. Leave `main`, Render, and scheduled NAWAA source jobs untouched. **Draft / DO NOT MERGE** until project owner explicitly requests it.
