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

### Direct adapters — LIVE_VERIFIED (4)

- extra — eXtra Saudi — 24/24 verified in latest direct audit
- jarir — Jarir Saudi — 24/24 verified
- sharafdg-sa — Sharaf DG Saudi — 13/13 verified
- swarovski-sa — Swarovski Saudi — 22/22 verified

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

Latest repeatable live audit on 2026-10-02 verified **11 of 20 free storefronts**. A separate repeatable audit verified **4 of 4 direct adapters**, so **15 of 24 connected ungated sources are LIVE_VERIFIED** overall.

The audit probe is capped at 100 offers per source for CI speed only; production search remains uncapped by this audit setting.

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

### Connected but no verified candidates yet (1)

- temu-global — search route responds, but the anonymous SSR payload currently contains no product candidates

### Failing / blocked in latest audit (8)

- shein-sa — redirected to SHEIN risk challenge
- walmart-us — redirected to Walmart blocked page
- iherb-sa — HTTP 403
- farfetch-sa — HTTP 403
- etsy-global — HTTP 403
- bhphoto-us — HTTP 403
- adidas-sa — HTTP 403
- sephora-sa — HTTP 403

Notable live proof from the latest pass:
- eXtra Saudi: 24/24 direct audit offers verified, SAR pricing and valid product URLs.
- Jarir Saudi: 24/24 verified.
- Sharaf DG Saudi: 13/13 verified.
- Swarovski Saudi: 22/22 verified.
- Centrepoint: 100/100 audit offers verified via Bloomreach, SAR pricing.
- Max Fashion: 100/100 audit offers verified via Bloomreach, SAR pricing.
- IKEA Saudi: official SIK search backend verified with live SAR product pricing.
- Best Buy, Newegg, ASOS, AliExpress, Nike, Namshi, Decathlon, and Nice One also returned verified live offers.
- SHEIN is explicitly classified as blocked by its risk-challenge response instead of being misreported as merely empty.
- Walmart is explicitly classified as blocked when the merchant redirects search to its blocked page.
- Temu now has a domain adapter plus an embedded `window.rawData` search parser and regression coverage, but it remains unverified because the anonymous live audit currently returns an empty `store.goodsList`.

Validation on the audit branch: `npm test` passed **79/79** and **33/33** tests with zero failures; the direct-source live audit passed **4/4**.

A source is promoted only from real merchant responses; code presence alone does not qualify it as live.
