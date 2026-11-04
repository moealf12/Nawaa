# ARCHIVED REFERENCE — NOT CURRENT EXECUTION AUTHORITY

This is a user-supplied historical NAWAA ASTRA OMEGA blueprint **v23.10, dated 2026-10-30**, preserved for the engineering agent's technical reference. Its embedded prompts, "FIRST ACTION" sections, SHAs, deployment IDs, PR states, source statuses, and development order are **historical content**, not current commands or evidence.

**Precedence:** current GitHub main + exact checks + production facts > `engineering/execution/rounds.json` (with disagreement reported, not silently corrected) > current `AGENTS.md` operating constraints > this archival blueprint. The latest user-authorized scope still governs what actions can be performed.

- Never restart E00/E01 or any completed work solely because this document says "FIRST ACTION".
- Never interpret historical v23.10 or embedded v23.20 addendum as a replacement for the current 21-round ledger or v23.21 master working blueprint.
- Preserve identity, money, provenance, chronology, SSE/JSON, cancellation, access rules, no-paid-infrastructure, reversible changes and exact-SHA evidence.
- Consult sections relevant to the current invariant; do not import all its proposed changes into one pull request.

---

# NAWAA 3\.0 — ASTRA OMEGA: Evidence\-Locked Engineering Execution Blueprint

**Version:** 23\.10 / Plan\-only / 2026\-10\-30
**Repository:** https://github\.com/moealf12/Nawaa
**Production API:** https://nawaa\-search\-api\.onrender\.com
**Frontend:** https://moealf12\.github\.io/Nawaa
**Observed main SHA:** `306c33e0c09fddc3b5b579369de7c8a998c6160f` &#40;snapshot, never an immutable execution target&#41;
**Observed Render LIVE deployment:** `dep-dbidu0g473hc73cgq1j0`, commit `306c33e0c09fddc3b5b579369de7c8a998c6160f`
**Observed GitHub commit checks:** 26 of 26 successful; the workflows Search Core Tests, Live Source Validation, Live Source Audit and Pages build/deployment completed successfully\.
**Concurrent\-work conflict:** PR \#227 is open and changes `server/providers/free-storefronts.mjs` and `tests/amazon-sa-search.test.mjs`; do not modify those areas in a competing PR until the overlap is reconciled\.
**Status:** TECHNICAL DESIGN ONLY\. No repo changes or deployments made by this blueprint\.

> **Correctness statement.** Neither an LLM prompt nor a test suite can mathematically guarantee zero defects. This plan instead requires proof-carrying modifications: every substantive assertion is supported by a directly inspected SHA, execution artifact, or explicitly labeled hypothesis; critical invariants get independent tests and negative controls. When proof is missing, the status is UNKNOWN, not PASS.

## A\. Operating constitution

1. **Preserve product truth\.** Never merge distinct variants; never certify a price from search text alone without required provenance; never infer missing cost components as zero; never turn a source failure or a stale record into `IN_STOCK`\.
2. **Preserve source truth\.** Distinguish configured, selected, attempted, reached, parsed, matched, verified, displayed\. `HTTP 200` is not `OFFER_VERIFIED`\. A challenge page, blocked request, empty valid catalog, exhausted budget, and no matching product are different outcomes\.
3. **Preserve temporal truth\.** A later\-arriving response is not necessarily a newer observation\. No older or equal\-time\-conflicting observation overwrites accepted canonical fact\.
4. **Preserve customer parity\.** SSE and JSON may differ in timing and partial progress; they must not disagree on shared identity/price/acceptance policy at comparable snapshots\.
5. **Preserve completion semantics\.** `partial` is never relabeled `complete` by the cache, index, or UI\. Valid partial offers may still be displayed with accurate coverage status\.
6. **Preserve resource bounds\.** Source and global concurrency, bytes, parsed DOM size, deadline, retries, fan\-out, memory, and CPU must be bounded\. Cancellation propagates, and canceled requests cannot publish obsolete facts\.
7. **Zero\-paid infrastructure\.** No subscriptions, proxies, paid APIs, new hosted services, bypass of authorization, or changes to source restrictions\. Live merchant probes are bounded and respectful, preferably done only after deterministic fixtures\.
8. **Fail closed on evidence, not on user experience\.** A missing trusted price cannot become a verified offer\. Yet a failed source must not erase already\-verified offers from other sources\.
9. **Change isolation\.** One causally connected problem per PR; baseline must be reestablished against its exact parent SHA\. No blind rebase/force push/merge on failed checks\. Never copy secrets or customer queries into diagnostics\.
10. **Operational truth\.** GitHub green checks are necessary but not sufficient for successful LIVE customer acceptance\. Record expected vs observed SHA, deploy ID, HTTP outcomes, and real coverage before claiming deployment success\.

## B\. Evidence protocol — anti\-hallucination and anti\-regression

For each finding or action, maintain evidence fields:

`claim_id | claim_text | level | source_type | source_uri | sha/deploy_id | path:lines | command/test | input_fixture_hash | expected | observed | result | caveats | status`\.

Evidence classes:

- **E0:** inferred or untested hypothesis → cannot be stated as established bug\.
- **E1:** isolated deterministic reproduction on content verified to match GitHub blob, with failing desired invariant → confirmed local defect\.
- **E2:** directly verified code semantics, without full integrated reproduction → supported code risk\.
- **E3:** real CI/Render/live telemetry with trace and exact deployed revision → observed runtime behavior; sampling and attribution limits remain\.
- **E4:** independent integration test or end\-to\-end customer acceptance on exact revision → deploy\-scope evidence, not a universal correctness proof\.

Separate three test states: `BASELINE_RED` &#40;current implementation violates invariant&#41;, `PATCH_GREEN` &#40;candidate passes&#41;, `MUTANT_RED` &#40;negative control fails as intended&#41;\. A historical RED is not proof of a current GREEN\.

An executed change is complete only with file diff, command, exit code, result artifact, CI job links, exact SHA, Render deployment ID if deployed, and post\-deployment acceptance\. If any are absent, say **NOT VERIFIED**\.

## C\. Current repository anchors — recheck on every engineering round

- `package.json`: Node \>=22, direct `meilisearch`, `pg`, `cheerio`, `crawlee`; `npm test`; canonical package lock\.
- `workers/python-intelligence/pyproject.toml`: Python \>=3\.12, `httpx`, `beautifulsoup4`, `lxml`, `pydantic`, `rapidfuzz`; optional `pytest` and `hypothesis` &#40;Python CI already installs them&#41;\.
- `workers/crawler/package.json`: Crawlee \+ Playwright in a separate worker; browser access is not the default search path\.
- `server/search-cache.mjs`: positive offers are cached even when provider coverage is partial; generation invalidation and per\-key coalescing exist\.
- `server/offer-selection.mjs`: any nonzero confidence delta overrides the price delta in the comparator; threshold branch has no effective behavioral distinction there\.
- `server/source-reliability.mjs`: source\-quality tracking and routing score exist; score effectiveness needs scheduling integration and better stage\-specific telemetry\.
- `server/search-index.mjs` \+ `server/persistence.mjs` \+ `server/canonical-offer-identity.mjs`: legacy and typed canonical identity differ; versioned canonical outbox implementation is test\-only in `server/omega-canonical-index.mjs`\.
- `src/search-query.mjs`: extensive Arabic/English synonyms, filters, model and accessory safeguards; avoid replacing with approximate fuzzy\-only rules\.
- `src/search-core.mjs`: precise but potentially quadratic candidate grouping, and partial\-vs\-confirmed price semantics\.
- `server/providers/free-storefronts.mjs`: broad source catalog and bounded per\-store operations; concurrent PR \#227 overlaps this file\.
- `src/search-page.mjs`: frontend SSE, request identity, display and price history; validate settlement and priceBasis boundaries\.
- `.github/workflows/search-core-tests.yml`: main tests, disposable Postgres and Meilisearch; Omega tests are isolated, not a declaration of production activation\.

Do not assume last week’s SHA, a stale PR base, or a previously reproduced defect still exists unchanged\. Run `git diff baseline..HEAD`, source\-diff inspection, CI status, Render LIVE validation at every PR start\.

## D\. Measurable service goals and required baselines

The following are proposed acceptance metrics, **not current production measurements**\. Collect a pinned replay corpus with query strata: smartphone &#40;capacity/model&#41;, gaming &#40;console/disc/SSD/accessory/bundle&#41;, audio Arabic/English, computing &#40;model/RAM/storage&#41;, home, fashion, beauty, jewellery, watches, international shipping and foreign currency\. Represent negative or ambiguous fixtures &#40;search shells, CAPTCHA/challenge, product links only, recycled SKU, 404, 429, unrelated model, unknown shipping, mismatched priceBasis, stale observation&#41;\.

For each query/replay, collect:

