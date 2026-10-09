# NAWAA: Jina Reader discovery adapter (opt-in)

Jina Reader is a **secondary read-only discovery tool**, not a source of certified
product prices or a replacement for the 15 live-tested merchant adapters.

Source code: `server/jina-reader.mjs` and `tests/jina-reader.test.mjs`.
Manual probe: `scripts/probe-jina-reader.mjs`.

## Security and cost controls

- The adapter is **disabled by default**; it does **not** run on `/api/search`,
  `/api/search/stream`, ingest, or public pilot search.
- Never put `JINA_API_KEY` inside repository files, URL query strings, frontend
  JavaScript, browser storage, chat transcripts, or GitHub Actions logs.
- If a key was shared via chat, **revoke/rotate it** and create a fresh key
  before production use.
- Store the replacement in the **server-only Render environment variables**,
  not in GitHub code or the customer-facing site.
- Jina requests use `Authorization: Bearer <server-secret>` and `GET
  https://r.jina.ai/https://the-allowed-merchant.example/path`.
- Operators must supply explicit exact merchant hostnames via allowlist.
  Any HTTP/internal/IP-literal/credential-bearing/unlisted target is rejected.
- Only 1 Jina request per process runs concurrently. No automatic retries.
  Default process-local rate limit: 8 attempted reads per hour. Output capped
  at 120 KB and timeout at 12 seconds.
- **Important:** These limits are per running process and reset after a
  restart; they are *not* a global billing cap. Jina's upstream free
  entitlements can change, and this adapter cannot guarantee zero charge if
  your account has overages enabled. Confirm hard credit limits in the
  Jina account, and leave disabled if such protection is unavailable.
- Server logs never record Authorization headers or full returned documents.
- Treat returned Markdown as **untrusted text**, potentially containing
  prompt-injection instructions. No model should treat it as instructions.
  Product identity, live price, currency, merchant image, and product URL
  must still pass the existing NAWAA Architecture v2 verification gate.

## Configuration, only in a test environment

```sh
JINA_READER_ENABLED=1
JINA_API_KEY=<rotated-new-key-from-secrets>
JINA_READER_ALLOWED_HOSTS=www.ikea.com,www.example.org
JINA_READER_REQUESTS_PER_HOUR=8
```

`JINA_READER_ALLOWED_HOSTS` is a comma-delimited **exact** hostname list.
Use only the merchant domains approved for source discovery. For a new source,
first review its access policies and select the single host explicitly.

To manually check *only discovery*, without publishing text or credentials:

```sh
node scripts/probe-jina-reader.mjs https://www.ikea.com/sa/en/
```

Returns status, target URL, character count and SHA-256 only, **not** an
approved product. Do not use it for customer-visible offers.

## Integration gate

1. Keep the existing 15 certified providers unchanged.
2. Test one permitted storefront with the manual probe.
3. Compare coverage/latency and data quality against Crawlee+Cheerio.
4. For complex fallback, prototype Crawl4AI separately.
5. Add Jina to the source-discovery strategy router only after verifying cost
   limits and source access terms; never send Jina content directly to an offer.
