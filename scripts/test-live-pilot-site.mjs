import {spawn} from "node:child_process";
import {mkdir,writeFile,appendFile} from "node:fs/promises";
import {createServer} from "node:net";

const listenPort=await new Promise((resolve,reject)=>{
 const server=createServer();
 server.once("error",reject);
 server.listen(0,"127.0.0.1",()=>{
   const port=server.address().port;
   server.close(()=>resolve(port));
 });
});
const base="http://127.0.0.1:"+listenPort;
const server=spawn(process.execPath,["server/server.mjs"],{
  env:{...process.env,PORT:String(listenPort),NAWAA_ENABLE_CERTIFIED_PILOT:"1"},
  stdio:["ignore","pipe","pipe"],
});
let serverErr="";
server.stderr.on("data",chunk=>{serverErr=(serverErr+String(chunk)).slice(-2500);});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(url,timeout=24000){
 const started=Date.now();
 try{
  const r=await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(timeout)});
  const text=await r.text();
  let data=null;try{data=JSON.parse(text);}catch{}
  return {http:r.status,ok:r.ok,durationMs:Date.now()-started,data,body:data?null:text};
 }catch(e){return {http:0,ok:false,durationMs:Date.now()-started,error:String(e?.message||e)};}
}
async function main(){
 let health=null;
 for(let i=0;i<50;i++){
   if(server.exitCode!==null)throw new Error("Pilot server exited: "+serverErr);
   health=await get(base+"/health",3500);
   if(health.ok)break;
   await sleep(500);
 }
 if(!health?.ok)throw new Error("Local pilot server failed to boot: "+serverErr);
 const [manifest,page]=await Promise.all([
   get(base+"/api/pilot/sources",6500),
   get(base+"/pilot.html",6500),
 ]);
 if(!manifest.ok||manifest.data?.sources?.length!==15||!page.ok||
    !String(page.body||"").includes("اختبار المصادر المعتمدة")){
   throw new Error("Pilot manifest/site missing: "+JSON.stringify({manifest:manifest.http,page:page.http}));
 }
 const sources=manifest.data.sources;
 const results=[];
 for(let i=0;i<sources.length;i++){
   const source=sources[i];
   const q=source.sampleQueries[0];
   const url=base+"/api/pilot/source-search?store="+encodeURIComponent(source.id)+"&q="+encodeURIComponent(q);
   // Rate limiting protects shared-free infrastructure. Never bypass 429.
   let response=await get(url,25500);
   if(response.http===429){
     await sleep(12500);
     response=await get(url,25500);
   }
   const offers=Array.isArray(response.data?.offers)?response.data.offers:[];
   const invalid=offers.filter(o=>
     o.providerMarket!==source.id||
     !Number.isFinite(o.productPrice)||o.productPrice<=0||
     !String(o.image||"").startsWith("https://") ||
     !String(o.sourceUrl||"").startsWith("https://"));
   const invalidDetails=offers.filter(o=>
     o.providerMarket!==source.id||
     !Number.isFinite(o.productPrice)||o.productPrice<=0||
     !String(o.image||"").startsWith("https://")||
     !String(o.sourceUrl||"").startsWith("https://")
   ).slice(0,2).map(o=>({
     providerMarket:o.providerMarket,
     priceSAR:o.productPrice,
     imageUrl:String(o.image||"").slice(0,180),
     sourceUrl:String(o.sourceUrl||"").slice(0,180),
   }));
   results.push({
     id:source.id,name:source.name,query:q,
     http:response.http,durationMs:response.durationMs,
     status:response.data?.status||(response.error?"network_error":response.data?.error||"unexpected_response"),
     offers:offers.length,
     invalid:invalid.length,invalidDetails,
     example:offers.slice(0,2).map(o=>({title:String(o.title||"").slice(0,90),priceSAR:o.productPrice})),
     error:response.error||response.data?.detail||null,
   });
   console.log("PILOT "+JSON.stringify(results.at(-1)));
 }
 const report={
   observedAt:new Date().toISOString(),
   certificationRun:manifest.data.certificationRun,
   sourceCount:sources.length,
   liveFound:results.filter(x=>x.offers>0&&x.invalid===0).length,
   noVerifiedOffers:results.filter(x=>x.http===200&&x.offers===0).length,
   failed:results.filter(x=>x.http!==200||x.invalid>0).length,
   pageServed:page.http===200,
   results,
   note:"This is a website + API integration test on the candidate branch runner, with actual merchant network requests. It is NOT a production Render deployment.",
 };
 await mkdir("pilot-15-report",{recursive:true});
 await writeFile("pilot-15-report/report.json",JSON.stringify(report,null,2)+"\n");
 const md=[
  "## NAWAA 15-source pilot — actual website endpoint + merchant network",
  "Website served: **"+report.pageServed+"** · Sources: **"+report.sourceCount+
    "** · Sources with live priced offers: **"+report.liveFound+"** · Empty: **"+report.noVerifiedOffers+"** · Failed: **"+report.failed+"**",
  "",
  "| Source | Query | HTTP | Live offers | Invalid offers |",
  "|---|---|---:|---:|---:|",
  ...results.map(row=>"| "+row.id+" | "+row.query+" | "+row.http+" | "+row.offers+" | "+row.invalid+" |"),
  "",
  "**Not a production deploy.** The published Render service may still be on main.",
 ].join("\n");
 console.log(md);
 if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,md);
 if(report.liveFound===0||results.some(x=>x.invalid>0))process.exitCode=1;
}
try{await main();}
catch(e){console.error(e);process.exitCode=1;}
finally{server.kill("SIGTERM");}
