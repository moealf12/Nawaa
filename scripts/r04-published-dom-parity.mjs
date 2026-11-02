// Read-only browser parity: compare the same live SSE session with its DOM.
// Honest failure for independent fallback JSON, unknown grades or mismatched UI.
import {chromium} from "playwright";
import {existsSync,readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {groupComparableOffers,buildDiscoverySections} from "../src/search-core.mjs";
import {parseSearchIntent} from "../src/search-query.mjs";
import {provisionalLabel} from "./verify-r04-live-ranking.mjs";
import {compareR04DomOrder} from "./r04-dom-parity-contract.mjs";

const ORIGIN="https://moealf12.github.io/Nawaa";
const API="https://nawaa-search-api.onrender.com";
const expected=String(process.env.NAWAA_EXPECT_LIVE_SHA||"");
const cases=[
  {id:"Q03",query:"Samsung Galaxy S25 Ultra",kind:"galaxy"},
  {id:"Q04",query:"سامسونج جالكسي S25 الترا",kind:"galaxy"},
  {id:"Q15",query:"HP laptop 16GB RAM",kind:"laptop"},
  {id:"Q16",query:"لابتوب اتش بي 16 رام",kind:"laptop"},
];
const report={schemaVersion:"nawaa.r04.published-ui-parity.v1",observedAt:new Date().toISOString(),
  expectedBackendSha:expected,observedBackendSha:null,frontendSourceMatch:null,
  rows:[],pass:false,provenance:"INDEPENDENT_PRECOMMITTED_RULE_LABELS_NOT_HUMAN_ADJUDICATION",
  limitations:["Four sampled intents are not all 36 queries.",
    "This compares the SAME intercepted SSE event to actual DOM, not independent JSON and SSE responses.",
    "Any UI recovery JSON call is reported as a separate lineage and fails this same-SSE assertion.",
    "Exact frontend source asset is checked; no claim of a perfect full-site build attestation."]};
const sha=x=>createHash("sha256").update(x).digest("hex");
const err=e=>String(e?.message||e?.name||"UNKNOWN").slice(0,140);
let browser;
try{
  if(!/^[a-f0-9]{40}$/.test(expected))throw Error("EXPECTED_SHA_INVALID");
  const response=await fetch(API+"/health",{signal:AbortSignal.timeout(20000),redirect:"error"});
  if(response.status!==200)throw Error("HEALTH_HTTP_FAILED");
  const h=await response.json();report.observedBackendSha=h?.revision??null;
  if(!h?.ok||h.revision!==expected)throw Error("LIVE_REVISION_MISMATCH");
  const deployed=await fetch(ORIGIN+"/src/search-page.mjs",{
    headers:{"cache-control":"no-cache"},signal:AbortSignal.timeout(20000),redirect:"error"});
  if(deployed.status!==200)throw Error("PUBLISHED_UI_ASSET_MISSING");
  report.frontendSourceMatch=sha(await deployed.text())===sha(readFileSync("src/search-page.mjs","utf8"));
  if(!report.frontendSourceMatch)throw Error("PUBLISHED_UI_REVISION_MISMATCH");
  const executable=["/usr/bin/google-chrome","/usr/bin/google-chrome-stable","/usr/bin/chromium"].find(existsSync);
  if(!executable)throw Error("CHROMIUM_NOT_AVAILABLE");
  browser=await chromium.launch({executablePath:executable,headless:true,
    args:["--no-sandbox","--disable-dev-shm-usage"]});
  for(const t of cases){
    const item={id:t.id,status:"UNKNOWN",streamDone:false,snapshots:0,offers:0,
      visibleGroups:0,extraJsonRequests:0,parity:false,rankOne:null,
      wrongTopTen:0,unknownTopTen:0,errors:[],elapsedMs:null};
    report.rows.push(item);const started=Date.now();
    const context=await browser.newContext({viewport:{width:1365,height:850},locale:"ar-SA",
      timezoneId:"Asia/Riyadh",serviceWorkers:"block"});
    try{
      await context.addInitScript(()=>{
        const Native=window.EventSource;
        window.__r04Sse={done:false,snapshots:0,last:null,lastWithOffers:null};
        if(!Native)return;
        window.EventSource=class extends Native{
          constructor(...args){
            super(...args);
            this.addEventListener("snapshot",event=>{
              try{const data=JSON.parse(event.data);window.__r04Sse.snapshots++;
                window.__r04Sse.last=data;
                if(Array.isArray(data?.offers)&&data.offers.length)
                  window.__r04Sse.lastWithOffers=data;
              }catch{}
            });
            this.addEventListener("done",()=>{window.__r04Sse.done=true;});
          }
        };
      });
      const page=await context.newPage();
      page.on("request",request=>{
        try{const u=new URL(request.url());
          if(u.host==="nawaa-search-api.onrender.com"&&u.pathname==="/api/search")
            item.extraJsonRequests++;
        }catch{}
      });
      const nav=await page.goto(ORIGIN+"/search.html?q="+encodeURIComponent(t.query),{
        waitUntil:"domcontentloaded",timeout:45000});
      if(nav?.status()!==200)throw Error("PAGE_HTTP_FAILED");
      await page.waitForFunction(()=>window.__r04Sse?.done===true,null,{timeout:48000});
      await page.waitForTimeout(1700);
      const seen=await page.evaluate(()=>({
        sse:window.__r04Sse,
        dom:[...document.querySelectorAll("#results .match-results-section .match-result-card")]
          .map(x=>({key:x.dataset.groupKey||"",
            title:x.querySelector(".match-card-copy strong")?.textContent?.trim()||""})),
      }));
      item.streamDone=seen.sse.done;item.snapshots=seen.sse.snapshots;
      const packet=seen.sse.last?.offers?.length?seen.sse.last:seen.sse.lastWithOffers;
      if(!packet?.offers?.length)throw Error("SSE_NO_OFFERS");
      item.offers=packet.offers.length;
      const intent=parseSearchIntent(t.query);
      const exact=groupComparableOffers(packet.offers,"lowest").filter(g=>
        g.bestOffer?.exactMatch===true&&(g.bestOffer.matchConfidence||0)>=0.9&&
        g.bestOffer.condition===(intent.condition||"new"));
      const expectedGroups=buildDiscoverySections(t.query,exact).flatMap(x=>x.groups.slice(0,10));
      const parity=compareR04DomOrder({
        expectedKeys:expectedGroups.map(x=>x.key),
        domKeys:seen.dom.map(x=>x.key),streamDone:item.streamDone,
        recoveryRequests:item.extraJsonRequests,
      });
      item.visibleGroups=seen.dom.length;item.parity=parity.pass;
      item.errors.push(...parity.failures);
      if(parity.pass){
        const labels=expectedGroups.slice(0,10).map(g=>provisionalLabel(t.kind,g.bestOffer));
        item.rankOne=labels[0]?.grade??null;
        item.wrongTopTen=labels.filter(x=>x.grade===0).length;
        item.unknownTopTen=labels.filter(x=>!Number.isInteger(x.grade)).length;
        if(item.rankOne!==3)item.errors.push("TOP1_NOT_STRICTLY_CONFIRMED");
        if(item.wrongTopTen)item.errors.push("KNOWN_WRONG_TOP10");
        if(item.unknownTopTen)item.errors.push("UNJUDGED_TOP10");
      }
      item.status=item.errors.length?"FAIL":"PASS";
    }catch(error){item.errors.push(err(error));item.status="FAIL";}
    finally{item.elapsedMs=Date.now()-started;await context.close();}
    console.log("R04_DOM_QUERY "+JSON.stringify(item));
  }
}catch(error){report.fatal=err(error);console.log("R04_DOM_FATAL "+report.fatal);}
finally{if(browser)await browser.close();}
report.completedAt=new Date().toISOString();
report.pass=!report.fatal&&report.rows.length===cases.length&&report.rows.every(x=>x.status==="PASS");
writeFileSync("r04-published-dom-parity.json",JSON.stringify(report,null,2)+"\n");
console.log("R04_DOM_SUMMARY "+JSON.stringify({pass:report.pass,queries:report.rows.length,
  passed:report.rows.filter(x=>x.status==="PASS").length,
  sourceShaMatch:report.frontendSourceMatch,backendSha:report.observedBackendSha,
  fatal:report.fatal||null}));
if(!report.pass)process.exitCode=1;