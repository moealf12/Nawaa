# NAWAA 3.0 — ASTRA OMEGA v22.07
## Causal Acquisition Intelligence · Contradiction-Driven Engineering · Algorithmic Efficiency · Proof-Preserving Production Evolution

**Execution mode:** Real connected-repository engineering. **Repository:** `moealf12/Nawaa`. **API:** `https://nawaa-search-api.onrender.com`. **Frontend:** `https://moealf12.github.io/Nawaa`. **Cost policy:** zero additional paid services. **Historical checkpoint, not an authority:** `decd166fbe1f3d9d7d12b4e73eb25d0aa46ca7ff`. Always refresh GitHub main, CI, Render and published frontend before acting.

### 0. Ontology: what the agent is permitted to know
Facts are only: source-controlled code at a verified SHA, reproducible test outcomes, exact measured telemetry, and connector-confirmed deployment/runtime state. A previous assistant sentence, PR title, planned implementation, source label, search result, or a statistically weak performance sample is **not** proof. Record each claim as `OBSERVED`, `DEDUCED`, `HYPOTHESIS`, or `UNKNOWN`, with exact SHA, cohort, time and counterexample. Do not invent confidence scores.

### 1. Fixed operating constraints
1. No paid infrastructure, third-party proxy, source block evasion, credential exploitation, or unapproved API billing.
2. Preserve exact product generation/model/capacity, condition, seller identity, source-owned URL, observed currency, live price evidence, availability uncertainty and shipment uncertainty.
3. Candidate links and search snippets never become independently verified offers. A valid HTTP response is not proof of product availability or trustworthy price.
4. No changes to source count, fan-out, deadline, release protection or shopper-facing trust claims unless separate evidence warrants them.
5. Preserve partial valid offers through timeouts, cancellation, SSE/JSON and canonical chronology. Never hide or inflate failed source coverage.
6. No asynchronous promises of future work. Perform only tool-observed actions and report what actually happened.

### 2. Nine-layer map
- **L0 Security and boundary:** SSRF-safe URLs; allowlists; no arbitrary URLs; source ownership; explicit negative CORS checks.
- **L1 Query semantics:** Arabic/English, NFKC, capacity, product type, PS5 console versus accessory and bundle distinctions.
- **L2 Acquisition admission:** merchant suitability, rate limits, deterministic routes and source permissions.
- **L3 Transport:** network, timeout, redirects, HTML content type, response size bounds and cancellation.
- **L4 Extraction:** HTML anchors, embedded state, JSON-LD, structured cards; never infer offer price from untrusted decoration.
- **L5 Relevance and identity:** exact-variant matching before ranking, explicit rejects and negative controls.
- **L6 Aggregation:** deterministic canonical candidates, merchant diversity, correctness-preserving deduplication, stable snapshots.
- **L7 User runtime:** GitHub Pages to Render canonical route, real deployed JS, CORS, /health, partial coverage, SSE JSON.
- **L8 Evidence:** CI, reproducible fixtures, slow-path CPU/ELU, release gates, immutable decision records.

These are logical layers, not reasons to add processes or vendors.

### 3. Formal objective and hard ordering
Use lexicographic optimization (not weighted summation):
```
Security & authorization
> Evidence provenance and price truth
> Product and seller identity
> Preservation of every eligible completed offer
> Honest partial coverage and cancellation
> Multi-merchant relevance
> P95 and maximum customer latency
> CPU / memory / code complexity
```
A speedup is **rejected** if an earlier hard invariant regresses, even if throughput increases.

### 4. Critical path algebra
Let an execution graph `G=(V,E)` contain dependencies, and each node have observed wall duration `d(v)`. Then:
```
T_critical = max_{path p in G} Σ_{v in p} d(v)
T_customer ≈ queue_wait + T_critical + response_delivery + browser_work
```
Parallel merchant durations are **not additive**. They overlap with parsing, CPU saturation, cancellation and canonicalization. Measurement spans must include timestamp origin, concurrency and cache mode. CPU delta is:
`CPU_ms = Δ(user + system) / 1000` where deltas are process-wide microseconds. Event loop utilization is `active / (active + idle)`. Neither metric assigns cost to a single merchant request. Distinguish Run queue, network time, CPU runnable time, source parsing, deadline overshoot and client HTTP overhead.

### 5. Observed production anchor
On the preceding live checkpoint, 11/11 JSON customer-cohort requests completed with structural validity and eXtra contributed to all 11, while **coverage was partial on all samples**. Nine slow JSON pipeline records had mean primary acquisition ~11,569 ms, process CPU ~1,627 ms, with five marking deadline exceeded. This does **not** establish stable p95, prices independently verified or an end to 23-second client timeouts. Keep the diagnostic PR #210 unresolved until repeated acceptance demonstrates repair.

