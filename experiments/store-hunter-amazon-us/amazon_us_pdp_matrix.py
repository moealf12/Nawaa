#!/usr/bin/env python3
"""Amazon US real public PDP diagnostic matrix; no marketplace integration.

Four distinct ASINs obtained from actual Amazon search HTTP 200 in
GitHub Actions run 41919591084; no fabricated products or prices.
Do not infer offer availability from HTTP 200 or unrelated price nodes.
"""
import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from bs4 import BeautifulSoup
from nawaa_store_hunter import Scraper, parse_amazon_us_pdp

OBSERVED_ASINS = (
    "B0FQFB8FMG",  # AirPods Pro 3 (live search observation)
    "B0C3HCD34R",  # soundcore Q20i
    "B0HHS6TH1Q",  # TRAUSI earbuds
    "B0CZPLV566",  # Beats Solo 4
)

async def main():
    scraper = Scraper("https://www.amazon.com", "wireless headphones",
                      maximum=4, pages=1, browser="never", pdp="none")
    records = []
    try:
        await scraper.prepare()
        for asin in OBSERVED_ASINS:
            url = f"https://www.amazon.com/dp/{asin}"
            record = {"asin": asin, "html_received": False, "title_present": False,
                      "identity_bound": False, "image_present": False, "buybox_price_present": False,
                      "other_price_nodes": 0, "price_region_nodes": 0,
                      "availability_signal": "unknown", "parser_issues": []}
            html = await scraper.fetch("matrix-pdp", url)
            if html:
                record["html_received"] = True
                soup = BeautifulSoup(html, "html.parser")
                record["title_present"] = bool(soup.select_one("#productTitle"))
                offers = parse_amazon_us_pdp(html, url)
                record["identity_bound"] = bool(offers)
                record["image_present"] = any(bool(p.image) for p in offers)
                record["buybox_price_present"] = any(bool(p.price and p.currency == "USD") for p in offers)
                record["parser_issues"] = sorted({x for p in offers for x in p.issues})[:8]
                record["other_price_nodes"] = len(soup.select("span.a-price:not(.a-text-price) span.a-offscreen"))
                record["price_region_nodes"] = len(soup.select(
                    "#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen, "
                    "#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen, "
                    "#apex_desktop .a-price:not(.a-text-price) .a-offscreen, "
                    "#priceblock_ourprice, #priceblock_dealprice, #price_inside_buybox"))
                # Stock signal remains informational, never treated as proof of price.
                region = soup.select_one("#availability, #outOfStock")
                if region:
                    t = region.get_text(" ", strip=True).casefold()
                    if "currently unavailable" in t or "out of stock" in t:
                        record["availability_signal"] = "unavailable_phrase"
                    elif "in stock" in t:
                        record["availability_signal"] = "in_stock_phrase"
            records.append(record)
            print(json.dumps(record, ensure_ascii=False, sort_keys=True))
    finally:
        await scraper.close()
    summary = {"observed_utc": datetime.now(timezone.utc).isoformat(),
               "source_observation_run": 41919591084,
               "sample_size": len(OBSERVED_ASINS), "results": records,
               "pdp_http_ok": sum(bool(x["html_received"]) for x in records),
               "asin_bound": sum(bool(x["identity_bound"]) for x in records),
               "with_image": sum(bool(x["image_present"]) for x in records),
               "with_main_price": sum(bool(x["buybox_price_present"]) for x in records),
               "full_acceptance": sum(bool(x["identity_bound"] and x["image_present"] and x["buybox_price_present"])
                                      for x in records)}
    Path("artifacts").mkdir(exist_ok=True)
    Path("artifacts/amazon-us-pdp-matrix.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("SUMMARY " + json.dumps({k:v for k,v in summary.items() if k!="results"}, sort_keys=True))

if __name__ == "__main__":
    asyncio.run(main())
