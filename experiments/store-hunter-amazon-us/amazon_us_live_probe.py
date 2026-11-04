#!/usr/bin/env python3
"""Bounded live Amazon US acquisition test for the standalone Store Hunter.

Only tests public routes, never rewrites production files, no logins/proxies/WAF bypass.
The only search target is www.amazon.com/s?k=wireless+headphones.
"""
import asyncio
import json
import os
from pathlib import Path
from datetime import datetime, timezone
from dataclasses import asdict
from nawaa_store_hunter import Scraper, parse_jsonld, parse_html_cards, parse_microdata, parse_meta_product, parse_amazon_us_pdp

async def main():
    query = os.environ.get("AMAZON_US_QUERY", "wireless headphones")
    scraper = Scraper(
        "https://www.amazon.com", query, maximum=5, pages=1,
        browser=os.environ.get("AMAZON_US_BROWSER", "never"), pdp="all",
        search_url="https://www.amazon.com/s?k={query}"
    )
    # Do not spray generic non-Amazon search routes.
    scraper.search_targets = lambda _: [("https://www.amazon.com/s", {"k": query})]
    browser_diagnostic = {"attempted": False, "html_received": False, "parsed_items": 0}
    # This ASIN was observed in the prior 2026-11-04 LIVE Amazon search artifact.
    # It is diagnostic-only, not a hardcoded product for the universal scraper.
    pdp_diagnostic = {"attempted": False, "html_received": False,
                      "structured_candidates": 0, "pdp_asin_bound_candidates": 0, "pdp_main_buybox_prices": 0, "pdp_verified_images": 0,
                      "candidates_with_price": 0,
                      "candidates_with_image": 0, "dom_price_nodes": 0}
    try:
        result = await scraper.search()
        # Single diagnostic retry with an ordinary Chromium browser, NOT stealth,
        # proxies, CAPTCHA solving, or identity spoofing.
        if scraper.browser != "never" and result.get("count", 0) == 0 and any(
            d.get("method") == "search-html" and d.get("status") == "HTTP_ERROR"
            for d in result.get("diagnostics", [])
        ):
            from urllib.parse import quote
            url = "https://www.amazon.com/s?k=" + quote(query)
            browser_diagnostic["attempted"] = True
            html = await scraper.browser_fetch(url)
            browser_diagnostic["html_received"] = bool(html)
            if html:
                candidates = parse_jsonld(html, url) + parse_html_cards(
                    html, url, "https://www.amazon.com", 5
                )
                browser_diagnostic["parsed_items"] = len(candidates)
                browser_diagnostic["complete_items"] = sum(
                    bool(p.title and p.url and p.price and p.currency == "USD" and p.image)
                    for p in candidates
                )
        # If search is unavailable, test ONE known public PDP to separate
        # discovery-route denial from page parsing. No full-page artifacts.
        if result.get("count", 0) == 0:
            pdp_url = "https://www.amazon.com/dp/B0C3HCD34R"
            pdp_diagnostic["attempted"] = True
            body = await scraper.fetch("pdp-diagnostic", pdp_url)
            if body:
                pdp_diagnostic["html_received"] = True
                from bs4 import BeautifulSoup
                parsed = parse_jsonld(body, pdp_url) + parse_microdata(body, pdp_url) + parse_meta_product(body, pdp_url)
                amazon_pdp = parse_amazon_us_pdp(body, pdp_url)
                pdp_diagnostic["pdp_asin_bound_candidates"] = len(amazon_pdp)
                pdp_diagnostic["pdp_main_buybox_prices"] = sum(bool(p.price and p.currency) for p in amazon_pdp)
                pdp_diagnostic["pdp_verified_images"] = sum(bool(p.image) for p in amazon_pdp)
                pdp_diagnostic["pdp_parser_issues"] = sorted({issue for p in amazon_pdp for issue in p.issues})
                soup = BeautifulSoup(body, "html.parser")
                pdp_diagnostic["price_region_nodes"] = {
                    "corePrice_feature": len(soup.select("#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen")),
                    "corePriceDisplay_desktop": len(soup.select("#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen")),
                    "apex_desktop": len(soup.select("#apex_desktop .a-price:not(.a-text-price) .a-offscreen")),
                    "centerCol": len(soup.select("#centerCol .a-price:not(.a-text-price) .a-offscreen")),
                    "buybox": len(soup.select("#buybox .a-price:not(.a-text-price) .a-offscreen")),
                    "priceblock_dealprice": len(soup.select("#priceblock_dealprice")),
                    "priceblock_ourprice": len(soup.select("#priceblock_ourprice")),
                }
                pdp_diagnostic["has_main_title"] = bool(soup.select_one("#productTitle"))
                pdp_diagnostic["has_selected_asin"] = bool(soup.select_one("input#ASIN[value], input[name='ASIN'][value]"))
                pdp_diagnostic["has_canonical"] = bool(soup.select_one("link[rel='canonical'][href]"))

                pdp_diagnostic["structured_candidates"] = len(parsed)
                pdp_diagnostic["candidates_with_price"] = sum(bool(p.price and p.currency) for p in parsed)
                pdp_diagnostic["candidates_with_image"] = sum(bool(p.image) for p in parsed)
                pdp_diagnostic["dom_price_nodes"] = len(BeautifulSoup(body, "html.parser").select("span.a-price:not(.a-text-price) span.a-offscreen"))
    except Exception as exc:
        result = {
            "store": "https://www.amazon.com", "query": query,
            "status": "probe_error", "products": [], "count": 0,
            "diagnostics": [{"method": "probe", "status": type(exc).__name__,
                             "detail": str(exc)[:180]}]
        }
    finally:
        # Rehydrate diagnostics AFTER the separate browser probe; search() returns
        # a pre-browser snapshot and would otherwise hide the second outcome.
        if scraper.diagnostics:
            result["diagnostics"] = [asdict(d) for d in scraper.diagnostics]
        await scraper.close()
    products = result.get("products", [])
    complete = [
        p for p in products if p.get("title") and p.get("url")
        and p.get("price") and p.get("currency") == "USD" and p.get("image")
    ]
    correlated = [p for p in complete if p.get("price_status") == "evidence_correlated"]
    summary = {
        "tested_utc": datetime.now(timezone.utc).isoformat(),
        "target": "https://www.amazon.com",
        "query": query,
        "source": "LIVE_REMOTE_HTTP",
        "status": result.get("status"),
        "browser_diagnostic": browser_diagnostic,
        "pdp_diagnostic": pdp_diagnostic,
        "count": len(products),
        "priced_usd_with_image": len(complete),
        "pdp_correlated": len(correlated),
        "challenge_or_access_denied": any(
            d.get("status") in ("CHALLENGE_PAGE", "BLOCKED_OR_RATE_LIMITED",
                                "ROBOTS_DENIED_OR_UNSAFE", "unavailable")
            for d in result.get("diagnostics", [])
        ),
        "diagnostics": result.get("diagnostics", []),
        "products": products,
        "acceptance": "PASS" if complete else "FAIL_NO_COMPLETE_LIVE_PRODUCT",
    }
    Path("artifacts").mkdir(exist_ok=True)
    Path("artifacts/amazon-us-live.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    public_summary = {k: v for k, v in summary.items() if k not in {"products", "diagnostics"}}
    public_summary["diagnostics"] = [
        {"method": d.get("method"), "status": d.get("status"),
         "found": d.get("found", 0), "elapsed_ms": d.get("elapsed_ms", 0)}
        for d in summary["diagnostics"]
    ]
    print(json.dumps(public_summary, ensure_ascii=False, indent=2))
    gh_summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if gh_summary:
        with open(gh_summary, "a", encoding="utf-8") as f:
            f.write("## Isolated Amazon US LIVE test\n")
            f.write("| Metric | Value |\n|---|---|\n")
            for k in ["tested_utc", "status", "count", "priced_usd_with_image", "pdp_correlated", "acceptance"]:
                f.write(f"| {k} | {summary[k]} |\n")
            f.write("\nNo production changes, no merge, no fake product fixtures.\n")
    # This gate intentionally fails if the live extractor could not obtain a complete item.
    raise SystemExit(0 if complete else 1)

if __name__ == "__main__":
    asyncio.run(main())
