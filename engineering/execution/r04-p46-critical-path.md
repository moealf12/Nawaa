# NAWAA R04-P46 — Request-Correlated Critical-Path Forensics

## Objective
Replace ambiguous, concurrently interleaved slow-search logs with bounded evidence tying each **JSON HTTP client request** to its own ephemeral trace ID and, where it actually initiated an uncached acquisition, a separate **cache refresh generation ID**. Do not change source routing, ranking, admission, product identity, prices, cache correctness, source transport or SSE.

## Explicitly limited scope
- HTTP GET /api/search (ordinary initial JSON depth 0); the endpoint also emits request lifecycle data for depth/cursor or fresh cache reads. The detailed generation trace is for depth-0 searchAll only.
- No direct diagnostic calls to external merchants or production credentials. The existing disposable live-source 36-intent test is reused with concurrency=2.
- The new instrumentation is opt-in only: NAWAA_SEARCH_DIAGNOSTIC_TRACE=1. Default production behavior remains unchanged.
- Generated 64-bit ephemeral random hex IDs, distinct per HTTP request and cache-generation. Not persistent identifiers and not derived from customer data.
- The x-nawaa-request-id response header is present only in opt-in mode. Caller input cannot set or choose this ID.
- Cache coalescing is explicitly labeled: a waiting HTTP request must not receive attribution for work started by another request. Invalidation or replays can also change generations; those cases remain ambiguous, not joined by guesswork.
- Raw query text, customer IP, product titles, URLs, merchant response bodies, SKUs, raw source error messages and prices are NEVER put in trace output.

## Observed spans
1. HTTP response lifecycle: pre-cache, cache lookup/refresh waiting, post-cache canonicalization, enqueue/transport event; finish is not client receipt.
2. Generation source barriers: Amazon Saudi, first-wave provider pass, Meilisearch and persisted catalog (the last observed barrier is not necessarily the root cause).
3. Provider timeline: start-to-completion wall clock, completion relative to search start, callback queue wait, returned offers and error count, pass label. Capped at 24 with explicit dropped event count.
4. Broad phases: primary acquisition, pre-selection/optional fallback, finalization, all monotonic server wall times.
5. Offer stage counts: raw providers, raw/validated Amazon, index, persisted catalog, before/after canonicalization, rescored accepted, selected and error events. Counts are not additive due to deduplication, independent recall and filtering.
6. Root cause is always UNDETERMINED without a discriminating experiment or stage-specific direct proof.

## Collection protocol
- PR #308 is the P45 dependency and remains unmerged at branch cut. P46 targets the PR #308 branch; no production deployment.
- Candidate workflow r04-p36-disposable-candidate-36.yml already runs real public merchant HTTP with concurrency=2, no fake/offline catalog, no production DB or index secrets.
- P46 enables the trace inside the disposable candidate process and retains JSON artifact r04-p36-candidate-36-evidence.json with criticalPathDiagnostics.
- Correlator joins Q01-Q36 to HTTP events ONLY via the emitted exact response ID. Generation ownership is admitted only when exactly one matching generator and one matching HTTP event exist, the request was not coalesced, and the owner ID matches. Missing and duplicate events remain explicit.
- Any candidate missing strict principal groups, exceeding internal deadlines, or returning invalid products remains a failing release gate; clean diagnostics do NOT turn red product accuracy tests green.
- Production SLO improvement, seller reachability, checkout availability, cheapest price, or human relevance are not claimed from disposable runner measurements.

## Required review
1. Regression tests: concurrent AsyncLocalStorage isolation, random ID format, no arbitrary metadata/PII leaks, duplicated IDs, malformed timestamps, coalesced request, cached response without generation and provider-cap conservation.
2. Search Core + Required PR gates on exact current PR HEAD.
3. Candidate 36-intent run with real public source calls and retained artifacts; identify the worst *observed* barrier and next specific discriminating test.
4. Only after approval and merge of P45/P46: verify exact Render revision, compare 2 independent production rounds and published browser without relaxing truth gates.