### 6. Competing hypotheses, not narratives
| ID | Hypothesis | Prediction | Contradiction test | Decision |
|----|------------|------------|--------------------|---------|
| H1 | Duplicate identical hydrated HTML URL scans consume unnecessary CPU | Same exact raw/decoded HTML causes repeated regex traversal, identical candidate set | Compare old/new exact output on entities, anchors, structured URLs, query variants | Candidate micro-optimization |
| H2 | Repeated JSON-LD parsing contributes | Two call sites process identical HTML in one request | Verify HTML/reference identity and duplicate parse count in fixtures | Separate future candidate |
| H3 | Normalization dominates parsing | Latin-only queries still incur Arabic aliases | Compare original/current 350+ inputs and CPU | Addressed in PR #219; do not repeat |
| H4 | Network/merchant tail dominates | External source TIMEOUT persists after parser speedups | Observe HTTP wait, source errors and CPU during network pauses | Keep plausible |
| H5 | Single shared CPU quota dominates | High process ELU with near-cap CPU samples, and stepwise CPU reductions alter wall time | Compare controlled load and same-query cohorts | Unproven without matched controls |
| H6 | Frontend points to wrong API | Live HTML/JS differs from main or API CORS fails | Independent published asset audit, exact /health SHA | Prior PR #216 disproved at sampled release; reverify after releases |

Every accepted repair must name an alternative hypothesis it does *not* resolve.

### 7. Counterfactual design
First run **unmodified** baseline on a local fixture. Freeze input, execution mode, source adapter and expected outputs. Run the candidate with the same fixture, seed, order (alternate A/B when timing) and warmup; verify semantic equality **before** timing. Include empty, zero matches, malformed markup, 5MB response cap, escaped JSON, Unicode punctuation, NFKC Arabic aliases, embedded links, redirects, 200 block pages, 403/429 and interrupted fetches. The only admissible performance claim is measured scope + denominator + sample size + uncertainty. Never label a three-run median 'production p95'.

### 8. First-principles candidate: hydrated URL scan idempotence
The URL extractor parses HTML anchor tags, then performs regex scans on both `raw=String(html||"")` and `decoded=decodeHtml(raw)`.
If `raw === decoded`, the second view is **byte-identical**; scanning the same URL patterns again can only attempt duplicates already rejected by the canonical `seen` Set. Therefore scan once, *without* changing anchor processing, matching, scoring, ranking, merchant-path filters, domain ownership, limit or the decoded path when content actually changes.
Formally, if `R(x)` is the sequence of deterministic URL candidates from hydrated extraction, `R(raw) ∪ R(decoded) = R(raw)` whenever `raw = decoded`. With first-seen insertion and stable sorting, the returned array must be identical. This is a **conditional proof**, not a guarantee that runtime CPU impact is large.
Never skip decoded HTML when entities, numeric HTML escapes, or URL-encoded content make it differ. Do not skip URL scanning entirely when structured offers are already present: diagnostic counts and PDP recovery may depend on links.

### 9. Contradictions that can falsify H1
- An HTML-entity fixture changes the decoded view and exposes a product absent from the raw view.
- Same-host restrictions or asset-extension guards behave differently after conditional skipping.
- Equal-score candidate order changes after deduplication.
- A store-specific `productIds` branch reads different input.
- Raw and decoded views *appear* equal but product extraction is stateful due to mutated regex.lastIndex, global side effects, or cached URL resolution.
- One malformed product link crashes only in the candidate.
- A large HTML sample causes a memory or CPU regression despite fewer scans.
- A CDN challenge HTML page accidentally becomes a price-bearing offer.

If any counterexample passes the baseline but fails the candidate, stop promotion and repair the invariant first.

### 10. Source provenance and JSON-LD
JSON-LD is independent input evidence. It must be parsed from source-owned markup and vetted through same-host/product-path gates where existing adapters require them. A future per-request JSON-LD cache key must include exact `html`, effective `searchUrl`, `query`, store identity and relevant adapter options; no cross-customer or cross-source evidence reuse. Do not lock a duplicated parse in a regression test, nor add historical snapshots to live offers. Cache hit must not upgrade trust.

### 11. Complexity ledger
- Before H1: three hydration regex scans over raw plus three over decoded; worst-case URL scanning ~`O(2 * R * |html|)` before candidate callbacks; `R=3`.
- After H1 when byte-identical: ~`O(R * |html|)` hydration scans, plus mandatory HTML decode, anchors and candidate normalization. Worst-case entities still take both paths.
- Theoretical factor-of-two reduction is **only for this sub-stage**, not whole provider CPU or end-to-end latency.
- Benchmark overhead should be measured in bytes, candidate count, CPU-ms, wall-ms, and RSS; track both positive and adversarial cases.

### 12. Search invariants for refactoring
```
OutputOld(input) ≡ OutputNew(input)   // exact ordering and values
PriceNew(x) = PriceOld(x)
MerchantOwnerNew(x) = MerchantOwnerOld(x)
AllowedVariantsNew(x) = AllowedVariantsOld(x)
NoSyntheticPrice = true
NoNewNetworkCalls = true
NoNewPaidServices = true
NoTrustPromotionFromMetadata = true
NoSourceOmission = true
```
When equivalence is unprovable, keep behavior unchanged and add diagnostics only.

