#!/usr/bin/env python3
"""Single-pass, staging-only HTTP transport comparison for public Noon Saudi search.
One GET per engine; no credentials, proxies, retries, private endpoints or publishing.
The owner reports source authorization; that assertion is not independently verified.
"""
import json
import os
import re
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import quote, urlsplit

URL = "https://www.noon.com/saudi-en/search/?q=" + quote("laptop")
UA = "NAWAA-PublicSourceIndexer/1.0 (+https://moealf12.github.io/Nawaa/)"
HEADERS = {"User-Agent": UA, "Accept": "text/html,application/xhtml+xml;q=0.9", "Accept-Language": "en-SA,en;q=0.7"}
TIMEOUT = 16
MAX_BYTES = 2_000_000

# Ensure neither system proxy env nor browser proxy configuration reroutes traffic.
for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
    os.environ.pop(key, None)
os.environ["NO_PROXY"] = "*"

class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.product_links = set()
        self.json_ld = 0
        self.headings = []
        self.in_h1 = False
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "a":
            path = a.get("href", "").split("?", 1)[0]
            if "/saudi-en/" in path and "/p/" in path:
                self.product_links.add(path)
        if tag == "script" and a.get("type", "").lower() == "application/ld+json":
            self.json_ld += 1
        if tag == "h1":
            self.in_h1 = True
    def handle_endtag(self, tag):
        if tag == "h1":
            self.in_h1 = False
    def handle_data(self, data):
        if self.in_h1 and len(self.headings) < 5:
            self.headings.append(data.strip()[:140])

def classify(status, html):
    if status in (401, 403, 429):
        return "ACCESS_DENIED"
    if status is None:
        return "TRANSPORT_FAILURE"
    if not 200 <= status < 300:
        return "HTTP_NON_2XX"
    if not html:
        return "EMPTY_RESPONSE"
    report = Links()
    try:
        report.feed(html.decode("utf8", errors="replace"))
    except Exception:
        return "HTML_PARSE_ERROR"
    # Do not confuse a successful homepage or bot shell with a search result.
    return {
        "state": "SEARCH_CARDS_PRESENT_UNVERIFIED" if report.product_links else "HTTP_2XX_NO_SEARCH_CARDS",
        "productLinkCount": len(report.product_links),
        "jsonLdScriptCount": report.json_ld,
        "h1": [x for x in report.headings if x][:2],
    }

def benchmark(name, fn):
    begin = time.monotonic()
    try:
        status, blob, detail = fn()
        outcome = classify(status, blob)
        result = {"engine": name, "httpStatus": status, "bytesRead": len(blob), "elapsedMs": round((time.monotonic()-begin)*1000),
                  "outcome": outcome, "details": detail}
        if isinstance(outcome, str) and outcome == "ACCESS_DENIED":
            result["stopFurtherProbes"] = True
        return result
    except Exception as e:
        return {"engine": name, "httpStatus": None, "bytesRead": 0, "elapsedMs": round((time.monotonic()-begin)*1000),
                "outcome": "TRANSPORT_FAILURE", "errorType": type(e).__name__, "error": str(e)[:200]}

def via_httpx():
    import httpx
    with httpx.Client(http2=False, follow_redirects=False, trust_env=False, timeout=TIMEOUT,
                      headers=HEADERS) as client:
        with client.stream("GET", URL) as resp:
            raw = bytearray()
            for piece in resp.iter_bytes():
                if len(raw)+len(piece) > MAX_BYTES:
                    raise ValueError("RESPONSE_EXCEEDS_2MB")
                raw.extend(piece)
            return resp.status_code, bytes(raw), {"httpVersion": resp.http_version, "redirect": bool(resp.is_redirect)}

def via_curl_cffi():
    from curl_cffi import requests
    with requests.Session() as session:
        response = session.get(URL, headers=HEADERS, timeout=TIMEOUT, allow_redirects=False)
        body = response.content
        if len(body) > MAX_BYTES:
            raise ValueError("RESPONSE_EXCEEDS_2MB")
        return response.status_code, body, {"redirect": 300 <= response.status_code < 400}

def via_playwright():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--disable-dev-shm-usage", "--no-sandbox"])
        try:
            context = browser.new_context(user_agent=UA, locale="en-SA", accept_downloads=False)
            page = context.new_page()
            response = page.goto(URL, wait_until="domcontentloaded", timeout=TIMEOUT*1000)
            status = response.status if response is not None else None
            content = page.content().encode("utf8")
            if len(content) > MAX_BYTES:
                raise ValueError("RENDERED_HTML_EXCEEDS_2MB")
            return status, content, {"redirect": bool(response and response.request.redirected_from)}
        finally:
            browser.close()

def main():
    os.umask(0o077)
    result = {"schema": "nawaa.oracle.noon-transport-comparison.v1",
              "observedAt": datetime.now(timezone.utc).isoformat(),
              "search": "laptop", "market": "noon-sa",
              "authorization": "OWNER_ASSERTED_NOT_INDEPENDENTLY_VERIFIED",
              "robotsChecked": False, "proxies": False, "retries": 0,
              "timeoutSecondsPerEngine": TIMEOUT, "maxBodyBytes": MAX_BYTES,
              "publishedToCustomers": False, "pdpVerified": False, "results": []}
    engines = [("httpx-http1", via_httpx), ("curl-cffi-default", via_curl_cffi),
               ("playwright-chromium-headless", via_playwright)]
    for label, fn in engines:
        item = benchmark(label, fn)
        result["results"].append(item)
        if item.get("stopFurtherProbes"):
            result["stoppedEarly"] = "EXPLICIT_ACCESS_DENIAL"
            break
    result["completedAt"] = datetime.now(timezone.utc).isoformat()
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))

if __name__ == "__main__":
    main()
