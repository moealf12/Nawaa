function flatten(value,out=[]){if(!value)return out;if(Array.isArray(value)){for(const item of value)flatten(item,out);return out}if(typeof value==="object"){out.push(value);if(value["@graph"])flatten(value["@graph"],out);if(value.itemListElement)flatten(value.itemListElement.map(x=>x?.item||x),out)}return out}
function firstOffer(p){return Array.isArray(p?.offers)?p.offers[0]:p?.offers||{}}
function imageOf(p){const x=Array.isArray(p?.image)?p.image[0]:p?.image;return typeof x==="object"?x?.url:x}
function brandOf(p){return typeof p?.brand==="object"?p.brand?.name:p?.brand}
export function extractJsonLdProducts(html=""){
 const blocks=[],pattern=/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;let match;
 while((match=pattern.exec(String(html)))){try{flatten(JSON.parse(match[1].trim()),blocks)}catch{}}
 return blocks.filter(node=>{const type=node?.["@type"];return Array.isArray(type)?type.some(v=>/product/i.test(String(v))):/product/i.test(String(type||""))}).map(p=>{const o=firstOffer(p);return {sourceProductId:p.productID??p.sku??p.mpn??null,title:p.name??null,brand:brandOf(p)??null,model:p.model??null,sku:p.sku??null,gtin:p.gtin13??p.gtin12??p.gtin??null,mpn:p.mpn??null,price:Number(o?.price??o?.lowPrice??o?.highPrice)||null,originalPrice:null,currency:o?.priceCurrency??null,availability:o?.availability??null,imageUrl:imageOf(p)??null,productUrl:p.url??o?.url??null,raw:p}})
export function probeJsonLd(html=""){const products=extractJsonLdProducts(html),priced=products.filter(p=>p.price>0);return {strategy:"jsonld",ok:products.length>0,blocks:products.length,products:products.length,pricedProducts:priced.length,coverage:products.length?priced.length/products.length:0,sample:products.slice(0,3).map(({raw,...p})=>p)}}
