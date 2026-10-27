// One-off, source-scoped browser diagnostic. NOT a production crawler.
// Node >=22, only built-ins and the project's existing source classifier.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectSamsungSearchDiscovery } from "../server/providers/free-storefronts.mjs";

const URL_SEARCH="https://www.samsung.com/sa_en/search/?searchvalue=galaxy%20s25";
const MAX_HTML_BYTES=5_000_000;
const CHROME_TIMEOUT_MS=22_000;

// Serialize only benign counts and path components. Do not persist raw
// merchant HTML, cookies, query parameters, page scripts or product prices.
export function summarizeSamsungHtml(html, searchUrl=URL_SEARCH) {
  if (typeof html!=="string" || !html.length) return {
    htmlBytes:0, sha256:null, status:"NO_HTML", discovery:null
  };
  const htmlBytes=Buffer.byteLength(html,"utf8");
  if (htmlBytes>MAX_HTML_BYTES) return {
    htmlBytes, sha256:null, status:"HTML_LIMIT_EXCEEDED", discovery:null
  };
  const evidence=inspectSamsungSearchDiscovery(html,searchUrl,"galaxy s25");
  return {
    htmlBytes, sha256:createHash("sha256").update(html).digest("hex"),
    status:"PARSED",
    discovery:{
      requestedModel:evidence.requestedModel,
      modelLinkOutcome:evidence.modelLinkOutcome,
      sampledCandidates:evidence.sampledCandidates,
      sampleTruncated:evidence.sampleTruncated,
      productBuyPdp:evidence.productBuyPdp,
      exactModelBuyPdp:evidence.exactModelBuyPdp,
      offModelBuyPdp:evidence.offModelBuyPdp,
      unknownModelBuyPdp:evidence.unknownModelBuyPdp,
      nonPurchaseCandidates:evidence.nonPurchaseCandidates,
      exactModelPaths:evidence.exactModelPaths,
      offModelPaths:evidence.offModelPaths,
      unknownModelPaths:evidence.unknownModelPaths,
    },
  };
}

export function compareSamsungHtml(raw, rendered) {
  const rawExact=raw?.discovery?.exactModelBuyPdp;
  const browserExact=rendered?.discovery?.exactModelBuyPdp;
  return {
    // Exact link only: not selected variant, price, availability, or delivery.
    newExactModelPdpAfterJs:Number.isInteger(rawExact)&&Number.isInteger(browserExact) &&
      rawExact===0 && browserExact>0,
    identicalHtmlHash:!!raw?.sha256&&!!rendered?.sha256&&raw.sha256===rendered.sha256,
    finding:rendered?.status!=="PARSED"?"BROWSER_EVIDENCE_UNAVAILABLE":
      raw?.status!=="PARSED"?"BASELINE_HTML_UNAVAILABLE":
      Number(browserExact)>Number(rawExact)?"ADDITIONAL_EXACT_PDP_LINKS_AFTER_JS":
      "NO_ADDITIONAL_EXACT_PDP_LINKS_OBSERVED",
    verifiedPrice:false,
  };
}

async function fetchRawSearchHtml() {
  try {
    const response=await fetch(URL_SEARCH,{
      headers:{
        accept:"text/html,application/xhtml+xml",
        "accept-language":"en-US,en;q=0.9"
      },
      redirect:"follow",
      signal:AbortSignal.timeout(8500),
    });
    const finalUrl=new URL(response.url);
    if(finalUrl.protocol!=="https:" ||
        !["www.samsung.com","samsung.com"].includes(finalUrl.hostname.toLowerCase())) {
      return {status:"UNTRUSTED_REDIRECT",html:"",httpStatus:response.status};
    }
    const type=response.headers.get("content-type")||"";
    if(!response.ok || !/text\/html|application\/xhtml\+xml/i.test(type)) {
      return {status:"HTTP_UNAVAILABLE",httpStatus:response.status,html:""};
    }
    const advertised=Number(response.headers.get("content-length"));
    if(Number.isFinite(advertised)&&advertised>MAX_HTML_BYTES) {
      return {status:"HTML_LIMIT_EXCEEDED",html:""};
    }
    const html=await response.text();
    return {status:"FETCHED",httpStatus:response.status,html};
  } catch(error) {
    return {status:error?.name==="TimeoutError"?"TIMEOUT":"FETCH_FAILED",html:""};
  }
}

function installedChrome() {
  for (const exe of [
    process.env.CHROME_BIN,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/opt/google/chrome/chrome",
  ]) if(exe && exe.startsWith("/") && existsSync(exe)) return exe;
  return null;
}

function fetchBrowserDom() {
  const bin=installedChrome();
  if(!bin) return {status:"CHROME_MISSING",html:""};
  const userDir=mkdtempSync(join(tmpdir(),"nawaa-samsung-chrome-"));
  try {
    // One browser/navigation. Chromium renders public first-party JS.
    // No stealth, proxy, captcha bypass, additional PDP visits or persistent
    // sessions. Browser sandbox remains enabled on the hosted runner.
    const args=[
      "--headless=new","--disable-gpu","--disable-dev-shm-usage",
      "--no-first-run","--no-default-browser-check",
      "--virtual-time-budget=7000","--dump-dom",
      "--window-size=1280,900",
      "--user-data-dir="+userDir,
      URL_SEARCH,
    ];
    const result=spawnSync(bin,args,{
      encoding:"utf8",timeout:CHROME_TIMEOUT_MS,maxBuffer:MAX_HTML_BYTES+1_000_000
    });
    if(result.error?.code==="ETIMEDOUT")return {status:"BROWSER_TIMEOUT",html:""};
    if(result.error || result.status!==0)return {status:"BROWSER_FAILED",html:""};
    if(!result.stdout?.includes("<html"))return {status:"BROWSER_NO_DOM",html:""};
    return {status:"RENDERED",html:result.stdout};
  } finally {rmSync(userDir,{recursive:true,force:true});}
}

export async function runSamsungBrowserForensics(){
  const raw=await fetchRawSearchHtml();
  const rendered=fetchBrowserDom();
  const rawSummary=summarizeSamsungHtml(raw.html);
  const renderSummary=summarizeSamsungHtml(rendered.html);
  return {
    schemaVersion:"nawaa.samsung-browser-diagnostic.v1",
    sourceId:"samsung-sa",
    requestedModel:"galaxy s25",
    method:"one direct public HTML fetch; one headless Chromium DOM rendering",
    acquisition:{rawStatus:raw.status,browserStatus:rendered.status,httpStatus:raw.httpStatus??null},
    raw:rawSummary,
    rendered:renderSummary,
    comparison:compareSamsungHtml(rawSummary,renderSummary),
    caveats:[
      "Observed URLs are search candidates, not verified purchasable offers.",
      "No variant-specific price is inferred from S25 family landing pages.",
      "Empty browser evidence is not proof of product unavailability."
    ]
  };
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const output=resolve(process.env.SAMSUNG_BROWSER_REPORT||"samsung-browser-forensics.json");
  try{
    const result=await runSamsungBrowserForensics();
    mkdirSync(resolve(output,".."),{recursive:true});
    writeFileSync(output,JSON.stringify(result,null,2)+"\n");
    process.stdout.write(JSON.stringify(result,null,2)+"\n");
    if(result.acquisition.browserStatus!=="RENDERED"){
      process.stderr.write("Browser observation unavailable; no customer-facing claim certified\n");
      process.exitCode=2;
    }
  } catch {
    process.stderr.write("Samsung browser diagnostic failed safely; no merchant data persisted\n");
    process.exitCode=2;
  }
}
