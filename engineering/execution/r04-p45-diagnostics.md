# R04-P45 — Evidence-first Diagnostic Intelligence Protocol

## Scope
Standalone, production-SHA-pinned analysis of the existing frozen 36-intent LIVE HTTP audit. No new merchant probes, no synthetic product data, no extra requests, no new infrastructure. The HTTP audit continues to execute ordinary read search endpoints; the server may independently perform its existing indexing/cache side effects.

This version does **not** instrument or change shopper search execution, source scheduling, admission, cache decisions, prices, product identity, or SSE semantics. No merge or deploy without independent gates.

## Inputs and provenance
- Frozen 36 identifiers Q01-Q36, each unique.
- Expected SHA compared with real pre/post /health revision, ok=true.
- Report schema nawaa.r04.36-live-corpus.v1.
- Transport phase boundaries: request start -> received headers -> complete body -> parsed JSON, measured with the client's monotonic clock.
- serverDurationMs is a server-reported wall-clock duration, **not CPU usage**.
- Source evidence is an event histogram, **not distinct merchants or unique failures**.
- The 32-bucket top-K cap means the source attribution has a known truncated tail. Never treat missing bucket entries as zero errors.

## What the analyzer CAN establish
1. Exact SHA and corpus evidence integrity; missing audit observations.
2. Request-failure boundary (headers/body/parse/response validation).
3. Verified zero offers versus nonzero offers lacking principal presentation groups.
4. Partial coverage, internal deadlines, catalog recall failure and contradictory coverage claims.
5. Which *client-observed* request phase dominates and whether timing evidence is inconsistent.
6. Source block/timeout evidence from explicit failure codes, not arbitrary messages.
7. Cross-stage evidence consistency; source event conservation, cardinality/coverage caveats.
8. Prioritized investigative steps keyed to static safe code names.

## What it CANNOT establish
- The root cause of a header wait: CPU, Render queueing, remote source latency, independent lookup barriers, or network path can all contribute.
- Whether a merchant has stock, an actual purchase can be completed, or a price is cheapest.
- A population-wide P95, causal speedup from a candidate, per-request CPU without correlated instrumentation, or human-certified matching accuracy.

## Evidence-driven triage
| Symptom | Next engineering instrument |
| --- | --- |
| CLIENT_HEADER_WAIT_DOMINANT | Request-scoped server critical path: admission, provider barriers, matching, normalization, finalization, event loop |
| CLIENT_BODY_READ_DOMINANT | Streaming/transfer bytes, buffering, compression, client parse boundary |
| CLIENT_PARSE_COST_DOMINANT | JSON size, decoding, parse CPU and payload cardinality |
| PRINCIPAL_PRESENTATION_GAP | Acquisition -> offer admission -> identity -> grouping -> classification -> presentation, preserving unrelated results |
| NO_VERIFIED_OFFERS | Per-merchant route, network, extraction, proof-of-price, validity and persisted recall, without claiming out-of-stock |
| SOURCE_ACCESS_BLOCK | Confirm merchant-observed 403/429/200 challenge; limit same-request redundant work without evasion |
| INTERNAL_DEADLINE | Shared budget, queue wait, independent Amazon/index/store barriers, blocked event loop and overload |
| SOURCE_ERROR_ACCOUNTING_GAP | Source event cardinality, top-K truncation, source classification and explicit unknowns |

## Required acceptance
1. Unit/negative-control test suite and syntax gate.
2. Exact-SHA real production 36-intent audit using existing 2-concurrency limit.
3. Full report saved even when search-acceptance fails; invalid/unverified provenance = diagnostic failure.
4. Inspect retained JSON and Markdown artifacts, including all failure codes and provenance.
5. Never merge the diagnostic as a claim that R04 source-retrieval or principal ranking is fixed. An independent product-fix PR, Render live deployment verification and published-browser check remain required.

## Manual reproduction (existing LIVE JSON only)
node scripts/diagnose-r04-live-evidence.mjs r04-36-live-corpus-evidence.json

Outputs: r04-causal-diagnostic.json, r04-causal-diagnostic.md.
