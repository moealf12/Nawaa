#!/usr/bin/env python3
"""Probe Amazon's public a-state JSON priceToPay structure without promoting prices.

Only exact selected ASIN and same-structure USD price is potentially eligible.
Report safe key paths, price/currency presence, and whether the independent
primary DOM price agrees. Do not emit raw HTML, hidden identifiers or cookies.
"""
import asyncio,json,re
from pathlib import Path
from datetime import datetime,timezone
from bs4 import BeautifulSoup
from nawaa_store_hunter import Scraper,parse_amazon_us_pdp,number_price,normalized_currency

SAMPLES=(("4K Monitor","B0FDDVRS59"),("soundcore","B0C3HCD34R"),("iPhone","B0G4RRVKQS"))
def inspect(body,asin,page):
    soup=BeautifulSoup(body,"html.parser")
    main=parse_amazon_us_pdp(body,page)
    dom_price=main[0].price if len(main)==1 and main[0].sku==asin else None
    candidates=[]
    for script in soup.select('script[type="a-state"]')[:250]:
        raw=script.string or script.get_text() or ""
        if asin not in raw or "priceToPay" not in raw or len(raw)>300000:continue
        try:obj=json.loads(raw)
        except ValueError:
            continue
        key_attr=script.get("data-a-state") or ""
        if isinstance(key_attr,str):
            try: key_attr=json.loads(key_attr)
            except ValueError:key_attr={}
        key_name=key_attr.get("key") if isinstance(key_attr,dict) else None
        q=[(obj,"$",0)]
        while q:
            node,path,depth=q.pop()
            if depth>9:continue
            if isinstance(node,dict):
                if "priceToPay" in node:
                    price=node["priceToPay"]
                    same_asin=any(str(node.get(k) or "").upper()==asin for k in
                                  ("asin","ASIN","sku","productAsin","productASIN"))
                    value=None;currency=None
                    if isinstance(price,dict):
                        for k in ("value","priceAmount","amount","raw"):
                            if price.get(k) is not None:
                                value=number_price(price[k]);break
                        currency=normalized_currency(price.get("currency") or price.get("currencyCode") or price.get("priceCurrency"))
                    elif isinstance(price,(int,float,str)):
                        value=number_price(price)
                    candidate={
                        "a_state_key":str(key_name or "")[:90],
                        "path":path[:100],
                        "parent_keys":sorted(str(x) for x in node.keys())[:35],
                        "price_value_exists":bool(value),
                        "price_currency":currency,
                        "exact_asin_same_node":same_asin,
                        "same_object_asin_mentions":asin in json.dumps(node,ensure_ascii=False)[:50000],
                        "agrees_independent_dom_buybox":bool(value and dom_price and value==dom_price),
                        "has_dom_buybox":bool(dom_price),
                    }
                    candidates.append(candidate)
                for k,v in list(node.items())[:80]:
                    if isinstance(v,(dict,list)):
                        q.append((v,path+"."+str(k)[:40],depth+1))
            elif isinstance(node,list):
                for v in node[:60]:
                    if isinstance(v,(dict,list)):q.append((v,path+"[]",depth+1))
    return {"asin":asin,"matching_a_state_price_nodes":len(candidates),
            "a_state_evidence":candidates[:12],
            "pdp_dom_price_present":bool(dom_price),
            "strict_price_evidence_eligible":sum(bool(x["price_value_exists"] and x["price_currency"]=="USD" and x["exact_asin_same_node"]) for x in candidates)}

async def main():
    scraper=Scraper("https://www.amazon.com","a state priceToPay evidence",1,1,"never","none")
    rows=[]
    try:
        await scraper.prepare()
        for name,asin in SAMPLES:
            url=f"https://www.amazon.com/dp/{asin}"
            body=await scraper.fetch("a-state-asin-price",url)
            row={"name":name,"html_received":bool(body)}
            if body:row.update(inspect(body,asin,url))
            rows.append(row)
            print("ASTATE "+json.dumps(row,ensure_ascii=False),flush=True)
            await asyncio.sleep(0.8)
    finally:await scraper.close()
    report={"observed_utc":datetime.now(timezone.utc).isoformat(),
            "tested":len(rows),
            "html_ok":sum(bool(x["html_received"]) for x in rows),
            "strict_price_eligible":sum(x.get("strict_price_evidence_eligible",0) for x in rows),
            "results":rows}
    Path("artifacts").mkdir(exist_ok=True)
    Path("artifacts/amazon-us-a-state-price-json.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("ASTATE_SUMMARY "+json.dumps({k:v for k,v in report.items() if k!="results"}),flush=True)
if __name__=="__main__":asyncio.run(main())
