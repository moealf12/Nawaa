# NAWAA R04-P49 — Censored Preheader Wait and Cross-Script Relevance Forensics

## Exact scope

Read-only, opt-in diagnostic enhancements on top of P45-P48. This branch keeps all R04 source selection, retry/timeout budgets, abort semantics, prices, product identity, cache admission, matching/ranking and customer presentation unchanged. No additional merchant HTTP requests.

## Incomplete HTTP observations are right-censored

A PDP connection that reached TLS-ready but had no observed HTTP headers when the request was terminated is NOT a completed header-latency sample. The trace now reports:
- number of terminated calls with TLS ready and no headers;
- elapsed milliseconds between last TLS-ready and the terminal observation, labeled a CENSORED lower bound;
- the completed headerWait P50/P95 on requests where both endpoints were observed, separately;
- store-budget cancellations and independently classified timeouts, separately;
- a clear UNKNOWN for missing socket/TLS milestones or redirect/multihop ambiguity.

Any time-to-first-byte/headers claim requires the completed stage, not substitution of a cancellation bound. The terminal observation does not establish the merchant host as the root cause; network/Routing/Render controls may contribute.

## Error histograms

Each merchant now retains an allowlisted observation count for classifiable HTTP_403, HTTP_TIMEOUT, SOURCE_ACCESS_DENIED_COOLDOWN and other coded states. A cooldown is a LOCAL skip, not proof of a new upstream 403, and zero PDP attempts are not counted as failed PDP requests.

## Query/title script evidence

The real classifier's existing outcome remains unmodified. Audit-only counts mark whether an Arabic-only query and Latin-only title (or vice versa) are script-disjoint among alternative groups, and whether those groups had title coverage below the existing threshold. Mixed/unknown scripts are excluded from strict disjoint counts. This is a language alignment hypothesis, NOT semantic equivalence, nor authorization to promote accessory/variant listings.

No raw customer query, product title, URL, SKU, price, error text or token is logged. Only allowlisted enums, bounded counts and clock offsets.

## Governance

All current parent PRs (#308 P45, #309 P46, #311 P47, #313 P48) are Draft and unmerged. P49 PR will target main for the repository's Required PR gate, so the diff includes the diagnostic dependency stack.

Acceptance requires:
1. Exact-head negative/contract tests and Required PR, Search Core and source gates.
2. Reuse the existing 36 real merchant intent candidate at concurrency 2; no synthetic product responses or extra source traffic.
3. Retained forensic JSON with explicit unknown/censored categories.
4. Browser and production evidence checks without relaxing relevance, source freshness or completeness.
5. Explicit approval before merge or Render deploy; no claim that R04 is fully solved by better diagnostics.
