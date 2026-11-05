#!/usr/bin/env node
// Read-only Chromium probe for JS-rendered 1688 search, motivated by HTTP 200
// thin HTML shells. This is not a crawler, credential workaround, or publisher.
// No stealth, proxy, captcha solving, retries, or leaked HTML/cookies.
import {writeFile} from "node:fs/promises";
import {inspect1688SearchEvidence} from "../src/1688-html-evidence.mjs";
const SEARCH_URL="https://s.1688.com/selloffer/offer_search.htm?keywords=%C0%B6%D1%C0%B6%FA%BB%FA";
const result={
  schema:"nawaa.1688.chromium-single-navigation.v1",
  observedAt:new Date().toISOString(),
  headSha:process.env.PULL_REQUEST_HEAD_SHA||null,
  sourceId:"1688-cn",method:"noon_browser_actual_chromium",
  queryEncoding:"GB18030",proxies:false,stealth:false,
  customerPublished:false,pdpPriceVerified:0,
  maxNavigations:1,navigations:0,
};
let browser;
const start=performance.now();
try {
  const {chromium}=await import("playwright");
  const executablePath=process.env.NAWAA_CHROME_EXECUTABLE || undefined;
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  const context=await browser.newContext({
    locale:"zh-CN",viewport:{width:1280,height:850},
  });
  const page=await context.newPage();
  result.navigations++;
  const response=await page.goto(SEARCH_URL,{waitUntil:"domcontentloaded",timeout:12000});
  result.navigationStatus=response?.status()??null;
  const final=new URL(page.url());
  result.finalHost=final.hostname;
  result.finalPath=final.pathname.slice(0,100);
  if(!["s.1688.com","www.1688.com"].includes(final.hostname) ||
      final.pathname.includes("punish") || final.pathname.includes("login")){
    result.state="REDIRECT_TO_LOGIN_OR_UNEXPECTED_HOST";
  } else if(result.navigationStatus===403||result.navigationStatus===429) {
    result.state="ACCESS_DENIED_OR_RATE_LIMITED";
  } else if(result.navigationStatus!==200) {
    result.state="NAVIGATION_NOT_OK";
  } else {
    // Bounded wait for ordinary client-side hydration (not a captcha/verification).
    await page.locator('a[href*="detail.1688.com/offer/"]').first().waitFor({
      state:"attached",timeout:3500
    }).catch(()=>{});
    const html=await page.content();
    result.evidence=inspect1688SearchEvidence(html,{
      status:200,contentType:"text/html",query:"蓝牙耳机",
    });
    result.state=result.evidence.state;
    result.finalTitleLength=(await page.title()).length;
  }
}catch(e){
  const message=String(e?.message||"");
  result.errorKind=e?.name==="TypeError"?"IMPLEMENTATION_TYPE_ERROR":"RUNTIME_OR_BROWSER_ERROR";
  result.state=/timeout/i.test(message)?"BROWSER_TIMEOUT":
    /Executable doesn't exist|not found/i.test(message)?"BROWSER_BINARY_MISSING":
    /net::ERR_/.test(message)?"BROWSER_NETWORK_ERROR":"BROWSER_ERROR";
}finally{
  await browser?.close().catch(()=>{});
  result.elapsedMs=Math.round(performance.now()-start);
  result.customerPublicationEligible=false;
  await writeFile("1688-chromium-one-shot.json",JSON.stringify(result,null,2)+"\n");
  console.log(JSON.stringify(result,null,2));
}
