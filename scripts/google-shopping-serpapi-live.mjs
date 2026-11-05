#!/usr/bin/env node
// One live SerpApi Google Shopping acquisition (if a GitHub secret is available).
// No synthetic evidence, no merchant spoofing, no customer publication.
import {writeFile} from "node:fs/promises";
import {createGoogleShoppingResultsClient} from "../server/google-shopping-results.mjs";
const report={
  schema:"nawaa.google-shopping.external-results-live.v1",
  exactHeadSha:process.env.PULL_REQUEST_HEAD_SHA||null,
  observedAt:new Date().toISOString(),
  live:true,source:"google-shopping",provider:"SerpApi",
  queryCategory:"smartphone",
  queryLocale:"sa/ar",verifiedMerchantPdpPrices:0,
  publishableOffers:0,customerPriceRankingChanged:false,
  status:"NOT_RUN",
};
try{
  const apiKey=process.env.SERPAPI_API_KEY||"";
  if(!apiKey||apiKey.length<12) {
    report.status="NOT_TESTED_API_KEY_UNAVAILABLE";
  }else {
    const client=createGoogleShoppingResultsClient({
      apiKey,enabled:true,monthlyCap:1,
    });
    const started=performance.now();
    const result=await client.run("iPhone 17 256GB");
    report.elapsedMs=Math.round(performance.now()-started);
    report.http=result.status;
    report.cardCount=result.body?.cards?.length||0;
    report.providerState=result.body?.state||result.body?.error||"UNKNOWN";
    report.withDisplayedPrices=(result.body?.cards||[]).filter(x=>x.displayedPrice).length;
    report.withProductLinks=(result.body?.cards||[]).filter(x=>x.productUrl).length;
    report.status=result.status===200&&report.cardCount>0 ?
      "LIVE_UNVERIFIED_CARDS_ACQUIRED" : "LIVE_ACQUISITION_NOT_PROVEN";
    // Do not retain raw products, client queries, API credentials, or responses.
  }
}catch(e){
  report.status="LIVE_TRANSPORT_FAILURE";
  report.errorClass=e?.name==="TimeoutError"?"TIMEOUT":"OTHER";
}finally{
  console.log(JSON.stringify(report,null,2));
  await writeFile("google-shopping-serpapi-live.json",JSON.stringify(report,null,2)+"\n");
}
