# eXtra — Python 3.12 direct evidence experiment (isolated)

This worker adapts the user-supplied `ExtraScraperEngine` design into
`nawaa_py/extra_pdp.py`, with Pydantic v2, HTTPX, Beautiful Soup 4, lxml,
Decimal prices and JSON Lines v1. **It is not a replacement for the existing
`extra-unbxd` Node search provider.** No price is persisted or shown to
customers by this experiment.

## Direct commands

From the repo root, with Python 3.12 and uv 0.10.0:

```sh
uv sync --project workers/python-intelligence --locked --extra test --python 3.12
cd workers/python-intelligence
.venv/bin/python -m pytest tests/test_extra_pdp.py -q -ra
.venv/bin/python -m nawaa_py.extra_live_trial
```

The live trial attempts one approved public eXtra PDP from an earlier NAWAA
inspection fixture: `https://www.extra.com/en-sa/mobiles-tablets/mobiles/smartphone/apple-iphone-17e-5g-6-1-512gb-soft-pink/p/100462492`.

It reads robots.txt before the product page, sends the transparent
NAWAA research User-Agent, uses no browser impersonation headers,
disables proxies/environment inheritance, prevents redirects, limits
network/HTML sizes and deadlines, and does not retry denied requests.
It reports `HTTP_403`, `HTTP_429`, `ROBOTS_DISALLOW`,
`RESPONSE_TOO_LARGE`, or other bounded failures as failures rather
than as success. No protection bypass is attempted.

## JSON Lines v1 contract

A single request:

```json
{"schemaVersion":"nawaa.extra.pdp.v1","requestId":"case1","sourceId":"extra-sa","url":"https://www.extra.com/en-sa/mobiles-tablets/mobiles/smartphone/apple-iphone-17e-5g-6-1-512gb-soft-pink/p/100462492","expected_sku":"100462492","timeoutMs":8000}
```

Run `python -m nawaa_py.extra_pdp` from
`workers/python-intelligence` and send one request per line. The response
contains `status=EVIDENCE_FOUND` only when positive SAR price, exact SKU,
and no conflicts exist. Error outputs contain only safe codes. Price is
serialized as decimal text, not binary float. Up to eight requests per worker
and 4 KB per line; only the exact approved source hostname, HTTPS product
path, and path-SKU are accepted.

## Differences from the original snippet

- Correct Decimal serialization, strict Pydantic models, bounded JSONL I/O.
- Graph/array JSON-LD Product selection and *exact* SKU ownership.
- Never select the first of multiple variants or accept an AggregateOffer
  `lowPrice` as a sellable single-product price.
- Never invent SAR from site geography or a DOM price without currency.
- DOM fallback cannot override a JSON-LD SKU conflict.
- No exception leakage, browser-header impersonation, redirects or WAF bypass.
- Network preflight prevents known local/private destinations; deployment
  needs network-layer egress rules to fully mitigate DNS rebinding.
- Tests use HTTPX MockTransport and Hypothesis. One live source trial is
  separate from deterministic tests and never writes to NAWAA canonical data.

A passing GitHub Actions workflow **does not mean** an eXtra price was found;
consult `NAWAA_EXTRA_PYTHON_LIVE` in job logs for the observed outcome.

## Existing UNBXD provider integration (controlled read path)

The Python observation is now connected to the existing
`server/providers/extra-unbxd.mjs` search provider, **not** registered as an
additional merchant/source. The provider calls
`server/python-extra-enrichment.mjs` via
`src/python-extra-bridge.mjs` only for one explicitly selected SKU and
exact operator-defined normalized query, and only when an existing eXtra
index offer already has the same source product ID.

Required environment settings (unset/OFF by default):

```sh
NAWAA_EXTRA_PYTHON_PDP=1
NAWAA_EXTRA_PYTHON_CANARY_SKU=100462492
NAWAA_EXTRA_PYTHON_CANARY_QUERY="Apple iPhone 17e 512GB Soft Pink"
NAWAA_EXTRA_PYTHON_CANARY_URL="https://www.extra.com/en-sa/mobiles-tablets/mobiles/smartphone/apple-iphone-17e-5g-6-1-512gb-soft-pink/p/100462492"
```

The **single** approved PDP must resolve on `www.extra.com`, terminate with
the same numeric SKU and have no query, credentials or fragment. No shopper
input can modify the four admin settings. A bare `NAWAA_EXTRA_PYTHON_PDP=1`
cannot start Python. Other queries retain the original fast UNBXD path.

Node verifies merchant and source ownership, index alias URL, exact SKU,
matching source host and PDP path, fresh response SHA-256, positive Decimal
price in SAR, matching field-level price/currency provenance, explicit model
suffix, storage, brand and color, query relevance, and reasonable price delta.
It updates only the original offer slot **and preserves the original
canonical URL, SKU, offer identity and existing city stock information**.
It never creates a second eXtra offer, makes a trust badge, or lets Python
write to Postgres. Failures or 403 retain the original UNBXD price.

New deterministic tests:

```sh
node --test tests/python-extra-admission.test.mjs tests/extra-python-provider-flag.test.mjs
```

The dedicated CI workflow also executes
`node scripts/verify-extra-python-integration.mjs` against live UNBXD.
A reported `LIVE_UNBXD_PYTHON_ADMITTED` means Python evidence reached the
existing Node offer admission code, but the CI-only result is **not persisted
or customer-visible**. Other outcomes honestly report missing matching SKU,
network denial, or retention of the original index price.

**Production policy:** Do not set the four flags on Render before checking
Python `ready=true` on the exact deployed SHA and testing the query's
customer SSE/JSON latency and source evidence. No new paid service is used.
