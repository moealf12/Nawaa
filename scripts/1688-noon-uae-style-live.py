#!/usr/bin/env python3
"""1688 staging experiment using the Noon UAE curl_cffi HTML-session pattern.

Public read-only proof. Does NOT save raw HTML, cookies, product prices, or
catalog data. No proxy, retries, captcha solving or production writes.
"""
import json
import os
import re
import time
from datetime import datetime, timezone
from urllib.parse import quote, quote_from_bytes, urljoin, urlsplit
from urllib.robotparser import RobotFileParser

from bs4 import BeautifulSoup
from curl_cffi import requests
from lxml import html as lxml_html

USER_AGENT = "NAWAA-PublicSourceIndexer/1.0 (+https://github.com/moealf12/Nawaa)"
ROOT = "https://s.1688.com"
WWW = "https://www.1688.com"
REPORT = "1688-noon-uae-style-live.json"
MAX_BYTES = 2_000_000
OFFER_PATH = re.compile(r"^/offer/([0-9]{6,20})\.html$")
BLOCK = re.compile(r"punish|cloud_ip_bl|请登录|安全验证|人机验证|captcha|访问异常|滑块验证", re.I)
report = {
    "schema": "nawaa.1688.noon-uae-html-session.v1",
    "observedAt": datetime.now(timezone.utc).isoformat(),
    "sha": os.getenv("PULL_REQUEST_HEAD_SHA"),
    "method": "noon_uae_curl_cffi_session_html_dom",
    "source": "1688-cn", "live": True, "noProxy": True, "retries": 0,
    "customerPublished": False, "pdpPriceVerified": 0,
    "requests": 0, "robots": [], "stages": [], "conclusion": "NOT_RUN",
}


def kind(error):
    message = (type(error).__name__ + ": " + str(error)).lower()
    if "timeout" in message:
        return "TIMEOUT"
    if "http/2" in message or "http2" in message:
        return "HTTP2_FAILURE"
    if "ssl" in message or "tls" in message:
        return "TLS_FAILURE"
    return "TRANSPORT_FAILURE"


def first_party_robots(url):
    parts = urlsplit(url)
    return (parts.scheme == "https" and
            (parts.hostname == "1688.com" or parts.hostname.endswith(".1688.com")) and
            parts.path == "/robots.txt" and not parts.query and not parts.fragment and
            parts.username is None and parts.password is None and parts.port in (None, 443))


def fetch(session, url):
    report["requests"] += 1
    started = time.monotonic()
    res = session.get(url, timeout=10, allow_redirects=False, headers={
        "user-agent": USER_AGENT,
        "accept": "text/html,application/xhtml+xml,text/plain;q=0.8",
        "accept-language": "en-US,en;q=0.9",
    })
    return res, round((time.monotonic() - started) * 1000)


def check_robots(session, host, path_to_check):
    current = host + "/robots.txt"
    for hop in range(3):
        try:
            r, elapsed = fetch(session, current)
            item = {
                "host": urlsplit(current).hostname, "http": int(r.status_code),
                "hop": hop, "elapsedMs": elapsed, "httpVersion": str(r.http_version)[:35],
            }
            report["robots"].append(item)
            if r.status_code in (301, 302, 303, 307, 308):
                redirect = r.headers.get("location")
                nxt = urljoin(current, redirect) if redirect else ""
                parts = urlsplit(nxt)
                item["redirectHost"] = parts.hostname
                item["redirectPath"] = parts.path
                if not first_party_robots(nxt) or nxt == current:
                    return {"allow": False, "reason": "ROBOTS_NONFILE_REDIRECT"}
                current = nxt
                continue
            if r.status_code != 200 or "text/plain" not in r.headers.get("content-type", "").lower():
                return {"allow": False, "reason": "ROBOTS_UNAVAILABLE"}
            if len(r.content) > 250_000:
                return {"allow": False, "reason": "ROBOTS_TOO_LARGE"}
            text = r.content.decode("utf-8", "replace")
            rp = RobotFileParser()
            rp.parse(text.splitlines())
            return {
                "allow": rp.can_fetch("NAWAA-PublicSourceIndexer", path_to_check),
                "reason": "ROBOTS_ALLOWED" if rp.can_fetch("NAWAA-PublicSourceIndexer", path_to_check)
                else "ROBOTS_DISALLOWED",
            }
        except Exception as exc:
            report["robots"].append({"host": urlsplit(current).hostname, "error": kind(exc)})
            return {"allow": False, "reason": "ROBOTS_TRANSPORT_FAILED"}
    return {"allow": False, "reason": "ROBOTS_TOO_MANY_REDIRECTS"}


def offer_id(href, base):
    if not href or len(href) > 2048:
        return None
    try:
        u = urlsplit(urljoin(base, href))
        if u.scheme != "https" or u.hostname != "detail.1688.com" or u.username or u.password:
            return None
        match = OFFER_PATH.fullmatch(u.path)
        return match.group(1) if match else None
    except ValueError:
        return None