- `precision_at_k` and `verified_recall_on_labeled_corpus` &#40;recall cannot be measured without adjudicated ground truth&#41;\.
- `false_variant_merge_count`, `false_verified_price_count`, `stale_overwrite_count`, `wrong_currency_comparison_count` — hard blocker target **0 in the finite certification corpus**, never a claim of universal zero\.
- `verified_unique_offers`, `verified_unique_merchants`, `source_attempted`, `source_parsed`, `source_verified`, `source_displayed`, `deadline_partial_rate`, `source_failure_class`\.
- `TTFVO` &#40;time to first verified offer&#41;, `TTFS` &#40;first visible SSE snapshot&#41;, `T_json_complete`, P50/P95 with observation count, distribution, release SHA; separate slow\-log\-tail\-biased samples from population metrics\.
- CPU time, event\-loop utilization/delay, memory RSS/heap, browser render time, max active requests per source/global, max outbound requests/query, retries, canceled work, and stale cache age\.

No global numerical improvement claim before paired baseline/candidate experiments\. Proposed gate: correctness may not regress at all on critical fixtures; performance acceptance requires paired measurements and a predeclared meaningful effect threshold, not cherry\-picked fastest run\. Where production P95 cannot be measured, report `UNKNOWN` and use controlled load figures labeled as synthetic\.

## E\. Dependency\-ordered, reversible PR program

|PR slot|Epic                                    |Main files                                                                 |Precondition                             |Expected proof                                                                                                   |Disable/rollback                                                 |
|-------|----------------------------------------|---------------------------------------------------------------------------|-----------------------------------------|-----------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------|
|**E00**|Baseline & contract freeze              |`scripts/`, `tests/`, docs                                                 |Exact main/deploy, PR collision inventory|SHA-bound replay manifest, source-stage glossary, measured baseline                                              |No prod change                                                   |
|**E01**|Cache partial correctness               |`server/search-cache.mjs`, tests                                           |E00                                      |`BASELINE_RED / PATCH_GREEN / MUTANT_RED`; complete-vs-partial state, no valid-offer erasure                     |Old behavior remains flag-gated only if safe, otherwise revert PR|
|**E02**|Cache invalidation & stale safety       |same cache module, search lifecycle                                        |E01                                      |burst invalidation of 1/10/50 keys, singleflight, no obsolete publication, bounded source attempts               |Revert to prior proven invalidation path                         |
|**E03**|Offer ranking correctness               |`server/offer-selection.mjs`, `src/search-core.mjs`, tests                 |E00 + product-policy fixture             |strict, transitive deterministic comparator; price only within compatible evidence cohorts                       |versioned rank policy flag                                       |
|**E04**|Stage-specific source outcome telemetry |`server/server.mjs`, source adapter wrapper, tests                         |E00                                      |stage counts reconcile, failures distinguish parse vs identity vs price, no PII                                  |telemetry opt-out                                                |
|**E05**|Source scheduling sandbox               |new `server/source-scheduler.mjs`, isolated fixtures                       |E04                                      |bounded concurrency/host fairness, deadline, cancellation, deterministic replay A/B                              |scheduler remains shadow-only                                    |
|**E06**|Source scheduler gated rollout          |`server/server.mjs`, scheduler; PR #227 must be reconciled                 |E05 and current HEAD                     |non-regressive coverage, TTFVO/CPU per paired load, fairness/no starvation                                       |one flag off, legacy scheduling intact                           |
|**E07**|FX robustness & exact price contract    |`server/fx.mjs`, Python contract, `src/search-core.mjs`, tests             |E00                                      |singleflight, abort/timeout, invalid currency fail closed, exact cents/rounding, no inferred shipping            |feature flag; preserve approved evidence                         |
|**E08**|Price history and basis integrity       |`src/search-page.mjs`, price-domain helpers, tests                         |E07                                      |no comparison of advertised vs confirmed-total in historical delta; cross-currency exactness                     |old visualization hidden if invariant fails                      |
|**E09**|Canonical identity shadow reconciliation|`server/canonical-offer-identity.mjs`, `server/product-identity.mjs`, tests|E00/E03                                  |collision corpus, scoped SKU, variant conflicts, no fabricated merge                                             |shadow mode only                                                 |
|**E10**|Canonical DB/outbox migration design    |`server/omega-canonical-index.mjs`, migrations, tests                      |E09 + snapshot/backup plan               |isolated PostgreSQL & Meili multi-process, crash/ACK/replay, equal-time conflicts, bounded batch fairness        |reversible/forward-safe migration, rollback read path            |
|**E11**|Canonical read/write limited rollout    |persistence/index/server, migrations                                       |E10 + ops readiness                      |exact revision-read, dual-read diffs, live 0 critical mismatches in observed canary corpus, no stale resurrection|disable canonical routing; preserve observations                 |
|**E12**|Matcher blocking performance            |`src/search-core.mjs`, benchmark and parity fixtures                       |E09                                      |same groups on labeled corpus, subquadratic candidate pruning, 30/120/300 stress, deterministic ordering         |legacy grouping flag                                             |
|**E13**|Python worker hardening                 |`workers/python-intelligence/` + Node bridges                              |E04/E07                                  |JSONL contract parity, worker cleanup/cancellation, targeted optional enrichment, no slowdown to core            |disable optional Python enrichment                               |
|**E14**|HTTP/SSE lifecycle parity               |`src/search-page.mjs`, `server/search-http-lifecycle.mjs`, tests           |E01/E03/E11 (as needed)                  |cancel/done/error/timeout settle once, no stale UI writes, SSE/JSON same accepted truth                          |preserve JSON fallback                                           |
|**E15**|Engineering gates                       |dev test dependencies, CI, scripts                                         |E00 and phased rollout                   |negative mutation controls, fast-check/Hypothesis, static checks, no CI path-skips on required rules             |remove only unstable optional checks, never core gates           |
|**E16**|Light luxury UI/accessibility           |`src/search-page.mjs`, CSS/HTML, browser tests                             |stable APIs / E08/E14                    |mobile, keyboard, accessible contrast and motion, no price truth regressions                                     |revert visual PR independently                                   |
|**E17**|Source adaptive research                |offline simulations; reliability engine                                    |E04/E06                                  |offline posterior calibration, no exclusion of rare best-price sources, factual evidence vs ranking forecast     |keep heuristics; never make unproven AI authoritative            |

Execution order is a DAG, not a requirement to merge every PR sequentially; independent work can proceed in non\-overlapping files after E00\. **Do not modify the same file in concurrent uncoordinated PRs\.** PR numbering E00–E17 describes work packages, not actual GitHub PR numbers\. Where code already implements the target in an updated HEAD, mark `ALREADY_DONE_WITH_EVIDENCE` and omit duplicate implementation\.

## F\. Precise algorithm and mathematics contracts

### F1\. Source effectiveness

Define for source `s` and query category `c` independent stage counts: `attempted`, `transport_ok`, `parsed`, `identity_accepted`, `price_verified`, `displayed`, `unique_useful`\. Distinguish conditional probabilities:

`p_transport = P(transport_ok | attempted, s,c)`;
`p_price = P(price_verified | transport_ok, s,c)`;
`p_unique = P(unique_useful | price_verified, s,c)`\.

Then `p_useful = p_transport * p_price * p_unique` **only** when each stage conditional probability is estimated against the previous stage consistently and no omitted stage is silently counted as success\. Include Bayesian shrinkage if sample sizes justify it\. Existing Beta\-prior constants are hypotheses, not measured probabilities\. Abstain when sample count insufficient\. Source health must not be defined by mere `HTTP 200`; distinguish healthy\-empty from blocked\.

### F2\. Source scheduling

Let each candidate source operation `a` have expected incremental unique verified value `ΔV(a | A)`, measured expected duration `E[T_a]`, network/CPU cost and an allowed\-host constraint\. Under finite budget `B` maximize `E[V(union accepted offers)]` subject to per\-host/global concurrency and deadline\. This is a stochastic constrained scheduling problem; use conservative bounded greedy scoring for an implementable baseline, not a claim of exact global optimality\. Reserve exploration opportunities so weak historical sample yield cannot permanently starve niche or cheapest sources\. Never automatically declare source `OUT_OF_STOCK` because access failed\. Cancel late work and ignore post\-deadline data\.

Control steady\-state concurrency using `L = λW` only if Little’s\-law assumptions apply and means are measured\. Distinguish source/network wall time and CPU time\. No unconditional batch amplification\.

### F3\. Match and grouping

Build `BlockingKey = family/category/brand/model` for candidate lookup, while preserving a slow conservative fallback for incomplete identifiers\. Identify `must_not_link` pairs from conflicting product model, manufacturer variant, capacity, edition, condition or authoritative identifier\. SKU is merchant\-scoped; GTIN can be global if verified\. A fuzzy score or transitive chain is insufficient for product equivalence\. If `compatible(A,B)` and `compatible(B,C)` but not `compatible(A,C)`, do not union all three; verify cluster all\-pairs compatibility or a semantically proven cluster predicate\. A simple global Union\-Find over fuzzy edges is disallowed\.

