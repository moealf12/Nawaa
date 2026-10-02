# NAWAA Source Audit

Audit started: 2026-10-02

## Rules

A source is **not** considered live merely because it exists in the registry or has an adapter.

- `LIVE_VERIFIED`: a real search can return at least one product offer with a resolvable product page and structured price.
- `CONNECTED_UNVERIFIED`: code path exists and is enabled by default, but live output has not yet been proven in this audit.
- `GATED`: adapter exists but runtime credentials/egress/configuration are required.
- `CANDIDATE_UNCONNECTED`: registry entry exists but no search adapter is mapped.
- `FAILING` / `BLOCKED`: live audit reached the source but it could not produce a verified offer.

## Baseline

Registry sources: **72**

Mapped to a search adapter: **41**

No mapped search adapter: **31**

### Direct adapters — connected, live audit pending (4)

- extra — eXtra Saudi
- jarir — Jarir Saudi
- sharafdg-sa — Sharaf DG Saudi
- swarovski-sa — Swarovski Saudi

### Free storefront discovery — connected, live audit pending (20)

- shein-sa
- aliexpress-cn
- temu-global
- iherb-sa
- ikea-sa
- asos-global
- farfetch-sa
- etsy-global
- newegg-us
- bhphoto
- walmart-us
- bestbuy-us
- adidas-sa
- nike-sa
- sephora-sa
- namshi-sa
- centrepoint-sa
- maxfashion-sa
- decathlon-sa
- niceone-sa

### Gated adapters — implementation exists, runtime activation required (17)

Amazon Creators markets (14):
- amazon-sa
- amazon-ae
- amazon-us
- amazon-ca
- amazon-uk
- amazon-de
- amazon-fr
- amazon-it
- amazon-es
- amazon-jp
- amazon-in
- amazon-sg
- amazon-au
- amazon-eg

Other gated adapters (3):
- noon-sa
- carrefour-sa
- ebay

### Candidate / unconnected sources (31)

- noon-ae
- currys
- argos
- mediamarkt-de
- kaufland-de
- fnac-fr
- cdiscount-fr
- pccomponentes-es
- bol
- allegro-pl
- allegro-cz
- allegro-sk
- allegro-hu
- emag-ro
- rakuten-jp
- yodobashi-jp
- biccamera-jp
- gmarket-kr
- coupang-kr
- jd-cn
- tmall-cn
- flipkart-in
- lazada-sg
- shopee-sg
- jbhifi-au
- mercadolibre-mx
- mercadolibre-br
- mercadolibre-ar
- mercadolibre-cl
- mercadolibre-co
- takealot-za

## Current audit conclusion

No source will be promoted to `LIVE_VERIFIED` from code inspection alone. The next pass must exercise the connected sources against real merchant responses and record candidates found, verified offers, structured price, extraction failures, blocking, and latency.

The deployed Render API could not be reached from the current external inspection environment at audit start, so no fabricated live-success statuses are recorded here.
