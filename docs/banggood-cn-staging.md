# NAWAA Banggood China — independent source feasibility

**State:** EXPERIMENTAL_RESEARCH_ONLY / NO_PRODUCTION_CHANGES / NO_MERGE.

## Selection rationale (2026-11-05)
- Banggood is not listed in NAWAA's main source registry.
- Its public category pages expose multiple real products across consumer electronics and accessories:
  - https://www.banggood.com/buy/headphones.html
  - https://www.banggood.com/buy/drones.html
- Official Banggood affiliate API page: https://www.banggood.com/Affiliate-promo-tools-api.html
  - Officially describes **Items API** with keyword/category search, product data, and separate order/coupon APIs.
  - Joining process: register, apply as partner, obtain `Appid` and `AppSecret`.
  - No credentials, product feed permissions, rate limits, endpoint schemas or live API responses have been supplied or verified yet.

## Critical feasibility distinction
- The official Terms of Service prohibit systematic retrieval of site content for a directory/database without written permission. Prefer approved affiliate search/items API or supplied product data feed to scraping. A browser-accessible category page **does not** demonstrate programmatic reuse rights.
- Source must be generic across arbitrary shopper queries, not designed around a handful of product examples.
- No presumption that a product can ship to Saudi Arabia. Delivery eligibility remains **unknown** until merchant-level source evidence exists; **do not filter unknown** as missing.
- Customer-facing offer requires stable product ID, title, canonical first-party PDP, image, original currency/price, variant identity, and price timestamp. If an official feed's displayed price is promotion/quantity-dependent, no exact-unit price assertion without a retail quantity-one proof.
- Strict no-merge until real test across categories and multi-query acceptance, PDP parity, safe-source licensing and production release review.
- Do not copy any 1688 code or resurrect PR #317: it was explicitly cancelled. Keep code and release paths isolated from ongoing NAWAA rounds.

## Execution order
1. Confirm official API scope to search **Items by keyword/category** and whether API access is free for the intended use.
2. Obtain the official current endpoint, method, signing algorithm, rate limits and sample response; keys stay in GitHub Actions secrets or server environment, **never the repository**.
3. Add an adapter based on observed response schemas and first-party retail PDP.
4. Run bounded live checks for Arabic/English queries and broad categories; distinguish source access errors from empty catalogs and normalize without inventing shipping fees.
5. Only then request explicit separate merge authorization.

## Current proof
The public product listing pages and official affiliate API page were observed independently through web retrieval. **No Banggood live API request or integration test has been executed.**
