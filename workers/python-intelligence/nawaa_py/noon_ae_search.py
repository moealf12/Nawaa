"""Bounded public Noon UAE search transport, run only by the NAWAA Node bridge.

Accepts one fixed-schema JSON line, fetches the UAE home page and exactly one
query-bound /uae-en/search/ page using the experimental PR #310 transport.
Never accepts arbitrary URLs, follows a redirect, retries, accesses APIs or
touches production data. All product admission and SAR FX remain in Node.
"""
from __future__ import annotations
import json
import re
import sys
import time
from urllib.parse import urlencode, urlsplit, urljoin, parse_qs, quote

SCHEMA = "nawaa.noon.ae.cards.v1"
SOURCE = "noon-ae"
MAX_INPUT = 1300
MAX_HTML = 5_000_000
MAX_ANCHORS = 250
MAX_CARDS = 250
MAX_QUERY = 120
ORIGIN = "https://www.noon.com"
MAX_NETWORK_MS = 5600
REQUEST_ID = re.compile(r"^[0-9a-f-]{36}$")
CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def request_url(query: str) -> str:
    if not isinstance(query, str) or not (2 <= len(query) <= MAX_QUERY):
        raise ValueError("INVALID_QUERY")
    if CONTROL.search(query):
        raise ValueError("INVALID_QUERY")
    return ORIGIN + "/uae-en/search/?" + urlencode({"q": query})


def attested_result(response, expected_url: str) -> tuple[str, str]:
    """Return source HTML only for the exact first-party URL and HTML HTTP 200."""
    from_url = str(response.url)
    got, expected = urlsplit(from_url), urlsplit(expected_url)
    if (got.scheme != "https" or got.netloc != "www.noon.com"
            or got.username or got.password
            or got.path.rstrip("/") != expected.path.rstrip("/")
            or got.query != expected.query or got.fragment):
        raise ValueError("SOURCE_SEARCH_URL_MISMATCH")
    status = int(response.status_code)
    if status == 403:
        raise ValueError("HTTP_403_ACCESS_DENIED")
    if status == 429:
        raise ValueError("HTTP_429_RATE_LIMITED")
    if status != 200:
        raise ValueError("SOURCE_HTTP_FAILURE")
    ctype = str(response.headers.get("content-type", "")).lower()
    if "text/html" not in ctype and "application/xhtml+xml" not in ctype:
        raise ValueError("NON_HTML_RESPONSE")
    if len(response.content) > MAX_HTML:
        raise ValueError("RESPONSE_TOO_LARGE")
    return response.content.decode("utf-8", errors="replace"), from_url


def collect(query: str, budget_ms: int) -> tuple[str, str]:
    # Lazy import permits deterministic offline unit tests without a network.
    from curl_cffi import requests

    target = request_url(query)
    started = time.monotonic()
    max_s = min(budget_ms, MAX_NETWORK_MS) / 1000
    with requests.Session(impersonate="chrome") as session:
        for url in (ORIGIN + "/uae-en/", target):
            remaining = max_s - (time.monotonic() - started)
            if remaining < 0.25:
                raise ValueError("SOURCE_HTTP_TIMEOUT")
            try:
                response = session.get(
                    url, timeout=min(remaining, 3.2), allow_redirects=False,
                    headers={"accept": "text/html,application/xhtml+xml"},
                )
            except Exception:
                raise ValueError("SOURCE_TRANSPORT_FAILURE") from None
            if url != target:
                if response.status_code == 403:
                    raise ValueError("HTTP_403_ACCESS_DENIED")
                if response.status_code == 429:
                    raise ValueError("HTTP_429_RATE_LIMITED")
                if response.status_code != 200 or urlsplit(str(response.url)).netloc != "www.noon.com":
                    raise ValueError("SOURCE_WARMUP_UNAVAILABLE")
                continue
            return attested_result(response, target)
    raise ValueError("SOURCE_HTML_UNAVAILABLE")


# Field selection and query/market verification are ported from the
# *successful* PR #310 HTML collector. Node independently validates exact
# SKU, offer code, amount, URL and image before a customer offer exists.
SKU_PATH = re.compile(r"/(N\d{8}[AV]|Z[A-Z0-9]{20}Z)/p/?$", re.I)
OFFER_CODE = re.compile(r"^[A-Za-z0-9-]{1,100}$")


def source_product(href):
    if not isinstance(href, str) or len(href) > 2500:
        return None
    try:
        u = urlsplit(urljoin(ORIGIN + "/uae-en/", href))
        if (u.scheme != "https" or u.hostname not in ("www.noon.com", "noon.com")
                or u.username or u.password or u.port not in (None, 443)
                or not u.path.startswith("/uae-en/")):
            return None
        sku = SKU_PATH.search(u.path)
        offers = parse_qs(u.query).get("o", [])
        if not sku or len(offers) != 1 or not OFFER_CODE.fullmatch(offers[0]):
            return None
        return (sku.group(1).upper(), offers[0],
                "https://www.noon.com" + u.path + "?o=" + quote(offers[0]))
    except (ValueError, TypeError):
        return None


