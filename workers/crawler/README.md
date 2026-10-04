# NAWAA ingestion worker

This worker is the scalable acquisition boundary for NAWAA. It does not bypass access controls.
Use direct HTTP/API/feeds first; browser rendering is reserved for JavaScript-dependent public pages.

## Pipeline
source adapter -> raw item -> normalize -> validate -> POST /api/ingest/offers -> PostgreSQL + Meilisearch

## Run
```bash
cd workers/crawler
npm install
NAWAA_API_BASE=http://localhost:10000 NAWAA_INGEST_TOKEN=... npm start -- "https://example.com/product"
```

Crawlee is intentionally isolated from the search API so crawling cannot slow customer searches.
