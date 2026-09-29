# NAWAA Search & Price Comparison Engine

## Sprint 01 — Product identity, landed cost, ranking, and UI

This sprint deliberately separates **product matching** from **price ranking**.

### Search flow

1. Query / URL input
2. Query normalization
3. Product identity resolution
4. Offer normalization
5. Match confidence
6. Saudi landed-cost calculation
7. Eligibility / trust filtering
8. Ranking
9. Quote-request handoff

### Comparable total

```
comparableTotal =
  productPrice
  + shipping
  + importCost
  + tax
  + mandatoryFees
  - confirmedDiscount
```

An offer is **not** eligible for the "cheapest confirmed" position when:
- the exact product / variant is uncertain;
- condition is not new;
- it cannot ship to Saudi Arabia;
- it is out of stock;
- any mandatory landed-cost component is unknown.

### Ranking buckets

1. `confirmed` — exact match + complete confirmed landed cost
2. `estimated` — exact match + complete estimated landed cost
3. `probable` — match confidence below the exact-match threshold
4. `incomplete` — exact identity but incomplete mandatory cost components
5. `ineligible` — wrong condition, unavailable, or cannot ship to Saudi Arabia

A cheaper probable/incomplete result must never outrank a confirmed exact match.

### Normalized offer shape

```js
{
  merchant,
  productPrice,
  shipping,
  importCost,
  tax,
  mandatoryFees,
  discount,
  currency,
  condition,
  availability,
  canShipToSaudi,
  deliveryDays,
  exactMatch,
  matchConfidence,
  priceConfidence,
  isLocal,
  observedAt
}
```

### Current state

- `search.html` is a development preview.
- `src/search-core.mjs` contains deterministic product matching and ranking logic.
- `src/search-page.mjs` handles the browser UI and quote-draft handoff.
- `tests/search-core.test.mjs` covers ranking guardrails.
- Demo prices are intentionally labelled as non-live data.
- No payment or purchase action is triggered.
- Quote drafts are local-only until the real quote workflow endpoint is connected.

## Sprint 02

Add real source adapters behind one provider contract:

```ts
interface OfferProvider {
  id: string;
  search(query: NormalizedQuery): Promise<NormalizedOffer[]>;
}
```

Initial target set: 3–5 sources that can be accessed legally and reliably without paid API commitments. Provider claims must be verified before activation.

## Sprint 03

Connect the selected offer to NAWAA's existing quotation lifecycle:

Search → Compare → Request Quote → Admin Pricing → Customer Offer → Accept/Reject → Order
