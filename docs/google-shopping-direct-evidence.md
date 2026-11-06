# Google Shopping direct extraction — source feasibility (2026-11-05)

## Target and governance

The owner requests a **100% free** direct HTML / JSON-LD / browser extraction from Google Shopping, reusing the acquisition techniques that work for Jarir and Noon UAE. This PR is an **isolated research experiment**; no backend source registration, client-facing Google offer import, merge, paid proxy, API credential or deployment.

## Direct source analysis (official rules)

Google's public crawler instructions: https://www.google.com/robots.txt

- `User-agent: *`: `Disallow: /search`. Thus `https://www.google.com/search?tbm=shop&q=...` is disallowed.
- `Disallow: /shopping/search`. Thus query-indexed Shopping search is disallowed.
- `Disallow: /shopping?` and `Allow: /shopping?udm=28$`. The allow exception is **exactly** `/shopping?udm=28` and does **not** extend to `/shopping?udm=28&q=...`.
- `Disallow: /shopping/product/`. Direct Google Shopping product-detail parity cannot be crawled.
- Google policy also prohibits automated Search traffic without explicit permission: https://developers.google.com/search/docs/essentials/spam-policies#machine-generated-traffic

**HTTP 200 or headless Chromium success do not override a disallow.** Rotating user-agent strings, proxies, fingerprints, cookies, or regional Google domains to bypass those directives is explicitly excluded from this NAWAA experiment.

## Implementation

`src/google-shopping-direct-policy.mjs`: deterministic parser for the public robots group and URL-by-URL matching, full URL query safety, Google origin pinning, `Allow` precedence, `$` end anchors, wildcard rules and explicit failure on missing robots evidence. The arbitrary-query routes can only be fetched if the policy admits them; it does not invent products or scrape unapproved pages.

`scripts/google-shopping-direct-live.mjs`: real GitHub Actions one-shot fetch of `/robots.txt` with NAWAA's transparent user agent, bounded bytes/time, no cookies, no redirects, and **zero requests** to forbidden search/PDP paths. It verifies three arbitrary intents (English smartphone, Arabic audio, mixed gaming). Optionally fetches the **one robot-admitted non-query** `/shopping?udm=28` page and records only sanitized diagnostics (HTML length, title, number of product links and JSON-LD Product elements). An allowed non-query landing is not evidence of arbitrary-query search or sale prices.

`tests/google-shopping-direct-policy.test.mjs`: regression cases for every route, robots wildcard and exact path exception, missing robots fail-closed, arbitrary search queries and isolation from NAWAA customer offer pipeline.

`.github/workflows/google-shopping-direct-live.yml`: deterministic contracts, actual live robots and allowed landing probe, post-run evidence acceptance, and JSON artifact with exact branch SHA.

## Decision gate

- `DIRECT_SEARCH_ROBOTS_BLOCKED` = no legally supported direct Shopping query crawler in current source policy; **do not publish any Google product/price cards from this direct path**.
- `ROBOTS_NOT_ATTESTED` = fail closed; do not assume permission when robots is unreachable.
- `SEARCH_PATH_ADMITTED` in a future changed robots snapshot = **manual policy and usage-rights review is still required before enabling HTTP/Chromium/JSON-LD/offer normalization**.
- No method makes this unlimited, free and authorized just by varying header sets.

For a truly zero-cost, high-coverage NAWAA price comparison: run the **same HTTP → structured data → live merchant PDP parity** pipeline **directly on each merchant's allowed or authorized catalog** (Jarir, eXtra, Noon UAE where allowed) and preserve exact merchant provenance, model/variant, original currency, time, price and image. This is not "Google Shopping search data"; never label it that way.

## Relationship with existing PRs

- Google Shopping SerpApi PR #321: **not** a free unlimited direct extractor, remains Draft and should be held until a deliberate choice.
- Banggood PR #320: remains on hold.
- Production `main`, Render and current R04 work are not modified by this experiment.
