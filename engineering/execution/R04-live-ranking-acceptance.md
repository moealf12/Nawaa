# R04 — Exact-LIVE first-screen identity correction (bounded)

**Status:** R04 remains IN_PROGRESS. This document certifies a **single first-result regression subset**, not full search quality or merchant coverage.

## Exact production lineage
- Baseline PROD SHA: `7b1fed5f29f4a78f8e1033f7f77af3108e547563`, prior candidate ordering release, Render `dep-dbil48bncjis73cop7v0`.
- Corrective source PR: https://github.com/moealf12/Nawaa/pull/243
- Genuine recorded-title RED Node check: https://github.com/moealf12/Nawaa/actions/runs/41161199545 — six observed misclassifications failed.
- Exact-head corrected candidate `253495d6fd5fc089ce3fbef72fb343b56c09682a`; protected PR checks, Search Core, isolated CPU and candidate live smoke all PASS.
- Source fix MERGE SHA and now Render LIVE: `9bd76738a228f7c40127742b82c4b8efac8ef589`; deploy `dep-dbilkbeq1p3s739uaqg0`. Post-merge release readiness: https://github.com/moealf12/Nawaa/actions/runs/41162321471 — PASS.
- Independent (read-only) postdeploy auditor PR: https://github.com/moealf12/Nawaa/pull/242; synchronized auditor commit `90dd0856ecb97817b6036a1d95ba3f26bb895a25`.

## Genuine live negative control and post-fix test
- Pre-fix production audit: https://github.com/moealf12/Nawaa/actions/runs/41161937606 — **FAILED by design**; 10/10 HTTP searches succeeded, 100 grouped top-screen products gathered; exact confirmed unrelated peripheral at rank #1 in queries `Q02,Q03,Q04,Q05,Q15` (5 of 10).
- Post-fix production audit: https://github.com/moealf12/Nawaa/actions/runs/41162761318 — **PASS**; 10/10 HTTP 200, 98 ranked groups in sampled top tens, **zero known confirmed peripherals at rank #1**, exact live health SHA pin. Evidence artifact ID `13027728079`.
- These are independent temporal production samples, not controlled same-candidate A/B. Merchant inventory, source availability, index changes and dynamic source ordering can vary. The observed zero/5 distinction is compatible with the engineered correction but does not isolate the correction's causal effect from such time-varying changes.
- Both sets of 10 requests were partial. Post-fix source error reports spanned 13–18 per request.

## Honest metrics and limits
- Grading is **precommitted rule-derived provisional** from retailer titles/specs. Neither model's `exactMatch` nor `matchConfidence` supplies truth labels. Unknown labels remain null.
- Postfix sample: 8/10 queries had complete provisional labels; 7 first-screen results remain unjudged; 2 JBL queries have insufficient judgments for NDCG/MRR.
- Some PS5 results with graded nonprincipal products remain **within** the top 10; clean rank #1 is not proof of top-10 purity.
- Group positions are from server `groupComparableOffers`, **not a browser DOM/visual capture**. Never call these 98 real customer-rendered cards without separate browser verification.
- These 10 checks cannot certify full 36 bilingual query corpus, product-stock truth, shipping, price parity, country eligibility, production P50/P95 or global cheapest offer.

## Next work
- Independent human/merchant-evidence adjudication of unknown or disputed first-screen products, including PS5 product/bundle variants, JBL earphones and HP RAM parts.
- Verify UI/DOM first-screen order separately against source offer grouping and JSON/SSE lifecycle.
- Diagnose partial acquisition and source errors as independent source-reliability work; do not erase valid merchant offers to inflate metric coverage.
