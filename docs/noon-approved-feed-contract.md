# Noon Saudi — Merchant-Approved Feed Ingress (Staged)

**Status:** Diagnostic contract only. Not merged, not deployed, not customer-publishable.

## Why

Observed cloud access barriers cannot be fixed by a JavaScript parser change. GitHub-hosted Ubuntu, macOS and Windows all received HTTP 403 with curl_cffi on a real Saudi query; Chromium encountered an HTTP/2 protocol error; two public catalog paths timed out. These are transport observations, not evidence of Noon rejecting NAWAA's commercial cooperation. See PR #303 and linked Actions artifacts.

The project owner reports Noon management approval for automated product and price retrieval. This work defines a **NAWAA-owned** JSON export contract for *an existing merchant-approved feed*, should that feed be made available. **This schema is not a claim about the actual format of Noon's Partner API.** No sample/fabricated product data is used as live acceptance.

## Expected JSON page contract

| Field | Required | Meaning |
|---|---|---|
| `schema` | yes | Exact string `nawaa.noon-sa.approved-feed.v1` |
| `market` | yes | Exact `SA` |
| `scope` | yes | Exact `marketplace`; a declaration, not independent proof of full marketplace coverage |
| `generated_at` | yes | Timestamp with timezone, no more than 60 minutes old |
| `records` | yes | Array containing at most 5,000 product-offer records per page |
| `next_page` | optional | HTTPS URL on the **same exact approved host and path** with a different cursor/query; no redirects |

Each record must have `sku`, `product_url` (a real **Saudi** Noon product URL with exactly one `?o=<offer_code>`), `offer_code`, `title`, numeric `price`, `currency: SAR`, `observed_at` (timezone-aware) and optionally `image_url` (Noon CDN). The identity validator uses the existing `noonSaudiProductIdentity` utility; invalid SKU/URL, non-SAR currencies, non-positive/non-cent prices and future observations are rejected. Repeated offer identities with inconsistent price or title are discarded. Seller and shipping data are not imported or exposed.

A price observation younger than ten minutes is *fresh by timestamp claim only*, not checkout-verified. **No feed record is automatically promoted to current buy-box, delivery or customer-visible offers.** Genuine independent verification and live source acceptance are required before a production integration.

## Deployment-neutral configuration (not configured at this checkpoint)

- `NOON_APPROVED_FEED_URL`: URL of an **actually provided** and approved HTTPS JSON feed page. Do not invent a public endpoint.
- `NOON_APPROVED_FEED_HOST`: exact approved domain. Redirects, different hosts and non-HTTPS URLs fail closed.
- `NOON_APPROVED_FEED_TOKEN`: optional bearer token from a secure secret store; never commit or paste keys.

Run the read-only acceptance script `node scripts/noon-sa-approved-feed-live.mjs` only after these values are available. The script permits **up to 4 real pages** with 15s/page, 8MB/page, and no retry or proxy. This is a diagnostic sampling budget, **not proof the entire Noon marketplace has been indexed**. Reports contain counts, hashes and status classes, not response bodies, cookies, merchant secrets, seller data or shipping.

When no approved feed exists, the exact result is `APPROVED_FEED_ENDPOINT_NOT_CONFIGURED`. A passing syntax/CI check is not a passing live integration.

## Remaining acceptance gates

1. Confirm data-source ownership, permissions and marketplace-wide catalog scope beyond seller-specific exports.
2. Receive a real approved URL or export delivery channel, ideally without requiring Noon to change application code.
3. Fetch actual live Saudi catalog pages; verify SKU, variant, offer identity, SAR, observed timestamps, conflicts and complete pagination.
4. Independently cross-check a changing sample of real offers with product detail or approved merchant-origin evidence.
5. Attach full live metrics and resulting branch SHA. Review, merge and deploy **only after** explicit release checks.

This staged code never changes `main`, `Render`, `Neon`, the current Noon provider, nor the customer search path.
