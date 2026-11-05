#!/usr/bin/env python3
"""One live Noon UAE PDP forensic probe; exact SKU+offer from live PLP.

Three bounded public requests: warmup, search, one PDP. Never publishes offers.
Records structural counts and whitelisted product fields, not raw HTML/JSON.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from decimal import Decimal, InvalidOperation
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit

from bs4 import BeautifulSoup
from curl_cffi import requests
from noon_uae_price_policy import assess_offer, cents, corroborate_sources
from noon_uae_embedded_offer import inspect_offer_scripts
from noon_uae_request_policy import classify_source_response
from noon_uae_tsr_ast import inspect_tsr_ast

BASE = "https://www.noon.com"
SEARCH = BASE + "/uae-en/search/?" + urlencode({"q": "PlayStation 5"})
REPORT_PATH = "noon-uae-pdp-structure-live.json"
MAX_BYTES = 5_000_000
MAX_HTML_SCRIPTS = 120
MAX_NODES = 10_000
SKU_RE = re.compile(r"/(N\d{8}[AV]|Z[A-Z0-9]{20}Z)/p/?$", re.I)
MONEY_RE = re.compile(r"(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?")
REPORT = {
    "schema": "nawaa.noon-ae.pdp-evidence-discovery.v1",
    "sha": os.getenv("PULL_REQUEST_HEAD_SHA", ""),
    "sourceMarket": "AE",
    "query": "PlayStation 5",
    "requestsAttempted": 0,
    "retries": 0,
    "usesProxies": False,
    "customerPublishable": False,
    "pdpVerified": False,
    "sourceCurrencyClaimVerified": False,
    "saudiDeliveryEligibilityVerified": False,
    "observations": [],
    "conclusion": "NOT_RUN",
}


def origin(url):
    try:
        u = urlsplit(url)
        return (
            u.scheme == "https" and u.hostname == "www.noon.com"
            and u.username is None and u.password is None
            and u.port in (None, 443)
        )
    except ValueError:
        return False


def error_class(exc):
    name = type(exc).__name__.lower()
    msg = str(exc).lower()
    if any(x in name for x in ("typeerror", "attributeerror", "nameerror")):
        return "IMPLEMENTATION_ERROR"
    if "timeout" in name or "timeout" in msg or "timed out" in msg:
        return "TIMEOUT"
    if any(x in msg for x in ("http2", "http/2", "errcode: 92")):
        return "HTTP2_PROTOCOL_ERROR"
    return "NETWORK_ERROR"


def fetch(session, url, step):
    observation = {"step": step}
    REPORT["requestsAttempted"] += 1
    started = time.monotonic()
    body = None
    try:
        if not origin(url):
            observation["state"] = "INVALID_ORIGIN"
            return observation, None
        response = session.get(
            url, timeout=15, allow_redirects=False,
            headers={"accept": "text/html,application/xhtml+xml"},
        )
        observation["httpStatus"] = response.status_code
        observation["htmlBytes"] = len(response.content)
        observation["mime"] = str(response.headers.get("content-type") or "")[:80]
        observation["sourceDecision"] = classify_source_response(
            status=response.status_code,
            retry_after=response.headers.get("retry-after"),
        )
        if (response.status_code == 200 and
                observation["mime"].lower().startswith("text/html") and
                len(response.content) <= MAX_BYTES and origin(str(response.url))):
            body = response.content
            observation["sha256"] = hashlib.sha256(body).hexdigest()
            observation["state"] = "HTML_SOURCE_RECEIVED"
        elif response.status_code in (403, 429):
            observation["state"] = f"HTTP_{response.status_code}"
        else:
            observation["state"] = "HTTP_OR_MIME_NOT_ACCEPTED"
    except Exception as exc:
        observation["state"] = error_class(exc)
        observation["errorType"] = type(exc).__name__[:50]
        observation["sourceDecision"] = classify_source_response(error=exc)
    finally:
        observation["elapsedMs"] = round(1000 * (time.monotonic() - started))
        REPORT["observations"].append(observation)
    return observation, body


def candidate_from_link(link):
    if not isinstance(link, str):
        return None
    url = urljoin(BASE + "/uae-en/", link)
    if not origin(url):
        return None
    split = urlsplit(url)
    if not split.path.startswith("/uae-en/"):
        return None
    match = SKU_RE.search(split.path)
    if not match:
        return None
    offer = parse_qs(split.query).get("o", [])
    if len(offer) != 1 or not re.fullmatch("[A-Za-z0-9-]{1,100}", offer[0]):
        return None
    return {"sku": match.group(1).upper(), "offerCode": offer[0], "url": url}


def pick_product(html):
    soup = BeautifulSoup(html, "html.parser")
    lang = str(soup.html.get("lang") or "").lower() if soup.html else ""
    heading = soup.select_one("h1")
    title = heading.get_text(" ", strip=True) if heading else ""
    if lang != "en-ae" or " ".join(title.casefold().split()) != "playstation 5":
        return None, {"state": "PAGE_QUERY_OR_MARKET_INVALID"}
    all_links = 0
    for link in soup.select('a[href*="/p/"]')[:200]:
        all_links += 1
        item = candidate_from_link(link.get("href"))
        if not item:
            continue
        amt = link.select_one('[data-qa="plp-product-box-price"] strong')
        title_node = link.select_one('[data-qa="plp-product-box-name"]')
        if amt is None or title_node is None:
            continue
        amount = amt.get_text(" ", strip=True).replace(",", "")
        if not MONEY_RE.fullmatch(amount) or cents(amount) is None:
            continue
        item["plpPrice"] = amount
        item["titleMatchesSkuLink"] = bool(title_node.get_text(" ", strip=True))
        return item, {"state": "SINGLE_LIVE_OFFER_SELECTED", "linksScanned": all_links}
    return None, {"state": "NO_VALID_LIVE_OFFER", "linksScanned": all_links}


def safe_decimal(value):
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        return None
    v = str(value).strip()
    try:
        d = Decimal(v)
        if d.is_finite() and Decimal(0) < d <= Decimal("10000000"):
            return str(d)
    except (ValueError, InvalidOperation):
        pass
    return None


def inspect_jsonld(soup, item):
    matches = []
    count = 0
    for script in soup.select('script[type="application/ld+json"]')[:50]:
        body = script.string or script.get_text()
        if not body or len(body) > 300_000:
            continue
        try:
            root = json.loads(body)
        except (ValueError, TypeError):
            continue
        queue = [root]
        while queue and count < MAX_NODES:
            count += 1
            entry = queue.pop()
            if isinstance(entry, list):
                queue.extend(entry[:100])
                continue
            if not isinstance(entry, dict):
                continue
            for k in ("@graph", "itemListElement", "mainEntity"):
                if k in entry:
                    queue.append(entry[k])
            kind = entry.get("@type")
            kinds = kind if isinstance(kind, list) else [kind]
            if "Product" not in kinds:
                continue
            if str(entry.get("sku") or "").upper() != item["sku"]:
                continue
            offers = entry.get("offers") or []
            if isinstance(offers, dict):
                offers = [offers]
            for o in offers[:30] if isinstance(offers, list) else []:
                if not isinstance(o, dict):
                    continue
                verdict = assess_offer(
                    requested_sku=item["sku"],
                    product_sku=str(entry.get("sku") or ""),
                    plp_price=item["plpPrice"],
                    pdp_price=o.get("price"),
                    currency=o.get("priceCurrency"),
                    requested_offer_code=item["offerCode"],
                    offer_url=o.get("url"),
                )
                matches.append({
                    "currency": str(o.get("priceCurrency") or "")[:10],
                    "price": safe_decimal(o.get("price")),
                    "offerLinkMatches": verdict["sameOfferIdentity"],
                    "deltaCents": verdict["deltaCents"],
                    "decision": verdict["decision"],
                })
    return {"nodesInspected": count, "matchedSkuOffers": matches[:10]}


def inspect_dom(soup, item):
    selectors = [
        '[data-qa*="price"]', '[data-testid*="price"]',
        '[itemprop="price"]', '[data-currency]', '[itemprop="priceCurrency"]',
        'meta[property="product:price:amount"]',
        'meta[property="product:price:currency"]',
    ]
    output = {}
    for selector in selectors:
        found = soup.select(selector)[:25]
        # Describe candidate values without pretending they are attributable to
        # the selected offer. Never copy all HTML or arbitrary script text.
        values = []
        for node in found[:3]:
            value = node.get("content") or node.get("aria-label") or node.get_text(" ", strip=True)
            stripped = " ".join(str(value).split())
            values.append({
                "tag": node.name,
                "text": stripped[:90],
                "len": len(stripped),
                "hasAed": bool(re.search(r"\bAED\b|د\.?\s*إ", stripped, re.I)),
                "hasOfferCode": item["offerCode"] in stripped,
            })
        output[selector] = {"count": len(found), "samples": values}
    return output


def flight_payload_diagnostics(soup, item):
    """Decode Next Flight push JSON arrays; never execute embedded JavaScript."""
    summary = {
        "flightScriptCount": 0,
        "flightPushArrayDecoded": 0,
        "flightDecodeErrors": 0,
        "flightTextChunkCount": 0,
        "chunksWithSelectedOffer": 0,
        "chunksWithSelectedSku": 0,
        "chunksWithOfferAndSku": 0,
        "chunksWithOfferPriceAndAed": 0,
        "offerAdjacentFieldNames": {},
        "parsedRecordCount": 0,
        "selectedOfferCandidateObjects": [],
    }
    for script in soup.find_all("script", limit=MAX_HTML_SCRIPTS):
        source = script.string or script.get_text()
        if not source or len(source) > 3_000_000:
            continue
        marker = "self.__next_f.push("
        if marker not in source:
            continue
        summary["flightScriptCount"] += 1
        pointer = 0
        while True:
            index = source.find(marker, pointer)
            if index < 0:
                break
            pointer = index + len(marker)
            try:
                value, _ = json.JSONDecoder().raw_decode(source[pointer:])
            except (ValueError, TypeError):
                summary["flightDecodeErrors"] += 1
                continue
            if not isinstance(value, list):
                continue
            summary["flightPushArrayDecoded"] += 1
            for chunk in value:
                if not isinstance(chunk, str):
                    continue
                summary["flightTextChunkCount"] += 1
                code_present = item["offerCode"] in chunk
                sku_present = item["sku"] in chunk
                summary["chunksWithSelectedOffer"] += int(code_present)
                summary["chunksWithSelectedSku"] += int(sku_present)
                summary["chunksWithOfferAndSku"] += int(code_present and sku_present)
                summary["chunksWithOfferPriceAndAed"] += int(
                    code_present and "2099.05" in chunk and "AED" in chunk
                )
                if not code_present:
                    continue
                idx = chunk.find(item["offerCode"])
                around = chunk[max(0, idx-900):idx+900]
                for name in re.findall(r'"([a-zA-Z][a-zA-Z0-9_]{2,40})"\s*:', around):
                    if any(x in name.lower() for x in (
                        "price", "offer", "sku", "currency", "variant", "ship",
                    )):
                        summary["offerAdjacentFieldNames"][name] = (
                            summary["offerAdjacentFieldNames"].get(name, 0) + 1
                        )
                for record in chunk.splitlines()[:150]:
                    if ":" not in record or len(record) > 1_000_000:
                        continue
                    text = record.split(":", 1)[1].strip()
                    if not text.startswith(("{", "[")):
                        continue
                    try:
                        parsed = json.loads(text)
                    except (TypeError, ValueError):
                        continue
                    summary["parsedRecordCount"] += 1
                    stack = [(parsed, 0)]
                    seen = 0
                    while stack and seen < 4000:
                        node, depth = stack.pop()
                        seen += 1
                        if depth > 14:
                            continue
                        if isinstance(node, list):
                            stack.extend((v, depth + 1) for v in node[:100])
                        elif isinstance(node, dict):
                            codes = [str(v) for k, v in node.items() if
                                     k.lower() in ("offer_code", "offercode", "offerid",
                                                   "offer_id") and isinstance(v, str)]
                            if (item["offerCode"] in codes and
                                    len(summary["selectedOfferCandidateObjects"]) < 10):
                                fields = {}
                                for k, v in node.items():
                                    if isinstance(v, (str, int, float)):
                                        lk = k.lower()
                                        if lk in ("price", "sale_price", "saleprice",
                                                  "current_price", "offer_price",
                                                  "currency", "currencycode", "sku",
                                                  "sku_config", "offercode", "offer_code"):
                                            fields[k] = (
                                                "EXACT_OFFER" if lk in
                                                ("offercode", "offer_code") and
                                                v == item["offerCode"] else
                                                str(v)[:35]
                                            )
                                summary["selectedOfferCandidateObjects"].append({
                                    "fieldNames": sorted(str(k)[:36] for k in node)[:35],
                                    "relevantFields": fields,
                                    "depth": depth,
                                })
                            for v in node.values():
                                if isinstance(v, (dict, list)):
                                    stack.append((v, depth + 1))
    return summary


def script_shape(soup, item):
    """Find embedded state objects, summarize only exact SKU/offer-adjacent nodes."""
    result = {
        "jsonScriptCounts": {},
        "candidateContexts": [],
        "matchedOfferCodeOccurrences": 0,
        "matchedSkuOccurrences": 0,
        "parsedStateObjects": 0,
        "rawHtmlScriptOfferOccurrence": False,
        "offerContextKeyFrequencies": {},
        "offerContextSemanticClues": [],
        "closestPriceNumericCandidates": [],
        "inlineScriptEnvelopeDiagnostics": [],
    }
    for node in soup.find_all("script", limit=MAX_HTML_SCRIPTS):
        body = node.string or node.get_text()
        if not body:
            continue
        src_type = str(node.get("type") or "unspecified")[:50]
        result["jsonScriptCounts"][src_type] = result["jsonScriptCounts"].get(src_type, 0) + 1
        result["matchedOfferCodeOccurrences"] += body.count(item["offerCode"])
        result["matchedSkuOccurrences"] += body.count(item["sku"])
        if item["offerCode"] in body:
            result["rawHtmlScriptOfferOccurrence"] = True
            # Only expose allowlisted structural key names and sanitized nearby
            # numeric fields. Never log raw inline scripts or product payloads.
            for match in list(re.finditer(re.escape(item["offerCode"]), body))[:12]:
                chunk = body[max(0, match.start() - 320):match.end() + 350]
                keys = re.findall(
                    r"""(?:\\?["'])([A-Za-z][A-Za-z0-9_]{2,44})(?:\\?["'])\\s*:""",
                    chunk,
                )
                for key in keys:
                    if any(fragment in key.lower() for fragment in (
                        "price", "offer", "sku", "currency", "amount", "variant",
                        "seller", "buybox", "product", "fulfil", "ship",
                    )):
                        result["offerContextKeyFrequencies"][key] = (
                            result["offerContextKeyFrequencies"].get(key, 0) + 1
                        )
                before = chunk[: min(320, match.start())].lower()
                after = chunk[min(320, match.start()):].lower()
                label = sorted(set(re.findall(
                    r"(?:saleprice|offerprice|pricecurrency|offer_code|offercode|"
                    r"buybox|sku_config|sellingprice|currency|variant|"
                    r"merchant|shipping|amount|price)",
                    before + after,
                )))
                if len(result["offerContextSemanticClues"]) < 12:
                    result["offerContextSemanticClues"].append({
                        "scriptType": src_type,
                        "windowChars": len(chunk),
                        "structuralTerms": label,
                        "hasAedText": "aed" in chunk.lower(),
                        "hasSkuText": item["sku"].lower() in chunk.lower(),
                    })
                amounts = re.findall(
                    r"(?:price|amount)[^0-9]{0,16}([1-9][0-9]{0,6}(?:[.][0-9]{1,2})?)",
                    chunk, re.I,
                )
                if amounts and len(result["closestPriceNumericCandidates"]) < 12:
                    result["closestPriceNumericCandidates"].append(
                        [value for value in amounts[:4]]
                    )
        if item["offerCode"] in body and len(result["inlineScriptEnvelopeDiagnostics"]) < 10:
            start = body.lstrip()[:350]
            # Whitelist only leading JavaScript identifiers, not string values.
            start = re.sub(r'["][^"]{0,100}["]', '"STRING"', start)
            start = re.sub(r"['][^']{0,100}[']", "'STRING'", start)
            identifiers = re.findall(r"[A-Za-z_$][A-Za-z0-9_$.]{2,60}", start)
            result["inlineScriptEnvelopeDiagnostics"].append({
                "type": src_type,
                "chars": len(body),
                "leadIdentifiers": identifiers[:8],
                "startsWithBrace": body.lstrip().startswith("{"),
                "containsOffer": item["offerCode"] in body,
                "containsSku": item["sku"] in body,
                "containsJsonParse": "JSON.parse" in body,
                "containsWindow": "window." in body,
                "containsAssignment": "=" in body[:200],
                "containsJsonStringify": "JSON.stringify" in body,
                "containsProductKey": "product" in body[:500].lower(),
                "containsAppData": "__" in body[:200],
            })
        if len(body) > 3_000_000:
            continue
        if src_type not in ("application/json", "application/ld+json"):
            continue
        try:
            obj = json.loads(body)
        except (ValueError, TypeError):
            continue
        result["parsedStateObjects"] += 1
        queue = [(obj, "$", 0)]
        visited = 0
        while queue and visited < MAX_NODES:
            visited += 1
            value, path, depth = queue.pop()
            if depth > 12:
                continue
            if isinstance(value, list):
                for index, entry in enumerate(value[:100]):
                    queue.append((entry, path + "[]", depth + 1))
                continue
            if not isinstance(value, dict):
                continue
            sku_keys = [k for k, v in value.items() if
                        isinstance(v, (str, int)) and str(v).upper() == item["sku"]]
            offer_keys = [k for k, v in value.items() if
                          isinstance(v, str) and v == item["offerCode"]]
            if (sku_keys or offer_keys) and len(result["candidateContexts"]) < 12:
                fields = {}
                for k, v in value.items():
                    lk = str(k).lower()
                    if (lk in ("price", "sale_price", "selling_price", "offer_price",
                               "currency", "currency_code", "pricecurrency",
                               "offer_code", "offercode", "sku", "product_sku") and
                            isinstance(v, (int, float, str, bool))):
                        if "price" in lk:
                            fields[k] = safe_decimal(v)
                        elif "currency" in lk:
                            fields[k] = str(v)[:12]
                        elif "sku" in lk:
                            fields[k] = str(v)[:30]
                        elif "offer" in lk:
                            fields[k] = "MATCHED" if v == item["offerCode"] else "DIFFERENT"
                result["candidateContexts"].append({
                    "path": path[:150],
                    "skuKeyCount": len(sku_keys),
                    "offerKeyCount": len(offer_keys),
                    "relevantFieldNames": sorted(fields)[:15],
                    "fields": fields,
                })
            for k, v in value.items():
                if isinstance(v, (list, dict)):
                    queue.append((v, path + "." + str(k)[:45], depth + 1))
    return result


try:
    with requests.Session(impersonate="chrome") as session:
        _, warm = fetch(session, BASE + "/uae-en/", "warmup")
        if warm is None:
            REPORT["conclusion"] = "WARMUP_NOT_AVAILABLE"
        else:
            _, search = fetch(session, SEARCH, "plp_live")
            if search is None:
                REPORT["conclusion"] = "PLP_NOT_AVAILABLE"
            else:
                item, selection = pick_product(search)
                REPORT["selection"] = selection
                if item:
                    REPORT["selectedSku"] = item["sku"]
                    REPORT["selectedOfferIdHash"] = hashlib.sha256(
                        item["offerCode"].encode("utf8")
                    ).hexdigest()
                    REPORT["plpDisplayedPrice"] = item["plpPrice"]
                    _, pdp = fetch(session, item["url"], "one_offer_linked_pdp")
                    if pdp is None:
                        REPORT["conclusion"] = "PDP_NOT_AVAILABLE"
                    else:
                        soup = BeautifulSoup(pdp, "html.parser")
                        REPORT["pdpLang"] = str(
                            soup.html.get("lang") or "" if soup.html else ""
                        )[:25]
                        REPORT["jsonLd"] = inspect_jsonld(soup, item)
                        REPORT["domEvidence"] = inspect_dom(soup, item)
                        REPORT["embeddedState"] = script_shape(soup, item)
                        REPORT["reactFlight"] = flight_payload_diagnostics(soup, item)
                        REPORT["parsedEmbeddedOfferEvidence"] = inspect_offer_scripts(
                            soup, sku=item["sku"], offer_code=item["offerCode"],
                            plp_price=item["plpPrice"],
                        )
                        REPORT["tanstackTsrAst"] = inspect_tsr_ast(
                            soup, sku=item["sku"], offer_code=item["offerCode"],
                            plp_price=item["plpPrice"],
                        )
                        REPORT["tsrAstSameOfferPriceAttested"] = bool(
                            REPORT["tanstackTsrAst"]["samePriceOfferAttested"]
                        )
                        REPORT["crossSurfaceCorroboration"] = corroborate_sources(
                            plp_price=item["plpPrice"],
                            ast_candidates=REPORT["tanstackTsrAst"]["candidateRecords"],
                            jsonld_offers=REPORT["jsonLd"]["matchedSkuOffers"],
                        )
                        REPORT["embeddedSameOfferPriceAttested"] = bool(
                            REPORT["parsedEmbeddedOfferEvidence"]["samePriceOfferAttested"]
                        )
                        # Cross-border KSA delivery requires product/checkout proof,
                        # not inferred from UAE listing currency or locale.
                        REPORT["saudiDeliveryEligibilityVerified"] = False
                        REPORT["customerPublishable"] = False
                        REPORT["conclusion"] = "PDP_STRUCTURES_OBSERVED_UNVERIFIED_OFFER"
except Exception as exc:
    REPORT["conclusion"] = error_class(exc)
    REPORT["fatalType"] = type(exc).__name__[:50]
finally:
    with open(REPORT_PATH, "w", encoding="utf8") as f:
        json.dump(REPORT, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(json.dumps(REPORT, indent=2, ensure_ascii=False))
    if REPORT["conclusion"] != "PDP_STRUCTURES_OBSERVED_UNVERIFIED_OFFER":
        raise SystemExit(1)