def product_image(anchor):
    # Matches the successful PR #310 selectors and validates the CDN.
    for node in anchor.select("picture source, img")[:15]:
        for attr in ("srcset", "data-srcset", "data-src",
                     "data-original", "data-lazy-src", "src"):
            value = node.get(attr)
            if not isinstance(value, str):
                continue
            for entry in value.split(",")[:8]:
                candidate = entry.strip().split(" ")[0]
                if not candidate or len(candidate) > 2500:
                    continue
                try:
                    u = urlsplit(candidate)
                    if (u.scheme == "https" and u.netloc == "f.nooncdn.com"
                            and u.path.startswith("/p/") and
                            not u.username and not u.password):
                        return candidate
                except ValueError:
                    continue
    return None


def numeric_price(raw):
    if not isinstance(raw, str) or len(raw) > 100:
        return None
    import unicodedata
    value = raw.strip().replace("\ue000", "").replace("\u00a0", " ")
    value = value.replace("\u202f", " ").replace("\u066c", ",").replace("\u066b", ".")
    chars = []
    for ch in value:
        if ch in "\ue001\ue002":
            continue
        try:
            if unicodedata.category(ch) == "Nd":
                chars.append(str(unicodedata.decimal(ch)))
            else:
                chars.append(ch)
        except (ValueError, TypeError):
            chars.append(ch)
    value = "".join(chars)
    if re.search(r"\b(?:USD|SAR|EUR|GBP|INR|EGP|QAR|BHD|KWD|OMR)\b|US\$|[$€£₹]|ر\.?\s*س|ريال", value, re.I):
        return None
    value = re.sub(r"\bAED\b|د\.?\s*إ", "", value, flags=re.I)
    value = re.sub(r"[\ue000-\uf8ff\s]", "", value)
    if not re.fullmatch(r"(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?|[1-9]\d{0,2}(?:,\d{3})+(?:\.\d{1,2})?", value):
        return None
    price = float(value.replace(",", ""))
    return price if 0 < price < 10_000_000 else None


def extract_cards(html: str, query: str) -> dict:
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    heading = soup.select_one("h1")
    heading_txt = heading.get_text(" ", strip=True) if heading else ""
    language = str(soup.html.get("lang") or "").strip() if soup.html else ""
    if language.casefold() not in ("en-ae", "ar-ae"):
        raise ValueError("UAE_MARKET_LOCALE_NOT_ATTESTED")
    if " ".join(heading_txt.casefold().split()) != " ".join(query.casefold().split()):
        raise ValueError("SEARCH_PAGE_CONTEXT_NOT_ATTESTED")
    anchors = soup.select('a[href*="/p/"]')[:MAX_ANCHORS]
    cards = []
    for a in anchors:
        identity = source_product(a.get("href"))
        if not identity:
            continue
        name = a.select_one('[data-qa="plp-product-box-name"]')
        if name is None:
            name = a.select_one("h2, h3")
        price_el = a.select_one('[data-qa="plp-product-box-price"] strong[class*="amount"]')
        if price_el is None:
            price_el = a.select_one('[data-qa="plp-product-box-price"] strong')
        title = name.get_text(" ", strip=True) if name else ""
        raw_price = price_el.get_text(" ", strip=True) if price_el else ""
        image = product_image(a)
        if not (4 <= len(title) <= 350 and 0 < len(raw_price) <= 100 and image):
            continue
        price = numeric_price(raw_price)
        if price is None:
            continue
        cards.append({
            "productId": identity[0], "offerCode": identity[1],
            "sourceUrl": identity[2], "title": title,
            "priceText": raw_price, "priceAED": price,
            "currency": "AED", "image": image,
        })
        if len(cards) >= MAX_CARDS:
            break
    return {"language": language, "heading": heading_txt[:350],
            "cards": cards, "anchorsSeen": len(anchors)}


def respond(value: dict) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def main() -> int:
    request_id = None
    try:
        line = sys.stdin.buffer.readline(MAX_INPUT + 1)
        if len(line) > MAX_INPUT or not line.endswith(b"\n"):
            raise ValueError("INVALID_INPUT")
        packet = json.loads(line)
        if not isinstance(packet, dict) or set(packet) != {
            "schemaVersion", "requestId", "sourceId", "query", "budgetMs"
        }:
            raise ValueError("INVALID_INPUT")
        request_id = packet["requestId"]
        if (packet["schemaVersion"] != SCHEMA or packet["sourceId"] != SOURCE
                or not isinstance(request_id, str)
                or not REQUEST_ID.fullmatch(request_id)
                or type(packet["budgetMs"]) is not int
                or not (1500 <= packet["budgetMs"] <= MAX_NETWORK_MS)):
            raise ValueError("INVALID_INPUT")
        html, final_url = collect(packet["query"], packet["budgetMs"])
        rows = extract_cards(html, packet["query"])
        respond({"schemaVersion": SCHEMA, "sourceId": SOURCE,
                 "requestId": request_id, "status": "OK",
                 "finalUrl": final_url, **rows})
    except Exception as exc:
        # No exception strings, request URL, cookies or raw HTML in logs.
        code = str(exc) if isinstance(exc, ValueError) else "SOURCE_TRANSPORT_FAILURE"
        if not re.fullmatch(r"[A-Z0-9_]{3,70}", code):
            code = "SOURCE_TRANSPORT_FAILURE"
        respond({"schemaVersion": SCHEMA, "sourceId": SOURCE,
                 "requestId": request_id, "status": "ERROR",
                 "errorCode": code})
    return 0


if __name__ == "__main__":
    sys.exit(main())
