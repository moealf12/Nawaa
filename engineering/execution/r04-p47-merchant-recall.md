# NAWAA R04-P47 — Merchant-Scoped Acquisition + Principal Recall Forensics

## Contract and deployment
- Continue R04-P45/P46 without duplicating code. Branch based on P46 head; PR targets main because the Required PR Gate explicitly requires main.
- Trace opt-in only with NAWAA_SEARCH_DIAGNOSTIC_TRACE=1 and the disposable P36 live runner setting NAWAA_P46_TRACE_ENABLED=1. Runtime defaults unchanged.
- Do not merge, deploy, modify provider timeouts, disable a merchant, weaken relevance, change product identity/price/availability or alter SSE behavior based on incomplete evidence.
- Do not issue any extra diagnostic HTTP requests. Reuse exactly the original 36 public merchant searches.

## What is captured (one record per real scheduled merchant in the generic storefront wave)
- Trusted store ID, pass (primary/fallback), wall-clock duration, outcome (with_offers / zero_offers / rejected), candidate and verified offer counts, failure code if typed.
- At most six monotonic stage offsets: HTML completed, cards parsed, fallback completed, direct offer admission, PDP resolution, final intent-filter completion; stage-specific integer counts only.
- Per-generation capped 64 merchant records and explicit dropped count; unknown or truncated evidence never means zero.
- Per intent: original request/refresh correlation, barriers, server selection/normalization counters, customer presentation primary/secondary lane counts.
- Maximum 25 triage merchant rows in the summary, sorted by observed p95 plus rejected/zero-offer occurrences. Triage score is NOT causal probability and must not automatically suppress sources.

## Why Q17 can vanish even with faster HTTP
- Frozen Q17 query is gaming desktop RTX 5070.
- One live candidate round returned 24 offers / 3 strict principal groups; a second returned 19 offers / 0 strict groups despite ~2 seconds HTTP. No product identity thresholds were modified.
- Do not claim this is "a matching bug" without product-truth evidence. Instrument raw candidate counts, merchant verified offers, strong-matched first wave, after canonicalization and after admission, then independently correlate them with client-side principal-vs-related groups.
- Missing Q17 principal can be caused by source recall, product variant identity, admission, matching or classification. Stage counts reduce the search space but are not item-level proof.

## Evidence completeness and safety
- Never log query text, client address, URLs, product title, price, seller, SKU, raw response, arbitrary error message or secret.
- Real merchant access failures remain explicit: blocked HTML, 403, 429, 5xx, timeout and cooldown are not proof of stockouts.
- Stage offsets can be absent on early failure; absent means unknown, not zero. Timings include async waits, not CPU.
- Source outcomes are sanitized before entering shared generation diagnostics; output is a bounded low-cardinality selection from a static known merchant set.
- Cache coalesced requests remain separate from owning generation. No artificial duplication of offer yield or request IDs.

## Acceptance
1. Exact SHA Required PR, Search Core and trace unit tests pass.
2. Existing disposable LIVE candidate 36-intent / concurrency-two run completes and archives criticalPathDiagnostics, even if strict customer relevance fails.
3. Report lists Q17 independently: acquisition count, merchant yield by known source, stage event completeness, strict principal and secondary lane count.
4. Zero change to published product output in default disabled mode; shadow instrumentation only.
5. After explicit approval, merge and Render exact SHA verification; then two independent 36-intent production rounds and browser acceptance before declaring R04 fixed.
