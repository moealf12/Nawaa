# Source remediation, batch 1

Base: 0b4303e519b6cb2f5b2fb6b740589ddeb75a6546. Evidence: phase3-production-results, 261 production probes. Continue the approved backend-first readiness plan.

## Task 1: Provider output
Canonicalize Jarir offers to jarir-direct while preserving extraction strategy. Successful Constructor empty results must stay empty and must not fall into recommendation HTML. Malformed responses remain failures. Remove query-incompatible offers from Jarir, eXtra, and free storefronts using shared matching rules; retain upstream and filtered counts in diagnostics. Keep the audit acceptance bar and delivered-cost uncertainty unchanged.
Tests: node --test tests/source-remediation.test.mjs, then npm test. RED: canonical attribution and incompatible/recommended products fail. GREEN: matching variants retained, wrong variant/capacity/accessories removed, successful empty distinct from transport/malformed errors.

## Task 2: Page diagnosis
Add safe per-sample verification details: invalid page data with existing reasons, identity mismatch, currency change, price change, transport/DNS/content failure. Never include raw exception messages. Retain aggregate counts, timeout behavior and source certification criteria.
Tests: node --test tests/audit-contract.test.mjs, then npm test. RED: page mismatch failures indistinguishable. GREEN: codes and safe reasons identify each boundary without accepting failures.

## Task 3: Review and production evidence
One whole-branch fresh reviewer, fix Important/Critical findings with RED/GREEN and full suite. Merge through PR and deploy the existing free Render service. Run fixed two-positive-plus-negative queries for Jarir, eXtra, NiceOne, Centrepoint and MaxFashion over three separated rounds; add focused page probes for prior generic failures. Preserve old results. Disable the temporary authenticated route afterward. Report actual gains and unresolved failures; do not claim all sources ready.

## Review Focus
False empty success after malformed/failed upstream; general discovery and Arabic aliases; conflict filtering hiding upstream errors; audit counts before/after filtering; source attribution remains strict; safe diagnostics leak no raw URLs/tokens/messages; source certification still requires independent page checks; no new paid resources.
