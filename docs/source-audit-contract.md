# Independent source audit

This internal CLI audits one registry source using the same runtime configuration as the search server. It does not add a customer-facing endpoint or substitute an aggregate search for an isolated source probe.

```bash
node scripts/audit-source.mjs --list
node scripts/audit-source.mjs --source extra --query 'iPhone 17 256GB' --compare-production --output /tmp/extra-audit.json
node scripts/audit-source.mjs --source shein-sa --query dress --output /tmp/shein-audit.json
node scripts/audit-source.mjs --source extra --query 'nawaa-unfindable-943271' --expected empty
```

Page verification is enabled by default for up to three accepted offers. `--catalog-only` explicitly skips that step and can return only `VALID_CATALOG_SAMPLE`, not `VERIFIED_SAMPLE`. Storefront discovery probes up to 10 candidates for the diagnostic run; that is an audit sample, not a production search cap. Existing provider-specific catalog limits remain in effect.

The command records the Git revision, dirty worktree flag and execution environment. `--compare-production` also reads Render's health revision. A successful audit from a different revision or environment does not prove production behavior. Local eBay, Amazon and Shopify configuration is independent from Render's settings; missing local credentials are classified as `NOT_CONFIGURED`, not as a merchant outage.

## Offer acceptance

- Nonempty product title, merchant and two-letter merchant country code.
- Finite, positive numeric SAR price within safe cent arithmetic; ISO original currency.
- Foreign prices need a recorded FX rate/source/time and a consistent conversion.
- Supplied SAR original prices must agree with normalized prices. Page checks compare original prices when available, otherwise normalized SAR prices.
- HTTPS product URL without credentials, nonstandard port, literal IP or search/root path. DNS and redirects are checked by the existing safe resolver during page verification.
- Exact query match; known model and requested capacity must not conflict with title/metadata. Accessories, unrequested variants and conflicting conditions are rejected.
- Model evidence is parsed independently in title and metadata. Explicitly labeled RAM is excluded from storage conflicts; ambiguous unlabeled capacities are not assumed to be RAM.
- Sampled pages must remain on the merchant hostname (ignoring `www`), have no identity conflicts, and provide a shared identifier or an exact normalized title. Uncertain identity cannot pass verification.
- Source attribution must match the selected adapter and marketplace/store.
- Missing images/specs, unknown availability and Saudi shipping are reported without fabrication. Sold-out products may have valid catalog data but are not counted as available delivered offers.
- Delivered cost is `price + shipping + importCost + tax + mandatoryFees - discount`. It is complete only when every component is numeric/nonnegative, Saudi delivery is confirmed and stock is available. Null costs remain unknown.

## Outcomes

| Status | Meaning |
|---|---|
| VERIFIED_SAMPLE | All accepted page samples resolved with matching identity and advertised price; this query only |
| VALID_CATALOG_SAMPLE | Data contract passed; product pages were not verified |
| PARTIAL_SAMPLE | Some accepted offers coexist with rejected offers or upstream errors |
| PAGE_VERIFICATION_FAILED | Catalog data exists, but one or more sampled pages failed identity/price/page checks |
| NO_RESULTS | No offers and no reported fetch error; not evidence of source reliability |
| INVALID_OFFERS | All returned offers failed the contract |
| NEGATIVE_CONTROL_PASS | Expected-empty query completed with no returned offers or errors |
| NEGATIVE_CONTROL_FAIL | Negative query unexpectedly returned raw offers, even if those offers were rejected |
| BLOCKED / TIMEOUT / FETCH_FAILED | Operational failure, distinct from a legitimate empty response |
| NOT_CONFIGURED / UNCONNECTED | Missing runtime activation / absent registry adapter |

`verifiedSource` remains false for a single probe. Source stability requires the separate multi-query, repeated acceptance protocol. Reports include raw/accepted/rejected/duplicate counts, duration, samples and rejection/error codes. Raw exception messages are excluded to avoid leaking credentials from upstream failures.

Counts are null when fetching fails before a catalog response; this is unknown coverage, not a measured zero. Page-verification timeouts preserve collected counts, samples and verification progress, with `failureStage` identifying the interrupted operation. A structurally valid empty eXtra response is legitimate emptiness; malformed responses and unnormalizable product payloads remain failures.

CLI exit codes: 0 for a passed sample/control; 1 for failed/partial/empty positive probes; 2 for invalid commands; 3 for unavailable or unconnected sources. `--timeout-ms` defaults to 120000 and permits 100–180000. On timeout the CLI persists a timeout report and terminates outstanding adapter work with the process. Optional production health comparison has its own 15000 ms timeout.

Tests:

```bash
node --test tests/audit-contract.test.mjs tests/source-probe.test.mjs tests/audit-cli.test.mjs
npm test
```

The existing `/api/source-audit` and `scripts/audit-sources.mjs` are legacy storefront diagnostics with a different promotion rule. Use the new CLI for this acceptance phase; it deliberately does not overwrite historical diagnostics or claim all registry sources work.


## Protected production protocol

`POST /internal/source-audit` runs the same isolated probe inside a disposable worker thread with the deployed service environment. It is disabled unless `NAWAA_INTERNAL_AUDIT_TOKEN` has at least 32 characters and `NAWAA_INTERNAL_AUDIT_EXPIRES_AT` is a future ISO timestamp. Use a randomly generated temporary token; never commit it or place it in browser code. No CORS access is granted, requests with an Origin header are refused, JSON bodies are limited to 2048 bytes, and only sourceId/query/expected are accepted. The service revision is authoritative.

Two workers maximum, with one active probe per source. Probes have a 90-second internal deadline and workers are terminated after the report, including outstanding adapter work. A watchdog terminates stalled workers after 93 seconds. Reports remain internal and uncached. Disable the token and redeploy after collection; expiry also closes access automatically.

`npm run audit:matrix -- --revision DEPLOYED_SHA --token-file /path/to/token --output /path/to/results` executes 29 source-specific triples across three rounds. Each report is persisted atomically. The default pause between rounds is 60 seconds; individual direct probes bypass the aggregate search cache. A resume requires the same target revision and matrix and preserves previous failure reports. The summary requires nine distinct successful results for each source. Catalog-only, mixed-version, unknown-cache and missing results cannot certify a source. Direct provider requests do not prove freshness inside a merchant's own upstream cache or long-term stability.
