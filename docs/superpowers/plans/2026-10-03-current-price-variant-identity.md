# Current Price and Variant Identity Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task with one whole-branch reviewer.

**Goal:** Emit page-backed Jarir prices and correctly verify explicit Shopify variants.
**Architecture:** A small variant selector filters structured candidates before reconciliation. Shared offer identity checks retain strict host/identifier/variant requirements. Jarir discovers then refreshes matching offers from product pages with bounded concurrency.
**Tech Stack:** Existing Node >=22 ES modules, node:test; no new dependencies.
**Spec:** docs/superpowers/specs/2026-10-03-current-price-variant-identity.md

## Global Constraints
- Existing free infrastructure only; no new credentials or services.
- Missing shipping/tax remain unknown.
- Bound concurrency, not total results; existing discovery limits are unchanged in this batch.
- Same revision/environment, three rounds, original queries, >=60-second gaps.

## Review Focus
- A cheapest or first sibling Offer must never override the explicit variant URL.
- SKU and model/MPN namespaces remain distinct; unrelated fields are not merged.
- Failed product page refresh cannot fall back to an old index price or pass a negative control.
- Page refresh concurrency is bounded without truncating discovered matches.
- Redirected merchant/path/variant mismatch and nonfinite prices cannot become verified output.

### Task 1: Variant selection and SKU
Files: create server/product-variant.mjs; modify server/url-resolver.mjs, server/product-reconciliation.mjs, server/product-identity.mjs, server/audit-contract.mjs; tests tests/price-identity.test.mjs and existing reconciliation/identity tests.
Consumes extractionCandidates(html,url) and structured Product.offers. Produces selectVariantCandidates(candidates,url) and sameOfferIdentity(left,right). Resolver emits sku and variantId separately; audit uses shared identity.
- [ ] Write tests for exact requested higher-priced sibling, SKU/MPN separation, unknown variant, relative URL, cross-host/path rejection, conflicting SKU and nonvariant compatibility.
- [ ] Run node --test tests/price-identity.test.mjs: expected RED on wrong variant and missing SKU.
- [ ] Select structured matching Offers before reconciliation; preserve offer SKU; retain strict audit identity and variant URL equality.
- [ ] Run targeted tests then npm test: zero failures.
- [ ] Commit independently.

### Task 2: Jarir page price refresh
Files: server/providers/jarir.mjs, server/audit-contract.mjs, tests/price-identity.test.mjs, existing source/server remediation tests.
Consumes resolveProductUrl(url), sameOfferIdentity(left,right), queryMatchReasons(query,offer). Produces refreshJarirPrices(offers,matchingQuery,{resolvePage}) returning offers, errors and refresh counts, concurrency <=6. searchJarir keeps canonical attribution and page price evidence.
- [ ] Write tests for 4599 index vs 3199 page, failed/mismatched pages producing no stale offer, 13 offers all refreshed with <=6 in flight, zero matches avoiding fetch, and partial error/filter counts preserved.
- [ ] Run targeted tests: expected RED on stale prices and absent refresh behavior.
- [ ] Refresh filtered matches only, preserve current price/currency/time and prior price evidence; never infer shipping/tax.
- [ ] Run targeted tests then npm test; update transport fixtures to model actual page fetching.
- [ ] Commit independently.

### Task 3: Review, deploy and focused production proof
- [ ] One read-only fresh whole-branch review. One fix pass for Important/Critical issues, each RED→GREEN, full suite.
- [ ] PR, CI, merge and existing Render deployment; temporary audit key with expiry, no duplicate deploy.
- [ ] Original matrix subset: Jarir, four Shopify stores, eXtra/Decathlon/ASOS; 8*9=72 probes on three rounds. Preserve prior evidence and make no cross-revision certification claim for untested sources.
- [ ] Close audit route/key, verify revision/health/404, save report and evidence with unresolved cases.
