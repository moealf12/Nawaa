# 1688 China — staged source for NAWAA

**Status:** BUSINESS_GREEN_LIGHT_REPORTED / CODE_STAGED / TECHNICAL_ACCESS_UNVERIFIED / LIVE_SOURCE_UNVERIFIED / NOT APPROVED FOR PRODUCTION.

**Branch:** `feature/1688-cn-staged-20261105` (draft PR only). No automatic merge, auto-merge, or production deployment.

## Integration into existing NAWAA architecture

- `server/providers/1688-cn.mjs` — maps *authorized* product catalog records into existing NAWAA offer schema, with exact quantity-one price verification.
- `server/authorized-1688-catalog.mjs` — separately configured POST-only approved catalog transport, bounded at 1 MiB, 4.5-second deadline, HTTPS host allowlist, no redirects, no browser/stealth/proxy fallback.
- `server/server.mjs`, `server/source-config.mjs`, `src/source-registry.mjs` — connection to the existing scheduler/registry with a **default-disabled** flag. No new architecture, deployment, database, or dependency required.
- `tests/1688-*.test.mjs` — coverage for retail MOQ, currency, FX provenance, unverified shipping, source identity, duplicate/variant behavior, cancellation and transport security.

No scraping or direct 1688 storefront traffic is performed by the staged adapter. The endpoint behind the approved feed must be backed by a data channel whose redistribution terms cover NAWAA; it is not assumed to exist.


## Partner green light and official integration route (2026-11-05)

Project owner reports that 1688 representatives responded positively and gave a green light to NAWAA's concept. This is **reported commercial encouragement**, not independent verification of API scopes, access credentials, data redistribution rights, allowed extraction methods, rate limits, or shipping eligibility. Do not quote this as API activation or permission to automatically scrape any page.

Prefer first-party **1688 / Alibaba Open Platform** for product discovery and price data:
- Developer portal: https://aop.alibaba.com/ (also referenced as https://open.1688.com/)
- Cross-border capability agreement: https://terms.alicdn.com/legal-agreement/terms/b_end_product_protocol/20231024161027594/20231024161027594.html
- Partner development terms: https://terms.alicdn.com/legal-agreement/terms/suit_bu1_b2b/suit_bu1_b2b202002111645_28701.html

Official documentation confirms cross-border search, product catalog and integration service capabilities, but **does not establish which APIs NAWAA's account has been granted**. Do not copy third-party API endpoint names or authorization signatures as if officially provisioned.

Request from partner, through their normal secure onboarding channel:
1. Open Platform application or delegated access workflow (including signed API request mechanics and rate-limit quotas).
2. Documentation of supported keyword and SKU/variant detail interfaces, search language, catalog freshness and pagination.
3. Explicit permitted reuse of current title/image/price/MOQ/URL for a public Saudi price-comparison service.
4. Whether quantity-one price evidence and stock availability are exposed per SKU or only as general product tiers.
5. Saudi-destination shipping eligibility, export restrictions, and whether approved forwarding partners can provide actual landed cost.
6. Privacy-safe test credentials provided via secrets manager only; **never paste tokens into a public PR or issue**.

**Engineering decision:** Maintain the already-built normalized feed boundary. Once official access shape is verified, implement the exact documented authentication and mapping behind that boundary, validate with a real 10-query live acceptance suite, and preserve staged isolation until the owner explicitly says merge.

## Approved feed contract

HTTPS POST (server to server):

```json
{
  "query": "手机壳",
  "limit": 20
}
```

Response (shape illustrative, **not a claim that 1688's official API uses this schema**):

```json
{
  "products": [
    {
      "offerId": "123456789012",
      "title": "手机壳",
      "titleEn": "Phone case",
      "image": "https://cbu01.alicdn.com/img/ibank/example.jpg",
      "currency": "CNY",
      "priceObservedAt": "2026-11-05T00:00:00Z",
      "minimumOrderQuantity": 1,
      "priceTiers": [
        {"minQuantity": 1, "unitPriceCny": 20},
        {"minQuantity": 10, "unitPriceCny": 12}
      ],
      "condition": "new",
      "stockQuantity": 100
    }
  ]
}
```

Only `offerId` (6–20 digits) is used to construct a canonical 1688 product URL. The supplier can optionally provide `skuId`, `brand`, `modelNumber`, `titleAr`, and `titleEn`. A trusted feed must bind quantity, SKU, currency, price and observation together. Missing MOQ or one-piece price = no retail offer. Missing, future-dated, or older-than-one-hour price evidence is rejected; ingestion time never refreshes stale prices. The timestamp in the sample is illustrative, not a live observation. A price-range floor or a 10-unit price is not a one-unit price.

## Explicit activation conditions (do not set yet)

```text
NAWAA_1688_ENABLED=1
NAWAA_1688_CATALOG_URL=https://<approved-public-host>/<feed-path>
NAWAA_1688_ALLOWED_HOSTS=<approved-public-host>
NAWAA_1688_CATALOG_TOKEN=<secret-on-Render-only>
```

All are required. Store secrets only in a secret store; never in code, PR comments, or logs. The feed must support POST JSON, bearer authentication, JSON responses, and no redirects. An official 1688 API directly is **not interchangeable** with this normalized feed: if an official API is used, its documented authentication and response schema need a verified gateway mapping. This is a **missing external dependency**, not a solved one.

## Price, delivery and ranking correctness

- A true MOQ = 1 and independently evidenced one-piece price is required.
- Tier prices are CNY and converted to SAR by NAWAA's existing FX module; no default hardcoded rate is used.
- `canShipToSaudi = null`, `shipping = null`, `importCost = null`, `tax = null`: no source price can masquerade as a Saudi delivered total.
- `exactMatch = false`, `matchConfidence = 0`, `priceConfidence = incomplete`: no implied SKU/title, delivery, or buyability certification.
- Other bulk products are counted as `WHOLESALE_ONLY` in diagnostics, not mislabeled as consumer retail offers.
- Chinese/English/Arabic titles may be accepted when **provided by the approved feed**. Automatic multilingual translation and product identity parity are **not certified**.

## Pre-merge release gates

1. Provide verifiable terms/authorization and the approved feed's API specification and credentials (privately).
2. Run live authorized feed tests for at least 10 search terms spanning Chinese, Arabic, and English, each covering product count, one-piece tiers, images, price conversion, stock, and variant binding.
3. Repeat from GitHub Actions and the target Render network with zero paid infrastructure, verifying repeated results, failure classes, aborts and latency.
4. Verify no regression in NAWAA full test suite and existing merchant routing; verify draft PR diff and that `main` is untouched.
5. Explicit user instruction is mandatory for **merge**, **enablement**, and **deployment**. Never activate from this draft automatically.

**Do not say LIVE_VALIDATED or MERGE_READY until gates above are demonstrably complete.**
