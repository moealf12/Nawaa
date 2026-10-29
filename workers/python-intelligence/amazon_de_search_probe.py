"""Amazon.de public search-card diagnostic only. Never emits customer-approved offers.

Run: python workers/python-intelligence/amazon_de_search_probe.py --query "iPhone 17"
No proxy rotation, access-control retries, or trust/status elevation.
"""
from __future__ import annotations

import argparse
import json
import re
from decimal import Decimal, InvalidOperation
from urllib.parse import urljoin, urlsplit

import httpx
from bs4 import BeautifulSoup

BASE = "https://www.amazon.de"
ASIN = re.compile(r"^[A-Z0-9]{10}$")
PRICE = re.compile(r"^\d{1,3}(?:\.\d{3})*,\d{2}$|^\d+,\d{2}$")
BLOCK = re.compile(r"captcha|robot check|automatisierte zugriffe|enter the characters", re.I)
OUT_OF_STOCK = re.compile(r"derzeit nicht auf lager|derzeit nicht verfügbar", re.I)


def parse_eur(value: str | None) -> str | None:
    text = str(value or "").strip().replace("\u00a0", " ")
    match = re.search(r"\d[\d.]*,\d{2}", text)
    if not match or not PRICE.fullmatch(match.group()):
        return None
    try:
        number = Decimal(match.group().replace(".", "").replace(",", "."))
        return str(number) if 0 < number <= 10000000 else None
    except InvalidOperation:
        return None


def canonical_pdp(href: str | None, asin: str) -> str | None:
    if not isinstance(href, str) or not ASIN.fullmatch(asin):
        return None
    try:
        url = urlsplit(urljoin(BASE, href))
        if url.scheme != "https" or url.netloc.lower() not in ("amazon.de", "www.amazon.de"):
            return None
        if not re.search(r"/(?:dp|gp/product)/" + re.escape(asin) + r"(?:/|$)", url.path, re.I):
            return None
        return f"{BASE}/dp/{asin}"
    except ValueError:
        return None


def parse_search_html(html: str, page: int = 1) -> dict:
    if BLOCK.search(html[:20000]):
        return {"status": "CHALLENGE_SUSPECTED", "offers": []}
    soup = BeautifulSoup(html, "html.parser")
    offers = []
    seen = set()
    for card in soup.select('div[data-component-type="s-search-result"][data-asin]'):
        asin = str(card.get("data-asin") or "").strip().upper()
        if not ASIN.fullmatch(asin) or asin in seen:
            continue
        anchor = card.select_one("h2 a[href]")
        title_el = card.select_one("h2 a span")
        title = title_el.get_text(" ", strip=True) if title_el else ""
        href = anchor.get("href") if anchor else None
        url = canonical_pdp(href, asin)
        if not title or not url:
            continue
        whole = card.select_one(".a-price-whole")
        fraction = card.select_one(".a-price-fraction")
        # German price "1.299,00" or separate "1.299," + "00".
        price_text = (whole.get_text(" ", strip=True) if whole else "") + (
            fraction.get_text(" ", strip=True) if fraction else ""
        )
        price = parse_eur(price_text)
        availability_text = card.get_text(" ", strip=True)
        seen.add(asin)
        offers.append({
            "asin": asin, "title": title, "price_eur": price,
            "url": url, "is_sponsored": bool(card.select_one(
                "a.puis-sponsored-label-text, [data-component-type='sp-sponsored-result']"
            )),
            "availability": "OUT_OF_STOCK" if OUT_OF_STOCK.search(availability_text) else "UNKNOWN",
            "page": page, "customer_publishable": False,
            "source_status": "SEARCH_CARD_UNATTESTED",
        })
    return {"status": "SEARCH_CARDS_FOUND" if offers else "NO_CARDS", "offers": offers}


def probe(query: str, timeout: float = 10.0) -> dict:
    if not (2 <= len(query.strip()) <= 180):
        raise ValueError("query length must be 2..180")
    url = BASE + "/s"
    headers = {"User-Agent": "NAWAA-Source-Diagnostic/1.0", "Accept": "text/html",
               "Accept-Language": "de-DE,de;q=0.9"}
    try:
        with httpx.Client(timeout=timeout, follow_redirects=False) as client:
            response = client.get(url, params={"k": query}, headers=headers)
        if response.status_code != 200:
            return {"status": "SOURCE_HTTP_" + str(response.status_code), "offers": []}
        if urlsplit(str(response.url)).hostname not in ("amazon.de", "www.amazon.de"):
            return {"status": "SOURCE_URL_MISMATCH", "offers": []}
        return parse_search_html(response.text)
    except httpx.HTTPError as exc:
        return {"status": "NETWORK_" + type(exc).__name__, "offers": []}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--query", required=True)
    parser.add_argument("--timeout", type=float, default=10.0)
    args = parser.parse_args()
    print(json.dumps(probe(args.query, args.timeout), ensure_ascii=False))
