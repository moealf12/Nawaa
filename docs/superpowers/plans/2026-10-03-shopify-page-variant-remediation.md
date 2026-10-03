# Shopify Page Variant Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Preserve the already selected native execution method with one fresh whole-branch reviewer.

**Goal:** Correct Spigen's vendor/model matching and verify tentree's requested page variant without relaxing identity checks.
**Architecture:** Keep query semantics in the shared search module and match Shopify variants before its existing result cap. Add a small bounded page-variant extractor which feeds the existing storefront selection and variant identity pipeline. Verify both affected sources alongside six previously passing controls.
**Tech Stack:** Existing Node >=22 ES modules and node:test; no new dependencies.
**Spec:** docs/superpowers/specs/2026-10-03-shopify-page-variant-remediation.md
**Baseline:** `4817d7775df20e50b74658af6be1109112ad75ed`; linked worktree `nawaa-price-identity`, isolated branch `codex/shopify-page-variant-remediation`. Baseline suite: 185 Node tests plus two legacy assertion scripts.
**Status:** User approved implementation, review, deployment and production proof on 2026-10-03.

## Global Constraints
- Existing free infrastructure only; no new credentials or services.
- Missing availability, shipping, tax and delivery time remain unknown.
- Match before the existing three-variant cap; keep existing store/product discovery limits.
- Manufacturer brand is not Shopify vendor; known actual brand conflicts still reject.
- Same revision/environment, original queries, three rounds, >=60-second gaps.
- No UI trial and no readiness claim for sources not tested on the new revision.

## Review Focus
- Family prefixes must neither mask Pro/Pro Max conflicts nor reject a correctly labelled requested Pro variant. Exercise both directions in Task 1.
- Accessory line words such as Ultra must not become device variant evidence; a real Galaxy Ultra suffix must still conflict. Exercise both in Task 1.
- Numeric zero, decimal strings, empty strings and invalid currencies must not yield invented page prices. Exercise in Task 2.
- Repeated initData blocks, escaped quotes/braces and unrelated recommendation variants must not establish a requested price. Exercise in Task 2.
- Existing structured JSON-LD and actual fetched URL provenance must not be overridden by an unrelated pixel payload. Exercise in Task 2.

### Task 1: Honest Shopify metadata and variant-level query matching

**Files:** Modify `server/providers/shopify.mjs`, `src/search-query.mjs`; test `tests/shopify.test.mjs`, `tests/regressions.test.mjs`, `tests/audit-contract.test.mjs`.
**Interfaces:**
- Consumes `searchShopifyStore(query,store,{limit,fetchImpl,convertMoney})`, `assessOfferMatch(query,offer)`, `queryMatchReasons(query,offer)`, `sameOfferIdentity(left,right)`.
- Produces Shopify offers retaining `vendor`, with `brand` explicitly sourced or null; only query-matching available variants, capped at three per product. Shared model matching checks all explicit supported model labels, ignoring a labelled generic Series prefix only.

- [ ] Write tests whose literal assertions pin: vendor `Power`, brand null, charger SKU `ACH10398` matching a page with brand `Spigen`; two results for existing vendor-only `brand` query; true known brand conflict still false.
- [ ] Add variant fixture with first three Pro Max variants and late base variants. For query `iPhone 17 case`, assert emitted variant IDs exactly `44458194370607`, `44458360045615`, `44458370793519`, not any Pro Max ID. Use actual product title, type `Clear Cases` and option labels.
- [ ] Add direct shared-matching tests: plural case type is accessory; base case in `Ultra Hybrid` matches; generic family plus Pro Max rejects base query; generic family plus explicit Pro matches Pro query; actual Galaxy S25 Ultra still rejects base S25; wrong-model/negative query emits no offers.
- [ ] Run `node --test tests/shopify.test.mjs tests/regressions.test.mjs tests/audit-contract.test.mjs`. Expected: RED on vendor identity, late variant selection and accessory semantics, not transport/import errors.
- [ ] Implement minimal shared model/category corrections and synchronous candidate matching before conversion/cap. Do not weaken `sameOfferIdentity` or change fee/FX semantics. Do not add misleading aggregate queryFilter counts.
- [ ] Run the targeted command and `npm test`. Expected: zero failures, existing vendor-only and other provider regressions remain green.
- [ ] Commit `fix: match Shopify variants without conflating vendor and brand`; complete task using `task-done ... -- npm test`.

