#!/usr/bin/env python3
"""Amazon US publicly embedded JS/JSON offer-provenance investigation.

No guessed price publication; only structure counts and approved field keys.
Each accepted structured offer must contain the selected exact ASIN and an
explicit USD price in the same object or product>offers subtree. Does not
query private endpoints or execute JavaScript from Amazon.
"""
import asyncio
import json
import re
from pathlib import Path
from datetime import datetime, timezone
from bs4 import BeautifulSoup
from nawaa_store_hunter import Scraper, normalized_currency, number_price

SAMPLES=[
 ("soundcore","B0C3HCD34R"),("iPhone","B0G4RRVKQS"),
 ("Samsung","B0DSLTZFXN"),("PS5","B09CYLL41S"),
 ("4K Monitor","B0FDDVRS59"),("Arabic audio","B0BTYCRJSS"),
]
ASIN_PAT=re.compile(r'\b(?:asin|sku|productAsin|productASIN)\b',re.I)
PRICE_PAT=re.compile(r'(?:"|\\")?(?:priceToPay|priceAmount|buyBoxPrice|displayPrice|salePrice|dealPrice|priceCurrency|priceSpecification)(?:"|\\")?\s*:',re.I)
BUYBOX_PAT=re.compile(r'(?:buybox|buyBox|corePrice|priceDisplay|priceToPay|apex_desktop)',re.I)
ASIN_URL=re.compile(r"/(?:dp|gp/product)/([A-Z0-9]{10})(?:[/?#]|$)",re.I)
SAFE_KEYS={"asin","sku","productasin","price","priceamount","pricetopay","buyboxprice","saleprice","dealprice","pricecurrency","currency","offers","pricespecification"}
def descendants(node):
    stack=[(node,0)];nodes=0
    while stack and nodes<3500:
        cur,depth=stack.pop();nodes+=1
        if isinstance(cur,dict):
            yield cur
            if depth<10:stack.extend((v,depth+1) for v in list(cur.values())[:80])
        elif isinstance(cur,list) and depth<10:
            stack.extend((v,depth+1) for v in cur[:100])

def proven_offer_in_node(node,asin):
    if not isinstance(node,dict):return False
    explicit=any(str(node.get(k) or "").upper()==asin for k in ("asin","ASIN","sku","productAsin"))
    url=node.get("url") or node.get("@id")
    if isinstance(url,str):
        m=ASIN_URL.search(url)
        explicit=explicit or bool(m and m.group(1).upper()==asin)
    if not explicit:return False
    prices=[]
    for obj in [node]+([node["offers"]] if isinstance(node.get("offers"),dict) else
                     node["offers"][:4] if isinstance(node.get("offers"),list) else []):
        if not isinstance(obj,dict):continue
        if "lowPrice" in obj or "highPrice" in obj:continue
        price=obj.get("price") or obj.get("priceAmount") or obj.get("priceToPay")
        if isinstance(price,dict):
            price=price.get("value") or price.get("amount")
        currency=normalized_currency(obj.get("priceCurrency") or obj.get("currency"))
        if price is not None and currency=="USD" and number_price(price):
            prices.append(number_price(price))
    return bool(prices and len(set(prices))==1)

def object_candidates(raw,asin):
    """Parse only bounded JSON object offsets within scripts containing ASIN."""
    decoder=json.JSONDecoder();parsed=[];seen=set()
    if len(raw)>500_000:raw=raw[:500_000]
    for m in re.finditer(r'\{\s*["\'](?:asin|ASIN|sku|productAsin|productASIN)["\']\s*:',raw,re.I):
        if len(parsed)>=12:break
        start=m.start()
        if start in seen:continue
        seen.add(start)
        try:
            obj,end=decoder.raw_decode(raw[start:])
        except (ValueError,TypeError):continue
        if isinstance(obj,dict) and end<350_000:
            parsed.append(obj)
    if raw.strip().startswith(("{","[")):
        try:parsed.append(json.loads(raw))
        except (ValueError,TypeError):pass
    return parsed