def page_evidence(data, url):
    soup = BeautifulSoup(data, "html.parser")
    tree = lxml_html.fromstring(data, parser=lxml_html.HTMLParser(recover=True, no_network=True))
    bs_ids = {
        ident for node in soup.select("a[href]")[:2500]
        if (ident := offer_id(node.get("href"), url))
    }
    lxml_ids = {
        ident for href in tree.xpath("//a/@href")[:2500]
        if (ident := offer_id(href, url))
    }
    script_text = " ".join((node.get_text() or "")[:100_000] for node in soup.select("script")[:80])
    is_block = bool(BLOCK.search(data))
    return {
        "bytes": len(data),
        "beautifulSoupProductLinks": len(bs_ids),
        "lxmlProductLinks": len(lxml_ids),
        "parserAgreement": bs_ids == lxml_ids,
        "intersectionProductLinks": len(bs_ids & lxml_ids),
        "jsonLdScriptCount": len(soup.select('script[type="application/ld+json"]')),
        "hasEmbeddedOfferResultData": "offerresultData" in script_text,
        "challengeShell": is_block,
        "priceAndMoqVerified": 0,
        "state": "ACCESS_OR_LOGIN_SHELL" if is_block else
        "PRODUCT_LINKS_OBSERVED_UNPRICED" if bs_ids & lxml_ids else
        "NO_CATALOG_LINK_EVIDENCE",
    }


def stage(session, name, url):
    out = {"id": name, "urlHost": urlsplit(url).hostname}
    started = time.monotonic()
    try:
        res, duration = fetch(session, url)
        out["status"] = int(res.status_code)
        out["httpVersion"] = str(res.http_version)[:35]
        out["elapsedMs"] = duration
        out["contentType"] = str(res.headers.get("content-type") or "")[:75]
        if res.status_code != 200:
            out["state"] = (
                "HTTP_403_ACCESS_DENIED" if res.status_code == 403 else
                "HTTP_429_RATE_LIMITED" if res.status_code == 429 else
                "HTTP_3XX_REDIRECT" if 300 <= res.status_code < 400 else
                "HTTP_NOT_OK"
            )
        elif "text/html" not in out["contentType"].lower():
            out["state"] = "UNEXPECTED_CONTENT_TYPE"
        elif len(res.content) > MAX_BYTES:
            out["state"] = "BODY_TOO_LARGE"
        else:
            out["evidence"] = page_evidence(res.content, url)
            out["state"] = out["evidence"]["state"]
    except Exception as exc:
        out["state"] = kind(exc)
    finally:
        out["elapsedTotalMs"] = round((time.monotonic() - started) * 1000)
        report["stages"].append(out)
    return out


try:
    with requests.Session(impersonate="chrome") as session:
        en_query = "headphones"
        en_search = ROOT + "/selloffer/offer_search.htm?keywords=" + quote(en_query)
        cn_query = "蓝牙耳机"
        cn_search = ROOT + "/selloffer/offer_search.htm?keywords=" + quote_from_bytes(
            cn_query.encode("gb18030"))
        sa_policy = check_robots(session, ROOT, en_search)
        report["searchRobots"] = sa_policy["reason"]
        if not sa_policy["allow"]:
            report["conclusion"] = "SEARCH_ROBOTS_NOT_CLEARED"
        else:
            www_policy = check_robots(session, WWW, WWW + "/")
            report["homeRobots"] = www_policy["reason"]
            if www_policy["allow"]:
                home = stage(session, "www_warmup", WWW + "/")
                if home.get("status") in (403, 429):
                    report["conclusion"] = "HOME_ACCESS_DENIED"
            if report["conclusion"] == "NOT_RUN":
                for ident, url in [("english_search", en_search), ("gb18030_chinese_search", cn_search)]:
                    if ident.startswith("gb18030"):
                        chinese = check_robots(session, ROOT, url)
                        if not chinese["allow"]:
                            report["conclusion"] = "CHINESE_QUERY_ROBOTS_DENIED"
                            break
                    evidence = stage(session, ident, url)
                    if evidence.get("status") in (403, 429) or evidence["state"] in (
                        "HTTP_3XX_REDIRECT", "ACCESS_OR_LOGIN_SHELL", "TRANSPORT_FAILURE",
                        "TIMEOUT", "HTTP2_FAILURE", "TLS_FAILURE",
                    ):
                        report["conclusion"] = "SEARCH_ACCESS_OR_TRANSPORT_BLOCKED"
                        break
                if report["conclusion"] == "NOT_RUN":
                    count = sum(
                        x.get("evidence", {}).get("intersectionProductLinks", 0)
                        for x in report["stages"]
                    )
                    report["conclusion"] = ("SEARCH_LINKS_ONLY_NOT_PRICED" if count else
                                            "NO_LIVE_PRODUCT_EVIDENCE")
except Exception as exc:
    report["conclusion"] = "UNEXPECTED_TRANSPORT_ERROR"
    report["errorClass"] = kind(exc)
finally:
    with open(REPORT, "w", encoding="utf-8") as file:
        json.dump(report, file, ensure_ascii=False, indent=2)
        file.write("\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))
