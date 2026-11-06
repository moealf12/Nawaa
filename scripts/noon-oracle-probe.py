#!/usr/bin/env python3
"""Isolated, bounded first-party Noon Saudi live acquisition preflight.

No authentication, proxies, paid APIs, browser impersonation, source bypass,
customer publishing or PDP price claims. Standard library only.
"""
import argparse
import hashlib
import json
import re
import sys
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib import error, parse, request, robotparser

DOMAIN = "www.noon.com"
BASE = "https://" + DOMAIN
USER_AGENT = "NAWAA-PublicSourceIndexer/1.0 (+https://moealf12.github.io/Nawaa/)"
MAX_BYTES = 2_000_000
TIMEOUT = 12
PRODUCT_PATH = re.compile(r"^/saudi-en/(?:[a-z0-9-]{2,320}/)?(?:N[0-9]{8}[AV]|Z[A-Z0-9]{20}Z)/p/?$", re.I)


class SameHostRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        url = parse.urlsplit(newurl)
        if url.scheme != "https" or url.hostname not in ("www.noon.com", "noon.com"):
            raise ValueError("CROSS_ORIGIN_REDIRECT_DENIED")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


OPENER = request.build_opener(SameHostRedirect(), request.ProxyHandler({}))


def get(url, max_bytes=MAX_BYTES):
    t = time.monotonic()
    req = request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "text/html,text/plain;q=0.9",
        "Accept-Language": "en-SA,en;q=0.7",
    })
    try:
        with OPENER.open(req, timeout=TIMEOUT) as response:
            if parse.urlsplit(response.url).hostname not in ("www.noon.com", "noon.com"):
                raise ValueError("FINAL_HOST_NOT_NOON")
            data = response.read(max_bytes + 1)
            return {
                "http": response.status,
                "body": data[:max_bytes],
                "bytes": len(data),
                "tooLarge": len(data) > max_bytes,
                "contentType": response.headers.get("Content-Type", "").split(";")[0],
                "durationMs": round((time.monotonic()-t)*1000),
            }
    except error.HTTPError as exc:
        return {"http": exc.code, "body": b"", "bytes": 0, "tooLarge": False,
                "durationMs": round((time.monotonic()-t)*1000)}
    except Exception as exc:
        return {"http": None, "body": b"", "bytes": 0, "tooLarge": False,
                "errorClass": type(exc).__name__,
                "durationMs": round((time.monotonic()-t)*1000)}


