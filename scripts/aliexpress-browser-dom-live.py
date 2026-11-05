#!/usr/bin/env python3
"""Isolated Chromium/Playwright rendered DOM evidence for one public AliExpress PDP.

A real browser executes ordinary first-party JavaScript, but no CAPTCHA solving,
stealth plugin, challenge-token replay, login, proxies, or merchant data writes.
Only an explicitly allowlisted item document may navigate. Other origins are
blocked. Any actual DOM price is diagnostic until same-item variant/buybox and
source price parity are independently established.
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from curl_cffi import requests

ROOT = Path(__file__).resolve().parent


def _load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


pdp = _load_module("aliexpress_browser_pdp", "aliexpress-pdp-evidence-live.py")
dom = _load_module("aliexpress_browser_dom", "aliexpress-pdp-dom.py")
shared = _load_module("aliexpress_browser_shared", "aliexpress-public-html-live.py")

ITEM_ID = re.compile(r"^\d{10,20}$")
PDP_HOSTS = frozenset({
    "ar.aliexpress.com", "www.aliexpress.com", "m.aliexpress.com",
    "www.aliexpress.us", "aliexpress.com", "aliexpress.us",
})
MAX_RENDERED_HTML = 3_500_000


def approved_resource(url, *, navigation, requested_host, item_id):
    """Fail closed on untrusted navigation and block out-of-merchant assets."""
    try:
        parsed = urlsplit(url)
        host = (parsed.hostname or "").lower()
        if parsed.scheme != "https" or parsed.username or parsed.password:
            return False
        if parsed.port not in (None, 443):
            return False
        if navigation:
            return (
                host == requested_host
                and dom.canonical_item_id(url, url) == item_id
            )
        return (
            host in PDP_HOSTS
            or host.endswith(".aliexpress.com")
            or host.endswith(".aliexpress.us")
            or host.endswith(".alicdn.com")
            or host.endswith(".aliexpress-media.com")
        )
    except (ValueError, TypeError):
        return False


def classify_rendered_dom(html, page_url, item_id, status=200):
    """Pure classifier; challenge/redirect HTML never produces a product price."""
    result = {
        "state": "UNVERIFIED",
        "finalItemId": dom.canonical_item_id(page_url, page_url),
        "identityVerified": False,
        "customerPublishable": False,
        "pdpPriceVerified": False,
        "dom": None,
        "jsonLd": None,
    }
    if status != 200:
        result["state"] = "BROWSER_PDP_HTTP_UNAVAILABLE"
        return result
    if not isinstance(html, str) or len(html) > MAX_RENDERED_HTML:
        result["state"] = "BROWSER_PDP_RENDERED_HTML_UNAVAILABLE"
        return result
    if result["finalItemId"] != item_id:
        result["state"] = "BROWSER_PDP_FINAL_ITEM_ID_MISMATCH"
        return result
    if shared.CHALLENGE.search(html):
        result["state"] = "BROWSER_PDP_CHALLENGE_NOT_CATALOG"
        return result

    dom_evidence = dom.read_pdp_dom_evidence(html, item_id, page_url)
    jsonld = pdp.safely_matched_product_jsonld(html, item_id)
    result["dom"] = dom_evidence
    result["jsonLd"] = jsonld
    result["identityVerified"] = (
        dom_evidence.get("identityState") == "SAME_ITEM_CANONICAL_ATTESTED"
    )
    if dom_evidence.get("state") == "DOM_CANONICAL_ID_CONFLICT":
        result["state"] = "BROWSER_PDP_CANONICAL_ID_CONFLICT"
        return result
    dprice = dom_evidence.get("priceCandidate")
    jprice = jsonld.get("priceEvidence")
    if dprice and jprice and (
        dprice["priceOriginal"] != jprice["priceOriginal"]
        or dprice["currency"] != jprice["currency"]
    ):
        result["state"] = "BROWSER_PDP_DOM_JSONLD_PRICE_CONFLICT"
    elif dom_evidence.get("state") == "DOM_PRICE_EVIDENCE_CONFLICT":
        result["state"] = "BROWSER_PDP_DOM_INTERNAL_PRICE_CONFLICT"
    elif dprice:
        result["state"] = (
            "BROWSER_PDP_VARIANT_AMBIGUOUS"
            if dom_evidence.get("state") == "DOM_PRICE_CANDIDATE_VARIANT_AMBIGUOUS"
            else "BROWSER_PDP_PRICE_CANDIDATE_NOT_BUYBOX_VERIFIED"
        )
    elif jprice:
        result["state"] = "BROWSER_PDP_JSONLD_ONLY_PRICE_CANDIDATE"
    else:
        result["state"] = "BROWSER_PDP_PRICE_NOT_ATTESTED"
    return result


async def inspect_browser(url, item_id, report):
    """Browser network is bounded to merchant/CDN origins; no login or bypass."""
    from playwright.async_api import async_playwright

    requested_host = urlsplit(url).hostname
    blocked = {"navigation": 0, "thirdParty": 0}
    main_document_requests = 0
    async with async_playwright() as api:
        browser = await api.chromium.launch(headless=True)
        try:
            context = await browser.new_context(
                locale="ar-SA", java_script_enabled=True,
                service_workers="block",
                accept_downloads=False,
                user_agent=shared.USER_AGENT,
                viewport={"width": 1280, "height": 800},
                ignore_https_errors=False,
            )
            await context.set_extra_http_headers({
                "Accept-Language": "ar-SA,ar;q=0.9,en;q=0.5"
            })

            # Playwright route() may observe only the FIRST URL in a 30x
            # redirect chain. CDP Fetch interception at Request stage also
            # catches redirected document requests before sending them out.
            page = await context.new_page()
            cdp = await context.new_cdp_session(page)
            pending = set()

            async def enforce_request(evt):
                nonlocal main_document_requests
                request_id = evt.get("requestId")
                url = evt.get("request", {}).get("url", "")
                is_document = evt.get("resourceType") == "Document"
                if is_document:
                    main_document_requests += 1
                approved = approved_resource(
                    url, navigation=is_document,
                    requested_host=requested_host, item_id=item_id
                ) and (not is_document or main_document_requests <= 3)
                if not approved:
                    blocked["navigation" if is_document else "thirdParty"] += 1
                try:
                    if approved:
                        await cdp.send(
                            "Fetch.continueRequest", {"requestId": request_id}
                        )
                    else:
                        await cdp.send(
                            "Fetch.failRequest",
                            {"requestId": request_id, "errorReason": "BlockedByClient"},
                        )
                except Exception:
                    # A request can be cancelled while its target is closing.
                    # No cancellation is interpreted as successful acquisition.
                    report["interceptionFailureClass"] = "CDP_REQUEST_CANCELLED"

            def on_paused(evt):
                task = asyncio.create_task(enforce_request(evt))
                pending.add(task)
                task.add_done_callback(pending.discard)

            cdp.on("Fetch.requestPaused", on_paused)
            await cdp.send("Fetch.enable", {
                "patterns": [{"urlPattern": "*", "requestStage": "Request"}]
            })
            response_status = None
            try:
                response = await page.goto(
                    url, wait_until="domcontentloaded", timeout=18000
                )
                response_status = response.status if response else None
                # One short observation window for ordinary first-party JS
                # hydration. No retry, reload, click, login or challenge solve.
                await page.wait_for_timeout(1700)
            except Exception as exc:
                report["navigationFailureClass"] = type(exc).__name__[:65]
                # The document may nevertheless have loaded before timeout.
            page_url = page.url
            html = await page.content()
            report["rendering"] = {
                "engine": "playwright-chromium",
                "guardMode": "CDP_FETCH_REQUEST_STAGE_EVERY_REDIRECT",
                "javascriptEnabled": True,
                "responseStatus": response_status,
                "renderedHtmlBytes": len(html.encode("utf8")),
                "navigationRequests": main_document_requests,
                "blockedNavigationRequests": blocked["navigation"],
                "blockedThirdPartyRequests": blocked["thirdParty"],
                "finalHost": urlsplit(page_url).hostname,
                "finalItemId": dom.canonical_item_id(page_url, page_url),
            }
            if blocked["navigation"]:
                # Do not inspect HTML after even one disallowed document hop.
                # Chromium must not turn a blocked alias into price evidence.
                report["domEvidence"] = {
                    "state": "BROWSER_UNAPPROVED_DOCUMENT_REDIRECT_BLOCKED",
                    "identityVerified": False,
                    "customerPublishable": False,
                    "pdpPriceVerified": False,
                }
                report["conclusion"] = "BROWSER_UNAPPROVED_DOCUMENT_REDIRECT_BLOCKED"
            else:
                evidence = classify_rendered_dom(
                    html, page_url, item_id, response_status
                )
                report["domEvidence"] = evidence
                report["conclusion"] = evidence["state"]
            await context.close()
        finally:
            await browser.close()


async def collect(item_id):
    if not ITEM_ID.fullmatch(item_id):
        raise ValueError("INVALID_ITEM_ID")
    host = os.getenv("ALIEXPRESS_PDP_HOST", "ar.aliexpress.com")
    if host not in PDP_HOSTS:
        raise ValueError("UNAPPROVED_PDP_HOST")
    url = "https://" + host + "/item/" + item_id + ".html"
    report = {
        "schema": "nawaa.aliexpress.browser-dom-proof.v1",
        "observedUtc": datetime.now(timezone.utc).isoformat(),
        "requestedHost": host, "requestedItemId": item_id,
        "customerPublishable": False,
        "pdpPriceVerified": False,
        "aliasIdentityVerified": False,
        "captchaSolved": False, "proxyUsed": False,
        "loginAttempted": False, "retries": 0,
        "conclusion": "NOT_STARTED",
        "robots": None, "rendering": None, "domEvidence": None,
    }
    headers = {
        "user-agent": shared.USER_AGENT,
        "accept": "text/html",
        "accept-language": "ar-SA,ar;q=0.9,en;q=0.5",
    }
    try:
        with requests.Session(impersonate="chrome") as session:
            allowed, stage = pdp.verify_public_robots(session, url, headers)
            report["robots"] = stage
        if not allowed:
            report["conclusion"] = "BROWSER_PDP_ROBOTS_NOT_VERIFIED"
        else:
            await inspect_browser(url, item_id, report)
    except Exception as exc:
        report["conclusion"] = "BROWSER_PDP_RUNTIME_UNAVAILABLE"
        report["failureClass"] = type(exc).__name__[:65]
    return report


def main():
    item_id = os.getenv("ALIEXPRESS_ITEM_ID", "1005012743543835").strip()
    if not ITEM_ID.fullmatch(item_id):
        raise SystemExit("INVALID_ITEM_ID")
    result = asyncio.run(collect(item_id))
    output = Path("aliexpress-browser-dom-" + item_id + ".json")
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print("NAWAA_ALIEXPRESS_BROWSER_DOM " + json.dumps(result, ensure_ascii=False))
    # Expected merchant challenges are evidence, not a false inventory empty
    # or a reason to crash this diagnostic-only CI lane.
    if result["conclusion"] == "NOT_STARTED":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
