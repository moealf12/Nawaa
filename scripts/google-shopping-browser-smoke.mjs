#!/usr/bin/env node
// Real Chromium DOM acceptance of staged Google Shopping user handoff.
// Runs a local static server. Blocks ALL remote requests; never queries Google.
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {resolve,extname,sep} from "node:path";

const ROOT=resolve(".");
const EXTENSIONS={
  ".html":"text/html; charset=utf-8",
  ".mjs":"text/javascript; charset=utf-8",
  ".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",
  ".svg":"image/svg+xml",
  ".json":"application/json; charset=utf-8",
};
const stats={viewports:[],remoteRequestsBlocked:0,priceOfferMutation:false};
const server=createServer(async (req,res)=>{
  try{
    const path=new URL(req.url,"http://127.0.0.1").pathname;
    const full=resolve(ROOT,"."+path);
    if(!(full===ROOT||full.startsWith(ROOT+sep)))throw Error("BAD_PATH");
    const contentType=EXTENSIONS[extname(full)];
    if(!contentType)throw Error("UNSUPPORTED_FILE");
    const bytes=await readFile(full);
    res.writeHead(200,{"content-type":contentType,"cache-control":"no-store"});
    res.end(bytes);
  }catch{res.writeHead(404);res.end();}
});
let browser;
try{
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const base="http://127.0.0.1:"+server.address().port;
  const {chromium}=await import("playwright");
  browser=await chromium.launch({headless:true,...(
    process.env.NAWAA_CHROME_EXECUTABLE?{executablePath:process.env.NAWAA_CHROME_EXECUTABLE}:{})});
  for(const viewport of [{width:390,height:844},{width:1366,height:900}]){
    const context=await browser.newContext({viewport,locale:"ar-SA"});
    // Never request anything external, even fonts or Google's search page.
    await context.route("**/*",route=>{
      const u=new URL(route.request().url());
      if(u.hostname==="127.0.0.1")return route.continue();
      stats.remoteRequestsBlocked++;
      return route.abort("blockedbyclient");
    });
    const page=await context.newPage();
    const errors=[];
    page.on("pageerror",err=>errors.push(String(err.message).slice(0,120)));
    await page.goto(base+"/search.html",{waitUntil:"domcontentloaded",timeout:12000});
    const input=page.locator("#searchInput");
    const lane=page.locator("#googleShoppingDiscovery");
    const link=page.locator("#googleShoppingDiscoverLink");
    if(await lane.isVisible())throw Error("DISCOVERY_VISIBLE_WHEN_EMPTY");
    await input.fill("سماعات Bluetooth 🎧 2026");
    if(!await lane.isVisible())throw Error("DISCOVERY_HIDDEN_WITH_VALID_QUERY");
    const href=await link.getAttribute("href");
    const url=new URL(href);
    if(url.origin!=="https://www.google.com" || url.pathname!=="/search" ||
        url.searchParams.get("tbm")!=="shop" ||
        url.searchParams.get("q")!=="سماعات Bluetooth 🎧 2026" ||
        url.searchParams.get("gl")!=="sa" || url.searchParams.get("hl")!=="ar")
      throw Error("UNSAFE_OR_LOSSY_GOOGLE_SEARCH_URL");
    if(await link.getAttribute("target")!=="_blank" ||
        !(await link.getAttribute("rel")).includes("noopener") ||
        !(await link.getAttribute("rel")).includes("noreferrer"))
      throw Error("EXTERNAL_NAVIGATION_NOT_ISOLATED");
    await input.fill("https://merchant.example/p/123?token=secret");
    if(await lane.isVisible()||await link.getAttribute("href")!==null)
      throw Error("PRIVATE_URL_ACCIDENTALLY_EXPORTED");
    await input.fill("");
    if(await lane.isVisible())throw Error("DISCOVERY_REMAINS_VISIBLE_AFTER_CLEAR");
    if(errors.length)throw Error("BROWSER_PAGEERROR:"+errors.join("|"));
    stats.viewports.push({width:viewport.width,passed:true});
    await context.close();
  }
  console.log(JSON.stringify({status:"PASS",...stats}));
}catch(e){
  console.log(JSON.stringify({status:"FAIL",reason:String(e?.message||e),...stats}));
  process.exitCode=1;
}finally{
  await browser?.close().catch(()=>{});
  await new Promise(resolve=>server.close(resolve));
}