def inspect(html,asin):
    soup=BeautifulSoup(html,"html.parser")
    count=0; both=0; close=0; buybox=0; parsed_objects=0; structured_price_proven=0
    key_names=set(); matched_scripts=0; maxlen=0; modules=[]
    for script in soup.find_all("script")[:300]:
        if script.get("src"):continue
        text=script.string or script.get_text() or ""
        if not text:continue
        count+=1;maxlen=max(maxlen,len(text))
        if asin not in text:continue
        matched_scripts+=1
        if not PRICE_PAT.search(text):continue
        both+=1
        if BUYBOX_PAT.search(text):buybox+=1
        prices=[m.start() for m in PRICE_PAT.finditer(text[:350_000])][:200]
        appearances=[m.start() for m in re.finditer(re.escape(asin),text[:350_000])][:40]
        if prices and appearances and min(abs(a-p) for a in appearances for p in prices)<=3500:
            close+=1
        for key in SAFE_KEYS:
            if re.search(r'["\']'+re.escape(key)+r'["\']\s*:',text,re.I):
                key_names.add(key)
        for obj in object_candidates(text,asin):
            parsed_objects+=1
            for node in descendants(obj):
                if proven_offer_in_node(node,asin):
                    structured_price_proven+=1
        if len(modules)<12:
            modules.append({
                "script_type":(script.get("type") or "inline")[:40],
                "has_buybox_token":bool(BUYBOX_PAT.search(text)),
                "same_script_asin_and_price_key":True,
                "nearby_3500chars":bool(prices and appearances and min(abs(a-p) for a in appearances for p in prices)<=3500),
                "size_bucket":"large" if len(text)>100000 else "medium" if len(text)>10000 else "small",
            })
    return {
        "inline_script_total":count,"scripts_with_exact_asin":matched_scripts,
        "scripts_with_asin_and_price_key":both,
        "scripts_with_nearby_asin_price_key":close,
        "scripts_with_buybox_token":buybox,
        "parsed_inline_json_objects":parsed_objects,
        "asin_bound_explicit_usd_offers":structured_price_proven,
        "safe_price_key_types":sorted(key_names),
        "script_structure_samples":modules,
    }
async def main():
    scraper=Scraper("https://www.amazon.com","embedded JSON source evidence",1,1,"never","none")
    rows=[];stopped=False
    try:
        await scraper.prepare()
        for name,asin in SAMPLES:
            if stopped:rows.append({"name":name,"asin":asin,"status":"SKIPPED_SAFETY_STOP"});continue
            before=len(scraper.diagnostics)
            body=await scraper.fetch("inline-json-structure",f"https://www.amazon.com/dp/{asin}")
            statuses=[x.status for x in scraper.diagnostics[before:]]
            record={"name":name,"asin":asin,"html_received":bool(body),"request_status":statuses}
            if body: record.update(inspect(body,asin))
            rows.append(record)
            print("INLINE_FORENSIC "+json.dumps(record,ensure_ascii=False),flush=True)
            if any(x in {"BLOCKED_OR_RATE_LIMITED","CHALLENGE_PAGE","ROBOTS_DENIED_OR_UNSAFE"} for x in statuses):
                stopped=True
            if not stopped:await asyncio.sleep(1)
    finally:
        await scraper.close()
    report={"observed_utc":datetime.now(timezone.utc).isoformat(),
            "requested":len(SAMPLES),"html_ok":sum(r.get("html_received",False) for r in rows),
            "scripts_with_near_price":sum(r.get("scripts_with_nearby_asin_price_key",0) for r in rows),
            "priced_eligible_asin_offers":sum(r.get("asin_bound_explicit_usd_offers",0) for r in rows),
            "safety_stop":stopped,"rows":rows}
    Path("artifacts").mkdir(exist_ok=True)
    Path("artifacts/amazon-us-inline-json-forensics.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("INLINE_FORENSIC_SUMMARY "+json.dumps({k:v for k,v in report.items() if k!="rows"}),flush=True)
    raise SystemExit(1 if stopped else 0)

if __name__=="__main__":
    asyncio.run(main())
