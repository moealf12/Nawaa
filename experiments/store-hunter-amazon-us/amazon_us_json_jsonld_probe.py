#!/usr/bin/env python3
"""Bounded live Amazon US PDP JSON/JSON-LD evidence forensics.

Reads only public PDP HTML, no proxy or restricted APIs. Does not publish
offers from embedded structures without exact ASIN+currency+offer evidence.
Sanitizes JSON diagnostics: counts, keys and issue codes, never raw HTML.
"""
import asyncio
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from bs4 import BeautifulSoup
from nawaa_store_hunter import Scraper, jsonld_nodes, normalized_currency, number_price

CASES = (
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
ASIN_RE = re.compile(r"/(?:dp|gp/product)/([A-Z0-9]{10})(?:[/?#]|$)", re.I)
PRICE_KEYS = {"price", "priceamount", "pricetopay", "pricetobuy", "saleprice",
              "dealprice", "buyboxprice", "pricecurrency", "currency",
              "pricevalue", "displayprice"}
ASIN_KEYS = {"asin", "sku", "productasin", "productid", "parentasin"}
MAX_SCRIPT_BYTES=600_000

def nodes_of(obj, max_nodes=5000):
    pending=[(obj, "", 0)]
    seen=0
    while pending and seen<max_nodes:
        item,path,depth=pending.pop()
        seen+=1
        if isinstance(item,dict):
            yield item,path
            if depth<12:
                pending.extend((v, (path+"."+str(k))[-160:], depth+1)
                               for k,v in list(item.items())[-100:])
        elif isinstance(item,list) and depth<12:
            pending.extend((v,path+"[]",depth+1) for v in item[:100])

def offer_prices(node):
    candidates=[]
    offers=node.get("offers")
    if isinstance(offers,dict): offers=[offers]
    if not isinstance(offers,list): offers=[]
    for offer in offers[:10]:
        if not isinstance(offer,dict) or any(x in offer for x in ("lowPrice","highPrice")):
            continue
        money=offer.get("price")
        currency=normalized_currency(offer.get("priceCurrency"))
        if money is None and isinstance(offer.get("priceSpecification"),dict):
            spec=offer["priceSpecification"]
            money=spec.get("price")
            currency=normalized_currency(currency or spec.get("priceCurrency"))
        value=number_price(money)
        if value and currency=="USD":
            candidates.append(value)
    return sorted(set(candidates))

def bound_asin(node, asin):
    for key in ("sku","asin","productAsin","productASIN","productasin"):
        if str(node.get(key) or "").upper()==asin: return True
    for field in ("url","@id","productUrl"):
        value=str(node.get(field) or "")
        match=ASIN_RE.search(value)
        if match and match.group(1).upper()==asin: return True
    return False

def inspect(html,page,asin):
    soup=BeautifulSoup(html,"html.parser")
    outcome={"jsonld_script_count":0,"jsonld_parseable":0,"jsonld_product_nodes":0,
             "jsonld_asin_bound_products":0,"jsonld_asin_bound_usd_prices":[],
             "jsonld_unbound_priced_products":0,
             "typed_json_script_count":0,"typed_json_parseable":0,
             "typed_json_asin_bound_objects":0,"typed_json_asin_bound_price_objects":0,
             "inline_script_count":0,"inline_script_mentioning_asin":0,
             "inline_script_price_key_mentions":0,"inline_json_parseable":0,
             "max_inline_script_size":0,"structured_candidate_paths":[]}
    for script in soup.find_all("script")[:250]:
        type_=(script.get("type") or "").lower()
        raw=script.string or script.get_text() or ""
        if len(raw)>MAX_SCRIPT_BYTES: raw=raw[:MAX_SCRIPT_BYTES]
        if "ld+json" in type_:
            outcome["jsonld_script_count"]+=1
            try: obj=json.loads(raw)
            except (TypeError,ValueError): continue
            outcome["jsonld_parseable"]+=1
            for node in jsonld_nodes(obj):
                types=node.get("@type",[])
                types=[types] if isinstance(types,str) else types if isinstance(types,list) else []
                if not any(str(t).split("/")[-1].lower()=="product" for t in types): continue
                outcome["jsonld_product_nodes"]+=1
                prices=offer_prices(node)
                if bound_asin(node,asin):
                    outcome["jsonld_asin_bound_products"]+=1
                    outcome["jsonld_asin_bound_usd_prices"]+=prices
                elif prices:
                    outcome["jsonld_unbound_priced_products"]+=1
            continue
        if "json" in type_ and "ld+" not in type_:
            outcome["typed_json_script_count"]+=1
            try: obj=json.loads(raw)
            except (TypeError,ValueError): continue
            outcome["typed_json_parseable"]+=1
            for node,path in nodes_of(obj):
                if bound_asin(node,asin):
                    outcome["typed_json_asin_bound_objects"]+=1
                    if set(k.lower() for k in node) & PRICE_KEYS:
                        outcome["typed_json_asin_bound_price_objects"]+=1
                        if len(outcome["structured_candidate_paths"])<8:
                            outcome["structured_candidate_paths"].append(path)
            continue
        if not raw: continue
        outcome["inline_script_count"]+=1
        outcome["max_inline_script_size"]=max(outcome["max_inline_script_size"],len(raw))
        if asin in raw:outcome["inline_script_mentioning_asin"]+=1
        if re.search(r'["\'](?:priceAmount|priceToPay|displayPrice|buyBoxPrice|priceCurrency|asin)["\']\s*:',raw,re.I):
            outcome["inline_script_price_key_mentions"]+=1
        text=raw.lstrip()
        if text.startswith(("{","[")):
            try:obj=json.loads(text)
            except (TypeError,ValueError): continue
            outcome["inline_json_parseable"]+=1
            for node,path in nodes_of(obj):
                if bound_asin(node,asin):
                    outcome["typed_json_asin_bound_objects"]+=1
                    if set(k.lower() for k in node)&PRICE_KEYS:
                        outcome["typed_json_asin_bound_price_objects"]+=1
                        if len(outcome["structured_candidate_paths"])<8:
                            outcome["structured_candidate_paths"].append(path)
    outcome["jsonld_asin_bound_usd_prices"]=sorted(set(outcome["jsonld_asin_bound_usd_prices"]))
    return outcome

async def main():
    scraper=Scraper("https://www.amazon.com","jsonld-json-pdp-evidence",1,1,"never","none")
    cases=[];stopped=False
    try:
        await scraper.prepare()
        for query,asin in CASES:
            if stopped:
                cases.append({"query":query,"asin":asin,"status":"SKIPPED_SAFETY_STOP"})
                continue
            url=f"https://www.amazon.com/dp/{asin}"
            before=len(scraper.diagnostics)
            html=await scraper.fetch("json-ld-json-evidence",url)
            codes=[x.status for x in scraper.diagnostics[before:]]
            row={"query":query,"asin":asin,"status":"HTTP_OK" if html else "NO_HTML","http_outcomes":codes}
            if html:
                row.update(inspect(html,url,asin))
            cases.append(row)
            print("JSON_EVIDENCE "+json.dumps(row,ensure_ascii=False,sort_keys=True),flush=True)
            if any(c in {"CHALLENGE_PAGE","BLOCKED_OR_RATE_LIMITED","ROBOTS_DENIED_OR_UNSAFE"} for c in codes):
                stopped=True
            if not stopped: await asyncio.sleep(0.8)
    finally:
        await scraper.close()
    measured=[r for r in cases if r.get("status")=="HTTP_OK"]
    summary={"observed_utc":datetime.now(timezone.utc).isoformat(),
             "target":"Amazon US public PDP HTML","requested":len(CASES),
             "http_ok":len(measured),
             "ld_product_asin_proof":sum(bool(x["jsonld_asin_bound_products"]) for x in measured),
             "ld_priced_asin_proof":sum(bool(x["jsonld_asin_bound_usd_prices"]) for x in measured),
             "json_asin_price_structures":sum(bool(x["typed_json_asin_bound_price_objects"]) for x in measured),
             "inline_price_key_scripts":sum(x["inline_script_price_key_mentions"] for x in measured),
             "safety_stop":stopped,
             "results":cases}
    Path("artifacts").mkdir(exist_ok=True)
    Path("artifacts/amazon-us-json-ld-json-live.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("JSON_EVIDENCE_SUMMARY "+json.dumps({k:v for k,v in summary.items() if k!="results"},ensure_ascii=False),flush=True)
    raise SystemExit(1 if stopped else 0)

if __name__=="__main__":
    asyncio.run(main())
