# NAWAA — public source transport and dead-link revalidation

Status: **opt-in engineering pilot**, not a blanket 403/429 bypass, not proof of Saudi shipment.

## 1. Transport migration (Node.js)

Existing NAWAA uses Node 22 global `fetch` in `server/providers/free-storefronts.mjs`.
There is no standard `axios` or `node-fetch` dependency to replace. PR #155
adds `server/source-transport.mjs`, called from the existing `fetchText()` path.
Without a configured opt-in, behavior remains native `fetch`.

**Existing Node implementation**

```js
const response = await fetch(url, {method:"GET",signal});
if(response.status===403 || response.status===429) {
  // classify and obey Retry-After, not alternate IP/transport retry
}
```

**Opt-in replacement (maintained `impit`)**

Apify deprecated `got-scraping` and recommends `impit` for new work.
It has an ordinary fetch-compatible API and a native binary, so first verify
compatibility with Render's Node 22 free Linux environment. Nothing in this PR
automatically installs dependencies or changes the lockfile.

To trial on a permitted source, **in a separately approved dependency PR**:

```bash
npm install --save impit
npm ci --ignore-scripts
npm test
```

Then set `NAWAA_IMPIT_SOURCE_IDS` to an **explicit** known source ID, e.g.
`thomann-de`, **only after confirming the merchant's automation permission**.
The built-in host allowlist covers six pilot European stores. No arbitrary URL
or redirect may be sent to the optional transport. The module creates an `Impit`
client lazily only for an approved source and returns a fetch-like `Response`.
A missing optional package fails explicitly with
`IMPIT_OPTIONAL_DEPENDENCY_UNAVAILABLE`; it will **not** fall back to another
outbound address after an error.

A direct `axios` migration, if one is introduced later:

```js
// before: const {data} = await axios.get(url);
// after:
const response = await createApprovedSourceFetcher({
  fetchImpl: globalThis.fetch,
  approvedSourceIds: [],
  approvedSourceHosts: {},
  optIn: false
})(url,{method:"GET"},{sourceId:"fixture"});
if (!response.ok) throw new Error("HTTP "+response.status);
const html = await response.text();
```

The legacy `got-scraping` interface is compatible with Got, but **EOL**.
A one-off migration demonstration (not deployed or imported in NAWAA):

```js
// Deprecated illustrative adapter — not recommended for new production code.
// import {gotScraping} from "got-scraping";
// const result=await gotScraping.get(url,{throwHttpErrors:false,retry:{limit:0}});
// const response=new Response(result.body,{status:result.statusCode,
//   headers:result.headers});
```

For Python work outside Node, `curl-cffi` uses a requests-style interface:

```python
# Optional Python experiment, not installed/deployed by this PR.
# pip install curl-cffi
from curl_cffi import requests
with requests.Session() as session:
    response = session.get("https://merchant.example/allowed-public-page", timeout=10)
    print(response.status_code)
```

Browser impersonation profiles are not an authorization mechanism and are not
used here to retry a blocked merchant or defeat a rate limit.

## 2. Fail-closed HTTP outcomes

- `403`: access denied; no proxy/fallback route or immediate rerun.
- `429`: honor the existing source-specific `Retry-After` guard; no retry.
- `404/410`: product URL may have changed; **not** proof of out-of-stock.
- `408/425/5xx`: at most one explicitly budgeted retry on the same route
  in a later transport policy, but no automatic third-party address cycling.
- `200` with an HTML shell: not a verified catalog or sellable offer.

## 3. Public sitemaps and historical continuity

`src/public-sitemap-evidence.mjs` parses an explicitly selected public
`urlset` in memory with a 2 MB input ceiling and 10,000-entry ceiling.
Sitemap indexes, malformed XML, redirects, failed network responses, foreign
hosts, XML entities and incomplete snapshots **never** create destructive
signals. A complete sitemap must be observed before a diff is meaningful.
Sitemaps are incomplete product signals even when they parse successfully:
*absence means recheck*, not deletion.

`scripts/poll-public-sitemaps.mjs` creates JSON audit evidence with:

```json
{
  "id": "approved-merchant",
  "status": "OBSERVED",
  "complete": true,
  "missing": [
    {
      "url": "https://merchant.example/p/older-product",
      "status": "SITEMAP_ABSENT_REVERIFY",
      "productAvailability": "unknown",
      "removeFromIndex": false,
      "priceStatus": "not_revalidated"
    }
  ],
  "indexMutated": false
}
```

No PostgreSQL/Meilisearch mutation is part of this PR. An existing index export
can supply `baselineUrls` after an owner-authorized, source-specific mapping.
Sitemap absence never changes a live offer's price, timestamps, stock or seller
identity. Expired observations should be handled by NAWAA's *existing* freshness
policy, not a fabricated stock update.

### Running the opt-in weekly free Actions workflow

Configure GitHub Actions repository variable `NAWAA_PUBLIC_SITEMAP_SOURCES_JSON`
with an **approved** JSON array. Example with fictitious test host
(do not use the example host as a real production source):

```json
[{
  "id": "approved-merchant",
  "merchantHost": "merchant.example",
  "sitemapUrl": "https://merchant.example/sitemap.xml",
  "baselineUrls": ["https://merchant.example/p/older-product"]
}]
```

Only explicit same-host `https://` `*.xml` URLs are allowed, up to eight
merchants per run, sequentially. The workflow skips runner execution while
the variable is absent, and archives read-only evidence for seven days.
There is no monetized proxy, Cloudflare account, relay, or permanent service.

For manual local testing:

```bash
node scripts/poll-public-sitemaps.mjs --sources ./my-approved-sources.json \
  --output ./sitemap-evidence.json
node --test tests/source-request-routing.test.mjs tests/public-sitemap-polling.test.mjs
```

Do not commit private merchant credentials or user-specific identifiers to a
public repository variable, file or artifact.

## 4. Public mobile API fallback

This PR does **not** guess unpublished mobile API endpoints or reverse-engineer
tokens. A later provider adapter may query a **documented public API** with
merchant approval, using the same source identity, authenticated permits when
required, 403/429 suppression, HTTPS host allowlists, and offer/SKU evidence
checks. An API `200` alone cannot certify a sellable product. Until that
specific provider is evidenced, a dead PDP is marked
`SITEMAP_ABSENT_REVERIFY`, not silently replaced by a historical/third-party
price.

## 5. Rollout / release gate

1. Keep `NAWAA_IMPIT_SOURCE_IDS` unset in production (default).
2. Require new exact-HEAD Search Core, source audit, source validation and
   required PR gate GREEN.
3. Verify GitHub main and Render release SHA before claiming deployment.
4. Test an allowlisted and authorized source with the optional adapter only in
   a separate dependency trial.
5. Do not treat successful CI, `404`, `403`, a Wayback archive or Sitemap
   inclusion as proof of current consumer savings.