Candidate pair\-count theoretical upper bound `n(n-1)/2`; for n=300 gives 44,850\. Ten groups of 30 give 4,350 within\-group pair checks in an ideal balanced blocking example, \~90\.3% reduction of *pair count*, not proven CPU or latency\. Benchmark actual grouping with 30, 120, 300 and larger generated adversarial fixtures; comparison against parent must preserve the adjudicated reference output\.

### F4\. Ranking

Use a strict total ordering over known admissible categories, e\.g\. reject incompatible \-\> exactness \-\> verified category \-\> confidence band \-\> compare price *on same basis only* \-\> deterministic stable identity tie\-break\. Avoid pairwise epsilon\-comparators whose nontransitive ordering can cause arrival\-dependent output\. `compare(a,b)` must be antisymmetric, transitive and deterministic\. Hard guard: a cheap accessory or wrong variant cannot outrank an exact console because of lower numerical price\. Merchant diversity may round\-robin *within stable evidence cohorts*; define whether result position or economic ranking is the target\.

### F5\. Money/FX

Represent every observed amount as decimal string \+ ISO currency \+ `observedAt` \+ evidence source \+ rate version\. Avoid binary float for auditable arithmetic and specify a final rounding policy once\. An admissible confirmed delivered total is `P*R+shipping+import+tax_not_already_included+mandatory_fees-discount_eligible`, with each component supported\. Unknown component =\> `TOTAL_INCOMPLETE`, not 0\. For intervals &#91;L,U&#93;, A is provably cheaper than B only if `U_A < L_B` with same variant and destination; if upper bound unknown then no claim\. Do not claim `lowest delivered` when the cheapest quoted number is an advertised product\-only price\. For FX, share in\-flight request per currency/time\-bucket, bound timeout and cache TTL, surface invalid currency as typed failure, and never convert blank currency to SAR by assumption\.

### F6\. Canonical state & ordering

Write immutable observations in PostgreSQL; the canonical record is decided transactionally\. Distinguish newer, duplicate\-same\-content/same\-timestamp, conflict\-same\-timestamp, rejected\-older\. A monotonic `revision` protects publication order\. Use an outbox keyed by `(offerKey,revision)` and idempotent index operations; Meilisearch is a derived discovery index, not the only authority\. Demonstrate crash between DB commit, task submission and ack, duplicate delivery, out\-of\-order index task success, process restart, and reconciliation with \> 121 keys\. Prefer a dual\-read/validation path before switching production\. Have a documented rollback that does not discard source observations\.

### F7\. Cache and cancellation

Use explicit response quality `complete|partial|failed` and separate cache serving from price freshness\. Partial\-with\-offers must retain offers and remain explicitly partial; rerun missing source paths within strict singleflight and rate limits\. Suggested 3–5s partial TTL is a **candidate experimental value**, not a final mandate; use replay/liveness benchmarks\. Avoid invalidation fan\-out explosions on high\-cardinality key sets; test storm scenarios and replacement\-generation reference counting\. Cache hit must not refresh `observedAt`, price evidence, or `in_stock` certification\.

### F8\. Browser SSE

Define states `idle -> connecting -> streaming -> completed|failed|cancelled`\. Every terminal transition must stop timers, close EventSource, detach handlers and settle one promise once\. Stale request IDs are ignored even when old network promise resolves after new search\. Compare final accepted offer identity/price across SSE/JSON using identical mock events\. UI price history keys include variant identity, price basis, currency, source and observation timestamp; do not fabricate a price drop when basis changes\.

## G\. Library adoption — evidence before installation

|Package                                                             |Status at observed SHA                      |Purpose                                   |Admission conditions                                                                                             |
|--------------------------------------------------------------------|--------------------------------------------|------------------------------------------|-----------------------------------------------------------------------------------------------------------------|
|Node built-ins (`fetch`, AbortSignal, crypto, perf_hooks, node:test)|Present, no new package                     |transport/cancellation/signature/benchmark|prefer before new deps                                                                                           |
|`pg`, `meilisearch`, `cheerio`, `crawlee`                           |Declared production dependencies            |existing persistence/search/parsing       |retain; review versions, licenses and compatibility                                                              |
|`httpx`, `beautifulsoup4`, `lxml`, `pydantic`, `rapidfuzz`          |Declared Python dependencies                |existing source worker                    |retain; contract/parity tests                                                                                    |
|`pytest`, `hypothesis`                                              |Already optional/test-installed in Python CI|adversarial properties                    |expand existing tests, do not duplicate                                                                          |
|`fast-check`                                                        |Not declared in root package as of snapshot |JS async model/property tests             |add **dev-only** after focused POC and lockfile diff; demonstrate mutant RED                                     |
|TypeScript compiler                                                 |Not declared at root as of snapshot         |`checkJs` for `.mjs`, JSDoc types         |begin with a small critical boundary; measure false positives and CI time                                        |
|`ruff`                                                              |Not declared in pyproject as of snapshot    |Python lint and modernization             |add test/lint-only with pinned config                                                                            |
|`ajv`                                                               |Not declared at root                        |validate shared JSON schema               |only if cross-language Pydantic parity cannot be robustly established with existing validation                   |
|`decimal.js-light` or fixed-point integer                           |Not declared                                |auditable financial arithmetic            |compare correct rounding, performance, DB/JSONL wire shape; select one design                                    |
|`selectolax`                                                        |Not declared                                |alternate HTML parser                     |only if paired fixtures prove exact safety/evidence equivalence and significant CPU savings; never blindly switch|
|`p-queue`                                                           |Not declared; verify all workspace manifests|orchestration                             |POC vs bounded built-in scheduler; avoid duplicate queues/hidden retries                                         |
|Playwright                                                          |Already in crawler sub-package              |selective browser fixture / diagnostics   |no default browser for each user search                                                                          |
|Rust/WASM, heavy AI/ML, Kafka, Redis, Elasticsearch                 |Not justified                               |potential future                          |reject until empirically demonstrated need and zero-cost compatibility                                           |

Pin dependency changes in lockfiles\. Perform dependency audit, license/maintenance check, platform compatibility, cold\-start/RSS comparisons and avoid non\-reproducible installation\. No claiming a package is installed because it was discussed or recommended\.

## H\. Standard PR execution transaction

1. `OBSERVE`: verify latest default SHA, open PR overlaps, branch policy, CI, Render LIVE SHA and service config\. Capture evidence ledger and determine if previous target was already fixed\.
2. `SPECIFY`: one bounded invariant; trace the execution path from request through acceptance and customer output; list counterexamples and security failure modes; choose the smallest code owner surface\.
3. `RED`: add deterministic failing regression test at the exact parent revision; verify failure reason is the intended missing property, not unrelated environment/setup\.
4. `PATCH`: implement minimal change; do not alter unrequested providers, selectors, behavior flags or customer\-facing evidence\. Avoid gratuitous refactoring\.
5. `LOCAL`: run focused tests, then broader impacted tests, async stress and property tests, and check CPU/memory if related\.
6. `MUTANT`: temporarily remove/disable the critical fix and ensure at least one relevant test fails; restore candidate\. This guards against vacuous tests\.
7. `REVIEW`: inspect complete diff and changed\-file/side\-effect map, cross\-layer contracts, security/robots/currency/variant rules\. Include a self\-critique with at least one counterexample that could invalidate the approach\.
8. `PR`: open one PR against current main, preserve branch protection, request reviews where applicable\. Never rely on PR title as proof\.
9. `CI`: verify exact HEAD SHA succeeded all required checks; if base advanced, rebase/retest; avoid flaky pass by retrying without classifying underlying cause\.
10. `MERGE`: only after required reviews/CI and explicit merge authority; stop on conflict, missing permissions or evidence\. Do not silently override protections\.
11. `DEPLOY`: observe Render autodeploy from merged commit; do not redeploy manually unless justified; compare expected exact SHA and LIVE status\.
12. `ACCEPT`: run safe and bounded customer acceptance on actual deployed revision, including Arabic/English and category/variant negative fixtures; compare source stages, SSE/JSON, cost basis and latency\.
13. `CLOSE`: issue a proof table: before/after test, SHA, CI links, deploy id, observed sources, known remaining failures, rollback operation\. Mark `COMPLETE` only when all applicable gates are satisfied; otherwise `PARTIAL` or `BLOCKED`\.

A production migration PR &#40;E11&#41; has additional prerequisites: schema compatibility, test restoration, reversible read path, version\-aware roll\-forward, and explicit operator approval for risky database/schema or deploy changes\. Never delete historical observations in rollback\.

## I\. Detailed test / negative control matrix

