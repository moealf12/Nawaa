// Bounded, read-only production wiring audit. Only first-party NAWAA Pages
// and Render endpoints are fetched; merchant storefronts are NEVER requested.
// Checks actual published assets, API CORS, and exact GitHub/Render revision.
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import vm from "node:vm";

export const PAGES="https://moealf12.github.io/Nawaa";
export const API="https://nawaa-search-api.onrender.com";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const ASSETS=Object.freeze([
  "index.html","config.js","search.html","src/search-page.mjs",
  "product.html","src/product-page.mjs"
]);
const sha256=x=>createHash("sha256").update(x).digest("hex");
function invariant(ok,label){if(!ok)throw new Error(label)}

export function resolvedEntrypoint(configSource,hostname,origin){
  const sandbox={window:{},location:{hostname,origin}};
  vm.runInNewContext(configSource,sandbox,{timeout:400,filename:"config.js"});
  return {
    api:String(sandbox.window.NAWAA_API_BASE||""),
    search:String(sandbox.window.NAWAA_SEARCH_URL||""),
    quote:String(sandbox.window.NAWAA_QUOTE_URL||""),
  };
}

export function checkRoutingContract(files){
  const config=files["config.js"];
  invariant(typeof config==="string","CONFIG_MISSING");
  const pages=resolvedEntrypoint(config,"moealf12.github.io","https://moealf12.github.io");
  const render=resolvedEntrypoint(config,"nawaa-search-api.onrender.com",API);
  const local=resolvedEntrypoint(config,"127.0.0.1","http://127.0.0.1:3000");
  invariant(pages.api===API,"PAGES_API_WRONG_ORIGIN");
  invariant(pages.search===API+"/search.html","PAGES_CANONICAL_SEARCH_WRONG");
  invariant(render.api===API,"RENDER_SEARCH_NOT_SAME_ORIGIN");
  invariant(render.search==="./search.html","RENDER_SEARCH_ROUTE_WRONG");
  invariant(local.api==="http://127.0.0.1:3000","LOCAL_CANDIDATE_ROUTING_BROKEN");
  const index=files["index.html"]||"";
  const search=files["search.html"]||"";
  const client=files["src/search-page.mjs"]||"";
  const product=files["product.html"]||"";
  invariant(index.includes('src="./config.js"'),"LANDING_CONFIG_NOT_LOADED");
  invariant(index.includes('id="nawaaSearchForm"'),"LANDING_SEARCH_ENTRY_MISSING");
  invariant(search.includes('src="./config.js"'),"SEARCH_CONFIG_NOT_LOADED");
  invariant(search.includes('src="./src/search-page.mjs"'),"SEARCH_MODULE_NOT_LOADED");
  invariant(product.includes('src="./config.js"'),"PRODUCT_CONFIG_NOT_LOADED");
  invariant(client.includes('"/api/search/stream?q="'),"SSE_ENDPOINT_NOT_WIRED");
  invariant(client.includes('"/api/search?q="'),"JSON_ENDPOINT_NOT_WIRED");
  invariant(client.includes("window.NAWAA_API_BASE"),"CLIENT_IGNORES_RUNTIME_API");
  return {pagesApi:pages.api,pagesCanonicalSearch:pages.search,
    renderApi:render.api,localApi:local.api,quoteHost:new URL(pages.quote).hostname};
}

export function sourceFiles(){
  return Object.fromEntries(ASSETS.map(p=>[p,readFileSync(resolve(ROOT,p),"utf8")]));
}

async function getBounded(url,{fetchImpl=fetch,origin=null,maxBytes=300000}={}){
  invariant(url.startsWith(PAGES+"/")||url.startsWith(API+"/"),"OUT_OF_SCOPE_URL");
  const response=await fetchImpl(url,{
    method:"GET",redirect:"error",cache:"no-store",
    ...(origin?{headers:{origin}}:{}),
    signal:AbortSignal.timeout(10000),
  });
  invariant(response.status===200,"HTTP_"+response.status+"_"+new URL(url).hostname);
  const length=Number(response.headers.get("content-length")||0);
  invariant(length<=maxBytes,"LENGTH_LIMIT");
  const chunks=[];let received=0;
  if(response.body)for await(const chunk of response.body){
    received+=chunk.byteLength;
    invariant(received<=maxBytes,"BODY_LIMIT");
    chunks.push(Buffer.from(chunk));
  }
  return {text:Buffer.concat(chunks).toString("utf8"),headers:response.headers};
}

export async function verifyPublishedWiring({fetchImpl=fetch,files=sourceFiles(),expectedSha}={}){
  invariant(/^[0-9a-f]{40}$/.test(String(expectedSha||"")),"EXPECTED_SHA_REQUIRED");
  const contract=checkRoutingContract(files);
  const expected=Object.fromEntries(ASSETS.map(p=>[p,sha256(files[p])]));
  // Both the GitHub Pages customer UI and Render same-origin UI must serve
  // exactly the audited main-branch HTML, configuration and module code.
  const results=[];
  for(const [label,base] of [["pages",PAGES],["render",API]]){
    for(const name of ASSETS){
      const actual=await getBounded(base+"/"+name,{fetchImpl});
      invariant(sha256(actual.text)===expected[name],
        "ASSET_MISMATCH_"+label+"_"+name.replace(/[^a-z0-9]/gi,"_"));
      results.push(label+":"+name);
    }
  }
  const health=await getBounded(API+"/health",{fetchImpl,origin:"https://moealf12.github.io",maxBytes:50000});
  invariant(["*","https://moealf12.github.io"].includes(
    health.headers.get("access-control-allow-origin")),"PAGES_CORS_MISMATCH");
  const status=JSON.parse(health.text);
  invariant(status.ok===true && status.revision===expectedSha,"LIVE_REVISION_NOT_MAIN");
  invariant(status.liveProviders?.extra===true&&status.liveProviders?.jarir===true,
    "CORE_PROVIDERS_NOT_CONFIGURED");
  const sources=await getBounded(API+"/api/sources",{fetchImpl,origin:"https://moealf12.github.io",maxBytes:200000});
  invariant(["*","https://moealf12.github.io"].includes(
    sources.headers.get("access-control-allow-origin")),"SOURCES_CORS_MISMATCH");
  const sourceData=JSON.parse(sources.text);
  invariant(Array.isArray(sourceData.sources),"SOURCES_CONTRACT_MISSING");
  return {result:"PASS",sha:expectedSha,assetPairsVerified:results.length,
    sourceRegistryReachable:true,originFromPages:contract.pagesApi,
    canonicalSearchFromPages:contract.pagesCanonicalSearch,
    quoteLinkHost:contract.quoteHost,
    warnings:contract.quoteHost.endsWith(".chatgpt.site")?
      ["QUOTE_LINK_POINTS_TO_SEPARATE_LEGACY_SITE_NOT_TESTED"]:[]};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const result=await verifyPublishedWiring({expectedSha:process.env.NAWAA_EXPECT_LIVE_SHA});
    console.log("NAWAA_PRODUCTION_WIRING "+JSON.stringify(result));
  }catch(error){
    // Do not print untrusted response bodies or URLs with query parameters.
    console.error("NAWAA_PRODUCTION_WIRING "+JSON.stringify({
      result:"FAIL",reason:String(error?.message||"UNKNOWN").slice(0,180)
    }));
    process.exitCode=1;
  }
}
