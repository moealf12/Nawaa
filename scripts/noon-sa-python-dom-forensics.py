#!/usr/bin/env python3
"""Real-source HTML triage with BeautifulSoup, lxml, selectolax (Lexbor).

Read-only independent DOM diagnostics; not a customer-facing provider. A
successful storefront response is NOT evidence of Saudi search prices.
One warmup and at most one Saudi search; no proxies, no retry, no raw content
artifacts, no seller/shipping, no PDP or price verification.
"""
import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup
from curl_cffi import requests
from lxml import html as lxml_html
from selectolax.lexbor import LexborHTMLParser

ORIGIN = "https://www.noon.com"
QUERY = "iPhone 17 256GB"
WARMUP = f"{ORIGIN}/uae-en/"
SA_SEARCH = f"{ORIGIN}/saudi-en/search/?q=iPhone%2017%20256GB"
REPORT = "noon-sa-python-dom-live.json"
MAX_BYTES = 8_000_000
MAX_ANCHORS = 1000
MAX_SCRIPTS = 70
SKU_PATH = re.compile(
    r"^/(?:saudi-en|uae-en)/(?:[a-z0-9-]{2,320}/)?"
    r"((?:N\d{8}[AV]|Z[A-Z0-9]{20}Z))/p/?$", re.I
)
report = {
    "schema": "nawaa.noon-sa.python-dom.v1",
    "headSha": os.getenv("PULL_REQUEST_HEAD_SHA"),
    "observedAt": datetime.now(timezone.utc).isoformat(),
    "source": "noon-sa",
    "query": QUERY,
    "libraries": ["beautifulsoup4/html.parser", "lxml", "selectolax/lexbor", "curl_cffi"],
    "requestsAttempted": 0,
    "noProxyArgument": True,
    "noRetries": True,
    "customerPublishable": False,
    "priceVerified": False,
    "pdpVerified": False,
    "stages": [],
    "conclusion": "NOT_RUN",
}


def error_class(error):
    name = type(error).__name__
    message = str(error).lower()
    if name in {"TypeError", "AttributeError", "NameError", "ImportError"}:
        return "IMPLEMENTATION_ERROR"
    if "timeout" in name.lower() or "timeout" in message or "timed out" in message:
        return "TIMEOUT"
    if "http2" in message or "http/2" in message:
        return "HTTP2_PROTOCOL_ERROR"
    if "ssl" in message or "tls" in message:
        return "TLS_ERROR"
    if "dns" in message or "resolve" in message:
        return "DNS_FAILURE"
    return "NETWORK_OR_UPSTREAM_ERROR"


def allowed_product_ref(raw, market):
    if not isinstance(raw, str) or len(raw) > 2048:
        return None
    try:
        url = urlsplit(urljoin(f"{ORIGIN}/{market}/", raw))
        if (url.scheme != "https" or url.hostname not in {"www.noon.com", "noon.com"}
                or url.username or url.password or url.port not in (None, 443)):
            return None
        match = SKU_PATH.fullmatch(url.path)
        if not match or not url.path.startswith("/" + market + "/"):
            return None
        return match.group(1).upper()
    except ValueError:
        return None


def jsonld_count(soup):
    script_count = 0
    product_count = 0
    parse_errors = 0
    for node in soup.find_all("script", limit=MAX_SCRIPTS):
        if str(node.get("type", "")).strip().lower() != "application/ld+json":
            continue
        script_count += 1
        body = node.string or node.get_text()
        if not body or len(body) > 250_000:
            parse_errors += 1
            continue
        try:
            payload = json.loads(body)
        except (TypeError, ValueError):
            parse_errors += 1
            continue
        stack = [(payload, 0)]
        while stack:
            value, depth = stack.pop()
            if depth > 6:
                continue
            if isinstance(value, list):
                stack.extend((v, depth + 1) for v in value[:100])
            elif isinstance(value, dict):
                kinds = value.get("@type")
                kinds = kinds if isinstance(kinds, list) else [kinds]
                if "Product" in kinds:
                    product_count += 1
                for field in ("@graph", "itemListElement", "item"):
                    if field in value:
                        stack.append((value[field], depth + 1))
    return {
        "jsonLdScriptCount": script_count,
        "jsonLdProductCount": min(product_count, 1000),
        "jsonLdParseErrors": parse_errors,
    }


