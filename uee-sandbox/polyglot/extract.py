import json,re,html,pathlib
root=pathlib.Path('uee-sandbox/polyglot')
out=json.loads((root/'results.json').read_text())
products=[]
for i,rec in enumerate(out['acquisition']):
 text=(root/'pages'/f'{i}.html').read_text()
 title=re.search(r'<h1[^>]*>([^<]+)</h1>',text,re.I)
 price=re.search(r'<p[^>]*class=["\'][^"\']*price_color[^"\']*["\'][^>]*>\s*[^\d]*(\d+\.\d{2})',text,re.I)
 image=re.search(r'<div[^>]*class=["\'][^"\']*item active[^"\']*["\'][^>]*>[\s\S]*?<img[^>]*src=["\']([^"\']+)',text,re.I)
 from urllib.parse import urljoin
 product={'name':html.unescape(title.group(1)) if title else None,'price':price.group(1) if price else None,'currency':'GBP' if price else None,'image':urljoin(rec['url'],image.group(1)) if image else None}
 product['valid']=all(product.values())
 products.append(product)
out['python_products']=products
(root/'results.json').write_text(json.dumps(out,indent=2))
print('PYTHON_PRODUCTS',json.dumps(products))
if not all(p['valid'] for p in products):raise SystemExit(1)
