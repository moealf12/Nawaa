"""Noon Saudi source-only curl_cffi trial. Never publishes offers or bypasses access denial.

Matches the submitted Chrome 120 impersonation request, then validates catalog data
using the existing isolated Noon parser. Prints diagnostic counts and up to 3 samples
only if a real HTTP 200 / hits response is returned.
"""
from __future__ import annotations

import argparse
import json
import time
from urllib.parse import urlsplit

from curl_cffi import requests
from noon_sa_catalog_probe import API, parse_payload

HEADERS = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "ar,en-US;q=0.9,en;q=0.8",
    "origin": "https://www.noon.com",
    "referer": "https://www.noon.com/saudi-ar/",
    "x-locale": "ar-sa",
    "x-platform": "web",
}


def search(query: str, limit: int = 50) -> dict:
    if not isinstance(query, str) or not 2 <= len(query.strip()) <= 180:
        raise ValueError("invalid search query")
    if not isinstance(limit, int) or not 1 <= limit <= 50:
        raise ValueError("invalid limit")

    params = {
        "q": query,
        "limit": limit,
        "page": 1,
        "sort[by]": "relevance",
        "dir": "desc",
    }
    start = time.monotonic()
    try:
        with requests.Session(impersonate="chrome120", timeout=15.0) as session:
            response = session.get(API, params=params, headers=HEADERS, timeout=15.0, allow_redirects=False)
        elapsed = round((time.monotonic() - start) * 1000)
        status = int(response.status_code)
        endpoint_host = urlsplit(str(response.url)).hostname
        if endpoint_host != "www.noon.com":
            return {"status": "UNEXPECTED_DESTINATION", "http_status": status, "elapsed_ms": elapsed, "items": 0, "priced": 0}
        if status != 200:
            return {"status": f"SOURCE_HTTP_{status}", "http_status": status, "elapsed_ms": elapsed, "items": 0, "priced": 0}
        try:
            payload = response.json()
        except (ValueError, TypeError):
            return {"status": "INVALID_JSON", "http_status": status, "elapsed_ms": elapsed, "items": 0, "priced": 0}

        parsed = parse_payload(payload, limit=limit)
        items = parsed["items"]
        samples = [
            {"title": x["title"][:110], "sku": x["sku"], "price_sar": x["price_sar"],
             "url": x["url"], "image": x["image"]}
            for x in items[:3]
        ]
        return {
            "status": parsed["status"], "http_status": status, "elapsed_ms": elapsed,
            "raw_hits": len(payload.get("hits", [])) if isinstance(payload, dict) and isinstance(payload.get("hits"), list) else None,
            "items": len(items), "priced": sum(x["price_sar"] is not None for x in items),
            "samples": samples, "customer_publishable": False,
        }
    except Exception as exc:
        # Log the exception *class* rather than ignoring it or publishing fabricated offers.
        return {"status": "REQUEST_EXCEPTION", "exception_class": type(exc).__name__,
                "elapsed_ms": round((time.monotonic() - start) * 1000),
                "items": 0, "priced": 0, "customer_publishable": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--query", default="ايفون 15")
    parser.add_argument("--limit", type=int, default=50)
    args = parser.parse_args()
    print(json.dumps(search(args.query, args.limit), ensure_ascii=False))
