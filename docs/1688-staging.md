# 1688 China — staged source for NAWAA

**Status:** CODE_STAGED / LIVE_SOURCE_UNVERIFIED / NOT APPROVED FOR PRODUCTION.

**Branch:** `feature/1688-cn-staged-20261105` (draft PR only). No automatic merge, auto-merge, or production deployment.

## Integration into existing NAWAA architecture

- `server/providers/1688-cn.mjs` — maps *authorized* product catalog records into existing NAWAA offer schema, with exact quantity-one price verification.
- `server/authorized-1688-catalog.mjs` — separately configured POST-only approved catalog transport, bounded at 1 MiB, 4.5-second deadline, HTTPS host allowlist, no redirects, no browser/stealth/proxy fallback.
- `server/server.mjs`, `server/source-config.mjs`, `src/source-registry.mjs` — connection to the existing scheduler/registry with a **default-disabled** flag. No new architecture, deployment, database, or dependency required.
- `tests/1688-*.test.mjs` — coverage for retail MOQ, currency, FX provenance, unverified shipping, source identity, duplicate/variant behavior, cancellation and transport security.

No scraping or direct 1688 storefront traffic is performed by the staged adapter. The endpoint behind the approved feed must be backed by a data channel whose redistribution terms cover NAWAA; it is not assumed to exist.

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

Only `offerId` (6–20 digits) is used to construct a canonical 1688 product URL. The supplier can optionally provide `skuId`, `brand`, `modelNumber`, `titleAr`, and `titleEn`. A trusted feed must bind quantity, SKU, currency, price and observation together. Missing MOQ or one-piece price = no retail offer. A price-range floor or a 10-unit price is not a one-unit price.

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
