# R01 — Live search customer acceptance matrix

**Test type:** READ-ONLY live public deployment. Run on a Pull Request with
expected revision pinned to the PR base SHA; this is *not* an assertion that
the PR head is deployed before merging.

The workflow `.github/workflows/live-production-source-acceptance.yml`
tests Render /health, the current deployed search page, /api/sources, eight
Arabic/English queries covering smartphones, gaming, audio and computing, and
four independent SSE requests. An artifact captures rounded elapsed times,
offer counts, errors, source attribution metadata, final snapshot and done
completion. No merchant-direct crawling, production writes, credentials,
product title or listing URL is stored in this evidence artifact.

The test fails on transport errors, malformed offers, category-level absence
of structurally valid offers, uncompleted SSE, inconsistent revision, and
improper source registry metadata. The tests **do not** attest actual purchase
availability, compare worldwide prices, or assert identical product sets across
separate SSE and JSON acquisitions. That would require a shared observation
snapshot; compare provenance and identity with isolated end-to-end tests.

Passing this test means a representative read-only production baseline,
not comprehensive recall over every merchant. When a category fails, leave
R01 IN_PROGRESS and record the observed failure. Never silently lower the
test thresholds or substitute synthetic results for live evidence.

Baseline: `4412d50e29035955d4fdb91cf3bfb7daa3042ea8`. The SHA of the tested baseline and CI artifact link must
be verified after the workflow completes.
