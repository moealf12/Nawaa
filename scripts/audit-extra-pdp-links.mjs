// Live merchant URL-field coverage probe. Diagnostic only; never persists/offers prices.
import {searchExtraUnbxd} from "../server/providers/extra-unbxd.mjs";
const queries=["Apple iPhone 17e 512GB Soft Pink","Apple iPhone 17","PlayStation 5"];
delete process.env.NAWAA_EXTRA_PYTHON_PDP;
delete process.env.NAWAA_EXTRA_PYTHON_ALL;
const results=[];
for(const query of queries){
  try{
    const data=await searchExtraUnbxd(query,12,query,{signal:AbortSignal.timeout(8000)});
    const offers=data.offers||[];
    results.push({query,offers:offers.length,
      exactMerchantUrls:offers.filter(o=>Boolean(o.sourceMeta?.pdpUrl)).length,
      sourceErrors:data.errors?.map(x=>x.error).slice(0,3)||[]});
  }catch(error){
    results.push({query,offers:0,exactMerchantUrls:0,
      failureClass:error?.name==="TimeoutError"?"DEADLINE":"SOURCE_ERROR"});
  }
}
process.stdout.write("NAWAA_EXTRA_PDP_URL_COVERAGE "+JSON.stringify({experiment:"DIAGNOSTIC_ONLY",published:false,persisted:false,results})+"\n");
