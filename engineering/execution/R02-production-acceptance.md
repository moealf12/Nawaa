# R02 — Final live cache admission certification (pending PR evidence)

- Branch baseline: `01dff25b38f0cc560f7da03d6d2b02212466c5d6`, verified as Render LIVE, deployment
  `dep-dbij1rjbc2fs73cigbv0`.
- The R02 implementation is already merged in PR #235. This PR **does not**
  change product retrieval, canonical identities, sources or live cache policy.
- This certification adds a read-only production test to existing eight
  Arabic/English searches and four SSE searches. On actual deployed production:
  partial results must not appear as `cache.mode=fresh` or
  `cache.completeness=complete`.
- A repeated sequential query with a partial, structurally valid first
  observation must re-acquire, rather than replay a falsely fresh partial.
- A coherent completed acquisition is permitted to be a fresh cache hit;
  `complete` means completion of the selected *wave*, not global exhaustion.
- SSE partial progress must not be promoted as a fresh snapshot.
- The live test requires a partial observation; if no such sample appears,
  it fails rather than claiming a negative-control proof that did not occur.
- This run neither checks stock by directly contacting merchants nor estimates
  worldwide cheapest landed prices.
- The repeat request adds one bounded extra request. Individual attempts are
  capped at 32 seconds. Existing 12-minute workflow and rate limits apply.

Do not set the R02 ledger to VERIFIED until the production test, PR CI, main
checks, exact Render live SHA, negative-control RED and benchmark evidence have
been inspected and linked. Treat source retries/latency from strict admission as
a measured follow-up risk; do not invent a P95 improvement.
