// NAWAA source acquisition CPU forensics — strictly synthetic fixture data.
// No storefront fetches, no secrets, no external credentials or URLs requested.
// Output is a bounded process-CPU sample, NOT an attribution to any live provider.
import {performance} from "node:perf_hooks";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {extractProductLinks,extractEmbeddedSearchOffers} from "../server/providers/free-storefronts.mjs";

export const SYNTHETIC_STORE=Object.freeze({
  id:"synthetic-local-fixture",
  name:"Fixture Store",
  euSource:false,
  productPath:/\/product\/\d+(?:[?#]|$)/i,
});
export const SYNTHETIC_SEARCH="https://fixture.invalid/search?q=iphone+17";

export function makeFixture(count=80,{entities=false}={}){
  const n=Math.max(1,Math.min(240,Math.trunc(count)));
  const cards=Array.from({length:n},(_,i)=>({
    url:"/product/"+(100000+i),
    title:"iPhone 17 256GB synthetic fixture "+i,
    productId:"synthetic-"+i,
    price:3000+i,
    currency:"SAR",
  }));
  const anchors=cards.map(p=>
    '<a href="'+p.url+'">'+p.title+'</a>').join("");
  const hydrated=JSON.stringify({props:{pageProps:{products:cards.map(p=>({
    name:p.title,sku:p.productId,url:p.url,
    offers:{price:p.price,priceCurrency:p.currency},
  }))}}});
  let page='<html><body>'+anchors+
    '<script id="__NEXT_DATA__" type="application/json">'+hydrated+'</script></body></html>';
  if(entities) page=page.replace(/\//g,"&#47;").replace(/&/g,"&amp;");
  return page;
}

export function inspectFixture(html){
  const start=performance.now();
  const cpuStart=process.cpuUsage();
  const links=extractProductLinks(html,SYNTHETIC_SEARCH,SYNTHETIC_STORE,"iphone 17",Infinity);
  const afterLinks=process.cpuUsage(cpuStart);
  const linkMs=(afterLinks.user+afterLinks.system)/1000;
  const embedded=extractEmbeddedSearchOffers(html,SYNTHETIC_SEARCH,SYNTHETIC_STORE,"iphone 17");
  const totalCpu=process.cpuUsage(cpuStart);
  return {
    linkCount:links.length,
    embeddedCount:embedded.length,
    links:links.map(x=>[x.url,x.label,x.score]),
    embedded:embedded.map(x=>[x.sourceUrl,x.title,x.price,x.currency]),
    linkCpuMs:linkMs,
    embeddedCpuMs:(totalCpu.user+totalCpu.system)/1000-linkMs,
    wallMs:performance.now()-start,
  };
}
export function fixtureExtractionProfile({sizes=[80,200],rounds=3}={}){
  const result=[];
  for(const size of sizes){
    const html=makeFixture(size);
    const measurements=[];
    // Prewarm regexes/JS JIT. Do not include startup in the sample.
    inspectFixture(html);
    for(let i=0;i<rounds;i++){
      const x=inspectFixture(html);
      measurements.push({linkCpuMs:x.linkCpuMs,
        embeddedCpuMs:x.embeddedCpuMs,wallMs:x.wallMs,
        extractedLinks:x.linkCount,embeddedCandidates:x.embeddedCount});
    }
    const median=k=>{
      const values=measurements.map(x=>x[k]).sort((a,b)=>a-b);
      return Math.round(values[Math.floor(values.length/2)]*100)/100;
    };
    result.push({syntheticProducts:size,htmlBytes:Buffer.byteLength(html),
      links:measurements[0].extractedLinks,
      embeddedCandidates:measurements[0].embeddedCandidates,
      linkParserMedianCpuMs:median("linkCpuMs"),
      embeddedParserMedianCpuMs:median("embeddedCpuMs"),
      totalMedianElapsedMs:median("wallMs")});
  }
  return {kind:"NAWAA_SOURCE_ACQUISITION_CPU_FORENSICS",
    environment:"synthetic_fixture_no_network",rounds,results:result,
    conclusionLimit:"Not per-source attribution; no real merchants or runtime p95 measured."};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  // Static proof of the double JSON-LD extraction path. This is a discovery,
  // not an instruction to weaken provenance checks or skip parsing changed HTML.
  const source=readFileSync(new URL("../server/providers/free-storefronts.mjs",import.meta.url),"utf8");
  const inSearchStore=source.slice(source.indexOf("async function searchStore("));
  const parseSites=(inSearchStore.match(/extractJsonLdSearchOffers\(html,/g)||[]).length;
  console.log(JSON.stringify({...fixtureExtractionProfile(),jsonLdParseCallSites:parseSites,
    evidenceNote:"An identical HTML page can be parsed in both the first and fallback source phases."}));
}
