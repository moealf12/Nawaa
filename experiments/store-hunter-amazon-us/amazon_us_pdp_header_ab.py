#!/usr/bin/env python3
"""Controlled PDP content-negotiation A/B on ten *previously observed* public ASINs.

No disguising the crawler, proxies, anti-bot bypass, repeated challenges, raw
HTML uploads or price invention. This A/B only checks whether Amazon returns
main buybox pricing with honest Accept and Accept-Language differences.
"""
import asyncio
import json
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from nawaa_store_hunter import Scraper, parse_amazon_us_pdp

SAMPLES = (
    ("wireless headphones", "B0C3HCD34R"),
    ("iPhone 17", "B0G4RRVKQS"),
    ("Samsung Galaxy S25", "B0DSLTZFXN"),
    ("PlayStation 5 console", "B09CYLL41S"),
    ("PS5 disc drive", "B0CL5HJNLM"),
    ("JBL bluetooth speaker", "B0CTD6WMXT"),
    ("laptop 16GB RAM", "B0GMC2P6RB"),
    ("4K monitor", "B0FDDVRS59"),
    ("robot vacuum", "B09H8CWFNK"),
    ("سماعات بلوتوث", "B0BTYCRJSS"),
)
ALT_HEADERS = {
    "Accept": "text/html,application/xhtml+xml;q=0.9,application/xml;q=0.8,*/*;q=0.5",
    "Accept-Language": "en-US,en;q=0.8",
}

async def main():
    start=time.monotonic()
    scraper=Scraper("https://www.amazon.com","public PDP variant experiment",
                    maximum=1,pages=1,browser="never",pdp="none")
    records=[]
    safety_stop=False
    try:
        await scraper.prepare()
        for query, asin in SAMPLES:
            if safety_stop:
                records.append({"query":query,"asin":asin,"outcome":"NOT_RUN_SAFETY_STOP"})
                continue
            url=f"https://www.amazon.com/dp/{asin}"
            record={"query":query,"asin":asin,"observations":[]}
            for profile,headers in (("baseline",None),("en_US_content_negotiation",ALT_HEADERS)):
                before=len(scraper.diagnostics)
                html=await scraper.fetch("pdp-header-ab",url,headers=headers)
                new= [x.status for x in scraper.diagnostics[before:]]
                parsed=parse_amazon_us_pdp(html,url) if html else []
                product=parsed[0] if len(parsed)==1 and parsed[0].sku==asin else None
                observation={
                    "profile":profile, "html_received":bool(html),
                    "asin_proved":bool(product and "AMAZON_PDP_ASIN_PROOF" in product.issues),
                    "primary_price":product.price if product and product.currency=="USD" else None,
                    "image_proved":bool(product and product.image),
                    "price_regions":[x for x in (product.issues if product else [])
                                     if x.startswith("AMAZON_PDP_PRIMARY_PRICE_SOURCE_")],
                    "status_codes":new, "reason_codes":(product.issues if product else [])[:5],
                }
                record["observations"].append(observation)
                if any(x in ("BLOCKED_OR_RATE_LIMITED","CHALLENGE_PAGE","ROBOTS_DENIED_OR_UNSAFE") for x in new):
                    safety_stop=True
                    break
                await asyncio.sleep(0.65)
            base=record["observations"][0] if record["observations"] else {}
            alt=record["observations"][1] if len(record["observations"])>=2 else {}
            record["alternate_recovers_missing_price"]=bool(
                not base.get("primary_price") and alt.get("primary_price") and alt.get("asin_proved"))
            record["price_disagreement"]=bool(
                base.get("primary_price") and alt.get("primary_price")
                and base["primary_price"] != alt["primary_price"])
            records.append(record)
            print("AB_INTENT "+json.dumps({
                "query":query,"asin":asin,"base_price":base.get("primary_price"),
                "alt_price":alt.get("primary_price"),
                "alt_recovers":record["alternate_recovers_missing_price"],
                "conflict":record["price_disagreement"],
                "baseline_status":base.get("status_codes"),"alt_status":alt.get("status_codes")
            },ensure_ascii=False),flush=True)
            if not safety_stop:
                await asyncio.sleep(0.85)
    finally:
        await scraper.close()
    completed=[r for r in records if "observations" in r]
    summary={
        "tested_utc":datetime.now(timezone.utc).isoformat(),
        "intent_count":len(SAMPLES),"completed":len(completed),
        "base_primary_price":sum(bool(r["observations"][0].get("primary_price")) for r in completed),
        "alt_primary_price":sum(len(r["observations"])>=2 and bool(r["observations"][1].get("primary_price")) for r in completed),
        "alternate_recovers_missing":sum(r["alternate_recovers_missing_price"] for r in completed),
        "price_disagreements":sum(r["price_disagreement"] for r in completed),
        "safety_stop":safety_stop,"elapsed_seconds":round(time.monotonic()-start,2),
        "observations":records,
        "interpretation":"Diagnostic only: A/B cannot establish durability or price parity without matching a contemporaneous search card."
    }
    Path("artifacts").mkdir(exist_ok=True)
    Path("artifacts/amazon-us-pdp-header-ab.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("AB_SUMMARY "+json.dumps({k:v for k,v in summary.items() if k!="observations"},ensure_ascii=False,sort_keys=True),flush=True)
    import os
    if os.getenv("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"],"a",encoding="utf-8") as f:
            f.write(f"\n### Amazon PDP real header A/B\nBaseline-priced: {summary['base_primary_price']}/{len(completed)}; "
                    f"Alternate-priced: {summary['alt_primary_price']}/{len(completed)}; "
                    f"Recovered: {summary['alternate_recovers_missing']}; "
                    f"Price disagreements: {summary['price_disagreements']}; "
                    f"Safety stop: {safety_stop}\n")
    raise SystemExit(1 if safety_stop else 0)

if __name__=="__main__":
    asyncio.run(main())
