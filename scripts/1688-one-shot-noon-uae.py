#!/usr/bin/env python3
"""One-shot 1688 extraction transport comparison using Noon UAE's session pattern.

One homepage warmup plus one search request. No retries, proxy, challenge bypass,
following cross-origin redirects, raw HTML artifacts, or product publication.
Site-owner permission is reported by NAWAA; technical API access is unverified.
"""
import json
import os
import re
import time
from datetime import datetime, timezone
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup
from curl_cffi import requests
from lxml import html as lxml_html

HOME = "https://www.1688.com/"
SEARCH = "https://s.1688.com/selloffer/offer_search.htm?keywords=%C0%B6%D1%C0%B6%FA%BB%FA"
REPORT = "1688-one-shot-noon-uae.json"
LIMIT = 2_000_000
OFFER = re.compile(r"^/offer/([0-9]{6,20})\.html$")
CHALLENGE = re.compile(r"punish|cloud_ip_bl|请登录|captcha|安全验证|人机验证|访问异常", re.I)
HEADERS = {
    "user-agent": "NAWAA-PublicSourceIndexer/1.0 (+https://github.com/moealf12/Nawaa)",
    "accept": "text/html,application/xhtml+xml",
    "accept-language": "zh-CN,zh;q=0.9",
}
result = {
    "schema": "nawaa.1688.noon-uae-single-probe.v1",
    "headSha": os.getenv("PULL_REQUEST_HEAD_SHA"),
    "observedAt": datetime.now(timezone.utc).isoformat(),
    "sourceId": "1688-cn",
    "mode": "noon_uae_chrome_tls_session_html",
    "queryEncoding": "GB18030",
    "maxRequests": 2, "requests": 0, "retries": 0,
    "proxies": False, "followRedirects": False,
    "sourceRobotsCleared": False,
    "customerPublished": False, "pdpPriceVerified": 0,
    "stages": [],
}


def key(href, base):
    if not isinstance(href, str) or len(href) > 2000:
        return None
    try:
        u = urlsplit(urljoin(base, href))
        if (u.scheme != "https" or u.hostname != "detail.1688.com"
                or u.username or u.password or u.port not in (None, 443)):
            return None
        m = OFFER.fullmatch(u.path)
        return m.group(1) if m else None
    except ValueError:
        return None


def parse(body, search_url):
    soup = BeautifulSoup(body, "lxml")
    tree = lxml_html.fromstring(body, parser=lxml_html.HTMLParser(
        recover=True, no_network=True))
    ids_a = {v for a in soup.select("a[href]")[:2400]
             if (v := key(a.get("href"), search_url))}
    ids_b = {v for href in tree.xpath("//a/@href")[:2400]
             if (v := key(href, search_url))}
    scripts = soup.select("script")[:100]
    first_bytes = body[:120_000].decode("utf-8", "replace")
    return {
        "htmlBytes": len(body),
        "bs4OfferLinks": len(ids_a),
        "lxmlOfferLinks": len(ids_b),
        "parserAgreement": ids_a == ids_b,
        "independentParserIntersection": len(ids_a & ids_b),
        "jsonLdBlocks": len(soup.select('script[type="application/ld+json"]')),
        "hydratedOfferResultSignal": any("offerresultData" in
                                         (x.string or "")[:100_000] for x in scripts),
        "challengeShell": bool(CHALLENGE.search(first_bytes)),
        "retailPriceVerified": 0,
        "skuMoqVerified": 0,
        "state": ("CHALLENGE_OR_LOGIN_SHELL"
                  if CHALLENGE.search(first_bytes) else
                  "UNPRICED_LIVE_LINKS" if ids_a & ids_b else
                  "NO_PRODUCT_LINKS"),
    }


def category(error):
    e = str(error).lower() + type(error).__name__.lower()
    if "timeout" in e or "timed out" in e:
        return "TIMEOUT"
    if "http2" in e or "http/2" in e:
        return "HTTP2_ERROR"
    if "ssl" in e or "tls" in e:
        return "TLS_ERROR"
    return "NETWORK_ERROR"


def stage(session, name, url):
    entry = {"id": name, "host": urlsplit(url).hostname}
    result["requests"] += 1
    start = time.monotonic()
    try:
        r = session.get(url, headers=HEADERS, timeout=9, allow_redirects=False)
        entry["http"] = int(r.status_code)
        entry["httpVersion"] = str(r.http_version)
        entry["contentType"] = str(r.headers.get("content-type") or "")[:75]
        if 300 <= r.status_code < 400:
            redirect = r.headers.get("location")
            if redirect:
                u = urlsplit(urljoin(url, redirect))
                entry["redirectHost"] = u.hostname
                entry["redirectPath"] = u.path[:90]
            entry["state"] = "HTTP_3XX_REDIRECT"
        elif r.status_code == 403:
            entry["state"] = "HTTP_403_DENIED"
        elif r.status_code == 429:
            entry["state"] = "HTTP_429_LIMITED"
        elif r.status_code != 200:
            entry["state"] = "HTTP_NOT_OK"
        elif "text/html" not in entry["contentType"].lower():
            entry["state"] = "NON_HTML"
        elif len(r.content) > LIMIT:
            entry["state"] = "BODY_TOO_LARGE"
        else:
            entry["evidence"] = parse(r.content, url)
            entry["state"] = entry["evidence"]["state"]
    except Exception as error:
        entry["state"] = category(error)
    finally:
        entry["elapsedMs"] = round((time.monotonic() - start) * 1000)
        result["stages"].append(entry)
    return entry


started = time.monotonic()
try:
    with requests.Session(impersonate="chrome") as session:
        home = stage(session, "homepage_session_warmup", HOME)
        if home["state"] in ("HTTP_403_DENIED", "HTTP_429_LIMITED",
                             "CHALLENGE_OR_LOGIN_SHELL"):
            result["verdict"] = "WARMUP_ACCESS_DENIED"
        elif home.get("redirectHost") not in (None, "www.1688.com", "1688.com"):
            result["verdict"] = "WARMUP_EXTERNAL_REDIRECT"
        else:
            search = stage(session, "actual_search", SEARCH)
            result["verdict"] = search["state"]
except Exception as error:
    result["verdict"] = category(error)
finally:
    result["elapsedMs"] = round((time.monotonic() - started) * 1000)
    result["sourceRetailOffersPublished"] = 0
    with open(REPORT, "w", encoding="utf-8") as file:
        json.dump(result, file, ensure_ascii=False, indent=2)
        file.write("\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))
