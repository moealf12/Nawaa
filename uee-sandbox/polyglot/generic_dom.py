import json,re,sys,html,urllib.parse
from bs4 import BeautifulSoup
from decimal import Decimal,InvalidOperation
def normalize_price(value):
 try:
  v=Decimal(str(value).strip().replace(',',''))
  return str(v) if v.is_finite() and v>=0 else None
 except (InvalidOperation,ValueError):return None
def extract(text,url):
 soup=BeautifulSoup(text,'lxml')
 out=[]
 def accept(name,price,currency,image,source):
  price=normalize_price(price)
  if not (name and price and currency):return
  if isinstance(image,list):image=image[0] if image else None
  if isinstance(image,dict):image=image.get('url')
  out.append(dict(name=str(name).strip(),price=price,currency=str(currency).strip(),image=urllib.parse.urljoin(url,image) if isinstance(image,str) else None,source=source))
 def scan(obj):
  if isinstance(obj,list):
   for x in obj:scan(x)
  elif isinstance(obj,dict):
   typ=obj.get('@type',[])
   if isinstance(typ,str):typ=[typ]
   if 'Product' in typ:
    offers=obj.get('offers') or {}
    if isinstance(offers,list):offers=offers[0] if offers else {}
    if isinstance(offers,dict):accept(obj.get('name'),offers.get('price') or offers.get('lowPrice'),offers.get('priceCurrency'),obj.get('image'),'jsonld')
   for x in obj.values():
    if isinstance(x,(dict,list)):scan(x)
 for node in soup.select('script[type="application/ld+json"]'):
  try:scan(json.loads(node.string or node.get_text()))
  except (json.JSONDecodeError,TypeError):pass
 for node in soup.select('[itemscope][itemtype*="schema.org/Product"]'):
  def prop(key):
   t=node.select_one('[itemprop="'+key+'"]')
   return (t.get('content') or t.get('value') or t.get('src') or t.get_text(' ',strip=True)) if t else None
  accept(prop('name'),prop('price'),prop('priceCurrency'),prop('image'),'microdata')
 meta=lambda key: (soup.select_one('meta[property="'+key+'"]') or {}).get('content')
 accept(meta('og:title'),meta('product:price:amount'),meta('product:price:currency'),meta('og:image'),'og')
 seen=set();unique=[]
 for x in out:
  key=(x['name'].lower(),x['price'],x['currency'])
  if key not in seen:seen.add(key);unique.append(x)
 return unique
if __name__=='__main__':
 payload=json.load(sys.stdin)
 print(json.dumps(extract(payload['html'],payload['url'])))
