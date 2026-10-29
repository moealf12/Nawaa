"""Isolated experiment for the third user-provided Noon scraper revision.

Checks v2 Stealth per-page compatibility on local HTML. Tests plain Chromium
with --disable-http2 against the one user-provided public search URL. No TLS
verification bypass, user-agent rotation, retries, proxy, access-control or
challenge circumvention. Never publishes source prices.
"""
from __future__ import annotations

import json
import re
import time
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

SEARCH_URL="https://www.noon.com/saudi-en/search/?q=Laptop"

def browser_reason(error):
    match=re.search(r"net::ERR_[A-Z0-9_]+",str(error))
    if match:
        return match.group(0)
    if "Timeout" in str(error):
        return "TIMEOUT"
    return type(error).__name__

def local_stealth_compatibility():
    from playwright_stealth import Stealth
    obj=Stealth()
    result={"stealth_class":type(obj).__name__,
            "has_apply_to_sync":callable(getattr(obj,"apply_to_sync",None)),
            "has_apply_stealth_sync":callable(getattr(obj,"apply_stealth_sync",None)),
            "has_use_sync":callable(getattr(obj,"use_sync",None))}
    with sync_playwright() as p:
        b=p.chromium.launch(headless=True)
        try:
            page=b.new_page()
            try:
                # Reproduce the exact proposed page-scoped method on a static
                # local fixture only; never on a refused merchant endpoint.
                if result["has_apply_to_sync"]:
                    obj.apply_to_sync(page)
                    result["proposed_call"]="PASS"
                else:
                    result["proposed_call"]="METHOD_MISSING"
            except Exception as exc:
                result["proposed_call"]="ERROR"
                result["error_class"]=type(exc).__name__
            if result["has_apply_stealth_sync"]:
                try:
                    obj.apply_stealth_sync(page)
                    result["supported_page_call"]="PASS"
                except Exception as exc:
                    result["supported_page_call"]="ERROR"
                    result["supported_page_error_class"]=type(exc).__name__
            else:
                result["supported_page_call"]="METHOD_MISSING"
            page.set_content("<html><h1>Local fixture</h1></html>")
            result["local_chromium"]=(
                "PASS" if page.locator("h1").inner_text()=="Local fixture"
                else "FAILED"
            )
        finally:
            b.close()
    return result

def isolated_http2_diagnostic():
    started=time.monotonic()
    stage="LAUNCH"
    try:
        with sync_playwright() as p:
            # Transport-only flag under test. Certificate validation stays ON,
            # and no Stealth/AutomationControlled alteration is applied.
            b=p.chromium.launch(headless=True,args=["--disable-http2"])
            try:
                stage="CONTEXT"
                context=b.new_context(locale="en-SA",viewport={"width":1366,"height":768})
                try:
                    page=context.new_page()
                    stage="GOTO"
                    response=page.goto(SEARCH_URL,wait_until="domcontentloaded",timeout=20000)
                    status=response.status if response else None
                    result={"stage":stage,"http_status":status,
                            "status":f"HTTP_{status}" if status else "NO_RESPONSE"}
                    if status==200:
                        stage="RENDER"
                        html=page.content()
                        result["html_chars"]=len(html)
                        result["has_search_heading"]=bool(re.search(
                            r"<h1[^>]*>\s*laptop\s*</h1>",html,re.I))
                        result["has_source_price_nodes"]="plp-product-box-price" in html
                        result["has_source_title_nodes"]="plp-product-box-name" in html
                    result["elapsed_ms"]=round((time.monotonic()-started)*1000)
                    return result
                finally:
                    context.close()
            finally:
                b.close()
    except Exception as exc:
        return {"status":"BROWSER_EXCEPTION","stage":stage,
                "reason":browser_reason(exc),
                "elapsed_ms":round((time.monotonic()-started)*1000)}

if __name__=="__main__":
    print(json.dumps({"kind":"local_stealth_api",**local_stealth_compatibility()}))
    print(json.dumps({"kind":"chromium_disable_http2",**isolated_http2_diagnostic()}))
