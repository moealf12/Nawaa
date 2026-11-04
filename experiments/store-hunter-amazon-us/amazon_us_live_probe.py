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
from nawaa_store_hunter import Scraper

async def main():
    query = os.environ.get("AMAZON_US_QUERY", "wireless headphones")
    scraper = Scraper(
        "https://www.amazon.com", query, maximum=5, pages=1,
        browser="auto", pdp="all", search_url="https://www.amazon.com/s?k={query}"
    )
    # Do not spray generic non-Amazon search routes.
    scraper.search_targets = lambda _: [("https://www.amazon.com/s", {"k": query})]
    try:
        result = await scraper.search()
    except Exception as exc:
        result = {
            "store": "https://www.amazon.com", "query": query,
            "status": "probe_error", "products": [], "count": 0,
            "diagnostics": [{"method": "probe", "status": type(exc).__name__,
                             "detail": str(exc)[:180]}]
        }
    finally:
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
