// Public read-only general-mode validation; no database or Render writes.
import {searchExtraUnbxd} from "../server/providers/extra-unbxd.mjs";
const query="Apple iPhone 17e 512GB Soft Pink";
const sku="100462492";
process.env.NAWAA_EXTRA_PYTHON_PDP="1";
process.env.NAWAA_EXTRA_PYTHON_ALL="1";
delete process.env.NAWAA_EXTRA_PYTHON_CANARY_QUERY;
delete process.env.NAWAA_EXTRA_PYTHON_CANARY_SKU;
delete process.env.NAWAA_EXTRA_PYTHON_CANARY_URL;
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),8500);
const report={experiment:"EXTRA_PYTHON_GENERAL_LIVE",published:false,
  persisted:false,sourceId:"extra-sa",sku,queryScope:"ALL_VISITORS",attempted:0,accepted:0};
try{
  const response=await searchExtraUnbxd(query,12,query,{signal:controller.signal});
  const offer=response.offers.find(x=>x.sourceMeta?.productId===sku);
  report.offerCount=response.offers.length;
  report.existingSkuFound=Boolean(offer);
  report.merchantPdpUrlFound=Boolean(offer?.sourceMeta?.pdpUrl);
  report.attempted=response.diagnostics?.pythonExtraPdp?.attempted??0;
  report.accepted=response.diagnostics?.pythonExtraPdp?.accepted??0;
  report.failureClasses=response.diagnostics?.pythonExtraPdp?.failureClasses??[];
  report.finalPriceSource=offer?.sourceMeta?.priceSource??"UNBXD_ONLY";
  report.outcome=report.accepted>0?"GENERAL_PRICE_EVIDENCE_ADMITTED":"GENERAL_SOURCE_FALLBACK";
}catch(error){
  report.outcome="GENERAL_LIVE_EXCEPTION";
  report.failureClass=error?.name==="AbortError"?"DEADLINE":"SOURCE_UNAVAILABLE";
}finally{clearTimeout(timer);}
process.stdout.write("NAWAA_EXTRA_PYTHON_GENERAL_LIVE "+JSON.stringify(report)+"\n");
if(report.outcome!=="GENERAL_PRICE_EVIDENCE_ADMITTED")process.exitCode=1;
