# NAWAA ASTRA OMEGA v22.03 — algorithmic and language tooling decision record

## Scope and evidence

Production before the v22.03 candidate: main `7a4a81d07b328b9533c278936249373279f7c2f8` (PR #212 was merged, deployment must be verified separately). Real production v22.02 (SHA `54bab626`) recorded slow requests with acquisition ~10–12 s and extra finalization, one 23-second customer timeout, and Render's Free CPU quota of 0.15 CPU reached during part of a controlled source test. A process-wide CPU measurement is NOT per-request CPU attribution.

Priority: preserve product identity, seller, price and evidence before improving speed. Stay on existing free infrastructure.

## 1. Mathematical model

A parallel search is a directed acyclic graph (DAG), not a sum of every merchant's duration. When all sources are independent and concurrently launched, the acquisition critical path is approximately `max(T_source_i)` plus shared orchestration. More generally:

`T_server = max_{p in dependency_paths} sum_{v in p} elapsed(v) + required_finalization + response_enqueue`

The DAG longest path is the correct conceptual object; source elapsed times may overlap, including CPU contention. The `/api/search` wall-clock time also includes queueing, cache coalescing, network delivery and server scheduling outside these spans.

CPU evidence:
`CPU_ms = (delta(process.cpuUsage().user) + delta(process.cpuUsage().system)) / 1000`.
Event-loop utilization `ELU = active / (active + idle)`, collected using `node:perf_hooks`. Both are **process-wide during the sample**, may count concurrent queries, and cannot prove a specific query caused CPU saturation. Percentages do not mean the percentage of Render's CPU quota.

The PR #212 provider-pass change removes an unused cumulative rescore after every provider completion. If there are `P` completed providers and `N` total offers, repeated cumulative evaluation visits up to `O(P*N)` offer references (plus dedup/scoring costs) versus `O(N)` references for one final evaluation. This is a complexity bound, not an observed runtime speedup.

Search optimization objective (lexicographic, not a weighted score that trades away truth):

1. zero identity / source / price integrity regressions;
2. retain every eligible completed offer;
3. improve relevant independent-merchant coverage;
4. minimize customer completion latency;
5. remain inside the zero-paid-cost CPU / memory / network quota.

Do not use mean latency as a replacement for tail behavior; report sample size, matched query cohorts and cache mode. Never claim p95 from three data points.

## 2. Recommended algorithms by layer

| Layer | Technique | Decision and prerequisite |
|---|---|---|
| Acquisition scheduler | Deadline-constrained DAG / critical-path analysis | **NOW**: inspect spans and source fan-out; no new scheduler before controlled proof |
| Provider result assembly | Incremental append + one final aggregate score | **IMPLEMENTED in PR #212**, preserve progressive callbacks |
| Memory and CPU | `process.cpuUsage()` + `performance.eventLoopUtilization()` | **IMPLEMENTED in this candidate**, zero external dependencies |
| Missing source detection | Causal first-failing-stage trace | **NEXT** if acquisition/normalization remains ambiguous; bounded cardinality |
| Merchant selection | Budgeted set-cover / max-coverage heuristics | **SHADOW ONLY** after proven source suitability; never hide legitimate offers for a score |
| Source reliability | Beta-binomial priors and conservative sample thresholds | **RESEARCH**; unavailable/blocked is not successful empty inventory |
| Offer diversity | Guarded reciprocal rank fusion or maximal marginal relevance | **HOLD**; exact variant, seller and price eligibility gates precede ranking |
| Duplicate suppression | Hash-keyed source/variant set, stable ownership key | **EXISTING**: inspect current canonical identity and dedup before changing |
| Streaming consistency | Monotonic partial-order reconciliation with stable snapshots | **EXISTING**: preserve SSE/JSON contracts, avoid stale price trust elevation |
| Cost comparisons | Comparable landed-cost vector: price + known shipping/tax/import, explicit unknown terms | **FUTURE**; unknown Saudi shipping cannot be treated as free |
| Performance experiments | Matched cold/warm A/B and negative controls | **NOW** via current GitHub CI; no claim of universal p95 |

## 3. Development layers and language policy

- **JavaScript ESM / Node.js 22:** Keep runtime orchestration, source adapters, HTTP APIs, server-enforced trust, SSE/JSON and lightweight `perf_hooks` observations. Prefer built-in `node:test` and source-controlled fixtures.
- **Python 3.12:** Reserve for authorized product extraction, HTML parsing, validation and narrowly scoped enrichment; preserve JSON Lines framing, Pydantic contracts and tight deadlines. Do not make optional Python a mandatory source.
- **PostgreSQL:** Canonical observation chronology, source ownership, source-safe evidence and transactional writes; optimize queries only after `EXPLAIN (ANALYZE, BUFFERS)` on an isolated test copy, never destructive production analysis.
- **Meilisearch:** Candidate retrieval only; never promote an index hit to valid live price without canonical controls.
- **TypeScript:** Optional incremental static contract checking on isolated modules; avoid rewriting production ESM solely for syntax.
- **Rust/WASM:** Defer entirely until a reproducible CPU flamegraph identifies a pure hot loop with benchmarked language-boundary benefit.
- **Browser / HTML/CSS:** Keep existing customer visual smoke testing and actual evidence/variant checks.

## 4. Open-source tool candidates (GitHub)

These are evaluation candidates, NOT claims that NAWAA has installed or integrated them.

| Project | Repository | Value | Adoption decision |
|---|---|---|---|
| Node.js native performance | https://github.com/nodejs/node | `perf_hooks`, CPU usage, built-in test runner | **USE NOW, no new dependency** |
| fast-check | https://github.com/dubzzz/fast-check | JS property-based testing for identity and cancel invariants | **EVALUATE** for test-only adoption after verifying lockfile and CI resource budget |
| Hypothesis | https://github.com/HypothesisWorks/hypothesis | Python property-based tests for parser and evidence contracts | **EVALUATE** in disposable tests, not production install |
| Playwright | https://github.com/microsoft/playwright | Browser-visible search and regression tests | **REUSE if already available**, don't add new browser runtime services |
| OpenTelemetry JS | https://github.com/open-telemetry/opentelemetry-js | Standard traces when existing spans insufficient | **DEFER** collector/export overhead until justified |
| dependency-cruiser | https://github.com/sverweij/dependency-cruiser | Detect illegal source-to-presentation dependencies | **EVALUATE** CI-only if architecture drift appears |
| autocannon | https://github.com/mcollina/autocannon | Reproducible LOCAL HTTP load tests | **EVALUATE** only on disposable localhost, never stress third-party merchants |
| Clinic.js | https://github.com/clinicjs/node-clinic | Historical flame/async diagnostics | **DO NOT ADOPT**: upstream warns not actively maintained and potential Node.js incompatibility |
| TypeBox | https://github.com/sinclairzx81/typebox | JSON Schema/type contracts if existing schema validation is insufficient | **DEFER**, avoid competing validation stacks |
| OpenTelemetry Python | https://github.com/open-telemetry/opentelemetry-python | Python traces if extraction timing later requires distributed correlation | **DEFER**, no telemetry backend by default |

Source documentation: https://nodejs.org/api/perf_hooks.html , https://fast-check.dev/docs/introduction , https://github.com/clinicjs/node-clinic .

## 5. Promotion gates

1. Every new dependency needs a measured bottleneck, version/license/security review, locked versions, free resource fit and an isolated proof that existing libraries are insufficient.
2. No paid proxy, paid model, source denial evasion, added live endpoint, external tracing collector or new provider traffic merely for telemetry.
3. Positive and negative identity tests must preserve iPhone generation/storage, PS5 console/accessory, merchant seller, price currency, URL and observation ordering.
4. Benchmark process CPU and event-loop utilization **only on sufficiently slow sampled paths** to avoid logging raw user queries, product content or URLs.
5. A low event-loop utilization reading with a high acquisition span suggests external waiting; a high reading plus high process CPU suggests contention worth profiling, but neither is dispositive without controls.
6. Require exact-head CI PASS, authorized merge, observed Render auto-deploy exact SHA, production health and bounded customer acceptance before claiming production improvement.

## 6. Knowledge and next falsification step

Candidate v22.03 adds process pressure to the two existing slow-only events: `NAWAA_SEARCH_JSON_PIPELINE` and `NAWAA_SEARCH_JSON_RESPONSE`. Compare their values, Render Free CPU metrics and matched customer query/cache cohorts. If high process pressure is demonstrated, run controlled isolated CPU profiling and remove proven repeated processing. If low, investigate wait, source failures, queue or transport independently.

Do not interpret overlapping per-request CPU deltas as additive. Do not publish fabricated prices or claim improved p95 latency solely from unit tests.