### Task 2: Bounded Shopify page variant extraction

**Files:** Create `server/shopify-page-variant.mjs`; modify `server/url-resolver.mjs`; test `tests/price-identity.test.mjs` and existing extractor tests as needed.
**Interfaces:**
- Consumes literal script JSON, requested page URL and existing `selectVariantCandidates(candidates,url)`/`resolveProductUrl(url)` contracts.
- Produces `extractShopifyVariantState(html,url) -> structured Product | null`, with a single verified Offer URL, SKU, name, image, major-unit price and currency. Feed as existing `storefront_data`; non-Shopify behavior and strategy names remain compatible. Vendor stays separate from brand.

- [ ] Write a real resolver fixture mirroring tentree's initData with sibling S/M/L variants: requested L `43940667982010` must return price `58.8`, USD, SKU `TCM4546-3560-L`, exact requested URL/variant ID, title ending `METEORITE BLACK RUSTIC PLAID / L`; availability and fees remain unknown.
- [ ] Table-test unknown variant, duplicate requested IDs, repeated qualifying blocks, cross-host/path/port/credentials, malformed/unbounded JSON and missing price/currency. Expected null from the new parser or variant-unverified resolver failure; never sibling/default price.
- [ ] Test literal amounts `0`, `58.8`, `"58.80"` versus `""`, negative, nonfinite/overflow and unsupported currency; accepted amounts remain major units. Include escaped braces/quotes and unrelated recommendation data.
- [ ] Test existing JSON-LD exact variant still resolves without pixel data; unrelated pixel data cannot supply metadata to it; redirected fetched URL still fails existing identity guard.
- [ ] Run `node --test tests/price-identity.test.mjs tests/nawaa-extractor.test.mjs`. Expected: RED on tentree's supported shape and missing parser behavior; existing JSON-LD cases green.
- [ ] Implement bounded literal JSON parsing within script content (<=1,500,000 characters per payload, <=500 variants); require one exact valid variant across qualifying blocks. Integrate without executing JS or retaining private/customer fields. Keep actual page URL and explicit variant evidence before reconciliation.
- [ ] Run targeted tests and `npm test`. Expected: zero failures; existing storefront, JSON-LD and identity regressions green.
- [ ] Commit `fix: verify Shopify page initData variants`; complete task using `task-done ... -- npm test`.

### Task 3: Whole-branch review, existing-service deploy and production proof

**Files:** Preserve matrix machinery; create report/evidence artifacts outside the Git-backed project.
**Interfaces:** Consumes the two corrected adapter/resolver paths and unchanged audit protocol. Produces independent 72-probe evidence on the merged production revision, actual readiness counts and closed temporary access.

- [ ] Generate review package from baseline through HEAD. Dispatch one fresh read-only reviewer; provide plan/spec and ledger rulings. One Important/Critical fix pass, each RED→GREEN and full suite; record deferred minors, no second review.
- [ ] Create PR and verify successful CI, then merge through the already authorized workflow; validate remote/local tree equivalence. Deploy existing free Render service with the temporary audit key's expiry; avoid duplicate deploys.
- [ ] Run `node scripts/audit-matrix.mjs --base https://nawaa-search-api.onrender.com --revision MERGED_SHA --token-file TOKEN_PATH --output EVIDENCE_PATH --round-gap-ms 60000 --sources jarir,extra,decathlon-sa,asos-global,shopify:native-union,shopify:spigen-us,shopify:death-wish-coffee,shopify:tentree`. Expected: 72 unique completed records at one revision/environment and unchanged queries. Read actual per-source outcomes; success is not assumed.
- [ ] Verify gaps, record integrity, zero missing/duplicate entries and any transport failures. Only 9/9 sources count as passing; preserve prior evidence independently.
- [ ] Remove temporary audit env values and local key; verify healthy same revision and private-route 404. Scan the final evidence bundle for the temporary key before saving report and evidence.
- [ ] Report tests, CI/deploy revision, actual per-source results, all rulings/minors and remaining limitations. No all-29 or complete-delivered-cost claim.

## Plan self-review
Spec requirements 1–3 map to Task 1, requirement 4 and variant extraction to Task 2, and acceptance/cleanup to Task 3. Metadata produced in Task 1 preserves the strict identity consumed by Task 2 and the audit. Review Focus cases have owning tests above. No UI, billing, inventory redesign or unrelated CI refactor is included.
