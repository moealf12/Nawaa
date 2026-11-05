# NAWAA — Google Shopping direct extraction, authorization claimed by project owner

**Scope:** User reports that Google has agreed to extraction of product name, product image, displayed price, and **original merchant product link**, as discussed for Noon. This is **owner-reported authorization**, not a verified machine-access exemption, allowlisted IP, negotiated endpoint, or documented rate limit.

## Four-field, no-billing acquisition

- `server/providers/google-shopping-authorized.mjs`: Cheerio HTML + JSON-LD Product/Offer parser, preserving co-location of all fields; explicit currency, HTTPS merchant URL, image and product title. Rejects incomplete results, Google Shopping product URLs in place of retailer URLs, malformed data, and interstitials.
- `scripts/google-shopping-authorized-live.mjs`: exactly **two** fixed Google Shopping queries, one Arabic and one English, via native Node.js `fetch`, with a public transparent NAWAA user agent, a hard 8.5-second timeout, 1.2 MB response limit, no cookies, no redirection, no header cycling, no proxies, no API keys, no retries.
- `.github/workflows/google-shopping-authorized-html.yml`: isolated GitHub-hosted CI; outputs counts, access status, currencies and merchant hostnames (never stores raw HTML/product/customer data).
- `tests/google-shopping-authorized-html.test.mjs`: deterministic schema contracts; fixture tests are never represented as real merchant evidence.

**Important distinction:** An owner-reported commercial discussion is evidence of intended permission but does not necessarily bypass technical access gates or prove which collection endpoints are whitelisted. Google robots for the public crawler still disallows automated Shopping search URLs. This **experimental authorized test** acknowledges the owner's statement and does not pretend the public rules have changed. No CAPTCHA evasion, IP rotation or deceptive identity is used.

## Release criteria

1. Two independent live queries must return HTML with **complete, co-located, query-relevant four-field product cards**. A challenge page or empty HTML response is failure, not success.
2. Validate merchant URL host, name, exact variant, price, currency, and date. Google listing snippets are **not** merchant checkout price evidence.
3. Verify a sampling of original first-party merchant PDPs using approved merchant-specific provider logic before considering an offer eligible for cheapest-price ranking.
4. For operational use, record the actual collection method, endpoint, geography, rate limits, user-agent/IP constraints and usage terms covered by the asserted permission. Do not assume unlimited scale or permission to evade protections.
5. Do not merge/deploy without explicit project owner sign-off and successful live acceptance.

**Isolation:** no imports into `server/server.mjs`, `server/source-config.mjs`, `src/source-registry.mjs` or the UI. Existing PRs #320 (Banggood) and #321 (SerpApi cards) unchanged. The earlier public-robots decision gate is preserved in PR #323 as historical evidence; it does not invalidate a separately authorized approach.
