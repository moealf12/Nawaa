#!/usr/bin/env node
// One-shot, operator-reported authorized Google Shopping browser check.
// Uses unmodified Chromium and standard browser navigation. No stealth,
// rotating fingerprints, proxy, CAPTCHA handling, credentials or source writes.
import {writeFile} from "node:fs/promises";
import {authorizedGoogleShoppingSearchUrl,extractAuthorizedGoogleShoppingHtml}
  from "../server/providers/google-shopping-authorized.mjs";

const ok=process.env.NAWAA_GOOGLE_SHOPPING_DIRECT_AUTHORIZED==="1";
const report={
  schema:"nawaa.google-shopping.authorized-browser-live.v1",
  observedAt:new Date().toISOString(),
  headSha:process.env.PULL_REQUEST_HEAD_SHA||null,
  permission:"OPERATOR_REPORTED_EXTRACTION_AUTHORIZATION",
  method:"UNMODIFIED_CHROMIUM_NO_PROXY_NO_PAID_API",
  enabled:ok,tries:[],candidateCount:0,verifiedPdpPrices:0,rankableOffers:0,
  status:ok?"PROBING":"NOT_RUN_NOT_AUTHORIZED",
};
const outfile="google-shopping-authorized-browser-live.json";
let browser;
try{
  if(ok){
    const {chromium}=await import("playwright");
    const launchOptions={headless:true};
    if(process.env.NAWAA_CHROME_EXECUTABLE)
      launchOptions.executablePath=process.env.NAWAA_CHROME_EXECUTABLE;
    browser=await chromium.launch(launchOptions);
    const context=await browser.newContext({
      locale:"ar-SA",timezoneId:"Asia/Riyadh",
      viewport:{width:1280,height:900},
      acceptDownloads:false,serviceWorkers:"block",
    });
    for(const item of [
      {id:"en_phone",query:"iPhone 17 256GB"},
      {id:"ar_audio",query:"سماعات بلوتوث"},
    ]){
      const rec={id:item.id,http:null,title:null,urlPath:null,
        htmlBytes:0,cards:0,parserStatus:null,shopProductAnchors:0};
      const page=await context.newPage();
      try{
        const response=await page.goto(authorizedGoogleShoppingSearchUrl(item.query),{
          waitUntil:"domcontentloaded",timeout:12000,
        });
        rec.http=response?.status()||null;
        rec.urlPath=new URL(page.url()).pathname;
        // Give first-party client-side hydration a bounded opportunity.
        await page.waitForTimeout(1600);
        const html=await page.content();
        rec.htmlBytes=Buffer.byteLength(html);
        rec.title=(await page.title()).slice(0,130);
        rec.shopProductAnchors=await page.locator('a[href*="/shopping/product/"]').count();
        const out=extractAuthorizedGoogleShoppingHtml(html,{
          query:item.query,
          sourceUrl:authorizedGoogleShoppingSearchUrl(item.query),
        });
        rec.parserStatus=out.status;
        rec.cards=out.cards.length;
        rec.priceCardCurrencies=[...new Set(out.cards.map(x=>x.currency))];
        rec.merchantDomains=[...new Set(out.cards.map(x=>new URL(x.merchantUrl).hostname))].slice(0,10);
        report.candidateCount+=rec.cards;
      }catch(e){
        rec.parserStatus=e?.name==="TimeoutError"?"BROWSER_TIMEOUT":
          e?.message?.includes("Timeout")?"BROWSER_TIMEOUT":"BROWSER_NAVIGATION_ERROR";
      }finally{
        report.tries.push(rec);
        await page.close();
      }
    }
    await context.close();
    report.status=report.candidateCount?
      "UNVERIFIED_BROWSER_CANDIDATES":"NO_COMPLETE_BROWSER_PRODUCT_CARDS";
  }
}catch(e){
  report.status="BROWSER_START_FAILED";
  report.errorClass=e?.name||"Error";
}finally{
  await browser?.close().catch(()=>{});
  await writeFile(outfile,JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
}
