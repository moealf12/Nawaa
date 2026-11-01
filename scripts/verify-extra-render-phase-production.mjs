// Read-only customer API probe, used to correlate one Render app-side phase diagnostic.
const expected=process.env.NAWAA_EXPECT_LIVE_SHA;
if(!/^[0-9a-f]{40}$/.test(expected||""))throw Error("EXPECTED_SHA_REQUIRED");
const root="https://nawaa-search-api.onrender.com";
async function read(path,timeoutMs){
  const started=performance.now();
  const res=await fetch(root+path,{redirect:"error",headers:{accept:"application/json"},signal:AbortSignal.timeout(timeoutMs)});
  if(res.status!==200)throw Error("PUBLIC_HTTP_"+res.status);
  const bytes=await res.arrayBuffer();
  if(bytes.byteLength>3_000_000)throw Error("PUBLIC_RESPONSE_TOO_LARGE");
  return {data:JSON.parse(new TextDecoder().decode(bytes)),elapsedMs:Math.round(performance.now()-started)};
}
const health=await read("/health",70000);
if(health.data.revision!==expected||health.data.ok!==true)throw Error("LIVE_SHA_NOT_DEPLOYED");
const query="Apple iPhone 17e 512GB Soft Pink";
const result=await read("/api/search?q="+encodeURIComponent(query),45000);
const offers=Array.isArray(result.data.offers)?result.data.offers:[];
const extra=offers.filter(x=>x.merchant==="eXtra");
const sku=extra.filter(x=>String(x.sourceUrl||"").endsWith("/p/100462492"));
const report={experiment:"EXTRA_RENDER_PHASE_PROBE",liveSha:expected.slice(0,12),
  responseHttp:200,elapsedMs:result.elapsedMs,offerCount:offers.length,
  extraOffers:extra.length,expectedSkuCount:sku.length,duplicateExpectedSku:sku.length>1,
  customerVisible:true,noProductionWrites:true,
  note:"Check Render NAWAA_EXTRA_PYTHON_PHASE and NAWAA_EXTRA_PYTHON_CANARY logs for Python acceptance."};
process.stdout.write("NAWAA_EXTRA_RENDER_PHASE_PROBE "+JSON.stringify(report)+"\n");
if(!extra.length||sku.length!==1)process.exitCode=1;