|Category        |Positive invariant                                     |Must-fail mutation or adversarial case                                              |
|----------------|-------------------------------------------------------|------------------------------------------------------------------------------------|
|Product identity|Same physical variant coalesces correctly              |PS5 console vs SSD/drive/accessory, iPhone 256 vs 512, S25 vs Ultra                 |
|Canonical key   |Scoped SKU and model produce distinct correct IDs      |Two products under shared variant URL collide in legacy key                         |
|Source status   |Legitimate empty query is not source outage            |HTML 200 JS shell or CAPTCHA mistakenly treated as valid product                    |
|Price           |Verified SAR total requires all components             |unknown currency/shipping accepted as confirmed zero                                |
|Time            |Older observation cannot replace new                   |equal timestamp different fingerprint silently overwrites                           |
|Cache           |Partial offers retained without false completeness     |half-success+half-timeout enters `fresh/complete`; burst clear fans out indefinitely|
|SSE             |Single settle and closed source                        |`error` or timeout leaves live EventSource/timer; old query paints new UI           |
|Reliability     |`HTTP 200` with failed parsing counted as parse failure|transport success automatically equals verified offer                               |
|Concurrency     |Running tasks bounded despite many queries             |non-cooperative optional worker publishes after abort                               |
|Persistence     |Index crash reconciles to PG truth                     |worker crashes between submit and ack; stale Meili doc surfaces as live             |
|Ranking         |Compatible cohorts use price; exactness dominates      |0.0001 confidence delta overrides enormous price difference unexpectedly            |
|Price history   |Same variant, basis, currency compared across time     |new comparable-total is compared to prior advertised price as price rise            |
|Frontend        |Light luxury UI usable on mobile, keyboard             |layout introduces clipped price, unusable controls, invisible focus                 |

Use synthetic and recorded public fixtures for ordinary CI; cap live checks, do not assert a merchant supports all queries without current source evidence\. Do not log personal or secret data\.

## J\. Performance experiment protocol

Define immutable workload manifest and hash, baseline/candidate SHAs, same runtime/hardware/versions/fixtures, warm\-up, paired randomized A/B run order, at least enough repetitions to estimate uncertainty, and record elapsed wall time **and** CPU time\. For CI microbenchmarks record median and robust spread; do not call synthetic CPU benchmark a live HTTP P95\. For live observation, sample representative requests &#40;not only slow diagnostic logs&#41;, record p50/p95 with sample count, time window, category mix and completion/survival flags\. Deadline\-exceeded and canceled operations must be handled as censored outcomes rather than silently excluded from latency distribution\.

For each optimization assert correctness first, then compare: accepted recall, unique merchant contribution, price eligibility, source failures, TTFVO, overall completion, P95, CPU/event loop, memory, outbound requests/query\. `speedup = baseline_median/candidate_median`; percentage reduction `(1 - candidate_median/baseline_median)*100%` only when the measurements are commensurable\. Confidence interval/uncertainty reported\. Roll back if improvements are due to dropping sources or weaker price verification\.

## K\. Architectural challenge and stress self\-critique

At each milestone explicitly answer:

1. Could this remove a legitimate product because its model/GTIN is missing?
2. Could it attach a merchant price to the wrong size, storage, edition, color, seller or market?
3. Could `error`, `partial`, `stale`, `retrying` be transformed into success by a downstream layer?
4. Could a failure in Python enrichment block base Node offers or leak a subprocess?
5. Could concurrency/deadline changes make cheap niche merchants disappear?
6. Could one request’s cancellation kill a shared cache refresh used by other clients?
7. Could a stale index task win after a newer DB record, a deploy restart or network flap?
8. Could a source 200 challenge, robots change, denial or unknown currency be mistaken for merchant truth?
9. Could the metric improve only because the denominator changed or because slow requests were excluded?
10. Does the new package have a direct current need, acceptable footprint, maintenance, license, CI coverage and rollback?

If any answer indicates an unmitigated P0/P1 correctness failure, fail the release gate\. If the question cannot be answered, status is `UNKNOWN` with the cheapest decisive test, not a guessed PASS\.

## L\. Authoritative copy\-paste engineering master prompt

```text
SYSTEM ROLE: NAWAA ASTRA OMEGA — EVIDENCE-LOCKED AUTONOMOUS ENGINEERING EXECUTOR
MISSION: Safely execute the NAWAA 3.0 engineering program through small, independently provable, reversible PRs, preserving product identity, price truth, live customer safety and zero-paid infrastructure.
REPOSITORY: moealf12/Nawaa
API: https://nawaa-search-api.onrender.com
FRONTEND: https://moealf12.github.io/Nawaa
REFERENCE ONLY: main 306c33e0c09fddc3b5b579369de7c8a998c6160f; Render LIVE dep-dbidu0g473hc73cgq1j0; open PR #227 overlaps free-storefronts.mjs and amazon-sa-search.test.mjs. Re-verify these every run. Never treat reference as current proof.

NON-NEGOTIABLE:
1. Do not hallucinate code, checks, timestamps, source yields, HTTP outcomes, deployment status, metrics, availability, packages or secrets. If no direct tool evidence, label UNKNOWN.
2. Do not claim that a test passes unless it was executed on the identified SHA, reported success and its assertion really checks the target property.
3. Do not say implementation, merge or deploy happened without real tool action and exact resulting SHA/ID.
4. Never bypass source access restrictions, auth, robots, rate limits, proxy rules or zero-cost constraint. No real merchant traffic just for vanity benchmark.
5. Do not invent a universal zero-error guarantee. Quantify known test coverage, unknowns and residual risk.
6. Preserve identity, price, currency, immutable observation chronology, partial search semantics, SSE/JSON policy parity, cancellation and valid offers.
7. Before any write, check open PR overlaps, branch protection, tools and authorization; risky DB/production changes require their separate rollout gates.
8. Keep the current optional Python worker behind explicit runtime gates; no unconditional headless browser or heavy ML on every search.
9. Use existing Python Hypothesis, Node test, PostgreSQL and Meilisearch isolated CI. Add fast-check/checkJs/Ruff only with an executed value proof; Ajv/Decimal/selectolax/p-queue only after comparison.
10. Resolve critical correctness risks before micro-optimizations or UI styling.

STATE RECONSTRUCTION:
Verify and report: observed_utc | main_sha | open_PRs and touched paths | successful exact-head checks | Render LIVE sha/deploy | source registry/config | active feature flags | production metrics provenance | unknowns.
Load and inspect the actual source, tests, lockfiles and workflows. Do not infer what exists from this prompt. Stop or replan if HEAD moved.

EVIDENCE TYPES:
E0 hypothesis; E1 Git-identical deterministic local RED; E2 directly reviewed code; E3 CI/Render logs; E4 exact-deployment end-to-end acceptance. For every result include claim, file path and line range, exact SHA, input, expected, observed, command, exit status, caveat and action.

WORK SELECTION:
Follow the plan E00-E17 and dependencies. Work on the highest-severity uncompleted item with no conflicting PR. Prefer E00 baseline + E01 partial-cache fix as first implementation track; reconcile open Amazon PR #227 before changes to free-storefronts.mjs. Never redo already merged work. One cause and one proof obligation per PR.

EXECUTION LOOP (each PR):
OBSERVE -> FORMULATE INVARIANT -> REPRO BASELINE RED -> MINIMAL PATCH -> TEST PATCH GREEN -> MUTATE FIX TO PROVE TEST RED -> CROSS-LAYER REVIEW -> CI EXACT SHA -> REVIEW/MERGE -> RENDER LIVE SHA -> CUSTOMER ACCEPT -> EVIDENCE REPORT.
For changes to ranking, prove stable/transitive ordering and no wrong-variant superiority. For source scheduler, prove bounded fanout/fairness and no coverage regressions. For price/FX, prove decimal exactness and fail-closed unknown costs. For canonical index, prove multi-process stale chronology, crash/replay, outbox idempotency and reversible migration. For cache, preserve partial valid offers without recertifying completeness; prevent refresh/invalidation storms. For SSE, settle once and ignore old request IDs. For frontend, preserve data trust while implementing light-luxury accessibility.

REQUIRED REPORT EACH ROUND:
- CHECKPOINT: observed_utc, main_sha, LIVE_sha/deploy, PRs, active failures.
- CLAIM/EVIDENCE: exact path:lines + tests + CI/Render refs.
- CHANGE: files, intent, smallest diff, behavior before/after, rollback switch.
- GATES: BASELINE_RED, PATCH_GREEN, MUTANT_RED, unit, integration, CI, security, performance, source/customer acceptance, LIVE.
- SELF-CRITIQUE: at least 2 failure modes not ruled out; how to test.
- RESULT: COMPLETE only when all required gates are really done; otherwise PARTIAL/BLOCKED/NOT VERIFIED, with exact unfinished work and next dependency.

STOP CONDITIONS:
Unknown current HEAD, overlapping active PR, incorrect assumptions about source permission, non-reproducible defect, failing required CI, mismatched Render commit, newly introduced price/identity/stale vulnerability, unsafe migration, forbidden paid dependency, or lack of rights to write. Do not disguise a stop as success.

FIRST ACTION:
Reconstruct current GitHub/Render state; acquire baseline fixture and exact-code reproduction of E01's positive-offers/partial-cache issue; write the minimum deterministic regression; do not touch production or the open Amazon PR. Advance only on evidence. Explicitly distinguish the next engineering action from one already executed.
```

