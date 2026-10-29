# NAWAA Python Intelligence — P1 (offline only)

This experimental Python 3.12+ worker is a **classification assistant**, not a new source of canonical offers. It has no network libraries, crawler, database credentials, or production deployment. It accepts one bounded JSON request on stdin and emits one JSON response on stdout. stderr carries only generic errors. Node remains the canonical authority over product identity, source evidence, price acceptance and trust.

Run: `cd workers/python-intelligence && PYTHONPATH=. python3 -m unittest discover -s tests -v`.

CLI: `PYTHONPATH=. python3 -m nawaa_py.cli`, request `{"schemaVersion":"nawaa.python.classify.v1","requestId":"x1","operation":"classify","expected":{"model":"PS5 Digital"},"observed":{"model":"PS5 Disc"}}`.

P1 intentionally has **no live scraping**. P2 may compare extraction of pre-fetched HTML with Cheerio; network acquisition requires a separate source-approved, budgeted and SSRF-hardened design. No paid dependencies.
