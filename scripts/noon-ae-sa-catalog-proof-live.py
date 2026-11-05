#!/usr/bin/env python3
"""Noon UAE/SA public catalog live proof, diagnostics only (never customer offers).

Cross-market protocol and schema test based on MrOplus/NoonMCP/client.py.
No proxy, paid service, WAF challenge solver, CAPTCHA, authentication bypass,
retry loop, merchant configuration change, or production data mutation.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup
from curl_cffi import requests

BASE = "https://www.noon.com"
API = BASE + "/_vs/nc/mp-customer-catalog-api/api/v3"
QUERY = "laptop"
LIMIT = 12
OUTPUT = "noon-ae-sa-catalog-proof-live.json"
MAX_BYTES = 4_000_000
SKU_RE = re.compile(r"^(?:N\d{8}[AV]|Z[A-Z0-9]{20}Z)$", re.I)

REPORT = {
    "schema": "nawaa.noon-crossmarket-source-proof.v1",
    "headSha": os.environ.get("PULL_REQUEST_HEAD_SHA", ""),
    "observedAtUTC": datetime.now(timezone.utc).isoformat(),
    "query": QUERY,
    "markets": ["AE", "SA"],
    "implementationReference": "MrOplus/NoonMCP/noonmcp/client.py",
    "method": "curl_cffi.Session.get_with_complete_response",
    "maxRequests": 5,
    "attempts": 0,
    "retries": 0,
    "usesProxies": False,
    "hasAuth": False,
    "pdpVerified": False,
    "currencyIndependentlyVerified": False,
    "canShipToSaudiVerified": False,
    "customerPublishable": False,
    "stages": [],
    "conclusion": "NOT_STARTED",
}


def classify_error(exc: Exception) -> str:
    if isinstance(exc, (TypeError, AttributeError, NameError)):
        return "PYTHON_IMPLEMENTATION_ERROR"
    name = type(exc).__name__.lower()
    message = str(exc).lower()
    if "timeout" in name or "timeout" in message or "timed out" in message:
        return "TIMEOUT"
    if ("http/2" in message or "http2" in message or "errcode: 92" in message
            or "stream 0 was not closed" in message):
        return "HTTP2_STREAM_PROTOCOL_ERROR"
    if "tls" in message or "ssl" in message:
        return "TLS_ERROR"
    if "dns" in message or "resolve" in message:
        return "DNS_ERROR"
    return "CLIENT_OR_NETWORK_EXCEPTION"


def allowed_noon_url(raw: str) -> bool:
    if not isinstance(raw, str) or len(raw) > 2048:
        return False
    try:
        u = urlsplit(raw)
    except ValueError:
        return False
    return (u.scheme == "https" and u.hostname in ("noon.com", "www.noon.com")
            and not u.username and not u.password and u.port in (None, 443))


def amount(raw) -> float | None:
    if isinstance(raw, bool) or not isinstance(raw, (str, int, float)):
        return None
    candidate = str(raw)
    if re.fullmatch(r"(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?", candidate) is None:
        return None
    val = float(candidate)
    return val if 0 < val < 10_000_000 else None


def image_url(raw):
    if not isinstance(raw, str) or not raw:
        return None
    try:
        u = urlsplit(raw)
        return raw if (u.scheme == "https" and
                       (u.hostname == "f.nooncdn.com" or
                        str(u.hostname).endswith(".nooncdn.com"))) else None
    except ValueError:
        return None


def sample_hit(raw, market):
    if not isinstance(raw, dict):
        return None
    sku = str(raw.get("sku") or raw.get("sku_config") or "").upper()
    if not SKU_RE.fullmatch(sku):
        return None
    title = raw.get("name")
    if not isinstance(title, str) or not 4 <= len(title.strip()) <= 350:
        return None
    pdp = raw.get("pdp_url")
    uri = None
    if isinstance(pdp, str) and len(pdp) < 1300:
        uri = urljoin(BASE + ("/uae-en/" if market == "AE" else "/saudi-en/"),
                      pdp)
        if not allowed_noon_url(uri):
            uri = None
    p = amount(raw.get("price"))
    sale = amount(raw.get("sale_price"))
    current = sale if sale and (p is None or sale <= p) else p
    return {
        "sku": sku,
        "title": title.strip()[:180],
        "sourceProductUrl": uri,
        "imageUrl": image_url(raw.get("image_url")),
        "referencePrice": p,
        "salePrice": sale,
        "displayPriceCandidate": current,
        "currencyClaim": str(raw.get("currency") or "") or None,
        "sourceMarketHeader": market,
        "priceVerifiedByPDP": False,
        "customerPublishable": False,
    }


def source_get(session, url, headers=None, params=None, name="", timeout=12):
    observation = {"stage": name}
    started = time.monotonic()
    REPORT["attempts"] += 1
    try:
        response = session.get(url, headers=headers or {}, params=params,
                               timeout=timeout, allow_redirects=False)
        observation["status"] = response.status_code
        observation["httpVersion"] = str(response.http_version)[:20]
        observation["contentType"] = str(response.headers.get("content-type") or "")[:80]
        observation["bodyBytes"] = len(response.content)
        observation["finalOriginValid"] = allowed_noon_url(str(response.url))
        if not observation["finalOriginValid"]:
            observation["state"] = "INVALID_RESPONSE_ORIGIN"
            return observation, None
        if response.status_code != 200:
            observation["state"] = (
                "DENIED_403" if response.status_code == 403
                else "THROTTLED_429" if response.status_code == 429
                else "HTTP_" + str(response.status_code)
            )
            return observation, None
        if len(response.content) > MAX_BYTES:
            observation["state"] = "BODY_LIMIT_EXCEEDED"
            return observation, None
        observation["bodySha256"] = hashlib.sha256(response.content).hexdigest()
        observation["state"] = "HTTP_200_BODY_RECEIVED"
        return observation, response.content
    except Exception as exc:
        observation["state"] = classify_error(exc)
        observation["exceptionType"] = type(exc).__name__[:60]
        return observation, None
    finally:
        observation["elapsedMs"] = round((time.monotonic() - started) * 1000)
        REPORT["stages"].append(observation)


def api_headers(market):
    # Exact minimal headers used by the independent NoonMCP source.
    locale = "en-ae" if market == "AE" else "en-sa"
    locale_path = "uae-en" if market == "AE" else "saudi-en"
    return {
        "accept": "application/json, text/plain, */*",
        "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
        "x-locale": locale,
        "x-mp-country": market.lower(),
        "referer": f"{BASE}/{locale_path}/",
    }


def search_market(session, market):
    obs, body = source_get(
        session, API + "/search", headers=api_headers(market),
        params={"q": QUERY, "limit": LIMIT, "page": 1},
        name=f"{market}_search_v3_exact_NoonMCP_config",
    )
    if body is None:
        return obs, []
    if "json" not in obs.get("contentType", "").lower():
        obs["state"] = "HTTP_200_NON_JSON"
        return obs, []
    try:
        raw = json.loads(body)
    except (UnicodeDecodeError, ValueError):
        obs["state"] = "JSON_DECODE_ERROR"
        return obs, []
    if not isinstance(raw, dict):
        obs["state"] = "INVALID_JSON_ROOT"
        return obs, []
    hits = raw.get("hits")
    obs["topLevelKeys"] = sorted(str(k)[:50] for k in raw)[:20]
    obs["reportedTotal"] = raw.get("nbHits") if isinstance(raw.get("nbHits"), (int, float)) else None
    if not isinstance(hits, list):
        obs["state"] = "MISSING_HITS_ARRAY"
        return obs, []
    good = [x for hit in hits if (x := sample_hit(hit, market))]
    obs["rawHits"] = len(hits)
    obs["parsedSkuHits"] = len(good)
    obs["hasPriceCandidate"] = sum(x["displayPriceCandidate"] is not None for x in good)
    obs["hasImage"] = sum(x["imageUrl"] is not None for x in good)
    obs["sample"] = good[:3]
    obs["marketVerifiedByResponse"] = False  # locale header alone never proves geo.
    obs["state"] = "LIVE_CATALOG_HITS_UNVERIFIED_MARKET" if good else "NO_VALID_CATALOG_HITS"
    return obs, good


def html_search_fallback(session, market):
    path = "uae-en" if market == "AE" else "saudi-en"
    obs, body = source_get(
        session, f"{BASE}/{path}/search/?q=laptop",
        headers={"accept": "text/html,application/xhtml+xml"},
        name=f"{market}_public_search_html",
    )
    if body is None:
        return obs
    if not obs.get("contentType", "").lower().startswith("text/html"):
        obs["state"] = "NON_HTML"
        return obs
    soup = BeautifulSoup(body, "html.parser")
    anchors = [x.get("href") for x in soup.select('a[href*="/p/"]')[:1000]]
    obs["productLikeLinks"] = len(anchors)
    obs["marketProductLinks"] = sum(1 for x in anchors if
        isinstance(x, str) and f"/{path}/" in x and (
            allowed_noon_url(urljoin(BASE, x)) or x.startswith("/")))
    obs["state"] = "HTML_PRODUCT_LINKS_UNVERIFIED_PRICES" if obs["marketProductLinks"] else "HTML_NO_PRODUCT_LINKS"
    return obs


started = time.monotonic()
try:
    with requests.Session(impersonate="chrome") as session:
        warm, body = source_get(session, BASE + "/uae-en/",
                                name="AE_storefront_warmup")
        if body is None or "html" not in warm.get("contentType", "").lower():
            REPORT["conclusion"] = "WARMUP_UNAVAILABLE"
        else:
            warm["sessionCookieCount"] = min(100, len(session.cookies))
            ae, ae_hits = search_market(session, "AE")
            if ae_hits:
                REPORT["conclusion"] = "AE_LIVE_PRODUCT_DATA_ACQUIRED_UNVERIFIED_PRICE"
                # Saudi is a distinct source market, not a copy of UAE.
                sa, sa_hits = search_market(session, "SA")
                REPORT["saLiveHits"] = len(sa_hits)
                if sa_hits:
                    REPORT["conclusion"] = "AE_AND_SA_LIVE_PRODUCT_DATA_ACQUIRED"
                # Verify independent product API access, without assuming
                # source price represents current checkout buybox.
                sku = ae_hits[0]["sku"]
                pdp, pdp_body = source_get(
                    session, API + "/product/" + sku,
                    headers=api_headers("AE"), name="AE_first_product_details"
                )
                if pdp_body and "json" in pdp.get("contentType", "").lower():
                    try:
                        details = json.loads(pdp_body)
                        p = details.get("product") if isinstance(details, dict) else None
                        variants = p.get("variants") if isinstance(p, dict) else None
                        pdp["productSkuMatches"] = str((p or {}).get("sku") or "").upper() == sku
                        pdp["variantCount"] = len(variants) if isinstance(variants, list) else None
                        pdp["offerCount"] = sum(len(v.get("offers") or []) for v in variants
                            if isinstance(v, dict)) if isinstance(variants, list) else None
                        pdp["state"] = "PDP_PRODUCT_STRUCTURE_OBSERVED_NOT_PRICE_PARITY"
                    except (ValueError, TypeError):
                        pdp["state"] = "PDP_JSON_INVALID"
            else:
                # Distinct, ordinary HTML route, not a retry of a rejected API.
                html_search_fallback(session, "AE")
                REPORT["conclusion"] = "NO_VERIFIED_PRODUCT_DATA_ACQUIRED"
except Exception as exc:
    REPORT["conclusion"] = classify_error(exc)
finally:
    REPORT["elapsedMs"] = round((time.monotonic() - started) * 1000)
    with open(OUTPUT, "w", encoding="utf8") as handle:
        json.dump(REPORT, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(json.dumps(REPORT, ensure_ascii=False, indent=2))
    if not REPORT["conclusion"].startswith(("AE_LIVE_PRODUCT_DATA_ACQUIRED",
                                            "AE_AND_SA_LIVE_PRODUCT_DATA_ACQUIRED")):
        raise SystemExit(1)
