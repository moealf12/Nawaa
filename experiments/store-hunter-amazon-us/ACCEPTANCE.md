# NAWAA Amazon US Store Hunter: source integrity and release gate

Scope: Draft PR 312, isolated experimental code. No deployment or merger of production server, frontend, Render, Neon, or ongoing R04 changes.

## Required invariants

1. Source HTTP 503, HTTP 403, HTTP 429, challenge or inaccessible robots means source unavailable, never a product out-of-stock verdict.
2. price_source search_only means one uncorroborated search result. pdp_main_only means a main buybox observation. search_and_pdp_agree means the same ASIN, compatible variant, identical observed price and currency in search and the selected ASIN PDP. None guarantees checkout cost.
3. Never use struck-through MSRP, a price per unit, bundle price, other-seller offers, recommendations or weak JSON-LD/Meta data as if it were the selected ASIN primary price.
4. Distinguish exact/related/unclassified/mismatch and preserve item condition. Never label Portal, PS5 game, SSD or optical repair part as console or complete disc-drive add-on.
5. A conflicting ASIN, explicitly different color, capacity or edition blocks price parity even when title terms overlap.
6. PDP parsing errors are isolated per item. Cancellation propagates. All inconsistent prices fail closed.
7. All requests are for public pages with robots checks, no paid proxy, hidden login, stealth or CAPTCHA defeat. One bounded ordinary Accept negotiation retry after temporary server 5xx; no retry on 403/429/challenge.
8. In-process robots caching (2 minutes) only on confirmed HTTP 200 or genuine 404. Never cache failed robots as allowed. Skip redundant homepage for an explicitly configured Amazon search.
9. The ten-query live test stops after three consecutive terminal search HTTP 503 events; skipped queries remain visible and the live coverage gate fails.

## Approval conditions

- Deterministic unit tests pass at the exact reviewed commit.
- Required PR Gate passes at the same commit.
- Ten independently obtained real queries provide product evidence without invented cards. At least one exact-intent price/image/ASIN card must be observed per query.
- Report completeness, semantic matching, single-source prices, price parity, source failures and unattempted queries SEPARATELY.
- Price-sensitive production acceptance needs independent price provenance evidence and repeated real successes, not just one green batch.
- The experiment is never merged without explicit review and approval.

## External source limitation

The officially supported catalog and featured-offer path is Amazon Creators API (SearchItems, GetItems, GetVariations, OffersV2.Listings.Price.Money). It needs Amazon Associates membership, approved access, eligibility and credentials. No credentials are assumed, stored or transmitted by this PR. Amazon's official US documentation currently states 10 qualifying sales in 30 days as part of API eligibility.

Official docs:
- https://affiliate-program.amazon.com/creatorsapi/docs/en-us/introduction
- https://affiliate-program.amazon.com/creatorsapi/docs/en-us/onboarding
- https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/resources/offersV2

An Amazon HTML PDP with no eligible main offer price cannot be made independently price-verified by loosening numeric/ASIN/variant checks. Source reliability is not under NAWAA's control.

## Optional official API bridge (NOT ACTIVE)

The standalone amazon_creators_official.py implementation uses the official
US marketplace OAuth token and GetItems endpoints and accepts only a single
explicit USD winning featured offer for the exact ASIN. It is not connected
to the live Store Hunter search path and must not be counted as a successful
live connection; its tests use httpx.MockTransport only.

It remains disabled unless approved Creators API access is obtained and these
environment variables are provisioned in a secret store (never GitHub source):
NAWAA_AMAZON_CREATORS_ID, NAWAA_AMAZON_CREATORS_SECRET,
NAWAA_AMAZON_US_PARTNER_TAG; optional credential version
NAWAA_AMAZON_CREATORS_VERSION (3.1 for North America; 3.2 for Europe;
3.3 for Far East). The API path does not claim to verify shopper-specific
checkout prices or shipping costs, and does not claim source availability
until a real authorized test passes.

Only a future approved integration may use this adapter to enrich the
catalog; account eligibility and access must be verified first.