def inspect_dom(body, market):
    html_text = body.decode("utf-8", errors="replace")
    soup = BeautifulSoup(html_text, "html.parser")
    tree = lxml_html.fromstring(
        html_text, parser=lxml_html.HTMLParser(recover=True, no_network=True)
    )
    lex = LexborHTMLParser(html_text)

    bs_links = [
        node.get("href")
        for node in soup.find_all("a", href=lambda value: (
            isinstance(value, str) and "/p/" in value
        ), limit=MAX_ANCHORS)
    ]
    lx_links = tree.xpath("//a[contains(@href, '/p/')]/@href")[:MAX_ANCHORS]
    sx_links = [
        node.attributes.get("href")
        for node in lex.css('a[href*="/p/"]')[:MAX_ANCHORS]
    ]
    observations = {}
    sets = {}
    for name, links in (
        ("beautifulsoup", bs_links), ("lxml", lx_links), ("selectolax", sx_links)
    ):
        skus = {
            sku
            for href in links
            if (sku := allowed_product_ref(href, market)) is not None
        }
        sets[name] = skus
        observations[name] = {
            "scannedLinks": len(links),
            "uniqueValidMarketSkuLinks": len(skus),
        }
    first = sets["beautifulsoup"]
    exact_agreement = all(other == first for other in sets.values())
    common = set.intersection(*sets.values())
    h1_bs = soup.find("h1")
    h1_text = h1_bs.get_text(" ", strip=True) if h1_bs else ""
    heading_context = (
        bool(h1_text)
        and " ".join(h1_text.casefold().split())
        == " ".join(QUERY.casefold().split())
    )
    return {
        "state": (
            "CONSISTENT_PRODUCT_LINKS_OBSERVED_UNVERIFIED"
            if exact_agreement and common
            else "DOM_PARSER_DISAGREEMENT"
            if not exact_agreement
            else "NO_MARKET_PRODUCT_LINKS"
        ),
        "headingQueryContextMatched": heading_context,
        "hasSearchHeading": bool(h1_text),
        "parserAgreementExact": exact_agreement,
        "intersectionSkuCount": len(common),
        "parsers": observations,
        "structuredData": jsonld_count(soup),
    }


def fetch_stage(session, url, name, market):
    result = {"stage": name}
    started = time.monotonic()
    try:
        report["requestsAttempted"] += 1
        response = session.get(
            url, timeout=12, allow_redirects=False,
            headers={"accept": "text/html,application/xhtml+xml",
                     "accept-language": "en-SA,en;q=0.9"},
        )
        result["status"] = int(response.status_code)
        result["httpVersion"] = str(response.http_version)[:35]
        result["contentType"] = str(response.headers.get("content-type") or "")[:80]
        final = urlsplit(str(response.url))
        if final.scheme != "https" or final.hostname != "www.noon.com":
            result["state"] = "UNEXPECTED_ORIGIN"
        elif response.status_code == 403:
            result["state"] = "HTTP_403_ACCESS_DENIED"
        elif response.status_code == 429:
            result["state"] = "HTTP_429_RATE_LIMITED"
        elif response.status_code != 200:
            result["state"] = "HTTP_" + str(response.status_code)
        elif not result["contentType"].lower().startswith("text/html"):
            result["state"] = "NON_HTML_RESPONSE"
        elif len(response.content) > MAX_BYTES:
            result["state"] = "RESPONSE_TOO_LARGE"
        else:
            result["responseBytes"] = len(response.content)
            result["responseSha256"] = hashlib.sha256(response.content).hexdigest()
            result["dom"] = inspect_dom(response.content, market)
            result["state"] = "HTML_PARSED"
    except Exception as error:
        result["state"] = error_class(error)
        result["exceptionType"] = type(error).__name__[:60]
    finally:
        result["elapsedMs"] = round((time.monotonic() - started) * 1000)
    report["stages"].append(result)
    return result


started = time.monotonic()
try:
    with requests.Session(impersonate="chrome") as session:
        warm = fetch_stage(session, WARMUP, "uae_warmup", "uae-en")
        if warm["state"] == "HTML_PARSED":
            search = fetch_stage(
                session, SA_SEARCH, "saudi_search_html", "saudi-en"
            )
            if (search["state"] == "HTML_PARSED"
                    and search["dom"]["headingQueryContextMatched"]
                    and search["dom"]["parserAgreementExact"]
                    and search["dom"]["intersectionSkuCount"] > 0):
                report["conclusion"] = "LIVE_SAUDI_SEARCH_PRODUCT_LINKS_OBSERVED"
            else:
                report["conclusion"] = "NO_ATTESTED_SAUDI_SEARCH_PRODUCTS"
        else:
            report["conclusion"] = "WARMUP_NOT_AVAILABLE"
except Exception as error:
    report["conclusion"] = error_class(error)
finally:
    report["elapsedMs"] = round((time.monotonic() - started) * 1000)
    with open(REPORT, "w", encoding="utf8") as file:
        json.dump(report, file, ensure_ascii=False, indent=2)
        file.write("\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report["conclusion"] != "LIVE_SAUDI_SEARCH_PRODUCT_LINKS_OBSERVED":
        raise SystemExit(1)
