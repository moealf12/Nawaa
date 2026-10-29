# NAWAA Python Intelligence — P1/P2 direct experiment

This is a real Python 3.12 extraction + variant classification trial. **It does not compare Python against Cheerio** and does not change the live shopper search routing. Node.js still owns canonical identity, prices, source trust and publishing.

## Implemented stack

- Python 3.12; HTTPX async client (explicit HTTPS allowlist, bounded timeouts/bodies, no redirects or proxies)
- Beautiful Soup 4 + lxml for public JSON-LD Product and Offer extraction
- Pydantic v2 with strict types, extra fields forbidden and versioned JSON Lines v1 contracts
- RapidFuzz for *diagnostic similarity only*. Numeric and model suffix conflicts always reject
- Decimal for exact positive monetary evidence; never fabricate prices, currencies, or stock status
- pytest + Hypothesis; stdlib urllib.parse, ipaddress, re, socket and asyncio

## Install and test in Python directly

Requires Python 3.12 and package index access. No paid library is necessary.

    cd workers/python-intelligence
    python3.12 -m venv .venv
    . .venv/bin/activate
    python -m pip install -e ".[test]"
    python -m pytest tests/test_classifier.py -q -ra

Run the JSON Lines worker directly with these complete example requests:

    printf '%s\n' '{"schemaVersion":"nawaa.python.extract.v1","requestId":"demo-1","sourceId":"jarir-sa","operation":"classify","input":{"expected":{"model":"Edge 540"},"observed":{"model":"Edge 540 Solar"}}}' | python -m nawaa_py.cli

Supported operations:
- classify: structured expected/observed fields
- extract_html: HTML supplied on stdin as input.html, optional input.expected
- extract_and_classify: exactly one input.html OR approved input.url
- fetch_extract: approved input.url; default network disabled

Response status: CLASSIFIED, EXTRACTED or NO_OFFER. Identity decision: REJECT, INSUFFICIENT_EVIDENCE or CANDIDATE. A candidate is never a certified store price or verified offer.

The CLI reads at most 32 lines and 2.2MB per line, emits one JSON object per input line. Errors contain only fixed error codes (no merchant URL, HTML, authentication token, traceback or raw exception).

## Genuine independent Python HTTPX trial

Explicit opt-in:

    NAWAA_PY_LIVE_ENABLED=1 python -m nawaa_py.live_trial

Canary URL: https://www.jarir.com/sa-en/apple-iphone-17-smartphones-666784.html

The canary validates an exact source-host allowlist and public DNS, reads robots.txt, respects robots and HTTPS, then tries the public page once with the transparent NAWAA User-Agent. No WAF evasion, redirects, retries, paid proxy, browser impersonation, or direct ingest. An HTTP 403, robots block or other transport error is a recorded result, **not a successful merchant offer**. The product page is parsed only when received completely; a source price is still observational evidence, not a verified sellable offer.

Note: DNS preflight alone cannot eliminate DNS rebinding; production network egress restrictions remain required before enabling arbitrary live fetching. Network access is OFF by default in the Node bridge.

## Node subprocess bridge

    node --test workers/python-intelligence/tests/node-bridge.test.mjs

The Node bridge validates request IDs, output framing, schema version, exit codes, input/output limits, timeouts and cancellation. Python has no access to PostgreSQL, Meilisearch or trust promotions. Network remains disabled unless the caller explicitly permits it.

## GitHub Actions

Python P1-P2 workflow:
1. setup-python 3.12
2. install dependencies and test extras
3. pytest plus Hypothesis property tests and HTTPX MockTransport tests
4. Node 22 to Python JSON Lines bridge tests
5. real HTTPX source trial in a separate PR job

Dependency ranges are bounded, not a cryptographic lock file. Pin an auditable hash lock before production release. Github-hosted runners use available Actions minutes; the open-source packages have no license fee, but remaining free minutes must be monitored.

## Production boundary

Do not merge or promote on the strength of examples alone. The Python layer remains experimental and is not invoked from server/server.mjs. No extra Render service or network acquisition loop is enabled.
