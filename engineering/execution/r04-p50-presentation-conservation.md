# NAWAA R04-P50 — Principal Presentation Conservation and Condition-Truth Forensics

## Purpose
Find the exact boundary behind Q09 "PS5 NVMe SSD 1TB" and Q10 "قرص اس اس دي بلايستيشن 5" failing strict principal presentation in one live 36-intent run. Q09 had 14 offers and zero classified-direct groups; Q10 had 3 offers, one classified direct, yet no final principal. These are different failure signatures, not a single proven matching bug.

## Production stages inspected without alteration
1. ACTUAL buildIntentAwareResultLanes classifier: classified.primaryGroups.
2. ACTUAL condition filter in buildSearchPresentationSections: bestOffer?.condition matches the requested condition (default new).
3. The existing pure buildDiscoverySections(query, conditionMatchedDirect) baseline.
4. The existing exact-title dispute rescue and exactGroups output.
5. unplacedDirect and the final relatedGroups fallback.

The audit accepts the already-built production sections. It does not implement its own matching decision or overwrite the customer output. It invokes buildDiscoverySections only as a pure read-only observation of its pre-rescue output.

## Conservation invariants
- input = classifierDirect + classifierRelated = finalPrincipal + finalRelated
- classifierDirect = conditionMatched + conditionUnknown + conditionExplicitMismatch
- conditionMatched = initialDiscoveryPlaced + rescuedByExactTitleEvidence + conditionMatchedButUnplaced
- classifierDirect = finalPrincipal + unplacedDirect
- unplacedDirect = unplacedUnknownCondition + unplacedExplicitMismatch + unplacedMatchedCondition
- Each group appears exactly once by identity; no duplicate final principal or unplaced group. Inconsistent evidence fails the audit, not the truth gate.

## Critical product-truth rule
A missing condition is UNKNOWN, NEVER implicitly new. We may learn that the field is absent in an otherwise direct classified source offer, but cannot promote it based on that absence. Any remediation must prove condition from merchant product evidence or an existing reliably grounded upstream contract, then verify this for general sources/categories.

## Acceptance
- Unit tests: explicit used/new, missing condition, accessory that is not a principal, condition/category rescue, duplicate or falsified sections, and raw-data non-disclosure.
- Existing 36-intent real public-merchant candidate, concurrency=2; all original search rules, abort/deadline budgets, source error and price guards unchanged.
- Q09/Q10 stage count diagnostics retained with exact SHA and live coverage. Candidate remains red if any strict principal group is missing.
- Required PR, Search Core, source validation, real-browser and frozen production evidence. Success of forensic collection is NOT product acceptance.
- No merge/Render deployment; only explicitly approved and separately validated source-truth corrections may change customer results.
