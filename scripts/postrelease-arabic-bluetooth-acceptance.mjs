// Temporary postrelease production acceptance for PR #205.
// No fixtures or archived merchant data. Counts only; no prices, cookies or PII logged.
const origin="https://nawaa-search-api.onrender.com";
const expected=process.env.NAWAA_EXPECT_LIVE_SHA;
if(!/^[a-f0-9]{40}$/.test(expected||""))throw Error("MISSING_EXACT_RELEASE_SHA");
const began=new Date().toISOString();
const MAX_BYTES=8_000_000;
async function get(path,accept){
  const started=Date.now();
  const response=await fetch(new URL(path,origin),{
    headers:{accept},redirect:"error",signal:AbortSignal.timeout(30000)
  });
  let n=0;const parts=[];
  if(response.body)for await(const chunk of response.body){
    n+=chunk.byteLength;
    if(n>MAX_BYTES)throw Error("RESPONSE_TOO_LARGE");
    parts.push(chunk);
  }
  return {response,body:Buffer.concat(parts).toString("utf8"),ms:Date.now()-started};
}
function structuralOffer(o){
  if(!o||typeof o.title!=="string"||!o.title.trim()||
    typeof o.merchant!=="string"||!o.merchant.trim()||
    !(Number(o.productPrice)>0)||!/^[A-Z]{3}$/.test(o.currency||""))return false;
  try{return new URL(o.sourceUrl).protocol==="https:";}catch{return false;}
}
function speakerOnly(o){
  const title=String(o.title||"").toLowerCase();
  return /\b(?:speakers?|soundbars?)\b/.test(title) &&
    !/\b(?:headphones?|headsets?|earphones?|earbuds?|airpods)\b/.test(title);
}
function counts(offers){
  const byMerchant={};
  for(const o of offers){
    const merchant=String(o.merchant||"unknown").slice(0,35);
    byMerchant[merchant]=(byMerchant[merchant]||0)+1;
  }
  return byMerchant;
}
const output={mode:"POSTRELEASE_CUSTOMER_READ_ONLY",expected,startedAtUtc:began,checks:[]};
const check=(name,ok,detail={})=>{output.checks.push({name,result:ok?"PASS":"FAIL",...detail});};
try{
  const health=await get("/health","application/json");
  const h=JSON.parse(health.body);
  output.health={httpStatus:health.response.status,revision:h.revision,latencyMs:health.ms};
  check("EXACT_LIVE_SHA",health.response.status===200&&h.ok===true&&h.revision===expected);
  if(!output.checks.at(-1).result.includes("PASS"))throw Error("INCORRECT_DEPLOYMENT");

  const query="سماعات بلوتوث";
  const json=await get("/api/search?q="+encodeURIComponent(query),"application/json");
  const data=JSON.parse(json.body);
  const offers=Array.isArray(data.offers)?data.offers:[];
  output.arabicJson={
    httpStatus:json.response.status,latencyMs:json.ms,
    offers:offers.length,merchants:counts(offers),
    invalid:offers.filter(o=>!structuralOffer(o)).length,
    speakerOnly:offers.filter(speakerOnly).length,
    partial:data.coverage?.complete===false,
    errors:Array.isArray(data.errors)?data.errors.length:0
  };
  check("ARABIC_BLUETOOTH_JSON_HAS_GENUINE_OFFERS",
    json.response.status===200&&offers.length>0&&output.arabicJson.invalid===0&&output.arabicJson.speakerOnly===0);

  const eng=await get("/api/search?q="+encodeURIComponent("bluetooth headphones"),"application/json");
  const enData=JSON.parse(eng.body);
  const englishOffers=Array.isArray(enData.offers)?enData.offers:[];
  output.englishControl={httpStatus:eng.response.status,offers:englishOffers.length,merchants:counts(englishOffers),latencyMs:eng.ms};
  check("ENGLISH_BLUETOOTH_REMAINS_PRODUCTIVE",eng.response.status===200&&englishOffers.some(structuralOffer));

  const sse=await get("/api/search/stream?q="+encodeURIComponent(query),"text/event-stream");
  const frames=sse.body.replace(/\r\n/g,"\n").split("\n\n");
  let snapshots=0,done=false,last=null,lastWithOffers=null,errors=0;
  for(const frame of frames){
    const event=frame.split("\n").find(x=>x.startsWith("event: "))?.slice(7);
    const raw=frame.split("\n").find(x=>x.startsWith("data: "))?.slice(6);
    if(!raw)continue;
    let payload;try{payload=JSON.parse(raw);}catch{continue;}
    if(event==="snapshot"){
      snapshots++;
      if(Array.isArray(payload.offers)){
        last=payload.offers;
        if(payload.offers.length)lastWithOffers=payload.offers;
      }
    }else if(event==="done")done=true;
    else if(event==="error")errors++;
  }
  const final=lastWithOffers||last||[];
  output.arabicSse={
    httpStatus:sse.response.status,latencyMs:sse.ms,snapshots,done,errorFrames:errors,
    offers:final.length,merchants:counts(final),
    invalid:final.filter(o=>!structuralOffer(o)).length,
    speakerOnly:final.filter(speakerOnly).length
  };
  check("ARABIC_BLUETOOTH_SSE_HAS_GENUINE_OFFERS",
    sse.response.status===200&&done&&errors===0&&snapshots>0&&final.length>0&&
    output.arabicSse.invalid===0&&output.arabicSse.speakerOnly===0);
}catch(err){
  output.unhandledError={class:err?.name||"Error",code:String(err?.code||"").slice(0,40)};
  check("COMPLETED_WITHOUT_RUNTIME_EXCEPTION",false);
}
output.finishedAtUtc=new Date().toISOString();
output.result=output.checks.every(x=>x.result==="PASS")?"PASS":"FAIL";
console.log(JSON.stringify(output));
if(output.result!=="PASS")process.exitCode=1;
