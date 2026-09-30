# NAWAA Search & Price Comparison Engine

## Current implementation snapshot — 2026-10-01

NAWAA is now beyond the original Sprint 01 demo. The current implementation has a live Saudi search backend, product identity logic, SKU-aware comparison, an interactive configurator, explainable offer intelligence, and a local price-history layer.

## Search flow

1. Query or product URL
2. Query normalization
3. Live provider aggregation
4. Product / variant identity assessment
5. Offer normalization and deduplication
6. SKU-aware grouping
7. Configurator selection: model → storage → color → condition → SKU
8. Canonical product-profile merge
9. Saudi landed-cost eligibility
10. Explainable offer comparison
11. Exact-match result grid
12. Product-detail handoff
13. Local price-history observation

## Live provider status

### Active
- eXtra Saudi — Unbxd site-search adapter
- Jarir Saudi — Constructor search with HTML fallback
- Sharaf DG Saudi — Algolia catalog adapter

### Implemented but gated
- Noon Saudi — disabled until reliable Saudi-safe egress is available
- Carrefour KSA — disabled until reliable free egress is available

### Implemented but awaiting configuration
- eBay official Browse API — requires approved client credentials
- Shopify predictive-search adapter — requires configured store list

## Comparable total

```
comparableTotal =
  productPrice
  + shipping
  + importCost
  + tax
  + mandatoryFees
  - confirmedDiscount
```

NAWAA must not describe an offer as the final cheapest delivered option while any mandatory component is unknown.

## Ranking buckets

1. `confirmed` — exact product + complete confirmed landed cost
2. `estimated` — exact product + complete estimated landed cost
3. `probable` — lower match confidence / variant uncertainty
4. `incomplete` — identity is acceptable but cost components are missing
5. `ineligible` — wrong condition, unavailable, or cannot ship to Saudi Arabia

## Product identity

The comparison layer distinguishes:
- brand
- model
- storage
- color
- condition
- model number / SKU when available

Equivalent formatting differences such as `MG674AH/A` and `MG674AHA` normalize together. Materially different SKUs remain separate even when title, storage, and color look similar.

## Canonical product profile

For the selected configuration, NAWAA merges specifications from matching merchant offers. A value keeps its source merchant(s). Conflicting values are surfaced rather than silently overwritten.

Examples:
- RAM
- processor
- screen size/type
- network
- SIM configuration
- regional version
- OS
- rear/front cameras
- battery
- water resistance
- model number
- barcode

## Offer Intelligence

The UI explains:
- lowest advertised price or confirmed comparable total
- price delta to another merchant
- confirmed Jeddah stock when a provider supplies it
- home-delivery and store-pickup signals
- unknown availability
- missing shipping/tax/mandatory-cost components
- match-confidence warnings

## Price history

The public frontend currently stores live/verified price observations in local browser storage.

It is explicitly:
- device-local
- started from the user's first observation
- not a market-wide historical database

A shared server-side price-history store is not implemented yet.

## Frontend reliability paths

Primary frontend:
- GitHub Pages: `https://moealf12.github.io/Nawaa/search.html`

Backend:
- Render: `https://nawaa-search-api.onrender.com`

Same-origin mobile fallback:
- `https://nawaa-search-api.onrender.com/search.html`

The same-origin route exists because some embedded mobile browsers can interrupt cross-origin requests before they reach Render. If live search fails, the UI must show a failure state and never silently replace the result with Demo catalog data.

## Current public implementation does not yet include

- real payment / checkout
- persistent server-side order lifecycle
- persistent public quote workflow
- shared multi-user price history
- complete shipping/tax/duty confirmation for every source
- universal worldwide live coverage
- active eBay traffic until credentials are configured

## Test / CI contract

`npm test` executes:
- deterministic search-core tests
- provider parser and normalization tests

GitHub Actions also syntax-checks browser and server modules. Provider changes are included in the workflow path filters.