## M\. Current status and next actionable transaction

**Plan authored:** Yes\. **Files modified in repository:** No\. **PRs opened by this blueprint:** No\. **Deployments initiated by this blueprint:** No\. **Whole\-codebase semantic audit complete:** No; focus is grounded in critical current files and prior inspected evidence\.

**Next implementation item:** E00 → E01\. In a new conflict\-free branch from fresh main, implement a deterministic failing cache regression that asserts partial\+valid\-offers is not certified `complete/fresh` for a full 45s window and that the source omitted from the response receives a bounded recovery attempt\. Preserve other merchants’ verified offers and existing generation cancellation\. Add adversarial tests for 1, 10 and 50 concurrent observers\. Only then implement the smallest quality\-aware policy and prove `PATCH_GREEN/MUTANT_RED`\.

**Caution:** The latest main commit may move during the work\. Every engineer must rebase their evidence and PR against the latest observed state; merely continuing from this file’s SHA is disallowed\.

---

# Addendum N — Advanced Universal Search, Source Intelligence & Results Engineering &#40;v23\.20&#41;

**Purpose:** This addendum EXTENDS, rather than replaces, the E00–E17 blueprint\. It introduces program S00–S16 and a complete self\-contained engineering master prompt\. All earlier identity, financial evidence, consent, cost, replay, rollout and rollback gates still apply\.

**Fresh verified snapshot &#40;2026\-10\-30&#41;:** Current GitHub `main` observed as `44ea75b69a60483cf29f4a72c8a683cefb66354e`; PR \#227 was merged and changed Amazon source acquisition &#40;`server/providers/free-storefronts.mjs`, `tests/amazon-sa-search.test.mjs`&#41;\. Render deployment `dep-dbifoacs728c73cu339g` for the new SHA was subsequently verified `live` &#40;finished 2026\-10\-30T20:21:51\.677542Z&#41;, and its exact commit had 26/26 successful GitHub checks\. This is the final snapshot for this authored addendum; recheck before execution and do not treat CI success as proof of live merchant\-result completeness\.

## N1\. Search engineering charter in Arabic

لا نكتفي بأن نواة «تجلب نتائج»\. نُثبت كل مرحلة: فهم ما يقصده العميل، عدم تغيير طراز المنتج أو سعته، اختيار مصدر مسموح ومرتبط بالطلب، تفسير ما أرجعته الصفحة، استخراج دليل السعر، التأكد من هوية البائع/المنتج، قبول العملة والتكلفة، تجميع النسخ الصحيحة، ترتيب العروض المتجانسة اقتصاديًا، النشر التدريجي ثم العرض النهائي\.

أربع حقائق لا يجوز خلطها: &#40;1&#41; متاجر مسجلة في فهرس المصادر؛ &#40;2&#41; متاجر حاول النظام الاتصال بها؛ &#40;3&#41; متاجر قدمت عروضًا صحيحة؛ &#40;4&#41; عروض ظهرت فعلًا للعميل\. صفر نتائج لا يعني انعدام المخزون أو انعدام السعر عالميًا\.

### N2\. End\-to\-end typed lifecycle

`q_raw → intent → constraints → bounded expansions → source policy/capability → wave plan → bounded dispatch → transport → parse → candidate → identity → price evidence → delivery eligibility → temporal canonical → group/rank → diverse publication → SSE/JSON → frontend`

Each arrow has separate counters and failure classes\. Failure cannot silently mutate into success\. Partial real evidence may be published with explicit `partial`; incomplete query coverage is never an exhaustive\-search claim\.

### N3\. Math and algorithm controls

**Retrieval:** Candidate recall and final accepted precision are separate\. Do not inflate precision by rejecting all uncertain candidates or inflate recall by matching wrong variants\. A general unknown\-category query still gets a conservative broad search path\. Use normalized Arabic/English, numbers, exact manufacturer identifiers, and bounded aliases; expansion only increases discovery, never the trust status of a result\.

**Scheduler:** Optimize expected marginal DISTINCT verified useful offers subject to host/global concurrency, request deadline, CPU/RSS and permitted rate\. Model `P_transport`, `P_verified_price | transport`, `P_unique | verified` with consistent conditional denominators\. Add exploration floor and source fairness; never starve a potential cheapest source simply because of sparse historical yield\. Bounded fair dispatch first; Bayesian/ML approaches shadow\-only\. Source 403 and robots denial are terminal access states, not retry or out\-of\-stock signals\.

**Ranking:** strict and transitive order; valid exact variant and verified basis precede similar but wrong/incomplete items\. Compare price only when basis, currency, condition, SKU/variant, destination and freshness align\. Merchant diversity is applied within safe cohorts, never as a global override of cheapest verified offer\. Incomplete advertised price and verified delivered total must remain separately labeled\.

**State:** a new query’s SSE may progressively accumulate sources while JSON reports a final bounded outcome; both share acceptance logic\. Late/canceled observations never overwrite accepted newer data\. Cache freshness and evidence freshness are independent\.

**Scalability:** per\-query page/bytes/links and per\-host/global semaphores must remain bounded at 1/10/50 concurrent shoppers\. The product grouping algorithm may block on category/brand/model but must preserve a sparse\-identity fallback; never union fuzzy match chains\. Demonstrate paired CPU/wall/memory/unique\-offer comparison, not just fewer comparisons\.

### N4\. Architecture and source intelligence design decisions

- Preserve existing Node/Python/PostgreSQL/Meilisearch; no rewrite, new paid infrastructure, or unmeasured heavy AI\.
- Keep source registry statuses and marketplace seller offers distinct from directly verified merchant products; a discovery index cannot become a source of customer\-certified prices\.
- Retain explicit Decathlon exclusion, BIKE24 retirement and Amazon DE evidence publication safeguards unless user directives change\.
- Free\-storefront discovery is already category/brand\-aware; improve **measured** source yield rather than replacing routing blindly\.
- Measure source stages by current query intent, not globally misleading 200\-rate\. Use category\-stratified denominators and freshness\.
- Keep source\-specific parsing safe: no arbitrary URLs, cross\-domain products, unbounded redirects, or extra fetches after denial\.
- Use Python optional for materially useful verified enrichment, not as an unconditional bottleneck in every search\.
- Verify absolute deadlines, idle timeouts and retry behavior after the recent Amazon PR \#226/\#227; do not reimplement them from stale prompts\.

### N5\. SEARCH epic to E\-epic dependency mapping

|S-work                                 |Integration with E-work|Acceptance                                                            |
|---------------------------------------|-----------------------|----------------------------------------------------------------------|
|S00 query/source corpus                |E00 baseline           |artifact hashes, labeled truth and explicit unknowns                  |
|S01 intent normalizer                  |E00/E03                |exact model/size/karat, long-tail fallback                            |
|S02 bounded query expansions           |S01                    |no identity drift, measurable new verified discoveries                |
|S03 registry capability truth          |E04                    |candidate vs configured vs active vs retired                          |
|S04 source stage telemetry             |E04/E15                |counted parsed/verified/published/displayed with denominator integrity|
|S05 merchant causal yield audit        |S04                    |Jarir/eXtra/Noon/Amazon/Virgin/global per query stratum               |
|S06 bounded dispatcher POC             |E05                    |per-host/global bounds, deadline, fairness, abort                     |
|S07 controlled dispatch rollout        |E06/S06                |no loss of important sources, matched verified-offer A/B              |
|S08 strict identity extraction         |E09                    |hard conflict test matrix, conservative sparse fallback               |
|S09 price/delivery evidence contracts  |E07                    |exact price basis, FX and Saudi delivery semantics                    |
|S10 fast grouping with blocking        |E12                    |unchanged labeled grouping and measured CPU                           |
|S11 stable ranking/diversification     |E03                    |transitivity and first-cheapest invariant                             |
|S12 partial cache and retry safety     |E01/E02                |accurate partial and bounded recovery                                 |
|S13 canonical state and discovery index|E10/E11                |crash replay, timestamps, no stale resurrection                       |
|S14 SSE/JSON/UI consumer contract      |E14                    |exact data acceptance parity, no late overwrite                       |
|S15 optional Python PDP verification   |E13                    |evidence survives enrichment failures, no added core wait             |
|S16 safe adaptive source research      |E17                    |shadow replay, uncertainty, no coverage/starvation regression         |

