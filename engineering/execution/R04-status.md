# R04 — Search intent and ranking (IN_PROGRESS)

**Baseline:** `69896f49c89a1534d62eb4a10a34da71ebfb6739`, after R03 evidence certification became GitHub main and Render LIVE.

## First bounded engineering slice: score cohort / price comparability

- Candidate PR: https://github.com/moealf12/Nawaa/pull/241
- RED commit: `8e261b82816c83ebf6be67d5bec6980a951f460e`
- RED required checks: https://github.com/moealf12/Nawaa/actions/runs/41157068912 — two controlled failed assertions.
- GREEN candidate head before main synchronization: `5766ac39fda8ff97ded638365e191001dcc63fec`
- GREEN required gate: https://github.com/moealf12/Nawaa/actions/runs/41157287009 — PASS (883 Node PASS, zero FAIL, 3 SKIP, 1 TODO).
- GREEN extended Search Core: https://github.com/moealf12/Nawaa/actions/runs/41157287045 — PASS.
- Scope: maintain confidence-defined relevance cohorts and merchant round-robin; compare observed positive prices only when same currency, same relevance tier and near-enough identity confidence; mixed-currency merchant buckets retain confidence order.

## Outstanding before R04 may become VERIFIED

1. Independently adjudicate sufficient bilingual ranking judgments; the existing 36-query R01 intent corpus covers normalization, not graded top-10 merchant relevance.
2. Compute meaningful NDCG@10 / MRR@10 on version-pinned labeled candidate fixtures and compare to the baseline, with no variant/accessory regressions.
3. Validate real JSON/SSE customer search on the deployed code and exact current SHA. Do not equate different-time JSON/SSE outputs.
4. Verify merchant source availability and price evidence separately; 8/8 LIVE R03 sample queries remained partial, with 14–15 source failures each. R04 ranking cannot resolve provider outages.
5. Execute protected PR gates and post-merge production exact-SHA checks before promoting a code slice.

**Status:** IN_PROGRESS is not a claim of production-verified R04 quality or final completion.
