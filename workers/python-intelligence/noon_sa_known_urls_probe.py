"""Read-only health/search/PDP probe for user-provided Noon Saudi English URLs.

One request per URL. Only diagnostics and first-party exact-SKU JSON-LD prices
are printed. No customer publication, user context tokens, proxy, or retries.
"""
from __future__ import annotations

import json
import re
import time
from urllib.parse import urlencode, urlsplit

from bs4 import BeautifulSoup
from curl_cffi import requests

from noon_sa_html_next_probe import HEADERS, html_shape, parse_html

BASE = "https://www.noon.com"
LONG_SLUG = (
    "matebook-d16-upgraded-version-laptop-with-16-inch-full-hd-1920x1080-display-"
    "core-i5-12450h-processor-16gb-ram-ddr5-512gb-ssd-windows-11-pro-with-"
    "microsoft-office-english-arabic-mystic-silver-english-arabic-mystic-silver"
)
SKU = "N70312362V"
# Preserve the merchant offer-code selection but intentionally omit nav_ctx.
PDP_PATH = f"/saudi-en/{LONG_SLUG}/{SKU}/p/"
URLS = [
    ("home", BASE + "/saudi-en/"),
    ("search_laptop", BASE + "/saudi-en/search/?" + urlencode({"q": "laptop"})),
    ("matebook_d16_pdp", BASE + PDP_PATH + "?o=f428b90c38b7fb5b"),
]

def matching_pdp_identity(raw):
    try:
        u = urlsplit(str(raw or ""))
        return u.scheme == "https" and u.hostname in ("noon.com", "www.noon.com") and u.path.startswith("/saudi-en/") and (
            re.search(r"/(N\d{8}V)/p/?$", u.path, re.I) is not None
        ) and u.path.rsplit("/", 3)[-3].upper() == SKU
    except (ValueError, IndexError):
        return False

def exact_sku_pdp_jsonld(html):
    soup = BeautifulSoup(html[:8_000_000], "lxml")
    products = []
    for script in soup.find_all("script", type="application/ld+json", limit=50):
        body = script.string or script.get_text()
        if not body or len(body) > 250000:
            continue
        try:
            record = json.loads(body)
        except (ValueError, TypeError):
            continue
        def traverse(node, depth=0):
            if depth > 5 or len(products) > 100:
                return
            if isinstance(node, list):
                for sub in node[:100]:
                    traverse(sub, depth+1)
            elif isinstance(node, dict):
                if str(node.get("@type", "")).lower() == "product":
                    products.append(node)
                for key in ("@graph", "itemListElement", "item"):
                    if key in node:
                        traverse(node[key], depth+1)
        traverse(record)
    exact = []
    for product in products:
        if str(product.get("sku", "")).upper() != SKU or not matching_pdp_identity(product.get("url")):
            continue
        offers = product.get("offers")
        if isinstance(offers, list):
            if len(offers) != 1:
                continue
            offers = offers[0]
        if not isinstance(offers, dict):
            continue
        if offers.get("priceCurrency") != "SAR" or not matching_pdp_identity(offers.get("url")):
            continue
        raw = str(offers.get("price", ""))
        if not re.fullmatch(r"\d{1,7}(?:\.\d{1,2})?", raw):
            continue
        if float(raw) > 0:
            exact.append(raw)
    # Conflicting records mean the source did not establish a unique price.
    return {"exact_sku_declared_offers": len(exact),
            "unique_source_price_sar": exact[0] if len(exact)==1 else None}

def inspect(label, url):
    started = time.monotonic()
    try:
        response = requests.get(url, headers={**HEADERS,"Accept-Language":"en-SA,en;q=0.9"},
                                impersonate="safari17_0",timeout=12,allow_redirects=False)
        milliseconds = round((time.monotonic()-started)*1000)
        status = int(response.status_code)
        if urlsplit(str(response.url)).hostname != "www.noon.com":
            return {"page":label,"status":"NON_NOON_HOST","http_status":status,
                    "elapsed_ms":milliseconds}
        if status != 200:
            return {"page":label,"status":f"SOURCE_HTTP_{status}","http_status":status,
                    "elapsed_ms":milliseconds}
        shape=html_shape(response.text)
        output={"page":label,"status":"HTTP_200","http_status":status,
                "elapsed_ms":milliseconds,"shape":shape}
        if label=="search_laptop":
            search=parse_html(response.text)
            offers=search.get("items",[])
            output.update({"parser_status":search["status"],"catalog_hits":search.get("raw_hits"),
                           "parsed_items":len(offers),
                           "advertised_priced_items":sum(bool(o.get("price_sar")) for o in offers)})
        if label=="matebook_d16_pdp":
            output.update(exact_sku_pdp_jsonld(response.text))
            output["expected_sku"]=SKU
        return output
    except Exception as exc:
        code=getattr(exc,"code",None)
        return {"page":label,"status":"REQUEST_EXCEPTION",
                "exception_class":type(exc).__name__,
                "curl_code":code if isinstance(code,int) else None,
                "elapsed_ms":round((time.monotonic()-started)*1000)}

if __name__=="__main__":
    for label,url in URLS:
        print(json.dumps(inspect(label,url),ensure_ascii=False))