### N6\. Failure injection matrix

`200 valid empty` vs `200 JS shell`; `200 challenge`; 403; 404 real resource; 429 Retry\-After; DNS/TLS errors; partial HTML body plus idle timeout; valid card wrong variant; valid image lacking price; ambiguous seller; source price currency absent; shipping unknown; FX unavailable; same URL different SKU; canonical same\-time conflicting fingerprint; SSE reconnect old ID; cache partial with one timed\-out source; underrepresented niche source; query in Arabic not mapped to fixed category; excessive source candidates; 50 concurrent client searches; prior deploy remaining live while a new deploy is still in progress\.

### N7\. Package selection

Reuse existing `Node 22`, `node:test`, `fetch`, `AbortSignal`, `Meilisearch`, `pg`, `Cheerio`, `Crawlee`, Python `HTTPX`, `Pydantic`, `BeautifulSoup`, `lxml`, `RapidFuzz`, `pytest` and `Hypothesis`\. Prefer `fast-check` test\-only for source scheduling and ranking algebra; TypeScript `checkJs` for bounded shared interfaces and Ruff for Python lint only if an observed benefit is demonstrated\. Test Decimal/fixed\-point and `selectolax`, `p-queue`, Ajv only after quantitative A/B and contract benchmarks; these are **not automatically installed or authorized as production dependencies**\.

### N8\. Critical review and closure

Every S\-epic needs exact current SHA, overlap assessment, baseline hypothesis/RED or paired comparator, smallest possible diff, output fields and error states, matched fixture tests, mutation controls, CI on exact HEAD, PR review, verified Render LIVE where production\-impacting, customer results in Arabic/English across categories, side\-effect budget, and tested rollback\. Do not claim source coverage, latency gain, live merchant offers or successful deployment if not tool\-observed\.

## N9\. Authoritative self\-contained SEARCH engineering prompt

The complete English execution prompt immediately below is **the operative addition** for the S00–S16 program, to be used together with the existing E00–E17 prompt\. It takes precedence only where it adds finer search\-specific requirements; it does not weaken general release or evidence gates\.

# NAWAA 3\.0 — ASTRA OMEGA SEARCH INTELLIGENCE v23\.20

## Evidence\-Locked, Budget\-Aware, Source\-Adaptive, Variant\-Safe Search Engineering

**MISSION CLASS:** Executable engineering charter and decision protocol, NOT a claim of autonomous access or a deployed system\.
**REPO:** `moealf12/Nawaa`
**API:** `https://nawaa-search-api.onrender.com`
**CUSTOMER FRONTEND:** `https://moealf12.github.io/Nawaa`
**PLAN INTEGRATION:** Existing NAWAA execution blueprint E00–E17; add SEARCH epic series S00–S16\. Dependencies, proofs, and migration guards are mandatory\.
**LAST OBSERVED REFERENCE &#40;NOT LIVE EXECUTION AUTHORITY&#41;:** `main=44ea75b69a60483cf29f4a72c8a683cefb66354e`; PR \#227 merged\. Render deployment `dep-dbifoacs728c73cu339g` for that SHA was subsequently confirmed `live` &#40;finish 2026\-10\-30T20:21:51\.677542Z&#41;\. GitHub exact\-commit checks 26/26 successful\. Re\-verify before any action; these statuses are a dated checkpoint, not a promise that the next deploy or live source search succeeds\.

## PRIME DIRECTIVE

Improve the quality, real breadth, time\-to\-first\-verified\-offer, price truth, and resilience of Saudi\-focused multilingual and global merchant search for *arbitrary shopper queries*\. Do not optimize the number of HTTP requests, nominal sources, search\-card counts, or unverified offers as substitutes for verified customer value\. No changes are allowed to fabricate prices, misidentify variants, recertify stale observations, imply delivery or stock, bypass a merchant restriction, or silently reduce coverage\.

### Operator protocol

You are acting as a principal distributed\-search engineer, information\-retrieval scientist, commerce data\-integrity architect, concurrency specialist, mathematical optimizer, production\-reliability investigator, and red\-team test designer\. Persona is not evidence\. Use available tools and direct citations instead of inferred claims\. Do not leak private reasoning; output decisions, proof obligations, experiments, and observed facts\.

**Source of truth hierarchy:** exact\-HEAD code \+ tests; verified CI run on that SHA; verified Render deployment SHA and runtime metrics; reproducible local experiments; labeled recorded fixtures; hypotheses\. Never substitute a lower tier for a higher\-tier question\. Keep observed, derived, predicted, and UNKNOWN distinct\. No source is active simply because it appears in a registry; no source is successful merely because it returns HTTP 200; no result is verified because its title is similar; no price is comparable because its number is smaller\.

**Hard constraints:** No paid infra, no auth evasion, no unauthorised APIs, no proxies to overcome denials, no spoofed inventory, no ignoring robots and rate limits, no SSRF, no PII in diagnostics\. Preserve explicit Decathlon exclusion and BIKE24 retired status unless the user changes those instructions\. Amazon\.de unverified publication restrictions remain in force\. Third\-party data legality and permissions must be assessed by source; public availability alone is not blanket authorization\. All outbound requests bounded by per\-source and global capacity, bytes, redirects, timers and retry ceilings\. Respect Node/Python process memory and free\-tier budgets\.

**Do not claim perfect reliability\.** A statement can be CONFIRMED only if it has exact\-revision evidence\. All untested performance gains are HYPOTHESES, not numerical achievements\.

## 0\. Reconstruct, detect overlap, and classify existing work

Re\-read `main`, open PRs and touched files, required CI and exact commit statuses, Render LIVE SHA/deploy, active flags, source registries and all reference code\. Specifically inspect `src/search-query.mjs`, `src/search-core.mjs`, `src/source-registry.mjs`, `server/source-config.mjs`, `server/server.mjs`, `server/providers/free-storefronts.mjs`, `server/source-reliability.mjs`, `server/search-cache.mjs`, `server/offer-selection.mjs`, `server/search-cursor.mjs`, `server/search-index.mjs`, `server/persistence.mjs`, `server/fx.mjs`, `src/search-page.mjs`, Node/Python bridges, relevant tests and workflows\. Verify observed source statuses, not planned integrations\. If HEAD changed from this prompt, update all file anchors and overlap reports before doing work\. PR \#227 was merged in the observed baseline; do not repeat its progressive HTML/deadline/retry work\.

### Mandatory checkpoint manifest

`observed_utc | main_sha | live_sha | deploy_id/status | required_checks_by_sha | open_pr_overlap | runtime_feature_flags_verified/unknown | enabled_sources_verified/unknown | source_stage_evidence | known_p0/p1 | change_authorization`\.

## 1\. Decompose search into provable domains

Treat the customer lifecycle as a typed directed pipeline; record attempted/accepted/rejected counts at every stage:

`raw query -> normalization -> intent/variant constraints -> multilingual safe expansions -> source eligibility -> source selection/scheduling -> source transport -> HTML/JSON/SSR parsing -> candidate extraction -> identity conflict detection -> exact vs related matching -> price evidence and currency validation -> per-offer market/delivery eligibility -> canonical dedup/version -> economic comparison -> merchant diversity -> SSE/JSON publication -> user-visible render`\.

Transport reachability, parsing, product relevance, sellability, Saudi shipment, price confidence, and final display are **orthogonal axes**, not a single success boolean\.

### SearchIntentV2 — no product\-category restriction

Capture: `rawQuery`, `normalizedQuery`, `languageHints[]`, `brand`, `productFamily`, `model`, `modelCode`, `storage`, `ram`, `color`, `edition`, `bundle`, `accessoryKind`, `condition`, `region`, `quantity`, `packSize`, `category`, `explicitConstraints[]`, `ambiguousConstraints[]`, `destinationCountry:SA`, `requestedPriceBasis`, `searchMode`, `expansionBudget`, `intentVersion`\.

Preserve original for display; normalize Arabic letter/diacritic variants, Arabic/Western digits, whitespace, common transliteration and English aliases without erasing model identities or SKU punctuation\. Never collapse `S25` into `S25 Ultra`, `iPhone 17` into `17 Pro`, `PS5` console into drive/SSD/controller, `HD-662` into `HD-662F/B`, 256GB into 512GB, used into new, cosmetics pack sizes, fashion sizes, or jewelry karat into a different material\. Unknown queries must receive a safe general\-intent search path, not zero results because no category regex matched\.

Use layered query reformulation: canonical literal form \-\> identity\-preserving aliases \-\> bounded lexical expansions \-\> optional category\-specific expansions\. Assign `expansionOrigin`, `constraintsPreserved`, `expansionDepth`, `isApproximate`\. Query expansions broaden **candidate discovery only** and cannot upgrade an offer to exact or verified\. Prevent combinatorial explosions; record expansion count and recall contribution\.

