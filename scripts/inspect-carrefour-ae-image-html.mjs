// Diagnostic only. Never imported by server or production crawler.
// Emits bounded metadata and nearest-image structure, not full retailer HTML.
import { load } from "cheerio";
import { extractionCandidates } from "../server/url-resolver.mjs";
import { fetchCarrefourAeBrowserPage } from "../server/source-inspector/carrefour-ae-image-proof.mjs";
import { searchFreeStorefrontById } from "../server/providers/free-storefronts.mjs";

const offerSearch = await searchFreeStorefrontById("carrefour-ae", "iPhone 17",{perStore:6});
const target = offerSearch.offers?.[0]?.sourceUrl;
const report = {source:"carrefour-ae", queries:offerSearch.offers?.length||0, productUrl:target, inspections:[]};
const urls = [
  "https://www.carrefouruae.com/mafuae/en/search?keyword=iPhone%2017",
  target,
].filter(Boolean);
for (const url of urls) {
  const type = url.includes("/search?") ? "search" : "product";
  try {
    const page = type==="product" ? await fetchCarrefourAeBrowserPage(url) : await (async()=>{
      const response=await fetch(url,{
        headers:{
          accept:"text/html,application/xhtml+xml",
          "accept-language":"en-US,en;q=0.9,ar-SA;q=0.8",
          "user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
        },
        signal:AbortSignal.timeout(8000),
      });
      if(!response.ok)throw new Error("search HTTP "+response.status);
      const html=await response.text();
      if(html.length>5_000_000)throw new Error("too_large");
      return {html,finalUrl:response.url||url};
    })();
    const $ = load(page.html);
    const matchingAnchors = [];
    $('a[href*="/p/"]').slice(0,4).each((_,el)=>{
      const a=$(el);
      const stages=[];
      let container=a;
      for(let n=0;n<5;n++){
        const imageNodes=container.find("img,picture,source").slice(0,5).toArray();
        stages.push({
          level:n, tag:container.get(0)?.tagName||null, className:String(container.attr("class")||"").slice(0,120),
          images:imageNodes.map(img=>({
            tag:img.tagName, alt:String($(img).attr("alt")||"").slice(0,140),
            src:String($(img).attr("src")||"").slice(0,150),
            dataSrc:String($(img).attr("data-src")||"").slice(0,150),
            srcset:String($(img).attr("srcset")||$(img).attr("data-srcset")||"").slice(0,150),
          })),
        });
        container=container.parent(); if(!container.length)break;
      }
      matchingAnchors.push({href:String(a.attr("href")||"").slice(0,200),stages});
    });
    const candidates=extractionCandidates(page.html,page.finalUrl);
    report.inspections.push({
      type, httpFinalUrl:page.finalUrl, htmlBytes:Buffer.byteLength(page.html),
      responsePrefix:page.html.slice(0,100).replace(/\s+/g," "),
      title:$("title").first().text().slice(0,160),
      h1:$("h1").first().text().replace(/\s+/g," ").slice(0,160),
      canonical:$('link[rel="canonical"]').attr("href")||null,
      ogImage:$('meta[property="og:image"]').attr("content")||null,
      ldJsonCount:$('script[type="application/ld+json"]').length,
      scriptCount:$("script").length, imageTagCount:$("img").length,
      candidateCount:candidates.length,
      candidates:candidates.slice(0,6).map(x=>({
        strategy:x.strategy, name:String(x.product?.name||"").slice(0,160),
        sku:x.product?.sku||null, price:x.product?.offers?.price||null,
        currency:x.product?.offers?.priceCurrency||null,
        imagePresent:Boolean(x.product?.image),
      })),
      matchingAnchors:type==="search"?matchingAnchors:[],
      firstProductImages:type==="product"?$("img").slice(0,5).toArray().map(el=>({
        alt:String($(el).attr("alt")||"").slice(0,150),
        src:String($(el).attr("src")||"").slice(0,200),
        dataSrc:String($(el).attr("data-src")||"").slice(0,200),
      })):[],
    });
  } catch (error) {
    report.inspections.push({type,error:String(error?.message||error).slice(0,200)});
  }
}
console.log(JSON.stringify(report,null,2));
