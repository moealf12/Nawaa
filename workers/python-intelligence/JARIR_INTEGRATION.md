# Jarir Python PDP evidence — controlled provider integration

## Source pipeline

Current Jarir Constructor/category/HTML discovery supplies an existing SKU and direct PDP URL.
Only when NAWAA_JARIR_PYTHON_PDP=1, the Node Jarir provider invokes the Python subprocess (python3 -m nawaa_py.jarir_pdp) with a bounded JSON Lines v1 request (nawaa.jarir.pdp.v1). It reads public Jarir HTML through HTTPX, robots.txt, direct HTTPS and transparent User-Agent; no proxies, retries, WAF bypass or redirects.

The Node admission module server/python-jarir-enrichment.mjs independently demands exact SKU, same canonical PDP URL, seller and Offer.url evidence, SHA-256 response trace, SAR currency, positive Decimal-formatted price, recent observation, explicit in-stock evidence, and no ambiguity. Variant and query consistency is checked with the existing Node identity classifier.

When accepted, Python updates the existing Jarir offer slot, not an additional source or duplicate. Node recomputes relevance. The feature never grants VERIFIED or another trust badge. PostgreSQL, Meilisearch, SSE and client safety remain Node-owned.

## Availability and limits

- OFF by default. No customer input can turn it on.
- At most one existing PDP per provider call; strict URL/SKU allowlist; child process output, stderr and execution time are bounded.
- With the flag OFF, the original progressive Jarir pipeline is untouched.
- With it ON, early raw Jarir pages are withheld until final same-SKU updates so SSE never emits two differently priced versions of that slot.
- Rejection, missing Python, timeout or source denial leaves original source offers unchanged. No price or inventory is fabricated.
- Do not set the flag on Render Free until Python 3.12 dependencies are provisioned, egress restrictions verified, and the 8-second provider deadline can be honored reliably.

## Tests

Run node --test tests/python-jarir-admission.test.mjs tests/jarir-python-provider-flag.test.mjs from the repository root.
Run python -m pytest tests/test_jarir_user_waterfall.py -q -ra inside workers/python-intelligence after installing local project dependencies.

The dedicated workflow additionally performs a read-only real Node-to-Python HTTPX source probe for three distinct Jarir product kinds:
1. Apple iPhone 17 256GB, SKU 666784.
2. Sony PS5 Slim Digital, SKU 668751.
3. Sony console-cover accessory, SKU 644723.

Each result records whether evidence was actually admitted, rejected or transport denied. A successful workflow alone is NOT proof that every SKU yielded usable price evidence. No write, ingest or customer publication occurs in the probe.

## Release policy

All exact-head CI gates must succeed before merge. Verify main SHA equals Render LIVE after automated deployment. Keep NAWAA_JARIR_PYTHON_PDP OFF until runtime and latency verification. No paid infrastructure or parallel scraping loop is introduced by default.
