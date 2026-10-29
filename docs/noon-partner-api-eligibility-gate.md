# NAWAA — official Noon Partner API eligibility gate

**Status:** PREPARED / NOT AUTHORIZED / NOT A CONSUMER-SEARCH CONNECTOR.

## Source and scope

Official documentation:
- Quick Start: https://noon-docs.noonpartners.dev/docs/getting-started/quick-start
- Offer API: https://noon-docs.noonpartners.dev/docs/api-reference/offer/offer-service-get-product-offers
- OAuth: https://noon-docs.noonpartners.dev/docs/authorization/getting-credentials-oauth

`GET https://noon-api-gateway.noon.partners/offer/v1/product/{partner_sku}`
is scoped to a **partner's own SKU** and requires noon Partner credentials.
It is not the anonymous Noon Saudi storefront search endpoint, is not
documented as a universal Noon catalog search, and should not be used to
enumerate unrelated merchants' offerings. Seller OAuth credentials similarly
require authorized access to sellers' projects.

## NAWAA decision

- `src/noon-partner-offer-evidence.mjs` normalizes already-received,
  explicitly authorized seller response data, **offline only**.
- The normalizer accepts only exact authorized partner SKU and expected
  Noon SKU, country `sa`, currency `SAR`, strictly positive price,
  `is_active === true`, `live_status === true`, positive integer stock,
  and unique offer identity. Conflicts are not chosen opportunistically.
- No credential file, service account, cookie, token, private key, customer
  data, raw HTML, or saved Safari archive is committed.
- No network client or cron job, no caller from public search, no Meilisearch
  or PostgreSQL persistence, and no shopper price promotion is provided.
- **All** normalized records are `customerPublishable:false`. A partner's
  status alone does not establish today's buybox price, shipping, end-user
  purchase availability, or a license to republish third-party offers.
- Zero additional infra cost; **do not claim that Noon grants free API access**
  or broad catalog rights without written confirmation.

## External dependency and questions to Noon

Before an authenticated integration can be enabled:
1. Confirm NAWAA's eligibility as a **price-comparison / product-discovery**
   service in Saudi Arabia, not necessarily a Noon seller.
2. Confirm a **no-charge** source or approved affiliate feed/API that searches
   public products across categories and multiple sellers, not only a
   seller's own `partner_sku` entries.
3. Obtain written permission covering displayed prices, titles, images,
   product links, refresh intervals, attribution, caching/retention, and
   deep links with offer code `o`.
4. Verify usage limits, costs, rate limits, Saudi-market fields, stock,
   actual buybox ownership, and availability to KSA destinations.
5. Only then introduce credentials through Render secrets (never GitHub
   files or API logs), test authenticated requests in isolation, and
   independently verify same-SKU / same-offer customer source facts.
6. Release a separate PR with explicit publication gates and end-to-end
   real merchant tests.

## Actual access blocker

On 2026-10-29, the production Render source audit for
`noon-sa`, query `laptop`, returned **underlying merchant HTTP 403**
in approximately 66 ms. The audit HTTP 200 only confirmed that **NAWAA's
audit endpoint** answered, not that the merchant allowed data access.
Noon storefront search remained zero verified live offers. Browser-saved
Safari HTML is a useful offline fixture, **not live server-side proof**.

Do not deploy WAF evasion, IP relays, proxy rotation, or expensive scraping
services to treat this refusal as an ordinary parser failure.
