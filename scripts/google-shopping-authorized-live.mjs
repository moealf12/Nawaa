#!/usr/bin/env node
// Operator reports Google authorization covering product title, image, price
// and ORIGINAL merchant link. Experimental HTTP probe only; no publication.
// Transparent UA; no rotating headers, authentication, cookies or CAPTCHA handling.
import {writeFile} from "node:fs/promises";
import {authorizedGoogleShoppingSearchUrl,extractAuthorizedGoogleShoppingHtml} from
  "../server/providers/google-shopping-authorized.mjs";

const authorized=process.env.NAWAA_GOOGLE_SHOPPING_DIRECT_AUTHORIZED==="1";
const intents=[
  {id:"en_phone",query:"iPhone 17 256GB"},
  {id:"ar_audio",query:"سماعات بلوتوث"},
];
const report={
  schema:"nawaa.google-shopping.direct-authorized-live.v1",
  observedAt:new Date().toISOString(),
  exactHeadSha:process.env.PULL_REQUEST_HEAD_SHA||null,
  method:"HTTP_HTML_NO_PROXY_NO_PAID_API",
  permission:"OPERATOR_REPORTED_EXTRACTION_AUTHORIZATION",
  authorizationToggle:authorized,
  runs:[],attemptedNetworkRequests:0,totalCandidateCards:0,
  candidateCardsWithAllFields:0,verifiedPdpPrices:0,rankableOffers:0,
  state:authorized?"PROBING":"DISABLED_NO_AUTHORIZATION_TOGGLE"
};
const filename="google-shopping-authorized-direct-live.json";
const MAX_BYTES=1_200_000;
async function fetchHtml(url,{redirectsLeft=1,history=[]}={}){
  const u=new URL(url);
  if(u.origin!=="https://www.google.com")throw Error("INVALID_ORIGIN");
  report.attemptedNetworkRequests++;
  const response=await fetch(url,{
    method:"GET",redirect:"manual",signal:AbortSignal.timeout(8500),
    headers:{
      "user-agent":"NAWAA-PublicSourceIndexer/1.0 (+https://github.com/moealf12/Nawaa)",
      accept:"text/html,application/xhtml+xml",
    },
  });
  if([301,302,307,308].includes(response.status)&&response.headers.has("location")){
    const next=new URL(response.headers.get("location"),url);
    const nextHistory=[...history,{status:response.status,host:next.hostname,path:next.pathname}];
    if(redirectsLeft>0&&next.origin==="https://www.google.com"&&
       /^\/(?:search|shopping(?:\/search)?)$/.test(next.pathname)){
      return fetchHtml(next.href,{redirectsLeft:redirectsLeft-1,history:nextHistory});
    }
    return {http:response.status,contentType:response.headers.get("content-type"),
      bytes:0,html:"",redirect:true,redirectHistory:nextHistory};
  }
  if(response.status!==200||!String(response.headers.get("content-type")).includes("text/html"))
    return {http:response.status,contentType:response.headers.get("content-type"),
      bytes:0,html:"",redirect:response.headers.has("location"),redirectHistory:history};
  const chunks=[];let size=0;
  const advertised=Number(response.headers.get("content-length"));
  if(Number.isFinite(advertised)&&advertised>MAX_BYTES)throw Error("RESPONSE_TOO_LARGE");
  for await(const part of response.body||[]){
    size+=part.byteLength;
    if(size>MAX_BYTES)throw Error("RESPONSE_TOO_LARGE");
    chunks.push(Buffer.from(part));
  }
  return {http:response.status,contentType:"text/html",bytes:size,
    html:Buffer.concat(chunks).toString("utf8"),redirect:false,redirectHistory:history};
}
try{
  if(authorized){
    for(const intent of intents){
      const url=authorizedGoogleShoppingSearchUrl(intent.query);
      if(!url)throw Error("QUERY_REJECTED");
      const evidence={id:intent.id,http:null,bytes:0,completeCards:0};
      try{
        const result=await fetchHtml(url);
        evidence.http=result.http;
        evidence.bytes=result.bytes;
        evidence.redirect=result.redirect;
        evidence.redirectHistory=result.redirectHistory||[];
        if(result.http===200&&result.html){
          const parsed=extractAuthorizedGoogleShoppingHtml(result.html,{
            query:intent.query,sourceUrl:url,
          });
          evidence.parserStatus=parsed.status;
          evidence.pageTitle=parsed.pageTitle;
          evidence.completeCards=parsed.cards.length;
          evidence.cardsWithPrice=parsed.cards.filter(x=>x.displayedPrice).length;
          evidence.cardsWithImage=parsed.cards.filter(x=>x.image).length;
          evidence.cardsWithMerchantUrl=parsed.cards.filter(x=>x.merchantUrl).length;
          evidence.currencies=[...new Set(parsed.cards.map(x=>x.currency))];
          evidence.merchantDomains=[...new Set(parsed.cards.map(x=>new URL(x.merchantUrl).hostname))].slice(0,12);
          report.totalCandidateCards+=parsed.cards.length;
          report.candidateCardsWithAllFields+=parsed.cards.length;
        }else{
          evidence.parserStatus="HTTP_OR_CONTENT_TYPE_UNAVAILABLE";
        }
      }catch(e){
        evidence.parserStatus=e?.name==="TimeoutError"?"TIMEOUT":
          e?.message==="RESPONSE_TOO_LARGE"?"RESPONSE_TOO_LARGE":"FETCH_ERROR";
      }
      report.runs.push(evidence);
    }
    report.state=report.totalCandidateCards>0?
      "LIVE_FOUR_FIELD_UNVERIFIED_CANDIDATES":"LIVE_ZERO_COMPLETE_FOUR_FIELD_CARDS";
  }
}finally{
  await writeFile(filename,JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
}
