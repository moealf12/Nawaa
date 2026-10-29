"""Read-only Noon Saudi search HTML/Next.js diagnostic, based on user supplied code.

Extract catalog fields only. No retail publication, retry loops, proxies or persistence.
Run: python workers/python-intelligence/noon_sa_html_next_probe.py --query "ايفون 15"
"""
from __future__ import annotations

import argparse
import json
import time
from urllib.parse import urlencode, urlsplit

from bs4 import BeautifulSoup
from curl_cffi import requests
from noon_sa_catalog_probe import parse_payload

BASE = "https://www.noon.com/saudi-ar/search"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 "
        "Mobile/15E148 Safari/604.1"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ar-SA,ar;q=0.9",
}

def locate_hits(data):
    """Only user-supplied known Next.js catalog paths; do not infer unknown offers."""
    if not isinstance(data, dict):
        return "INVALID_ROOT", None
    props = data.get("props")
    page_props = props.get("pageProps") if isinstance(props, dict) else None
    if not isinstance(page_props, dict):
        return "PAGE_PROPS_ABSENT", None
    state = page_props.get("initialState")
    catalog = state.get("catalog") if isinstance(state, dict) else None
    if isinstance(catalog, dict) and isinstance(catalog.get("hits"), list):
        return "INITIAL_STATE_CATALOG", catalog["hits"]
    search_data = page_props.get("searchData")
    if isinstance(search_data, dict) and isinstance(search_data.get("hits"), list):
        return "PAGE_SEARCH_DATA", search_data["hits"]
    return "HITS_SCHEMA_NOT_FOUND", None

def html_shape(html: str):
    """Only summary flags, never log or persist merchant HTML or embedded scripts."""
    text = html[:8_000_000] if isinstance(html, str) else ""
    lower = text.lower()
    return {
        "html_chars": len(text),
        "script_count": lower.count("<script"),
        "jsonld_markers": lower.count("application/ld+json"),
        "next_data_marker": "__next_data__" in lower,
        "next_f_marker": "self.__next_f.push" in lower,
        "react_root_marker": 'id="__next"' in lower or 'id="root"' in lower,
        "product_dom_marker": "data-testid" in lower and "product" in lower,
        "challenge_marker": "<title>robot check</title>" in lower
            or "<title>captcha</title>" in lower
            or "/errors/validatecaptcha" in lower,
    }


def parse_html(html: str):
    if not isinstance(html, str) or len(html) > 8_000_000:
        return {"status": "HTML_INVALID_OR_TOO_LARGE", "items": [], "raw_hits": None}
    soup = BeautifulSoup(html, "lxml")
    next_tag = soup.find("script", id="__NEXT_DATA__")
    if not next_tag:
        return {"status": "NEXT_DATA_ABSENT", "items": [], "raw_hits": None}
    try:
        data = json.loads(next_tag.string or next_tag.get_text() or "")
    except (json.JSONDecodeError, ValueError):
        return {"status": "NEXT_DATA_INVALID_JSON", "items": [], "raw_hits": None}
    schema, hits = locate_hits(data)
    if hits is None:
        return {"status": schema, "items": [], "raw_hits": None}
    parsed = parse_payload({"hits": hits}, limit=50)
    return {"status": schema if parsed["items"] else "HITS_PRESENT_NO_USABLE_OFFERS",
            "items": parsed["items"], "raw_hits": len(hits)}

def probe(query: str):
    if not isinstance(query, str) or not 2 <= len(query.strip()) <= 180:
        raise ValueError("invalid_query")
    url = BASE + "?" + urlencode({"q": query})
    started = time.monotonic()
    try:
        response = requests.get(url, headers=HEADERS, impersonate="safari17_0",
                                timeout=15, allow_redirects=False)
        elapsed = round((time.monotonic()-started)*1000)
        status = int(response.status_code)
        if urlsplit(str(response.url)).hostname != "www.noon.com":
            return {"status": "UNEXPECTED_HOST", "http_status": status, "elapsed_ms": elapsed}
        if status != 200:
            return {"status": "SOURCE_HTTP_" + str(status), "http_status": status,
                    "elapsed_ms": elapsed}
        shape = html_shape(response.text)
        parsed = parse_html(response.text)
        items = parsed["items"]
        return {
            "status": parsed["status"], "http_status": status, "elapsed_ms": elapsed,
            "html_shape": shape,
            "raw_hits": parsed["raw_hits"], "items": len(items),
            "priced": sum(x["price_sar"] is not None for x in items),
            "with_image": sum(x["image"] is not None for x in items),
            "samples": [{"title": x["title"][:90], "sku": x["sku"],
                         "price_sar": x["price_sar"], "url": x["url"]}
                        for x in items[:3]],
            "customer_publishable": False,
        }
    except Exception as exc:
        # Do not suppress failures or print sensitive environment/network details.
        code = getattr(exc, "code", None)
        return {"status": "REQUEST_EXCEPTION", "exception_class": type(exc).__name__,
                "curl_code": code if isinstance(code, int) else None,
                "elapsed_ms": round((time.monotonic()-started)*1000),
                "items": 0, "priced": 0, "customer_publishable": False}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--query", default="ايفون 15")
    args = parser.parse_args()
    print(json.dumps(probe(args.query), ensure_ascii=False))
