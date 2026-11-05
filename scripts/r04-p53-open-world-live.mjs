// R04-P53: OPEN-WORLD OUT-OF-CORPUS live candidate evidence.
// This is NOT the frozen 36. Fetches actual public merchants from a disposable
// local candidate server: no fixtures, no production writes, no paid proxies.
// A 200 with zero principal is reported as an unresolved real-source miss,
// never converted to a fabricated success.
import {spawn,execFileSync} from "node:child_process";
import {setTimeout as sleep} from "node:timers/promises";
import {writeFileSync} from "node:fs";
import {groupComparableOffers} from "../src/search-core.mjs";
import {buildSearchPresentationSections} from "../src/search-result-presentation.mjs";

const sha=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
const cases=[
  ["X01","مكواة بخار تيفال"],
  ["X02","قطاعة خضار كهربائية"],
  ["X03","منظم كابلات مكتب"],
  ["X04","طقم مفكات دقيق"],
  ["X05","راوتر واي فاي 7 شبكي"],
  ["X06","كتاب طبخ عربي"],
  ["X07","mechanical keyboard 75 percent"],
  ["X08","guitar reverb pedal"],
  ["X09","portable solar panel 100W"],
  ["X10","LEGO star wars 75355"],
  ["X11","shampoing sans sulfate"],
  ["X12","funda para tablet samsung"],
];
const PORT=18753,ORIGIN="http://127.0.0.1:"+PORT;
const child=spawn(process.execPath,["server/server.mjs"],{
  env:{...process.env,PORT:String(PORT),NODE_ENV:"test",
    DATABASE_URL:"",MEILI_HOST:"",MEILI_MASTER_KEY:"",
    FIRECRAWL_API_KEY:"",PYTHON_WORKER_URL:"",
    NAWAA_PY_LIVE_ENABLED:"0",
  },
  stdio:["ignore","pipe","pipe"],
});
let stderr="",stdout="";
child.stderr.on("data",d=>{stderr=(stderr+String(d)).slice(-2000)});
child.stdout.on("data",d=>{stdout=(stdout+String(d)).slice(-2000)});
const rows=[];
try{
  let ready=false;
  for(let i=0;i<45;i++){
    if(child.exitCode!==null)break;
    try{
      const r=await fetch(ORIGIN+"/health",{signal:AbortSignal.timeout(1000)});
      if(r.ok){ready=true;break;}
    }catch{}
    await sleep(300);
  }
  if(!ready)throw Error("DISPOSABLE_CANDIDATE_NOT_READY");
  for(const [id,query] of cases){
    const started=Date.now();
    const row={id,http:null,offers:0,principals:0,related:0,
      partial:null,sourceErrors:null,deadlineExceeded:null,
      recallReason:null,recallMode:null,elapsedMs:null,status:"NOT_OBSERVED"};
    try{
      const response=await fetch(ORIGIN+"/api/search?q="+encodeURIComponent(query),{
        headers:{"accept":"application/json"},
        signal:AbortSignal.timeout(18000),redirect:"error",
      });
      row.http=response.status;
      const body=await response.json();
      if(response.status!==200||!Array.isArray(body?.offers))throw Error("INVALID_SEARCH_RESPONSE");
      const items=body.offers;
      for(const offer of items){
        if(!offer||!Number.isFinite(offer.productPrice)||offer.productPrice<=0||
           offer.currency!=="SAR"||!/^https:\/\//.test(String(offer.sourceUrl||"")))
          throw Error("INVALID_REAL_MERCHANT_OFFER");
      }
      const groups=groupComparableOffers(items,"lowest");
      const presentation=buildSearchPresentationSections(query,groups);
      if(presentation.partitionedGroups!==groups.length)throw Error("LOST_GROUP_PARTITION");
      row.offers=items.length;
      row.principals=presentation.exactGroups.length;
      row.related=presentation.relatedGroups.length;
      row.partial=body.coverage?.partial===true;
      row.sourceErrors=Array.isArray(body.errors)?body.errors.length:null;
      row.deadlineExceeded=body.coverage?.deadlineExceeded===true;
      row.recallReason=body.coverage?.recallExpansionEvidence?.reason||null;
      row.recallMode=body.coverage?.recallExpansionEvidence?.mode||null;
      row.status="OBSERVED";
    }catch(e){
      row.status=["INVALID_SEARCH_RESPONSE","INVALID_REAL_MERCHANT_OFFER",
        "LOST_GROUP_PARTITION"].includes(e.message)?e.message:"REQUEST_FAILED";
    }
    row.elapsedMs=Date.now()-started;
    rows.push(row);
    console.log("NAWAA_P53_OPEN_WORLD_QUERY "+JSON.stringify(row));
  }
}finally{
  child.kill("SIGTERM");
  await sleep(500);
  if(child.exitCode===null)child.kill("SIGKILL");
}
const observed=rows.filter(r=>r.status==="OBSERVED").length;
const principalQueries=rows.filter(r=>r.principals>0).length;
const result={schemaVersion:"nawaa.r04.p53.open-world-live.v1",
  exactCandidateSha:sha,execution:"DISPOSABLE_LOCAL_CANDIDATE_REAL_MERCHANT_HTTP",
  queryCount:cases.length,observed,principalQueries,
  relatedOnlyQueries:rows.filter(r=>r.status==="OBSERVED"&&r.principals===0).map(r=>r.id),
  sourceErrorEvents:rows.reduce((n,r)=>n+(r.sourceErrors||0),0),
  deadlineExceededQueries:rows.filter(r=>r.deadlineExceeded).map(r=>r.id),
  rows,independentProductTruthCertified:false,globalCoverageCertified:false,
  verdict:observed===cases.length&&principalQueries>=1&&
    rows.every(r=>r.deadlineExceeded===false)
      ?"LIVE_STRUCTURAL_PASS":"LIVE_OPEN_WORLD_INCOMPLETE",
};
writeFileSync("r04-p53-open-world-live-evidence.json",JSON.stringify(result,null,2));
console.log("NAWAA_P53_OPEN_WORLD_SUMMARY "+JSON.stringify(result));
if(result.verdict!=="LIVE_STRUCTURAL_PASS")process.exitCode=1;
