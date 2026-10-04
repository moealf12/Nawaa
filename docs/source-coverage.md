# Source coverage and expansion

## Verified code update — 2026-10-04

Current code supersedes the older snapshots below. `npm test` discovers every
`tests/*.test.mjs` file, including Amazon and crawler regressions. CI installs
locked dependencies before testing.

- Amazon cards support heading-only names, select the current price rather than
  a crossed-out list price, and keep URLs on the matching Amazon listing.
- eXtra follows catalog pagination within a shared 6.5-second acquisition budget;
  collected results survive later-page errors. Missing prices are not zero.
- Structured-price storefront results are no longer cut to four. Product-page
  resolution remains bounded separately. This is not exhaustive crawling.
- Runtime source coverage includes enabled direct storefronts, including Amazon
  and GCC stores; configured does not mean live-certified.
- Persisted/indexed recall retains its provenance and observation timestamp and
  is not written back as a new live observation.
- Public diagnostics include isolated Amazon failures, per-provider counts and
  acquisition limits. `coverage.truncated` describes final selection only;
  `coverage.exhaustive` is false because upstream acquisition is bounded.
- URL resolution rejects IPv4-mapped private addresses, multicast and non-global
  IPv6 destinations. This does not constitute a complete security audit.

Remaining: cursor-based remote load-more, Jarir pagination, exhaustive Amazon
pagination, source-by-source production certification, DNS rebinding protection
by pinning validated addresses at connection time, and request-level rate limits.
The UI's load-more reveals already acquired groups, ten at a time per category.


`GET /api/sources` reports the running service's source registry and coverage.
`configured` means a connector is enabled in this runtime, `disabled` means its
adapter exists but is off, and `candidate` means no adapter has been integrated.
These labels do not assert successful live requests. Per-search `providers` and
`errors` remain the evidence of success for that particular query.

The registry contains 57 targets across 28 countries. Five configured sources
at rollout: eXtra, Jarir, Sharaf DG Saudi, Swarovski Saudi and eBay. Carrefour and Noon adapters
remain disabled. Dynamic Shopify entries describe individual configured stores,
not all merchants on Shopify. Runtime records expose no credentials or base URL
configuration. Counts describe sources, not the number of independent sellers
on a marketplace or verified shipping destinations.

Search responses include `coverage.availableOffers`, `returnedOffers`,
`returnedMerchants` and `truncated`. The 120-result budget is allocated in rounds
across merchants within relevance tiers (exact, strong, weak, unrelated). Exact
matches always consume capacity before related items. Selected results keep the
existing confidence/price ordering. eBay markets share one merchant allocation;
configured Shopify merchants each receive their own allocation. This avoids
adding market connections simply to dominate the response budget.

## Direct brand-store coverage

Swarovski Saudi is integrated through its public Saudi storefront search. The adapter
returns the official product URL, listed SAR price, image, product identifiers and stock
only when the storefront exposes them. Arabic brand/category aliases are canonicalized
before provider lookup. Shipping, tax and final landed cost remain unconfirmed until
those components are explicitly available.

## Zero-result recovery

When a specific provider query returns no products, NAWAA performs one bounded retry
with a relaxed query derived from the same intent (for example, dropping storage/color
before falling back to model, brand/category, or category). Candidate offers are still
scored against the original query, so relaxation cannot turn a mismatched variant into
an exact match.

## Read-only connection probes, 2026-10-01

- Noon existing catalog adapter: timeout.
- Carrefour existing adapter: HTTP 500.
- Anker US public Shopify predictive endpoint: HTTP 404.
- Nomad public Shopify predictive endpoint: HTTP 404.
- Gymshark US public Shopify predictive endpoint: HTTP 502.

These observations concern the tested endpoints and runtime only. They do not
prove these merchants cannot be integrated through official catalogs or other
supported methods. None was enabled based on these unsuccessful probes.

## Next integrations

Amazon: Creators API with an accepted Associates account and marketplace
credentials. Salla: merchant-authorized OAuth connection; not unrestricted
access to all stores. Additional Shopify stores: verify endpoint format,
currency units, stock, product URLs, images and shipping before runtime enablement.
Affiliate feeds: ingest only the merchants/catalogs actually granted to the
account. Each integration must pass live-query validation before being reported
as returning products. Do not invent prices, shipping, availability or total costs.

## Added Shopify stores, 2026-10-01

Native Union (Hong Kong), Spigen (US), Death Wish Coffee (US), tentree (Canada):
verified public predictive search and cart endpoints. US storefront probes presented USD; Native Union varies presentment currency by region and reads it dynamically from cart.js.
The adapter now retrieves product Ajax details and emits up to three available
variants per product with exact variant IDs and prices. Integer minor-unit prices
are divided by 100 only for explicitly supported two-decimal currencies. A failed
variant lookup cannot fall back to an ambiguous predictive starting price. Currency
changes reject the source instead of silently assigning the configured currency.
Each store has a 15-second network deadline and a bounded product/variant count.

Countries describe the merchant, not manufacturing origin or guaranteed dispatch
country. Original currency and converted SAR prices remain separate. Missing FX
keeps the original price and leaves SAR unknown. Stock is based on the variant's
available field. Delivery charges, import costs and delivery dates remain unknown.
Spigen's May 23, 2026 policy requires a valid US address, including eligible US
forwarders: record forwarding_required and directShippingToSaudi=false. Other
stores' Saudi delivery remains unconfirmed per offer.

References:
- https://shopify.dev/docs/api/ajax/reference/product
- https://www.spigen.com/pages/notice-to-customers
- https://www.nativeunion.com/pages/terms-of-sale
- https://www.deathwishcoffee.com/pages/help-shipping-delivery
- https://www.tentree.com/pages/contact
