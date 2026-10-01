# Source coverage and expansion

`GET /api/sources` reports the running service's source registry and coverage.
`configured` means a connector is enabled in this runtime, `disabled` means its
adapter exists but is off, and `candidate` means no adapter has been integrated.
These labels do not assert successful live requests. Per-search `providers` and
`errors` remain the evidence of success for that particular query.

The registry contains 56 targets across 28 countries. Four configured sources
at rollout: eXtra, Jarir, Sharaf DG Saudi and eBay. Carrefour and Noon adapters
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
