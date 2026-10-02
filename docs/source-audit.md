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

Latest repeatable live audit on 2026-10-02 verified **11 of 20 free storefronts**. The audit probe is capped at 100 offers per source for CI speed only; production search remains uncapped by this audit setting.

### LIVE_VERIFIED (11)

- aliexpress-cn
- ikea-sa
- asos-global
- newegg-global
- bestbuy-us
- nike-sa
- namshi-sa
- centrepoint-sa
- maxfashion-sa
- decathlon-sa
- niceone-sa

### Connected but no verified candidates yet (3)

- shein-sa
- temu-global
- walmart-us

### Failing / blocked in latest audit (6)

- iherb-sa
- farfetch-sa
- etsy-global
- bhphoto-us
- adidas-sa
- sephora-sa

Notable live proof from the latest pass:
- Centrepoint: 100/100 audit offers verified via Bloomreach, SAR pricing.
- Max Fashion: 100/100 audit offers verified via Bloomreach, SAR pricing.
- IKEA Saudi: official SIK search backend verified with live SAR product pricing.
- Best Buy, Newegg, ASOS, AliExpress, Nike, Namshi, Decathlon, and Nice One also returned verified live offers.

A source is promoted only from real merchant responses; code presence alone does not qualify it as live.
