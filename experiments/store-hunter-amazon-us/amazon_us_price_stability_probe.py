#!/usr/bin/env python3
"""Bounded independent re-observation of real Amazon PDP price + image evidence.

The 2 ASINs originate in the exact historical live 200 search run 41919591084.
Requires two independently fetched PDP observations. This is not a substitute
for discovering products in real-time Amazon search or verifying the final cart.
"""
import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from nawaa_store_hunter import Scraper, parse_amazon_us_pdp

ASINS = ("B0C3HCD34R", "B0CZPLV566")

async def main():
    scraper = Scraper("https://www.amazon.com", "wireless headphones", 2, 1, "never", "none")
    data = []
    try:
        await scraper.prepare()
        for asin in ASINS:
            observations = []
            for pass_number in (1, 2):
                url = f"https://www.amazon.com/dp/{asin}"
                html = await scraper.fetch("pdp-reobservation", url)
                products = parse_amazon_us_pdp(html, url) if html else []
                # Require the exact ASIN, price and nonplaceholder image. The
                # parser rejects missing or conflicting primary-price evidence.
                relevant = [p for p in products if p.sku == asin and p.url.endswith("/dp/" + asin)]
                product = relevant[0] if len(relevant) == 1 else None
                observations.append({
                    "pass": pass_number,
                    "observed_utc": datetime.now(timezone.utc).isoformat(),
                    "http_success": bool(html),
                    "asin_bound": bool(product),
                    "image": bool(product and product.image),
                    "price": product.price if product and product.price and product.currency == "USD" else None,
                    "currency": product.currency if product and product.price else None,
                    "price_status": product.price_status if product else "unresolved",
                    "issues": product.issues if product else ["NO_ASIN_BOUND_PRODUCT_EVIDENCE"],
                })
                if pass_number == 1:
                    await asyncio.sleep(1.0)
            good = [x for x in observations if x["price"] and x["image"] and x["asin_bound"]]
            matching = len(good) == 2 and good[0]["price"] == good[1]["price"] and good[0]["currency"] == good[1]["currency"]
            data.append({
                "asin": asin,
                "observations": observations,
                "two_observation_price_agreement": matching,
                "evidence_status": "TWO_PDP_OBSERVATIONS_AGREE" if matching else
                                   "INSUFFICIENT_OR_CONFLICTING_PRIMARY_PRICE_EVIDENCE"
            })
    finally:
        await scraper.close()

    summary = {
        "tested_utc": datetime.now(timezone.utc).isoformat(),
        "source_search_run": 41919591084,
        "sample_asins": len(ASINS),
        "two_observation_agreements": sum(x["two_observation_price_agreement"] for x in data),
        "results": data,
        "note": "Two agreement observations are provisional, not search-to-PDP parity or proof of continuous availability."
    }
    Path("artifacts").mkdir(exist_ok=True)
    Path("artifacts/amazon-us-pdp-reobservations.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    asyncio.run(main())
