// Read-only, one-shot diagnostic for source-owned Decathlon product templates.
// Never prints HTML, URLs, IDs, image addresses, prices or search terms.
import {load} from "cheerio";
import {auditDecathlonSitemap} from "./audit-sitemap-discovery.mjs";
import {fetchHtmlSafe,extractionCandidates} from "../server/url-resolver.mjs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const host="decathlon.com.sa";
const isProductUrl=(raw)=>{
  try{const u=new URL(raw);return u.protocol==="https:"&&u.hostname===host&&!u.search&&
    /^\/products\/[a-z0-9][a-z0-9-]*\/?$/i.test(u.pathname)&&!u.hash&&!u.username&&!u.password;}
  catch{return false;}
};
export function inspectDecathlonHtmlStructure(html,url){
  if(!isProductUrl(url))return {status:"INVALID_SOURCE_URL"};
  const source=String(html||"").slice(0,1_500_000);
  const $=load(source);
  const scripts=$("script").slice(0,150).toArray();
  const scriptsJson=scripts.filter(el=>/application\/(?:json|ld\+json)/i.test($(el).attr("type")||""));
  const sources=extractionCandidates(source,url);
  const byName=Object.fromEntries(["jsonld","embedded_json","hydrated_state","storefront_data","domain_adapter","meta"]
    .map(name=>[name,sources.some(x=>x.strategy===name)]));
  const sourceEvidence=Object.fromEntries(sources.map(entry=>{
    const product=entry.product||{};
    const rawImage=Array.isArray(product.image)?product.image[0]:product.image;
    const rawOffer=Array.isArray(product.offers)?product.offers[0]:product.offers;
    return [entry.strategy,{
      hasName:Boolean(product.name),
      hasImage:Boolean(rawImage&&(typeof rawImage==="string"?rawImage:rawImage.url)),
      hasSku:Boolean(product.sku),
      hasVariantId:Boolean(product.variantId),
      hasBrand:Boolean(product.brand),
      hasPrice:Boolean(rawOffer?.price),
      hasCurrency:Boolean(rawOffer?.priceCurrency),
      hasCanonicalProductUrl:(()=>{
        try{
          const id=product.url || rawOffer?.url || product["@id"];
          return Boolean(id)&&new URL(id,url).origin===new URL(url).origin &&
            new URL(id,url).pathname.replace(/\/+$/,"")===new URL(url).pathname.replace(/\/+$/,"");
        }catch{return false;}
      })(),
    }];
  }));
  const metaValue=(selector)=>String($(selector).first().attr("content")||"").trim();
  const canonical=$('link[rel="canonical"]').first().attr("href")||"";
  const canonicalMatches=(()=>{
    try{
      const c=new URL(canonical,url),u=new URL(url);
      return c.hostname===u.hostname&&c.pathname.replace(/\/+$/,"")===u.pathname.replace(/\/+$/,"");
    }catch{return false;}
  })();
  const imageTags=$("img").length;
  const page=$("html").first().attr("lang")||"";
  return {
    status:"HTML_OBSERVED",
    availableStrategies:byName,
    evidenceByStrategy:sourceEvidence,
    canonicalMatches,
    ogImageValuePresent:Boolean(metaValue('meta[property="og:image"]')),
    twitterImageValuePresent:Boolean(metaValue('meta[name="twitter:image"]')),
    scriptsCount:scripts.length,structuredScriptsCount:scriptsJson.length,
    jsonLdProductText:/["']@type["']\s*:\s*["']Product["']/i.test(source),
    productDataJsonMarker:/["'](?:variants|product|selectedOrFirstAvailableVariant|sku)["']\s*:/i.test(source),
    shopifyAnalyticsMarker:/ShopifyAnalytics\.meta\.product|Shopify\.shop|shopify/i.test(source),
    nextDataMarker:source.includes("__NEXT_DATA__"),
    titleTag:Boolean($("title").first().text().trim()),
    ogImageMeta:$('meta[property="og:image"]').length>0,
    twitterImageMeta:$('meta[name="twitter:image"]').length>0,
    imageTagsCount:Math.min(imageTags,100),
    imageDataAttributes:Math.min($('img[data-src],img[data-srcset],img[data-original],img[srcset]').length,100),
    skuAttributeCount:Math.min($('[data-sku],[itemprop="sku"],[data-variant-id]').length,100),
    h1Count:Math.min($("h1").length,20),
    shopLocale:page?("LANG_ATTRIBUTE_PRESENT"):"NO_LANG_ATTRIBUTE",
    rawBytes:Buffer.byteLength(source),
    warning:"Read-only structural hints, NOT product identity/price/availability certification."
  };
}
export async function auditDecathlonPdpStructure({fetchSitemap=fetch,fetchPdp=fetchHtmlSafe,signal}={}){
  const urls=[];const snapshot=await auditDecathlonSitemap({fetchPage:fetchSitemap,signal,onProductSample:arr=>{
    for(const url of arr.slice(0,2))if(isProductUrl(url))urls.push(url);
  }});
  const pages=[];
  if(["SOURCE_DENIED","SOURCE_RATE_LIMITED","SOURCE_UNAVAILABLE","XML_INVALID"].includes(snapshot.status))
    return {sitemapStatus:snapshot.status,sitemapRequests:snapshot.requests,pages,trustCertified:false};
  for(const url of urls.slice(0,2)){
    try{
      const controller=AbortSignal.timeout(5000);
      const s=signal?AbortSignal.any([signal,controller]):controller;
      const page=await fetchPdp(url,0,{signal:s});
      if(!isProductUrl(page.finalUrl)||
         new URL(page.finalUrl).pathname.replace(/\/+$/,"")!==new URL(url).pathname.replace(/\/+$/,"")){
        pages.push({status:"PDP_IDENTITY_REDIRECT_REJECTED"});continue;
      }
      pages.push(inspectDecathlonHtmlStructure(page.html,url));
    }catch{pages.push({status:"PDP_TRANSPORT_UNAVAILABLE"});}
  }
  return {sitemapStatus:snapshot.status,sitemapRequests:snapshot.requests,
    sourceUrlCount:snapshot.productCandidates,pages,trustCertified:false,
    note:"Structure metadata only. No product, SKU, image URL, price or inventory output."};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  process.stdout.write(JSON.stringify(await auditDecathlonPdpStructure(),null,2)+"\n");
}
