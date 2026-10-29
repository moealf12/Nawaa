"""Noon Saudi catalog endpoint candidate probe — diagnostics only, no production changes."""
import argparse
import json
import re
from decimal import Decimal, InvalidOperation
from urllib.parse import urljoin, urlsplit, urlencode
import httpx

API = "https://www.noon.com/_svc/catalog/api/search"
SKU = re.compile(r"^[A-Za-z0-9_-]{5,64}$")
PRICE = re.compile(r"^\\d{1,8}(?:\\.\\d{1,2})?$")

def price_value(raw):
    if type(raw) not in (str, int, float, Decimal):
        return None
    txt = str(raw).strip()
    if not PRICE.fullmatch(txt):
        return None
    try:
        number = Decimal(txt)
        return str(number) if number > 0 else None
    except InvalidOperation:
        return None

def product_url(raw, offer_code=None):
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        u = urlsplit(urljoin("https://www.noon.com/saudi-ar/", raw))
        if u.scheme != "https" or u.netloc.lower() not in ("www.noon.com", "noon.com"):
            return None
        if not u.path.startswith(("/saudi-ar/", "/saudi-en/")) or "/p/" not in u.path:
            return None
        # Keep the merchant's provided product URL, never invent an offer code.
        return u._replace(fragment="").geturl()
    except ValueError:
        return None

def image_url(raw):
    if not isinstance(raw, str) or not re.fullmatch(r"[A-Za-z0-9_./-]{3,300}", raw):
        return None
    return "https://f.nooncdn.com/products/tr:n-t_400/" + raw + ".jpg"

def parse_payload(payload, limit=50):
    hits = payload.get("hits") if isinstance(payload, dict) else None
    if not isinstance(hits, list):
        return {"status": "UNEXPECTED_SCHEMA", "items": []}
    items = []
    seen = set()
    for hit in hits[:max(1,min(50,limit))]:
        if not isinstance(hit, dict):
            continue
        sku = str(hit.get("sku") or "").strip()
        title = hit.get("name")
        url = product_url(hit.get("url"), hit.get("offer_code"))
        if not SKU.fullmatch(sku) or not isinstance(title,str) or not title.strip() or not url or sku in seen:
            continue
        regular = price_value(hit.get("price"))
        sale = price_value(hit.get("sale_price"))
        # Do not silently accept an anomalous discounted price above regular.
        final = sale if sale and (not regular or Decimal(sale)<=Decimal(regular)) else regular
        seen.add(sku)
        items.append({"title":title.strip(),"sku":sku,"price_sar":final,
                      "image":image_url(hit.get("image_key")),"url":url,
                      "currency":"SAR","price_kind":"CATALOG_ADVERTISED",
                      "customer_publishable":False})
    return {"status":"CATALOG_RESULTS" if items else "EMPTY_CATALOG","items":items}

def probe(query, timeout=12):
    if not isinstance(query,str) or not 2<=len(query.strip())<=180:
        raise ValueError("invalid query length")
    headers={"Accept":"application/json","Accept-Language":"ar,en;q=0.9",
             "x-platform":"web","x-locale":"ar-sa",
             "User-Agent":"NAWAA-Source-Diagnostic/1.0"}
    try:
        with httpx.Client(timeout=timeout,follow_redirects=False) as client:
            response=client.get(API,params={"q":query,"limit":50,"page":1,
                                           "sort[by]":"relevance","sort[dir]":"desc"},
                                headers=headers)
        if response.status_code != 200:
            return {"status":"SOURCE_HTTP_"+str(response.status_code),"items":[]}
        try:
            return parse_payload(response.json())
        except ValueError:
            return {"status":"INVALID_JSON","items":[]}
    except httpx.HTTPError as error:
        return {"status":"NETWORK_"+type(error).__name__,"items":[]}

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--query",default="ايفون 15")
    args=parser.parse_args()
    result=probe(args.query)
    # Avoid logging product prices or identifiers to public CI artifacts.
    print(json.dumps({"status":result["status"],"items":len(result["items"]),
                      "priced":sum(bool(x["price_sar"]) for x in result["items"]),
                      "customer_publishable":False},ensure_ascii=False))
