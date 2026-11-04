// Post-merge LIVE deployment identity gate. This script never creates
// products, fixtures, sessions or production writes. It verifies exact Render
// main SHA BEFORE Chromium inspects the published customer's experience.
const endpoint="https://nawaa-search-api.onrender.com/health";
const expected=String(process.env.NAWAA_EXPECT_LIVE_SHA||"");
if(!/^[a-f0-9]{40}$/i.test(expected))throw Error("EXPECTED_MAIN_SHA_INVALID");

let last="UNKNOWN",verified=false;
for(let attempt=1;attempt<=36;attempt++){
  try{
    const response=await fetch(endpoint,{
      headers:{accept:"application/json","cache-control":"no-cache"},
      redirect:"error",signal:AbortSignal.timeout(12_000),
    });
    if(response.status===200){
      const length=Number(response.headers.get("content-length")||0);
      if(length>8192)throw Error("HEALTH_OVERSIZED");
      const raw=await response.arrayBuffer();
      if(raw.byteLength>8192)throw Error("HEALTH_OVERSIZED");
      const health=JSON.parse(new TextDecoder().decode(raw));
      const revision=health?.revision;
      if(health?.ok===true && typeof revision==="string" &&
        /^[a-f0-9]{40}$/i.test(revision)){
        last=revision;
        if(last.toLowerCase()===expected.toLowerCase()){
          verified=true;break;
        }
      }else last="INVALID_HEALTH_CONTRACT";
    }else last="HTTP_"+response.status;
  }catch(error){last=["TimeoutError","AbortError"].includes(error?.name)
    ?"HEALTH_TIMEOUT":"HEALTH_UNAVAILABLE";}
  if(attempt<36)await new Promise(resolve=>setTimeout(resolve,10000));
}
console.log("R04_P38_POSTDEPLOY_SHA "+JSON.stringify({
  expected,observed:last,exactMatch:verified,
  probesAreLive:true,syntheticProductData:false,
}));
if(!verified)throw Error("POSTDEPLOY_RENDER_EXACT_SHA_MISMATCH");
