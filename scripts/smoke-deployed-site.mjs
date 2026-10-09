import {mkdir,writeFile,appendFile} from "node:fs/promises";
import {CERTIFIED_PILOT_SOURCES,CERTIFIED_PILOT_RUN} from "../src/certified-pilot.mjs";

const PUBLIC_SITE="https://moealf12.github.io/Nawaa/search.html";
const SAME_ORIGIN_SITE="https://nawaa-search-api.onrender.com/search.html";
const API="https://nawaa-search-api.onrender.com";
async function probe(url,timeoutMs=40000){
  const started=Date.now();
  try{
    const response=await fetch(url,{redirect:"follow",headers:{accept:"text/html,application/json"},signal:AbortSignal.timeout(timeoutMs)});
    const raw=await response.text();
    let data;
    try{data=JSON.parse(raw);}catch{}
    return {ok:response.ok,status:response.status,durationMs:Date.now()-started,finalUrl:response.url,data,html:data?null:raw.slice(0,150000)};
  }catch(error){return {ok:false,error:String(error?.message||error),durationMs:Date.now()-started};}
}
const publicPage=await probe(PUBLIC_SITE,20000);
const sameOriginPage=await probe(SAME_ORIGIN_SITE,90000);
const health=await probe(API+"/health",90000);
const sourceIds=new Set(CERTIFIED_PILOT_SOURCES.map(s=>s.id));
const cases=[["chair","furniture"],["perfume","fragrance"],["stroller","baby"]];
const runs=[];
for(const [q,category] of cases){
  const response=await probe(API+"/api/search?q="+encodeURIComponent(q),60000);
  const offers=Array.isArray(response.data?.offers)?response.data.offers:[];
  const detected=new Set();
  for(const offer of offers){
    for(const field of [offer.providerMarket,offer.sourceId,offer.provider,offer.merchantId]){
      if(field&&sourceIds.has(field)) detected.add(field);
    }
  }
  const suspect=offers.filter(offer=>{
    const title=String(offer.title||"").toLowerCase();
    return (q==="chair"&&/chair pad|chair cushion|seat cushion/.test(title))||
      (q==="perfume"&&/felt.tip marker|anthology|novel|poetry|\bbook\b/.test(title))||
      (q==="stroller"&&/chronicles of a stroller|\bnovel\b|\bbook\b/.test(title));
  }).slice(0,5).map(o=>String(o.title).slice(0,140));
  runs.push({
    query:q,category,status:response.status||null,error:response.error||null,
    durationMs:response.durationMs,offerCount:offers.length,returnedMerchants:[...detected],
    suspectTitles:suspect,partialErrors:Array.isArray(response.data?.errors)?response.data.errors.length:null,
    apiSucceeded:response.ok&&Array.isArray(response.data?.offers),
  });
  await new Promise(resolve=>setTimeout(resolve,1700));
}
const report={
  examinedAt:new Date().toISOString(),certificationRun:CERTIFIED_PILOT_RUN,
  pilotSources:CERTIFIED_PILOT_SOURCES.length,
  buildUnderTest:process.env.GITHUB_SHA||null,
  productionRevision:health.data?.revision||null,
  productionSameAsBuild:!!(health.data?.revision&&process.env.GITHUB_SHA&&
    health.data.revision.startsWith(process.env.GITHUB_SHA.slice(0,7))),
  publicSite:{ok:publicPage.ok,status:publicPage.status,searchFormPresent:!!publicPage.html?.includes("<form")},
  sameOriginSite:{ok:sameOriginPage.ok,status:sameOriginPage.status,searchFormPresent:!!sameOriginPage.html?.includes("<form")},
  health:{ok:health.ok,status:health.status,apiVersion:health.data?.apiVersion||null,configuredStorefronts:health.data?.liveProviders?.freeStorefronts?.length||0},
  runs,
  important:"Production website is tested as deployed, not the unmerged PR branch. Zero offers, 403, 429, or a blocked request is not a pass.",
};
await mkdir("site-smoke-report",{recursive:true});
await writeFile("site-smoke-report/report.json",JSON.stringify(report,null,2)+"\n");
const markdown=[
  "## NAWAA deployed website — read-only smoke test",
  "Pilot registry: **"+report.pilotSources+" sources** (prior certified), production revision: `"+(report.productionRevision||"not reported")+"`",
  "Unmerged pilot branch deployed? **"+(report.productionSameAsBuild?"YES":"NO / NOT CONFIRMED")+"**",
  "GitHub Pages search: **"+report.publicSite.status+"**; Render search: **"+report.sameOriginSite.status+"**; Render health: **"+report.health.status+"**",
  "",
  "| Search | HTTP | Live offers | Observed pilot merchants | Suspect examples |",
  "|---|---:|---:|---|---|",
  ...runs.map(r=>"| "+r.query+" | "+(r.status||r.error||"ERR")+" | "+r.offerCount+" | "+(r.returnedMerchants.join(", ")||"none recorded")+" | "+(r.suspectTitles.join("; ").slice(0,130)||"—")+" |"),
  "",
  "**Note:** A successful API query does NOT mean all 15 pilot sources are deployed or routed in the public site.",
].join("\n");
console.log(markdown);
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,markdown);
if(!report.publicSite.ok||!report.sameOriginSite.ok||!report.health.ok||runs.every(x=>!x.apiSucceeded)){
  process.exitCode=1;
}