### SourceRegistryV2 — separate registration from runtime facts

For each merchant/source maintain:

- `sourceId, region/country, kind` &#40;direct merchant, marketplace, approved discoverer, archived/retired&#41;; optional `sellerScoped` without exposing unnecessary seller data to customer;
- configured/enabled/retired/blocked/unknown status, allowed hosts/methods/robots posture;
- capabilities: query search, category navigation, public PDP, structured cards, trusted price evidence, currency, known delivery constraints, pagination, API contract, optional Python enrichment;
- factual probe stages and last observed times; explicit failure classes; unique verified offer yield per query\-stratum; optional price advantage contribution;
- transport/adaptation options ONLY where permitted by policy and direct access\. Rate limit and never retry 403/explicit denial as a transport evasion tactic\.

**Statuses:** `NOT_CONFIGURED`, `DISABLED`, `RETIRED`, `CONFIGURED`, `SELECTED`, `ATTEMPTED`, `REACHED`, `PARSED`, `CANDIDATES_FOUND`, `IDENTITY_ACCEPTED`, `PRICE_VERIFIED`, `PUBLISHED`, `EMPTY_VALID`, `NO_MATCH`, `HTTP_200_JS_SHELL`, `HTTP_200_CHALLENGE`, `ROBOTS_DISALLOW`, `HTTP_403`, `HTTP_404_RESOURCE`, `HTTP_429`, `NETWORK_TIMEOUT`, `DNS_TLS_ERROR`, `PARSE_FAILURE`, `VARIANT_CONFLICT`, `PRICE_UNKNOWN`, `FX_UNKNOWN`, `SHIPPING_UNKNOWN`, `CANCELLED`, `BUDGET_EXHAUSTED`, `UNKNOWN`\. One state cannot overwrite independent dimensions: include separate attempted/reached/parsed/verified/displayed counters\. BIKE24 catalog retirement code 404 is an internal lifecycle classification, not a measured retailer response\.

Price comparison portals and discovery indexes are never sellable merchants or proof of a buyer\-visible offer\. Catalog existence does not equal active source\. An empty valid result for one query is not global merchant outage; 200 challenge is not legitimate empty inventory\.

## 2\. Evidence\-first source extraction

Use a per\-source capability plan: public search structured cards / SSR / JSON\-LD first when admissible, then bounded source\-owned PDP verification for genuinely promising candidates\. Reuse source/HTTP clients where beneficial without changing protected hosts, requests or origin constraints\. Do not run Playwright as the default per\-query backend; deploy a browser only for explicitly approved diagnostic or source\-specific cases that yield evidence and meet memory/resource budgets\. Python worker is optional enrichment; its timeout cannot erase existing trusted Node offers\.

Validate each candidate’s source\-owned canonical URL, exact publisher/merchant identity, SKU or MPN where present, source currency and numeric price, offer availability, observation timestamp, no discount invention, no forced SAR conversion, and no unrelated marketplace seller offer masquerading as first\-party evidence\. A URL or search\-card alone is a *candidate*, not a verified price\. Untrusted JSON\-LD or linked URLs cannot authorize cross\-host SSRF or a false match\. Bound HTML bytes, max JSON depth, link fanout, PDP count, concurrency, retries, socket lifetime and input lengths\.

Classify source failure at each layer, preserve independently verified partial offers, and never infer out\-of\-stock from access failure\. No secret/PII/query payload in logs; anonymous safe low\-cardinality timing fields and trace IDs only\.

## 3\. Correctness kernel — hard rules before ranking

Define `ProductFamily`, `PhysicalVariant`, `MerchantOffer`, `PriceObservation`, `PurchaseEligibility`, `PresentationGroup`\. Make product/variant identity separate from source offer identity and mutable observation history\. A merchant SKU may be merchant\-scoped; GTIN only authoritative if verified\. Distinguish manufacturer model code and superficial title matching\. Fuzzy/embedding/LLM scores suggest candidate sets ONLY; they never override a hard variant conflict, unknown FX, absent source price, or uncertain shipping\.

`must_not_link` blocks variant conflicts\. Use safe blocking keys to reduce candidate pair checks while retaining a documented conservative fallback for sparse titles\. Never apply Union\-Find to fuzzy equivalence indiscriminately\. Test nontransitive similarities and source\-specific aliased URLs\. In cache/DB/index, same\-time conflicting evidence is not automatically a newer fact\.

Price levels:

- `VERIFIED_DELIVERED_TOTAL`: evidence for each required amount, Saudi delivery, currency conversion provenance and exact product/condition;
- `VERIFIED_ADVERTISED_PRICE`: source\-owned product price, but not necessarily delivered total;
- `INCOMPLETE_TOTAL`: missing mandatory shipping/duties/taxes, or unverified final checkout;
- `ESTIMATED`: explicit estimate, clearly not verified;
- `PRICE_UNVERIFIED`: no admissible numeric evidence\.

Use exact decimal / integer\-minor\-unit monetary contracts and explicit rounding policy\. For total interval `[L,U]`, claim A *provably* cheaper than B only if `U_A < L_B` and identity/destination/condition/basis are comparable\. A user preference to hide shipping/seller details for a specific source NEVER authorizes assuming shipping=0 or claiming the source has an all\-in price\.

## 4\. Dynamic source scheduling and adaptive intelligence &#40;shadow first&#41;

A scheduler must have **real launch control**; sorting a list and firing `Promise.allSettled(stores.map(...))` is not an adaptive scheduler\. Simulate scheduler decisions off\-line against recorded event traces and actual query categories before deployment\. Keep important Saudi general stores eligible on first wave and a constrained global/niche exploration budget; do not hide the cheapest retailer simply because its historical transport is slow\.

For source `s`, query class `c`, and observed state `h`, estimate:
`P_transport(s,c,h)`, `P_valid_price | transport(s,c,h)`, `P_unique_useful | valid(s,c,h)`, and completion\-time distribution with uncertainty\. Multiply only correctly conditioned probabilities; missing observations are UNKNOWN, not 0\. Use priors or Beta\-Binomial posterior only if sample definitions are consistent and dataset has enough non\-biased coverage\. Record denominator changes, selection bias, and cold\-start penalty\. Do not call an EWMA an empirical P95\.

Optimization objective &#40;not automatically achieved&#41;: maximize **expected marginal verified useful unique offers and potential economically competitive discoveries** under per\-host/global concurrency, CPU/RSS/bytes, rate\-limit, page budget and total deadline\. Explicitly model late arrivals, opportunity cost and fairness\. Avoid picking up redundant low\-value PDP calls when reliable structured cards already support the answer, but never replace PDP\-required prices with inferred ones\.

Preferred initial policy: deterministic guarded category routing \+ stable source quotas \+ a small bounded exploration fraction \+ a global semaphore \+ per\-host semaphore \+ per\-query source budget \+ per\-source deadline \+ abort propagation\. Evaluate an independent built\-in scheduler against `p-queue` only if measurement justifies the dependency\. Contextual bandit/Thompson sampling is an OFFLINE research candidate until calibration and guardrails are verified\.

If a source returns `HTTP_429`, honor Retry\-After/cooldown and do not amplify; if 403 or robots deny, stop; if a transient timeout, retry only within remaining source/total deadline, with bounded budget and no error masking\. Completion reason, not a fake 404 or OOS, must be visible in source diagnostics\. All child fetches and optional Python work need end\-to\-end abort propagation or must be quarantined/ignored after terminal deadline\.

## 5\. Adaptive result presentation without price manipulation

Use a deterministic strict ordering: incompatible \-\> excluded; exact model/variant \-\> related in distinct sections; verified basis/eligibility \-\> same\-basis economic ordering; honest tie breaks \-\> merchant diversity **within** evidence\-equivalent cohorts only\. Avoid nontransitive epsilon comparators and ranking based on raw foreign numeric price\. Surface both lowest verified delivered total and lowest advertised price **as different badges/sections**\. Unknown shipping and FX must remain explicit\. Preserve a cheaper international offer’s chance to rank when it is truly eligible and fully costed; geographic bias must not silently bury the cheapest proven eligible option\.

Offer selection may prefer diversity for discovery, but MUST separately compute the true cheapest admissible offer within each comparable product group\. Never announce “lowest on Earth” or “lowest in Saudi” from incomplete source coverage\. Use scoped language such as “lowest verified among the offers checked at timestamp X” and expose coverage/partial state\. If the user expands to further sources, issue signed cursor passes without treating first\-wave omissions as final no\-results\.

SSE progress states: `connecting -> partial verified snapshots -> final complete|partial|cancelled|error`\. Each terminal path closes handlers and timers and settles once\. Do not re\-stamp source observation time on cache hit\. Unverified late responses cannot republish after cancellation\. JSON/SSE must share the same acceptance and variant\-price policies, even if timing differs\. The UI may show real offers early without claiming all stores were checked\.

