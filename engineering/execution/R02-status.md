# R02 — Strict cache admission and performance safety

## Fix delivered by this PR

- Cache admission now checks positive offers, coherent bounded-wave coverage,
  source errors, deadline, outstanding providers and well-typed counters.
- Production is strict: missing or contradictory evidence never produces a
  45-second FRESH snapshot. Legacy test-only consumers without coverage retain
  their existing explicit compatibility behavior.
- Partial offers are returned to the requesting customer unchanged. They are
  not stored in the authoritative primary cache; an existing prior complete
  snapshot remains stale-only (never served when allowStale:false).
- All identities, prices, source ownership and user-visible result contracts
  are preserved. Invalid or crashing classifiers deny cache admission without
  invalidating an already valid shopper response.
- Depth 1/2 acquisition now explicitly states partial/complete, including
  diagnostics that previously could hide Amazon or PDP failures.
- Low-cardinality admission diagnostics survive invalidated generation replay;
  no shopper query, price, URL, or raw merchant payload is logged.

## Expected performance and protection

The last R01 production acceptance found 8/8 queries PARTIAL with
15–19 source errors per query. Therefore strict admission can reduce
the 45-second cache hit rate and increase repeated source requests.
This is a **known correctness/performance tradeoff**, not a measured
latency improvement. The 30-concurrent-reader fixture must prove one
in-flight merchant acquisition; repeated non-overlapping partial
requests are reattempted, while provider deadlines, source cooldowns
and existing public rate limits remain in force. Any measured breach
of free-tier resource constraints blocks promotion.

Do not disguise short-lived partial evidence as a complete fresh cache
or introduce a second hidden partial cache. A future explicitly scoped
source-reliability round may optimize retry pacing with source evidence,
but shall not silently reintroduce the original misclassification.

## Evidence

- R01 LIVE baseline main SHA: `ccd379508c2f1f357329a188949d4b40779490af`
- Branch RED commit: `d60bbf1984a2e7ee313b368747a7614f782550db`
- Target: exact-head PR checks, explicit RED/GREEN regression, full
  npm test, PostgreSQL/Meilisearch/Python integration, and live release
  SHA verification. The ledger remains R02 IN_PROGRESS pending all gates.
