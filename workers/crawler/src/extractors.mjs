const MONEY=/([0-9][0-9,.]*)/;
const currencyAliases=new Map([["ر.س","SAR"],["SAR","SAR"],["SR","SAR"],["AED","AED"],["د.إ","AED"],["USD","USD"],["$","USD"],["GBP","GBP"],["£","GBP"],["EUR","EUR"],["€","EUR"]]);

const clean=v=>String(v??"").replace(/\s+/g," ").trim();
function num(v){const m=clean(v).match(MONEY);if(!m)return null;const n=Number(m[1].replace(/,/g,""));return Number.isFinite(n)&&n>0?n:null;}
function currency(v){const s=clean(v).toUpperCase();for(const [k,val] of currencyAliases)if(s.includes(k.toUpperCase()))return val;return null;}
function first(...v){return v.find(x=>x!==undefined&&x!==null&&clean(x)!=="")??null;}
function meta($,keys){for(const k of keys){const v=$(`meta[property="${k}"],meta[name="${k}"]`).first().attr("content");if(v)return v;}return null;}
function ldProducts($){const out=[];$('script[type="application/ld+json"]').each((_,el)=>{try{const root=JSON.parse($(el).text());const stack=Array.isArray(root)?[...root]:[root];while(stack.length){const x=stack.shift();if(!x||typeof x!=="object")continue;if(Array.isArray(x)){stack.push(...x);continue;}if(x["@graph"])stack.push(...x["@graph"]);const t=x["@type"];if(t==="Product"||(Array.isArray(t)&&t.includes("Product")))out.push(x);}}catch{}});return out;}
function fromLd(p,url,merchant){const offers=Array.isArray(p?.offers)?p.offers:[p?.offers].filter(Boolean);return offers.map(o=>({title:clean(p.name),brand:typeof p.brand==="string"?p.brand:p.brand?.name||null,merchant,sourceUrl:o.url||url,imageUrl:Array.isArray(p.image)?p.image[0]:typeof p.image==="object"?p.image?.url:p.image||null,currency:first(o.priceCurrency,currency(o.price)),productPrice:num(first(o.price,o.lowPrice,o.highPrice)),sku:first(p.sku,p.mpn,p.gtin13,p.gtin),availability:clean(o.availability||"unknown").split("/").pop().toLowerCase(),condition:clean(o.itemCondition||"new").split("/").pop().toLowerCase(),extractionStrategy:"jsonld"})).filter(x=>x.title.length>=3&&x.productPrice&&x.currency);}
function fromMeta($,url,merchant){const title=first(meta($,["og:title","twitter:title"]),$("h1").first().text(),$("title").text());const rawPrice=first(meta($,["product:price:amount","og:price:amount"]),$('[itemprop="price"]').first().attr("content"),$('[itemprop="price"]').first().text());const rawCurrency=first(meta($,["product:price:currency","og:price:currency"]),$('[itemprop="priceCurrency"]').first().attr("content"),$('[itemprop="priceCurrency"]').first().text(),currency(rawPrice));const price=num(rawPrice);if(!title||!price||!rawCurrency)return [];return [{title:clean(title),brand:first(meta($,["product:brand"]),$('[itemprop="brand"]').first().text()),merchant,sourceUrl:url,imageUrl:first(meta($,["og:image","twitter:image"]),$('[itemprop="image"]').first().attr("src")),currency:clean(rawCurrency).toUpperCase(),productPrice:price,sku:first(meta($,["product:retailer_item_id"]),$('[itemprop="sku"]').first().attr("content"),$('[itemprop="sku"]').first().text()),availability:clean(first(meta($,["product:availability"]),$('[itemprop="availability"]').first().attr("href"),"unknown")).split("/").pop().toLowerCase(),condition:"new",extractionStrategy:"metadata"}];}

export function extractOffersFromPage({$,url}){
 const merchant=new URL(url).hostname.replace(/^www\./,"");
 const all=[...ldProducts($).flatMap(p=>fromLd(p,url,merchant)),...fromMeta($,url,merchant)];
 const seen=new Set();
 return all.filter(x=>{const k=[x.sourceUrl,x.sku,x.productPrice,x.currency].join("|");if(seen.has(k))return false;seen.add(k);return true;}).map(x=>({...x,observedAt:new Date().toISOString()}));
}
