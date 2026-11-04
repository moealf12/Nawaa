# NAWAA R04-P48 — PDP TLS/HTTP Forensics and Alternative Classification Gates

## Scope
- Diagnostic-only follow-up after P47, with no changes to product retrieval strategy, merchant selection, retry count, connection policy, scoring, offer identity, price, cache freshness, SSE or shopper publication.
- PR Draft targets main due to repository's strict "not-main-pr" gate, so the diff includes unmerged P45/P46/P47 dependencies.
- All additional tracing is strictly opt-in through NAWAA_SEARCH_DIAGNOSTIC_TRACE=1 and candidate live-run NAWAA_P46_TRACE_ENABLED=1.
- No new diagnostic network calls, paid APIs, proxy rotation or attempts to circumvent a merchant's refusal.

## PDP phase milestones
The existing URL resolver invokes a safe stage observer when provided:
1. dns_complete: the secure public target passed DNS/IP checks.
2. request_started and socket_assigned: transport initiated, not proof of TCP connection.
3. tcp_connected and tls_ready: observed socket milestones in pinned Node HTTPS.
4. headers_received and body_complete.
5. candidates_extracted and price_selected.

A missing milestone is unobserved, not zero elapsed. Multi-hop requests never become fictitious single-hop TCP/TLS/header intervals. Test-fetch mode cannot claim socket/TLS stages it does not observe. Traces contain only known stage names, bounded durations and count totals.

## Deadline provenance
The generic storefront provider imposes a roughly 6500ms per-store deadline. Its controller aborts in-flight PDP requests. Previous generic HTTP_TIMEOUT events do not, by themselves, prove remote merchant socket timeouts.
The new probe snapshots synchronously on a store budget abort, because the outer Promise.race can finish before outstanding PDP promises. It distinguishes:
- parent/store-budget cancellation;
- independent PDP timeout classification;
- failure before DNS, before headers and after headers;
- missing milestones.

The timeout, concurrency, retry budget, HTTP parser and source policy are unchanged.

## Quantile semantics
Per-PDP intervals are counted only when directly observed stage pairs exist. Source-level summaries include counts and within-run quantiles over up to 20 existing PDP attempts. Multiwave aggregation clearly marks P95 of run-level P95 samples, not a population P95 or causal probability.

## Alternative lane gate attribution
The existing production classifier still decides every lane. Auxiliary read-only histograms decompose alternative into overlapping observed conditions:
- exactMatch is not true;
- matchConfidence is missing/below 0.9;
- requested model not verified in title;
- title coverage below 0.67;
- remaining subject-role/precedence gate.

These overlap and are not mutually exclusive root causes. No customer query, product title, exact URL, seller, SKU, raw price, cookies or secrets in saved histograms. No product promoted to direct.

## Acceptance
1. Exact-head Required PR, Search Core and negative/security tests.
2. Same REAL merchant 36-intent, concurrency-two candidate and unchanged strict relevance/deadline gates.
3. Retain failed cases and unknowns with exact candidate SHA.
4. Source audit, real browser and candidate smoke gate, all independently verified.
5. No merge/deploy until review and explicit production approval. R04 remains open until actual Render exact-SHA 2x36 and browser verification.
