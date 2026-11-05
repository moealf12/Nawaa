#!/usr/bin/env node
// Operator-reported merchant green light: one direct public search HTTP probe.
// Diagnostic only: not a robots-cleared crawler and never customer-publishable.
import {writeFile} from "node:fs/promises";
import {inspect1688SearchEvidence} from "../src/1688-html-evidence.mjs";
const URL="https://s.1688.com/selloffer/offer_search.htm?keywords=%C0%B6%D1%C0%B6%FA%BB%FA";
const MAX_BYTES=2_000_000;
const result={
  schema:"nawaa.1688.jarir-single-probe.v1",
  headSha:process.env.PULL_REQUEST_HEAD_SHA||null,
  observedAt:new Date().toISOString(),
  sourceId:"1688-cn",method:"jarir_single_first_party_html_get",
  queryEncoding:"GB18030",queryCategory:"bluetooth-headphones",
  maxRequests:1,retries:0,proxies:false,followRedirects:false,
  customerPublished:false,sourceRobotsCleared:false,
  pdpPriceVerified:0,
};
const started=performance.now();
try {
  const response=await fetch(URL,{
    redirect:"manual",signal:AbortSignal.timeout(9000),
    headers:{
      accept:"text/html,application/xhtml+xml",
      "accept-language":"zh-CN,zh;q=0.9",
      "user-agent":"NAWAA-PublicSourceIndexer/1.0 (+https://github.com/moealf12/Nawaa)",
    },
  });
  result.requests=1;
  result.status=response.status;
  result.contentType=response.headers.get("content-type")||null;
  const location=response.headers.get("location");
  if(location){
    try {
      const target=new URL(location,URL);
      result.redirectHost=target.hostname;
      result.redirectPath=target.pathname.slice(0,80);
      result.redirectClass=target.hostname.endsWith(".1688.com") ?
        "FIRST_PARTY_REDIRECT" : "OTHER_REDIRECT";
    }catch{result.redirectClass="INVALID_REDIRECT"}
  }
  if(response.status===200 && /^text\/html/i.test(result.contentType||"")){
    let size=0;const chunks=[];
    try{
      for await(const chunk of response.body||[]){
        size+=chunk.byteLength;
        if(size>MAX_BYTES)throw new Error("BODY_TOO_LARGE");
        chunks.push(Buffer.from(chunk));
      }
      const html=Buffer.concat(chunks).toString("utf8");
      result.evidence=inspect1688SearchEvidence(html,{
        status:response.status,contentType:result.contentType,query:"蓝牙耳机",
      });
      result.state=result.evidence.state;
    }catch(e){
      result.state=/TOO_LARGE/.test(String(e?.message))?"BODY_TOO_LARGE":"BODY_READ_FAILURE";
      await response.body?.cancel().catch(()=>{});
    }
  }else {
    await response.body?.cancel().catch(()=>{});
    result.state=response.status===403?"HTTP_403_DENIED":
      response.status===429?"HTTP_429_LIMITED":
      response.status>=300&&response.status<400?"SEARCH_REDIRECT":
      "NO_HTML";
  }
}catch(e){
  const message=String(e?.name||"")+" "+String(e?.message||"");
  result.state=/timeout|abort/i.test(message)?"TIMEOUT":"TRANSPORT_ERROR";
}finally{
  result.elapsedMs=Math.round(performance.now()-started);
  result.catalogValidated=false;
  result.independentSkuMoqParity=false;
  await writeFile("1688-one-shot-jarir.json",JSON.stringify(result,null,2)+"\n");
  console.log(JSON.stringify(result,null,2));
}
