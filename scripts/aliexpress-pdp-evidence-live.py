#!/usr/bin/env python3
"""Live AliExpress PDP evidence probe for user-supplied item IDs.

No session/link tracking parameters are fetched, stored, or logged. Search
query parameter offers, URL marketing discounts, and guessed buyboxes are NOT
proof of current product price. All findings remain experimental.
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser

from bs4 import BeautifulSoup
from curl_cffi import requests

_spec = importlib.util.spec_from_file_location(
    "aliexpress_public_probe", Path(__file__).resolve().with_name("aliexpress-public-html-live.py")
)
_shared = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = _shared
_spec.loader.exec_module(_shared)

MAX_PDP_BYTES = 3_500_000
PDP_HOST = os.getenv("ALIEXPRESS_PDP_HOST", "ar.aliexpress.com").strip()
BASE = "https://" + PDP_HOST
CHALLENGE = _shared.CHALLENGE


def safely_matched_product_jsonld(html, item_id):
    """Corroborate only Product JSON-LD scoped to the exact requested item."""
    document = BeautifulSoup(html, "html.parser")
    records = []
    checked = 0

    def descend(value, depth=0):
        if depth > 5:
            return
        if isinstance(value, list):
            for x in value[:40]:
                descend(x, depth + 1)
            return
        if not isinstance(value, dict):
            return
        kind = value.get("@type")
        is_product = "Product" in kind if isinstance(kind, list) else (
            isinstance(kind, str) and kind.casefold() == "product"
        )
        if is_product:
            records.append(value)
        for key in ("@graph", "itemListElement", "item"):
            if key in value:
                descend(value[key], depth + 1)

    for element in document.select('script[type="application/ld+json"]')[:20]:
        checked += 1
        if len(element.get_text()) > 250_000:
            continue
        try:
            descend(json.loads(element.get_text()))
        except (TypeError, ValueError):
            continue
    valid = []
    for entry in records:
        url = _shared.product_link(entry.get("url"), item_id)
        if not url:
            continue
        if entry.get("sku") is not None and str(entry.get("sku")) != item_id:
            continue
        offers = entry.get("offers")
        offers = offers if isinstance(offers, list) else [offers]
        if len(offers) != 1 or not isinstance(offers[0], dict):
            continue
        offer = offers[0]
        if offer.get("@type") not in (None, "Offer"):
            continue
        if any(offer.get(x) is not None for x in ("lowPrice", "highPrice", "priceSpecification")):
            continue
        offer_url = offer.get("url")
        if offer_url and not _shared.product_link(offer_url, item_id):
            continue
        price = _shared.exact_price(offer.get("price"))
        currency = offer.get("priceCurrency")
        if not price or not isinstance(currency, str) or not re.fullmatch("[A-Z]{3}", currency):
            continue
        valid.append({
            "priceOriginal": price,
            "currency": currency,
            "evidenceTier": "PRODUCT_JSONLD_SAME_ID_SINGLE_OFFER",
            "offerUrlMatched": bool(offer_url),
        })
    if len(valid) != 1:
        return {"state": "NO_UNAMBIGUOUS_EXACT_ID_PRODUCT_JSONLD",
                "scriptCount": checked, "productNodes": len(records),
                "matchedPricedNodes": len(valid)}
    return {"state": "SAME_ITEM_JSONLD_PRICE_CANDIDATE",
            "scriptCount": checked, "productNodes": len(records),
            "matchedPricedNodes": 1, "priceEvidence": valid[0]}


# Redirects are followed only when they preserve the exact AliExpress item ID.
# Each new origin must independently pass robots before its PDP is fetched.
ALLOWED_PDP_HOSTS = frozenset({
    "ar.aliexpress.com", "www.aliexpress.com", "m.aliexpress.com",
    "www.aliexpress.us", "aliexpress.com", "aliexpress.us",
})
MAX_REDIRECT_HOPS = 2
REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})


def classify_redirect_destination(raw_location, current_url, item_id):
    """Safe, bounded redirect diagnostics: route class only, no tokens or query."""
    if not isinstance(raw_location, str) or not 0 < len(raw_location) <= 2048:
        return {"targetHostClass": "UNKNOWN", "targetPathClass": "MISSING_LOCATION"}
    try:
        target = urlsplit(urljoin(current_url, raw_location))
        host = target.hostname or ""
        host_class = "OFFICIAL" if host in ALLOWED_PDP_HOSTS else "OTHER"
        path = target.path.lower()
        if re.fullmatch(r"/item/" + re.escape(item_id) + r"\.html/?", path):
            path_class = "EXACT_ITEM_PDP"
        elif re.fullmatch(r"/item/\d{10,20}\.html/?", path):
            path_class = "OTHER_ITEM_PDP"
        elif re.search(r"/(?:punish|verify|captcha|login|passport)(?:/|$)", path):
            path_class = "CHALLENGE_OR_AUTH"
        elif path in ("", "/"):
            path_class = "ROOT"
        elif "/search" in path or path.startswith("/w/"):
            path_class = "SEARCH"
        else:
            path_class = "OTHER"
        item_match = re.fullmatch(r"/item/(\d{10,20})\.html/?", path)
        return {"targetHostClass": host_class, "targetPathClass": path_class,
                "targetHost": host if host_class == "OFFICIAL" else None,
                "targetItemId": item_match.group(1) if host_class == "OFFICIAL" and item_match else None,
                "hasQuery": bool(target.query)}
    except (ValueError, TypeError):
        return {"targetHostClass": "UNKNOWN", "targetPathClass": "INVALID_URL"}


def approved_pdp_redirect(raw_location, current_url, item_id, *, trace_alias=False):
    """Follow safe canonical destinations; cross-ID tracing never certifies product identity."""
    if not isinstance(raw_location, str) or not 0 < len(raw_location) <= 2048:
        return None, "REDIRECT_LOCATION_MISSING_OR_LONG"
    try:
        target = urljoin(current_url, raw_location)
        split = urlsplit(target)
        if (split.scheme != "https" or split.hostname not in ALLOWED_PDP_HOSTS
                or split.username or split.password or split.port not in (None, 443)):
            return None, "REDIRECT_UNTRUSTED_SCHEME_OR_HOST"
        canonical = _shared.product_link(target, item_id)
        if canonical is None:
            if re.search(r"/(?:punish|verify|captcha|login|passport)(?:/|$)", split.path, re.I):
                return None, "CHALLENGE_OR_LOGIN_REDIRECT"
            if trace_alias:
                match = re.fullmatch(r"/item/(\d{10,20})\.html/?", split.path, re.I)
                if match and match.group(1) != item_id:
                    alias = _shared.product_link(target, match.group(1))
                    if alias:
                        return alias, "REDIRECT_CROSS_ITEM_DIAGNOSTIC_ONLY"
            return None, "REDIRECT_NOT_SAME_ITEM_PDP"
        if canonical == _shared.product_link(current_url, item_id):
            return None, "REDIRECT_TO_SAME_CANONICAL_ITEM"
        return canonical, "REDIRECT_SAME_ITEM_APPROVED"
    except (ValueError, TypeError):
        return None, "REDIRECT_LOCATION_MALFORMED"


def verify_public_robots(session, target_url, headers):
    """Robots.txt may redirect, but only to approved official robots.txt paths.

    This never treats an HTTP redirect as permission to fetch a PDP. The policy
    retrieved from an approved redirected URL still controls the original
    requested product path and is never replaced by permissive defaults.
    """
    requested_host = urlsplit(target_url).hostname
    if requested_host not in ALLOWED_PDP_HOSTS:
        return False, {
            "step": "robots_policy", "host": requested_host, "state": "HOST_NOT_APPROVED"
        }
    started = time.monotonic()
    current_robots = "https://" + requested_host + "/robots.txt"
    stage = {"step": "robots_policy", "host": requested_host,
             "policyRedirectsFollowed": 0}
    visited = set()
    try:
        for hop in range(3):
            if current_robots in visited:
                stage["state"] = "ROBOTS_REDIRECT_LOOP"
                break
            visited.add(current_robots)
            response = session.get(
                current_robots,
                headers={**headers, "accept": "text/plain"},
                timeout=12, allow_redirects=False,
            )
            stage["status"] = response.status_code
            stage["bytes"] = len(response.content)
            final = urlsplit(str(response.url))
            expected = urlsplit(current_robots)
            if final.hostname != expected.hostname:
                stage["state"] = "ROBOTS_RESPONSE_ORIGIN_MISMATCH"
                break
            if response.status_code in REDIRECT_STATUSES:
                location = response.headers.get("location")
                if not isinstance(location, str) or len(location) > 2048:
                    stage["state"] = "ROBOTS_REDIRECT_MISSING_LOCATION"
                    break
                candidate = urlsplit(urljoin(current_robots, location))
                approved = (
                    candidate.scheme == "https"
                    and candidate.hostname in ALLOWED_PDP_HOSTS
                    and candidate.path == "/robots.txt"
                    and not candidate.query and not candidate.fragment
                    and not candidate.username and not candidate.password
                    and candidate.port in (None, 443)
                )
                if not approved:
                    stage["state"] = "ROBOTS_REDIRECT_NOT_APPROVED"
                    break
                if hop >= 2:
                    stage["state"] = "ROBOTS_REDIRECT_HOP_LIMIT"
                    break
                next_robots = "https://" + candidate.hostname + "/robots.txt"
                if next_robots in visited:
                    stage["state"] = "ROBOTS_REDIRECT_LOOP"
                    break
                stage["policyRedirectsFollowed"] += 1
                current_robots = next_robots
                continue
            valid = (
                response.status_code == 200
                and 0 < len(response.content) <= 150000
            )
            if not valid:
                stage["state"] = "POLICY_UNAVAILABLE"
                break
            policy = RobotFileParser()
            policy.parse(response.text.splitlines())
            allowed = policy.can_fetch(
                _shared.USER_AGENT.split("/", 1)[0], target_url
            )
            stage["state"] = "ALLOWED" if allowed else "DISALLOWED"
            stage["resolvedPolicyHost"] = expected.hostname
            stage["elapsedMs"] = round((time.monotonic() - started) * 1000)
            return allowed, stage
    except Exception as exc:
        stage["state"] = "TRANSPORT_FAILURE"
        stage["exceptionType"] = type(exc).__name__[:60]
    stage["elapsedMs"] = round((time.monotonic() - started) * 1000)
    return False, stage


def probe_item(item_id, *, trace_alias=False):
    if not _shared.ID.fullmatch(item_id):
        raise ValueError("INVALID_ITEM_ID")
    if PDP_HOST not in ALLOWED_PDP_HOSTS:
        raise ValueError("PDP_HOST_NOT_APPROVED")
    url = BASE + "/item/" + item_id + ".html"
    report = {
        "schema": "nawaa.aliexpress.pdp-live-evidence.v2",
        "itemId": item_id, "canonicalUrl": url,
        "observedUtc": datetime.now(timezone.utc).isoformat(),
        "retries": 0, "proxyUsed": False, "captchaSolved": False,
        "customerPublishable": False, "stages": [],
        "redirectsFollowed": 0, "aliasCandidate": None,
        "aliasIdentityVerified": False, "conclusion": "NOT_STARTED",
    }
    with requests.Session(impersonate="chrome") as sess:
        headers = {
            "user-agent": _shared.USER_AGENT,
            "accept": "text/html,application/xhtml+xml",
            "accept-language": "ar-SA,ar;q=0.9,en;q=0.5",
        }
        robots_hosts = set()
        visited = set()
        current = url
        current_item_id = item_id
        for hop in range(MAX_REDIRECT_HOPS + 1):
            host = urlsplit(current).hostname
            if host not in robots_hosts:
                allowed, robots_stage = verify_public_robots(sess, current, headers)
                report["stages"].append(robots_stage)
                if not allowed:
                    report["conclusion"] = "ROBOTS_POLICY_NOT_VERIFIED"
                    return report
                robots_hosts.add(host)
            if current in visited:
                report["conclusion"] = "REDIRECT_LOOP_BLOCKED"
                return report
            visited.add(current)
            started = time.monotonic()
            try:
                response = sess.get(
                    current, headers=headers, timeout=15, allow_redirects=False
                )
                data = response.content
                source = urlsplit(str(response.url))
                content_type = response.headers.get("content-type", "").lower()
                stage = {
                    "step": "pdp_html", "hop": hop, "host": host,
                    "status": response.status_code, "bytes": len(data),
                    "contentType": content_type[:70],
                    "originPinned": source.hostname == host,
                    "elapsedMs": round((time.monotonic() - started) * 1000),
                }
                if source.hostname != host:
                    stage["state"] = "RESPONSE_ORIGIN_MISMATCH"
                    report["conclusion"] = "PDP_SOURCE_UNAVAILABLE"
                    report["stages"].append(stage)
                    return report
                if response.status_code in REDIRECT_STATUSES:
                    destination, reason = approved_pdp_redirect(
                        response.headers.get("location"), current, current_item_id,
                        trace_alias=trace_alias and report["aliasCandidate"] is None,
                    )
                    stage["state"] = reason
                    stage["redirectTarget"] = classify_redirect_destination(
                        response.headers.get("location"), current, item_id
                    )
                    report["stages"].append(stage)
                    if not destination:
                        report["conclusion"] = (
                            "PDP_CHALLENGE_OR_LOGIN_REDIRECT"
                            if reason == "CHALLENGE_OR_LOGIN_REDIRECT"
                            else "PDP_REDIRECT_IDENTITY_NOT_VERIFIED"
                        )
                        return report
                    if hop == MAX_REDIRECT_HOPS:
                        report["conclusion"] = "PDP_REDIRECT_HOP_LIMIT"
                        return report
                    if reason == "REDIRECT_CROSS_ITEM_DIAGNOSTIC_ONLY":
                        alias = stage["redirectTarget"].get("targetItemId")
                        if not _shared.ID.fullmatch(alias or ""):
                            report["conclusion"] = "PDP_REDIRECT_IDENTITY_NOT_VERIFIED"
                            return report
                        report["aliasCandidate"] = {
                            "originalItemId": item_id,
                            "destinationItemId": alias,
                            "evidence": "OFFICIAL_HTTP_REDIRECT_ONLY",
                            "customerPublishable": False,
                        }
                        current_item_id = alias
                    report["redirectsFollowed"] += 1
                    current = destination
                    continue
                valid = (
                    response.status_code == 200 and
                    "html" in content_type and 0 < len(data) <= MAX_PDP_BYTES
                )
                if not valid:
                    stage["state"] = "PDP_HTTP_OR_CONTENT_REJECTED"
                    report["conclusion"] = "PDP_SOURCE_UNAVAILABLE"
                    report["stages"].append(stage)
                    return report
                html = data.decode("utf-8", "replace")
                if CHALLENGE.search(html):
                    stage["state"] = "PDP_CHALLENGE_NOT_CATALOG"
                    report["conclusion"] = "PDP_CHALLENGE_NOT_CATALOG"
                    report["stages"].append(stage)
                    return report
                stage["state"] = "PDP_HTML_RECEIVED"
                report["stages"].append(stage)
                soup = BeautifulSoup(html, "html.parser")
                meta = soup.select_one('meta[property="og:title"]')
                image_meta = soup.select_one('meta[property="og:image"]')
                title = (meta.get("content") or "")[:250] if meta else ""
                image = _shared.product_image(
                    image_meta.get("content") if image_meta else None
                )
                jsonld = safely_matched_product_jsonld(html, current_item_id)
                report["productIdentity"] = {
                    "pageTitleCandidate": title or None,
                    "sourceImageCandidate": image,
                    "identitySource": "PDP_META_NOT_OFFER_PROOF",
                    "jsonLd": jsonld,
                }
                report["conclusion"] = (
                    "PDP_ALIAS_IDENTITY_AND_PRICE_NOT_CORROBORATED"
                    if report["aliasCandidate"] else
                    "PDP_PRODUCT_JSONLD_PRICE_CANDIDATE"
                    if jsonld["state"] == "SAME_ITEM_JSONLD_PRICE_CANDIDATE"
                    else "PDP_RECEIVED_PRICE_NOT_ATTESTED"
                )
                return report
            except Exception as exc:
                report["stages"].append({
                    "step": "pdp_html", "hop": hop, "state": "TRANSPORT_FAILURE",
                    "exceptionType": type(exc).__name__[:60],
                })
                report["conclusion"] = "PDP_SOURCE_UNAVAILABLE"
                return report
    report["conclusion"] = "PDP_REDIRECT_HOP_LIMIT"
    return report


def main():
    raw = os.getenv("ALIEXPRESS_ITEM_ID", "")
    if not _shared.ID.fullmatch(raw):
        raise SystemExit("INVALID_ALIEXPRESS_ITEM_ID")
    report = probe_item(raw, trace_alias=os.getenv("ALIEXPRESS_ALIAS_TRACE") == "1")
    with open("aliexpress-pdp-" + raw + ".json", "w", encoding="utf8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report["conclusion"] not in (
        "PDP_PRODUCT_JSONLD_PRICE_CANDIDATE", "PDP_RECEIVED_PRICE_NOT_ATTESTED"
    ):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
