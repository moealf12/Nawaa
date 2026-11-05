# Google Shopping → NAWAA internal card integration (staged, 2026-11-05)

**Project priority:** Google Shopping first. Banggood PR #320 remains on hold.

## Truthful scope

NAWAA now has code for two distinct Google Shopping experiences:

1. **External link handoff:** free browser navigation by a shopper to Google Shopping using their query.
2. **In-NAWAA observation cards:** a server-only SerpApi Google Shopping Results API client that accepts a customer search term, retrieves structured Google Shopping listing data (when enabled and keyed), validates the product-page identity, then displays up to 24 external cards in NAWAA's own search page.

**This is not an official Google API, not direct Google scraping by NAWAA, not Google Merchant API and not merchant-PDP price verification.** Cards show only the search listing's observed price text and never contribute to the cheapest-price ranking. No offer UPSERT, no SSE merge, no index write, no price-history entry, no source registry registration.

## Technical evidence and selection

- Official Google Merchant API https://developers.google.com/merchant/api : manages authorized Merchant Center account products, not all Google Shopping search results.
- SerpApi Google Shopping search results schema https://serpapi.com/shopping-results : `shopping_results` with `title`, `source`, `product_id`, `product_link`, `price`, `extracted_price`, `thumbnail`.
- SerpApi plans https://serpapi.com/pricing : public Free plan of 250 searches/month and up to 50 throughput per hour. This is NOT unlimited. The code reserves a margin at max 200 attempted requests/month and 40 attempted requests/hour **per running server instance** and caches matching query responses for 90 seconds.
- SerpApi's own cache is allowed by default to reduce quota consumption. Its returned search data may be older than the retrieval timestamp; customer-facing prices are explicitly unverified and should not be treated as current checkout prices.
- Zero-cost assurance (Nov 5, 2026): `server/serpapi-free-plan-guard.mjs` verifies the live SerpApi Account API `https://serpapi.com/account.json` **before every cache miss**. The account endpoint itself is documented as free and does not consume search credits: https://serpapi.com/account-api .
- This verification requires an affirmative **Free / $0** account, exact 250 monthly and 50 hourly entitlements, over **50 monthly** and under **40 hourly** used, with fail-closed handling for changed plans, missing fields, quota exhaustion, API errors or invalid JSON. It returns no account identifiers or credentials to customers.
- Account-wide checks reduce multi-instance quota risks, whereas per-process counters alone reset with deployment. **No contract can guarantee unlimited Google Shopping results at $0**; the UI must remain honest if the free quota is insufficient.
- Verify that the signed-up account does not have payment details or automatic paid renewal and that its Free plan permits NAWAA's intended commercial use before activation. Account API free-plan checking is a technical spend guard, not proof of legal licensing or contractual no-billing.
- SerpApi terms https://serpapi.com/legal : downstream display/use rights remain a separate release/legal acceptance item. **Do not deploy the provider-backed cards in production until the account/usage rights are accepted.**
- Google public robots https://www.google.com/robots.txt disallows automated crawling of search/Shopping pages; this candidate never requests those pages directly.

## Code and evidence

- `server/google-shopping-results.mjs`: fixed SerpApi HTTPS endpoint, no user URL selection, server-only key; validate query, Google canonical product URL and matching numeric ID, safe image origin, title, merchant label, currency text, duplicates, response body length and timeout. Per-process quota, per-IP endpoint rate limit, 90-second in-memory result caching and in-flight request dedupe. No retries.
- `server/server.mjs`: `GET /api/discovery/google-shopping?q=<encoded>` uses that client, blocked by default without an active key, explicit `no-store` response and rate limiting. The SerpApi key is never shipped to the browser. Adds `/src/google-shopping-cards.mjs` to public JS allowlist.
- `src/google-shopping-cards.mjs`: escaped HTML, safe Google product link and safe image origins. Separately labeled unverified results without misleading comparisons.
- `search.html` and `src/search-page.mjs`: customer manually selects “عرض المنتجات والأسعار داخل نواة”. One request per action, client-side cancellation on query change, safe failure states and no automatic credit consumption for every typed character. External Google Shopping link remains available.
- `tests/google-shopping-discovery.test.mjs`, `tests/google-shopping-search-ui.test.mjs`, `tests/google-shopping-results.test.mjs`: unit and integration guards. Chromium smoke covers 390px mobile and 1366px desktop with a **deterministic sample provider response; this is not live shopping evidence**.
- `scripts/google-shopping-serpapi-live.mjs`: a bounded **real** SerpApi attempt on exact PR SHA only if `SERPAPI_API_KEY` secret is provided; never persists raw products/key or falsely labels a skipped attempt as success.
- `.github/workflows/google-shopping-discovery.yml`: runs contracts, real Chrome UI, and a secret-gated live single-category search with a machine-readable result artifact.

## Configuration (NO secrets in source)

- GitHub Actions secret: `SERPAPI_API_KEY` (testing).
- Server environment in the intended service: `SERPAPI_API_KEY` plus `NAWAA_GOOGLE_SHOPPING_RESULTS_ENABLED=1` (production/staging activation **not** performed by this PR).
- If either is missing, API returns HTTP 503 with `google_shopping_not_configured`; no source queries or fabricated cards.
- The in-process budget counter resets after a restart. Each upstream request is additionally gated against current provider-wide Free-plan entitlement and remaining allowance. This is **not** proof that an external account could never bill if the account itself is configured to purchase extra usage. For unlimited scale, a shared rate/quota store and a paid plan would be needed. Keep the SerpApi account on the strictly free plan with no auto-renewal.
- Upstream rate, account rights, Google product IDs and actual SKU/PDP parity require live acceptance. Zero-fake policy: no tests based on fixtures may substitute for live source evidence.

## Gate and rollout

1. Exact-head CI tests pass. Verify no regression in production static routes and normal NAWAA search/SSE.
2. Inject the real SerpApi free-tier API key via encrypted runner secret; run actual Google Shopping keyword and verify at least one canonical Google Shopping product with displayed title, merchant label and price text. No API key was present in the first CI live attempt (observed `NOT_TESTED_API_KEY_UNAVAILABLE`), so live acquisition **has not been certified**.
3. Repeat source-backed checks for Arabic and English cross-category queries and confirm actual Saudi locale; reject empty/foreign-language/incorrect-currency claims.
4. Confirm legal/usage rights and source freshness. If direct merchant prices should be ranked against Jarir/eXtra, separately fetch and verify each merchant first-party PDP, exact SKU, currency, stock and MOQ where applicable. This is *not* provided by the Shopping snippets alone.
5. Do not merge/activate/deploy until the project owner explicitly directs it.

**Banggood stays on hold. Main and Render LIVE remain unchanged.**
