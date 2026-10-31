# R02 — Verified strict cache admission

**Scope:** authoritative cache admission and honest partial evidence; not global
merchant coverage or a claim of faster live search.

## Exact code and release provenance

- Code PR #235: https://github.com/moealf12/Nawaa/pull/235
- Tested PR head: `8e75405aa04e7ff5643ca8c835318af4fc862e91`
- RED reproduction: `d60bbf1984a2e7ee313b368747a7614f782550db`;
  failed test and protected check:
  https://github.com/moealf12/Nawaa/actions/runs/41146177000
- GREEN required PR checks:
  https://github.com/moealf12/Nawaa/actions/runs/41147570959
- GREEN Search Core regressions:
  https://github.com/moealf12/Nawaa/actions/runs/41147570965
- Real-source candidate, successful second attempt:
  https://github.com/moealf12/Nawaa/actions/runs/41147570967
- Post-deploy acceptance PR #236:
  https://github.com/moealf12/Nawaa/pull/236
- Live acceptance:
  https://github.com/moealf12/Nawaa/actions/runs/41148436879
- Latest inspected main and Render LIVE:
  `9fd20bd57b3f19e181afa2397d3ed2fdf7abc7e7`
- Render deployment: `dep-dbij60rm8hqs73etojv0`;
  current main release checks 9/9 successful.

## Real read-only production observations

- Eight Arabic/English JSON search requests, four categories, HTTP 200;
  all eight were `coverage.partial=true`, `cache.mode=miss`,
  structurally valid offers, and **not** `fresh`.
- Repeated PS5 query was another `miss/partial` with
  `cache.completeness=partial`; no false fresh reuse.
- Four SSE streams sent one done event each, with no SSE error or
  malformed offers and no partial-as-fresh promotion.
- All R02 live acceptance checks PASS, observed
  2026-10-31T00:10:19.730Z.

## Residual limitations and resource caveat

All eight live queries still had partial source coverage; the initial
observed JSON timings ranged 9,199–12,401 ms. The repeated PS5
request took 12,498 ms. These are isolated samples, not P95.
Strict admission causes legitimate sequential re-acquisition instead of
caching incomplete results; it has **not** been proved to improve
performance, source hit rate, free-tier load or worldwide cheapest-price
coverage. Existing rate limits and deadlines do not eliminate these
future scalability risks. R02 was scoped to correctness; those issues
remain for later rounds.

A VERIFIED ledger entry attests this R02 scope only. The evidence
certification commit itself must pass exact-head CI and become LIVE before
the next round begins.