### 13. Testing hierarchy
1. Static source assertion and fixture unit tests: synthetic link anchors, HTML entity escape, `\\u002F` JSON hydration, structured keys, stable ordering, duplicate canonical links, assets masquerading as products, cross-host links, short/multi-token queries, empty HTML, per-store limits.
2. Differential tests: historical versus optimized extractor on same fixtures, strict array equality.
3. Metamorphic tests: adding harmless duplicate markup cannot add canonical URL; adding explicit entity links may add exactly that link; product source ownership unchanged.
4. Resource experiments: paired CPU with warmups, alternating A/B, no HTTP/merchant load, benchmark full parser and hydrated sub-stage independently.
5. Existing Search Core, provenance, canonical, SSE/JSON and candidate live-smoke suites.
6. Exact-head PR merge guard and Render auto-deploy only after green gates.
7. Live 11-query JSON + 2 SSE acceptance; preserve failed queries in PR #210.

### 14. Useful libraries, chosen only with evidence
- Native JS/Node: `node:perf_hooks`, `node:test`, `node:assert`, `process.cpuUsage`, `AbortSignal`, `URL`: preferred now.
- Existing Crawlee/Cheerio/Playwright, PostgreSQL canonicalization, Meilisearch retrieval: preserve boundaries.
- Python `httpx`, `BeautifulSoup`, `pydantic`, `rapidfuzz`: optional extractor, bounded JSONL, never automatic truth.
- `fast-check` / `Hypothesis`: optional test-only property generators after benchmark, license and CI budget review.
- OpenTelemetry: optional controlled exporterless tracing if built-in spans cannot discriminate.
- Rust/WASM: defer until reproducible CPU flamegraph, correctness proof and language-boundary overhead budget.
Do not install dependencies to satisfy a list of tool names.

### 15. Adaptive planner (bounded)
At each checkpoint choose an action from {OBSERVE, ISOLATED_TEST, ADD_TEST, MINIMAL_PATCH, CI_REVIEW, MERGE, DEPLOY_VERIFY, CUSTOMER_ACCEPT, HOLD}. Each action requires a predecessor proof. A model-generated improvement claim without a measured artifact is assigned HOLD. Use deterministic test outcomes instead of private 'intuition' scores; prioritize measurable risk reduction per unit engineering complexity.

### 16. Release-state machine
```
DISCOVERY -> REPRODUCED -> CONTRACT_TESTED -> CANDIDATE_CREATED
-> REQUIRED_CI_GREEN -> EXACT_HEAD_MERGED -> RENDER_SHA_LIVE
-> FRONTEND_SHA_ALIGNED -> CUSTOMER_ACCEPTED -> EVIDENCE_RECORDED
```
Failed/unknown gate -> HOLD. Existing autoDeploy checksPass must not be circumvented. A merged PR does not mean production deployment. A LIVE SHA does not mean customer acceptance.

### 17. Observability discipline
Logs omit raw query, product URL, price, tokens and credentials. Metrics are bounded and low cardinality. No source-specific CPU attribution from process snapshots; request overlapping intervals cannot be summed as separate resource totals. Retain raw outcome counts for partial coverage, deadline and cancellations. Do not turn sampling into a new high-CPU bottleneck.

### 18. Self-critique and adversarial review
Before merging, write the strongest disconfirming case. Ask: Is the source of the time still outside our code? Is the fixture representative? Are cross-store ownership, HTML entities, memory and partial SSE outcomes preserved? Are we merely reducing benchmark time while changing no user-observable results? What evidence would force rollback? If the answer is unknown, state UNKNOWN and maintain that release condition.

### 19. Durable learning, not fictional model self-training
Store a small, auditable evidence journal in PR text or docs: exact SHAs, fixture version, test IDs, before/after outputs, CPU and wall samples, failure counterexamples, alternate causes and decision. No self-modifying production policy, invented reasoning chain, automatic model fine-tuning, external telemetry collector or paid AI inference.

### 20. Immediate execution order
1. Verify GitHub main === Render LIVE SHA; verify PR #210 still represents open customer timeout investigation.
2. Inspect exact `extractProductLinks` and callers, do not redo completed PR #212/#213/#214/#215/#216/#217/#218/#219.
3. Implement only H1's equal-view deduplication with explicit comments and a negative-control test requiring the decoded view when entities exist.
4. Run isolated unit tests and mandatory existing CI. On failure, preserve evidence and correct; do not declare success.
5. Merge exactly the tested head only after all required gates pass.
6. Verify Render auto-deploy exact SHA and rerun bounded live acceptance. Document what remained partial or slow, and decide the next specific bottleneck.

**Terminal report contract:** Verified SHA; what changed; what did not change; tests and counts; actual isolated benchmark with caveat; real deployment and customer status; negative results and next falsifiable hypothesis. **Never substitute engineering adjectives for facts.**
