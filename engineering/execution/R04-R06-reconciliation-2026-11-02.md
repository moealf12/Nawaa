# NAWAA v23.21 — R04–R06 evidence reconciliation (2026-11-02)

**Status: NOT A FINAL ROUND CERTIFICATE.** This report reconciles **implemented/deployed slices** with the stricter **21-round certification ledger**. Every reference below was checked as a real GitHub PR/run or Render deployment; evidence sufficiency is assessed separately. This document does not confer `VERIFIED`.

## Exact observed state

| Evidence | Verified value |
|---|---|
| GitHub `main` at audit | `d442e211da059040f6a3641927428b07508764df` |
| Render API `live` commit | `d442e211da059040f6a3641927428b07508764df` |
| Render deployment | `dep-dbkdqpbbc2fs73clrdeg` |
| Ledger file | `engineering/execution/rounds.json` |
| Recorded `planVersion` | `23.20` (user's working architecture is `v23.21`; **not auto-migrated**) |
| Ledger's mandatory schema | `nawaa.execution.v1`, exactly 21 rounds/35 unique packages |
| Current R04 / R05 / R06 | `IN_PROGRESS` / `PLANNED` / `PLANNED` (implementation and certification are separate) |

**Preserved invariants:** R05 and R06 require their predecessor to be `VERIFIED` before either may receive an active/verified ledger status; the validator also requires syntactically valid tested/merged/live SHA, exact deployment, negative control and customer acceptance for any `VERIFIED` round. A URL's existence is not proof its contents satisfy those gates.

## R04 — E03/S01: implemented slices; full certification withheld

**Confirmed chronology:**
- Ranking/identity fixes merged with [PR #251](https://github.com/moealf12/Nawaa/pull/251): `ff102bbcbb435e7dcd75d8b9310ccf070cd77f39`, previously LIVE at Render `dep-dbjmp6favr4c73c8as40`.
- A separately scoped production ranking verifier was merged as [PR #252](https://github.com/moealf12/Nawaa/pull/252): `152fc20bfcee7c7b6a58d6cfc46cdad948949a40`, historically LIVE at `dep-dbjpubfb9u1s73c0vjdg`.
- [Read-only postdeploy acceptance 41345730730](https://github.com/moealf12/Nawaa/actions/runs/41345730730), artifact `13098982850`: **4/4** observed bilingual ranking queries Q03, Q04, Q15 and Q16 passed the script's narrow criteria. All four were **source-partial**. The verifier's 15 associated unit tests passed.
- Existing [R04-status.md](R04-status.md) and [R04-live-ranking-acceptance.md](R04-live-ranking-acceptance.md) explicitly distinguish first-screen sample fixes from full independent bilingual grading, top-ten accessory correctness across the corpus, and UI/DOM parity.

**Certification blockers:**
1. The four-query postdeploy check and synthetic ranking benchmark do not establish broad independently graded results over the intended 36-intent bilingual corpus. Unknown/provisional classifications must not be silently counted as independently adjudicated.
2. New [PR #261](https://github.com/moealf12/Nawaa/pull/261), merged `b29cd8194474d83525faceac8a05f42f1dc3f43c`, added actual **published browser first-screen parity for Q03/Q04/Q15/Q16**: [live Chromium run 41509844134](https://github.com/moealf12/Nawaa/actions/runs/41509844134), artifact `13173032817`, tested previous live SHA `d442e211da059040f6a3641927428b07508764df`. Each query showed 10 ordered product groups matching its **same SSE session**, rank one provisionally grade 3, zero known wrong or unjudged top-ten within these four, and zero extra JSON recovery requests; frontend `src/search-page.mjs` hash matched the tested repository file. The reused ten-query live ranking audit observed 99 first-ten groups with zero provisional unknown labels, but ALL ten searches were source-partial. This **narrows** the blocker to broader 36-intent/variant DOM and independently adjudicated labeling, not these four first-screen cases.
3. Independent source partialness is separately tracked; do not use rank-quality PASS to claim that every merchant was queried or available.

**Ledger decision:** retain R04 `IN_PROGRESS`; add linked historical evidence and explicit blockers. No fraudulent `customerAcceptance=PASS` for full round.

## R05 — E04/S03/S04: merged LIVE; full certification withheld

**Confirmed chronology:**
- [PR #254](https://github.com/moealf12/Nawaa/pull/254), 403 access-denial cooldown and source reliability evidence, merged `d9de32af2f67ffc3c4b251b460b07812d9ff13a0`; previously Render LIVE at `dep-dbjqi76q1p3s73b2s3b0`.
- [Branch verification 41349033474](https://github.com/moealf12/Nawaa/actions/runs/41349033474): **954 PASS / 0 FAIL / 3 SKIP / 1 TODO**. Recorded 403 cooldown threshold, per-source isolation, non-403 recovery, 429 precedence, and refusal to turn transport/access failures into out-of-stock.
- [Six-query LIVE source baseline 41348833590](https://github.com/moealf12/Nawaa/actions/runs/41348833590), artifact `13100293250`: actual production revision `152fc20bfcee7c7b6a58d6cfc46cdad948949a40`, **before the R05 merge**; 92 source events, 81 classified, 11 unknown. This is NOT a post-fix A/B comparison.
- [Issue #253](https://github.com/moealf12/Nawaa/issues/253) documents the original failure classes and acceptance conditions.

**Certification blockers:**
1. The accepted pre-fix baseline cannot prove measured request reduction or preservation of genuine merchant yield **after** R05 was deployed. Require a bounded postdeploy source/yield audit on an exact LIVE revision, with no fabricated source availability or global P95 claim.
2. The candidate's green tests include negative scenarios, but a separately grounded baseline RED or independent mutation experiment specific to the R05 implementation has not been verified in the reviewed evidence. Do not label R05's negative-control certification PASS until that proof is inspected or generated.

**Ledger decision:** retain R05 `PLANNED` **as a certification state under the current dependency-restricted schema**, despite real merged code. Record the contradiction explicitly instead of rewriting the schema or falsely satisfying R04. The word `PLANNED` does **not** imply the R05 code is unimplemented.

## R06 — S12: A/B/C/D delivered, sampled acceptance passed, full certification withheld

**Confirmed implementation and lineage:**

| Slice | PR | Status / reference |
|---|---|---|
| R06-A hard stale-expiry | [#256](https://github.com/moealf12/Nawaa/pull/256) | Baseline [RED 41463217714](https://github.com/moealf12/Nawaa/actions/runs/41463217714): four targeted failures; patched [Search Core 41463988507](https://github.com/moealf12/Nawaa/actions/runs/41463988507) PASS |
| R06-B partial Amazon evidence | [#257](https://github.com/moealf12/Nawaa/pull/257) | [Search Core 41478122384](https://github.com/moealf12/Nawaa/actions/runs/41478122384) PASS including disposable JSON/SSE partial error and eXtra offer preservation |
| R06-C explicit pending-provider evidence | [#258](https://github.com/moealf12/Nawaa/pull/258) | Baseline [RED 41500013413](https://github.com/moealf12/Nawaa/actions/runs/41500013413); [GREEN 41500420161](https://github.com/moealf12/Nawaa/actions/runs/41500420161) PASS |
| R06-D read-only production acceptance | [#259](https://github.com/moealf12/Nawaa/pull/259) | [LIVE run 41504165842](https://github.com/moealf12/Nawaa/actions/runs/41504165842), artifact `13170461924`: 7/7 JSON and 4/4 SSE PASS on LIVE `305921f8f0de11ae838d72a02bfbdd3ddf9e2f68` |

Latest R06-D tool merge: `d442e211da059040f6a3641927428b07508764df`; Render deployment `dep-dbkdqpbbc2fs73clrdeg` is LIVE, public `/health` reported `ok:true` and the same revision, and [postmerge main CI 41505064083](https://github.com/moealf12/Nawaa/actions/runs/41505064083) succeeded.

**Limits:** All live R06-D query observations were still `partial:true`, with 14–18 source errors per first-round JSON query. The repeat PS5 request was `miss`, not a falsely fresh cached partial. JSON and SSE were separate requests at different times; matching structural outcomes do **not** establish byte-for-byte offer parity. The vendor failure scenario was injected only in a disposable HTTP test, not induced against real merchant traffic.

**Ledger decision:** retain R06 `PLANNED` under the preexisting sequential certification schema until R04/R05 are independently certified, then review R06 scope against all required source-recovery guarantees.

## Exact next bounded actions (do not reopen merged work)

1. **R04 closure evidence:** independently adjudicate representative real, captured bilingual top-ten results including accessories, memory/storage variants and JBL/PS5 cases; verify actual browser first-screen parity. Reuse the existing ranking corpus, provisional auditor and browser customer journey. Do not change ranking unless a real failing case is established.
2. **R05 closure evidence:** compare bounded source-denial/merchant-yield outcomes on a confirmed postdeploy revision against the actual pre-fix source baseline. Preserve observed 403/429 errors, enforce zero proxy/circumvention, and add an independent mutation/RED control if required. Never assert that all access-denied sources became available.
3. **R06 certification:** once predecessors meet their own gates, verify partial recovery evidence sufficiency and promote round statuses only via a dedicated exact-URL/CI/Render lineage PR. Check the 21-round validator on every ledger change.

**Do not mark R07 in progress** until predecessor certificate prerequisites are resolved. **Do not update planVersion from 23.20 to 23.21** merely because user-facing architecture has a newer label: any version migration requires explicit schema/validator alignment and a tested scope.

## Known unresolved distinction

The R04, R05 and R06 features may be deployed and useful while their round-wide governance certificates are still missing. The `rounds.json` evidence fields on this branch intentionally have `certification: "NOT_VERIFIED"` and do not grant automatic `VERIFIED` status. `R01–R03` are unchanged.


### Full 36-intent LIVE corpus evidence and objective relevance failures — 2026-11-02
- [PR #262](https://github.com/moealf12/Nawaa/pull/262) adds read-only 36-intent source-backed audit to the repository, merged at `42a38667116206e9b1b899d85ca47be1a86b3558`. Source LIVE SHA `b29cd8194474d83525faceac8a05f42f1dc3f43c`.
- [GREEN current-live audit 41520143778](https://github.com/moealf12/Nawaa/actions/runs/41520143778), artifact `13176798630`: 36/36 observed, 36/36 partial, **560 source error events** summed per request (not unique incidents), 1,515 returned raw offer observations, 13 intent IDs without strictly qualified UI groups, 117 unjudged positions, 9 **rule-provisional only** NDCG queries, human-independent full-round certificate FALSE.
- [RED test 41520038229](https://github.com/moealf12/Nawaa/actions/runs/41520038229): 7 PASS / 2 intentionally FAIL due missing source-error counter. [GREEN 41520143778](https://github.com/moealf12/Nawaa/actions/runs/41520143778): 9 PASS / 0 FAIL. Counter now reads exact `sourceErrors` and fails closed on absence.
- The **known ranking failures** in [issue #263](https://github.com/moealf12/Nawaa/issues/263) are corroborated by actual public merchant titles in TWO production observations. Canon mirrorless camera → straps/lens; Dyson V15 → toy vacuum; office chair → 1:100 miniature; coffee beans → sprayer/stickers. These are substantive relevance errors that cannot be overwritten by a provisional `wrongTopOne:[]` field, which only evaluated rule-supported identities.
- **Missing strict groups** do not assert out-of-stock; some corresponding API queries returned 1–5 offers below qualification thresholds. All sources remain partial, so human rating across 36 intents and broader DOM parity are still separately required.
- R04 remains `IN_PROGRESS`; R05 `PLANNED`, R06 `PLANNED` by dependency schema. Do not claim the 36-query transport PASS establishes search quality PASS or proceed to R07 without closing these blockers.
