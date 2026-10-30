# R01 — Evidence-based certification

**Status:** VERIFIED for the R01 governance + baseline acceptance scope.
This is NOT source-completeness, price-live-attestation or an assertion that
all 21 rounds are implemented. Follow-up rounds own the observed source errors,
latency, partial cache, production source coverage and ranking improvements.

## Exact GitHub and deployment lineage

- Baseline for live checks: `4412d50e29035955d4fdb91cf3bfb7daa3042ea8`
- Merge PR: https://github.com/moealf12/Nawaa/pull/232
- Tested PR head: `310b44ed782f93521206531de97770a2f03c1191`
- Required PR CI: https://github.com/moealf12/Nawaa/actions/runs/41140566482
- Extended Search Core regressions: https://github.com/moealf12/Nawaa/actions/runs/41140566465
- Live public search CI: https://github.com/moealf12/Nawaa/actions/runs/41140566442
- Live artifact: `nawaa-live-production-source-acceptance-310b44ed782f93521206531de97770a2f03c1191`, artifact ID `13018912743`
- Main merged SHA and last verified Render LIVE SHA: `aa0da3fe3ccfa16ac8e8eb80f7ee67f926b0199d`
- Render deployment: `dep-dbii12vb9u1s738j8ij0`
- Main release gate: https://github.com/moealf12/Nawaa/actions/runs/41140985605 (9/9 SHA-scoped checks successful)

## Real negative-control: not simulated

- https://github.com/moealf12/Nawaa/pull/233
- https://github.com/moealf12/Nawaa/actions/runs/41140794943
- `nawaa-pr-core=success`
- `nawaa-pr-integrations=failure` because the temporary PR intentionally ran `exit 86`
- Protected `nawaa-required-pr-check=failure`, GitHub `mergeable_state=blocked`
- **PR #233 was closed WITHOUT merging.** No negative-control code entered main.

## Live public production acceptance (not synthetic)

Eight JSON requests covering smartphone, gaming, audio and computing,
each in Arabic and English; all eight HTTP 200 and zero structurally invalid
published offers. Count of selected offers (Arabic and English summed):

| Category | Selected offer records |
| --- | ---: |
| Smartphone | 70 |
| Gaming | 48 |
| Audio | 240 |
| Computing | 240 |

Four additional independent streaming searches, one per category,
returned HTTP 200, exactly one done event each, 0 SSE error events,
and 0 structurally invalid final offers. Render health revision matched
the pinned baseline; source registry contained a single noon-sa entry;
customer-facing search HTML loaded.

**Critical limitation:** 15–19 source errors were observed per JSON query and
ALL 8 responses had `coverageComplete=false`. Valid structure does not prove
a retailer still has the item in stock or that prices include Saudi shipping.
JSON and SSE samples are independent acquisitions, not a common snapshot:
difference in counts (35 JSON vs 52 SSE for iPhone 17) is *not* proof of
a search-integrity mismatch. It is evidence of source variability to diagnose
in subsequent search reliability rounds. Measurements are one live sample,
not independently established P50/P95 or full-merchant recall.

## Baseline and gates

- Search truth corpus: 36 paired Arabic/English intents, 7 labeled identity
  cases, 8 source-failure glossary scenarios; all explicitly synthetic.
- Exact-head mandatory PR aggregate uses Node + disposable PostgreSQL/Meilisearch
  + Python JSONL contracts.
- The additional production wiring PR check validates GitHub Pages and Render
  actual assets, CORS and exact RELEASED base SHA before THIS certification
  PR can merge. If it fails, keep PR unmerged and correct evidence first.
- Any claim that all sources work or have 0 defects is not supported.

The permanent ledger refers to the last fully verified previous release SHA.
After this *documentation-only* certification PR merges, verify its own
main CI and Render deployment independently before commencing R02.