class SearchEvidence(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = set()
        self.scripts = []
        self._jsonld = False
        self._buffer = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "a":
            href = attributes.get("href", "")
            full = parse.urljoin(BASE, href)
            url = parse.urlsplit(full)
            if url.scheme == "https" and url.hostname in ("www.noon.com", "noon.com"):
                if PRODUCT_PATH.fullmatch(url.path):
                    self.links.add(BASE+url.path)
        if tag == "script" and attributes.get("type", "").lower() == "application/ld+json":
            self._jsonld = True
            self._buffer = []

    def handle_data(self, data):
        if self._jsonld and sum(len(x) for x in self._buffer) < 500_000:
            self._buffer.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self._jsonld:
            self.scripts.append("".join(self._buffer))
            self._jsonld = False
            self._buffer = []


def first_party_candidates(evidence):
    """Search-side JSON-LD evidence only; never considered PDP-verified."""
    candidates = []
    for raw in evidence.scripts[:50]:
        try:
            tree = json.loads(raw)
        except (ValueError, TypeError):
            continue
        nodes = tree if isinstance(tree, list) else [tree]
        for node in nodes:
            if not isinstance(node, dict):
                continue
            graph = node.get("@graph")
            if isinstance(graph, list):
                nodes.extend(graph[:100])
            types = node.get("@type")
            if types != "Product" and not (isinstance(types, list) and "Product" in types):
                continue
            try:
                url = parse.urlsplit(str(node["url"]))
                sku = str(node["sku"])
                offer = node["offers"]
                image = node["image"]
                if isinstance(offer, list) or not isinstance(offer, dict):
                    continue
                offer_url = parse.urlsplit(str(offer["url"]))
                price = float(offer["price"])
                image = image[0] if isinstance(image, list) and image else image
                image_url = parse.urlsplit(str(image))
                if url.scheme != "https" or url.hostname not in ("www.noon.com", "noon.com") or not PRODUCT_PATH.fullmatch(url.path):
                    continue
                if offer_url.path != url.path or offer_url.hostname not in ("www.noon.com", "noon.com"):
                    continue
                if sku.upper() not in url.path.upper() or offer.get("priceCurrency") != "SAR":
                    continue
                if image_url.scheme != "https" or image_url.hostname != "f.nooncdn.com" or not image_url.path.startswith("/p/"):
                    continue
                if not 0 < price <= 1_000_000:
                    continue
                candidates.append({"sku": sku, "title": str(node.get("name", ""))[:180],
                                   "price": price, "currency": "SAR",
                                   "url": url.geturl(), "image": image_url.geturl(),
                                   "evidence": "SEARCH_JSONLD_ONLY_UNVERIFIED"})
            except (KeyError, TypeError, ValueError, OverflowError):
                continue
    return candidates[:5]


def main():
    arg = argparse.ArgumentParser()
    arg.add_argument("--query", default="laptop")
    ns = arg.parse_args()
    query = ns.query.strip()
    if not query or len(query) > 120:
        raise SystemExit("INVALID_QUERY")
    url = BASE + "/saudi-en/search/?q=" + parse.quote(query)
    report = {
        "schema": "nawaa.oracle.noon-sa.live-probe.v1",
        "observedAt": datetime.now(timezone.utc).isoformat(),
        "query": query, "source": "noon-sa", "transport": "first-party-direct-HTTPS",
        "requestBudget": 2, "requestsMade": 0, "proxy": False,
        "customerPublishable": False, "pdpVerified": False, "checkoutVerified": False,
        "status": "NOT_STARTED", "candidateCount": 0,
    }
    robots = get(BASE + "/robots.txt", max_bytes=1_000_000)
    report["requestsMade"] += 1
    report["robots"] = {k: v for k, v in robots.items() if k != "body"}
    allowed = None
    if robots.get("http") == 200 and not robots.get("tooLarge"):
        parser = robotparser.RobotFileParser()
        parser.parse(robots["body"].decode("utf8", "replace").splitlines())
        allowed = parser.can_fetch(USER_AGENT, url)
    report["robotsAllowed"] = allowed
    if allowed is True:
        page = get(url)
        report["requestsMade"] += 1
        report["search"] = {k: v for k, v in page.items() if k != "body"}
        if page.get("http") == 200 and not page.get("tooLarge"):
            body = page["body"]
            report["search"]["sha256"] = hashlib.sha256(body).hexdigest()
            inspector = SearchEvidence()
            inspector.feed(body.decode("utf8", "replace"))
            report["productLinkCount"] = len(inspector.links)
            candidates = first_party_candidates(inspector)
            report["candidates"] = candidates
            report["candidateCount"] = len(candidates)
            report["status"] = "SEARCH_HTML_OBSERVED_NOT_PRICE_CERTIFIED"
        elif page.get("http") in (401, 403, 429):
            report["status"] = "SOURCE_ACCESS_DENIED"
        else:
            report["status"] = "SEARCH_ACCESS_UNAVAILABLE"
    else:
        report["status"] = "ROBOTS_DISALLOWED_STOP" if allowed is False else "ROBOTS_NOT_CONFIRMED_STOP"
    print(json.dumps(report, ensure_ascii=False, separators=(",", ":")))
    # A diagnostic run may exit successfully even when the source is blocked.
    # Consumers MUST inspect status, not infer acquisition from exit code.


if __name__ == "__main__":
    main()