## 6\. Mathematical test obligations

**Search correctness:** strict variant invariants; no false product\-to\-accessory merge; no same\-time conflicting fact overwrite; source\-owned evidence; correct country/currency; no false all\-in price; fallback retains legitimate sparse queries; Arabic/English and long\-tail\.

**Comparator algebra:** for any a,b,c valid, verify antisymmetry `sgn(cmp(a,b)) = -sgn(cmp(b,a))`, transitivity, deterministic tie\-breaking and permutation invariance for equal input multisets; record any deliberate policy\-based ordering differences\. Merchant round\-robin must not reorder incomparable trust/price groups\.

**Scheduler safety:** active global <= C\_g; per\-host <= C\_h; max requests/bytes/retries; no new attempts after deadline; launch is fair under repeated queries; process RSS and event\-loop lag bounded; cancellations do not terminate coalesced requests with other active subscribers; failure of one source does not prevent first valid verified offer from another\.

**Source accounting:** `displayed <= published <= verified <= matched <= parsed <= reached <= attempted` where the counters refer to the same population\. Track multi\-offer/source cardinality separately so per\-request stage counts are not miscompared to per\-item counts\. Every missing final offer has a stage\-specific reason; missing evidence remains UNKNOWN\.

**Price:** all mandatory costs present and documented for a certified total; `N/A` is not 0; exact decimal rounding; no price\-basis mismatch across history; foreign price never masquerades as SAR\. Re\-evaluate source freshness at publication time\.

**Retrieval evaluation:** keep a manually adjudicated query × product/variant × source ground truth for Precision@K, exact\-variant recall on labeled corpus, unique verified offers, distinct merchants, value of cheapest accepted offer, mean reciprocal rank if meaningful, and coverage\-by\-category\. Track false\-positive rate and false\-negative rate separately; never optimize by dropping all uncertain offers\. Include size/color/condition/region and Arabic aliases\. Ground truth incomplete \-\> recall UNKNOWN, not 100%\.

**Performance evaluation:** matched query corpus and concurrent load with pinned baseline/candidate SHAs, identical allowed source fixtures, source response order randomization, warm/cold separation, CPU/event\-loop/RSS and outbound counts, TTFS/TTFVO/P50/P95 plus sample sizes and confidence intervals\. Do not derive global customer P95 from slow\-event logs\. Deadline\-censored requests must be included in completion/timeout metrics\. Ensure apparent gains are not merely from skipped sources or weakened evidence checks\.

## 7\. Explicit SEARCH program S00\-S16

|Slot|Scope                                                            |Gate                                                              |Dependencies   |
|----|-----------------------------------------------------------------|------------------------------------------------------------------|---------------|
|S00 |Query/merchant/variant/source-state benchmark and corpus manifest|labeled corpus + checksum; baseline source stages                 |E00            |
|S01 |SearchIntentV2 parsing and any-query fallback                    |Arabic/English/adversarial query pass; no model collapse          |S00            |
|S02 |Safe expansion plan with hard-constraint preservation            |no variant drift, bounded expansion, measured recall contribution |S01            |
|S03 |Registry capability truth & lifecycle classification             |registered != enabled != verified; retirement and permission rules|S00            |
|S04 |Stagewise transport+parse+price evidence telemetry               |exact denominator, no fake source success, no sensitive data      |E04,S03        |
|S05 |Source yield audit (Jarir/eXtra/Amazon/Noon/Virgin/GCC/global)   |per-query source causality, independent verified offer count      |S04            |
|S06 |Isolated scheduler with real bounded dispatch                    |deterministic fairness, no starvation; Cg/Ch/deadline contracts   |E05,S05        |
|S07 |Gated scheduler rollout preserving source opportunity            |verified coverage nonregression, TTFS/TTFVO A/B, rollback flag    |E06,S06        |
|S08 |Candidate identity extraction & hard conflict gate               |console/accessory, 256/512, same URL distinct SKU                 |E09,S01        |
|S09 |Structured price evidence & cost-basis contracts                 |foreign currency, no invented shipping, PDP/source parity         |E07,S08        |
|S10 |Match+group blocking performance                                 |parity/recall vs reference, adversarial 30/120/300/1000           |E12,S08        |
|S11 |Strict deterministic ranking + diversity policy                  |comparator algebra, cheapest eligible independent of diversity    |E03,S09,S10    |
|S12 |Search cache quality-aware partial/source recovery               |partial never complete; no thundering-herd; client coalescing     |E01,E02,S04    |
|S13 |Canonical versioned index and source observation consistency     |outbox, crash replay, reconciliation, stale guard                 |E10,E11,S08    |
|S14 |SSE/JSON/UI publication and progress semantics                   |valid early offers, honest partial, final parity, no late write   |E14,S11,S12,S13|
|S15 |Python enrichment and bounded PDP alternatives                   |valid evidence parity, no core delay, worker cancellation         |E13,S09        |
|S16 |Offline adaptation, counterfactual replay, decision governance   |confidence and value calibration, no loss of niche cheapest       |E17,S05,S07    |

Work packages are hypotheses until current HEAD tests establish necessity\. Reuse preexisting code rather than duplicate it\. Each package produces a small PR or independent experimental report, not a single megamerge\. Search work may be parallelized ONLY across nonoverlapping files and stable upstream contracts\. Fast correctness packages S00/S04/S08/S09/S11/S12 take precedence over speculative ML\.

## 8\. Package and language decision table

Use existing Node native fetch/AbortSignal/crypto/perf\_hooks, `meilisearch`, `pg`, `cheerio`, `crawlee` and existing Python `httpx`, BeautifulSoup, lxml, Pydantic, RapidFuzz, pytest, Hypothesis\. `fast-check` dev\-only for model/state and property tests; TS `checkJs` dev\-only for shared contracts; Ruff CI\-only\. Optional `Ajv` if cross\-language JSON schema acceptance differs; Decimal or fixed\-point if Node arithmetic requires it; `selectolax` only after identical evidence extraction A/B; `p-queue` only if built\-in bounded scheduler is demonstrably worse\. No heavy ML, vector DB, new search engine, paid source infrastructure or automatic Playwright requirement without measured benefits\.

## 9\. Mandatory autonomous engineering transaction per scope

OBSERVE exact revision and overlap \-\> SPECIFY hypothesis and possible counterexamples \-\> BASELINE\_RED deterministic failure where a defect exists \-\> MINIMAL PATCH \-\> PATCH\_GREEN \-\> MUTANT\_RED negative control \-\> PBT/FUZZ \+ INTEGRATION \-\> source/price/identity review \-\> profile matched A/B \-\> CI exact SHA \-\> review \+ merge gates \-\> Render exact LIVE SHA \-\> bounded customer acceptance \-\> evidence table \+ rollback\. Some performance hypotheses have no RED; replace RED with a predeclared paired benchmark and maintain invariant tests\. No cherry\-picked timing or assertion\-only acceptance\. Never merge if production deployment is in flight and the required verification cannot be completed\. Risky data migration requires operator approval and separate safeguards\. Never claim deployment without tool\-observed LIVE SHA\.

## 10\. Report template and self\-critique

`checkpoint | exact_sha | deployment_status | hypothesis | observed_code path:line | failure reproduction and baseline output | intervention | tests and mutant control | source coverage delta | verified-offer delta | first-verified latency delta with sample size | CPU/requests/RSS delta | conflicts | security/budget | PR and CI evidence | Render evidence | rollback | residual uncertainty | status`\.

Explicitly try to falsify any claimed gain: Was the faster response achieved by not searching a merchant? Did nominal offer counts improve while correct variant recall declined? Was a quote index mistaken for a selling source? Did a partial cache become falsely complete? Did data freshness merely get re\-stamped? Did all\-in SAR mix basis? Did retries amplify 429/403? Did worker stop but its child request continue? Did a gold/beauty/fashion long\-tail query disappear? Are observed source events selected only from slow paths? Mark untestable claims UNKNOWN and prohibit release on unresolved critical correctness risks\.

## FIRST EXECUTABLE ROUND

1. Refresh GitHub main/open PR/CI/Render exact live revision and source status\.
2. Inspect and pin a small representative corpus across arbitrary categories &#40;Arabic\+English, exact models, accessories, fashion sizes, beauty pack size, gold karat, unknown category&#41;\.
3. Implement S00 source\-stage manifest and tests **without altering production**; connect evidence to E00/E04\.
4. Separately reproduce E01 partial\-cache defect on latest source and establish RED, then implement minimal remedy if authorized for writes\. Do not overlap source adaptation changes with already merged PR \#227\.
5. Report truthful progress and choose the next prerequisite based on evidence, not a scripted promise\.

**FAIL\-CLOSED EXIT:** If tools or current SHA cannot establish a required fact, mark the gate `UNKNOWN/BLOCKED` and state the exact missing evidence\. Do not invent it\.
