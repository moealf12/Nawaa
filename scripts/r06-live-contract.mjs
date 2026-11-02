// R06-D: inspection-only customer response contract.
// Structural evidence is not price attestation or cross-request content parity.
export function assessCustomerSearchPayload(body,{stream=false}={}){
  const failures=[];
  const offers=body?.offers,errors=body?.errors,coverage=body?.coverage;
  if(!Array.isArray(offers))failures.push("OFFERS_SCHEMA");
  if(!Array.isArray(errors))failures.push("ERRORS_SCHEMA");
  if(!coverage||typeof coverage!=="object"||Array.isArray(coverage))
    failures.push("COVERAGE_SCHEMA");
  const c=coverage||{};
  if(typeof c.complete!=="boolean"||typeof c.partial!=="boolean"||
     typeof c.deadlineExceeded!=="boolean")failures.push("COVERAGE_FLAGS");
  const pending=c.providersPending;
  if(!(pending===null&&(c.deadlineExceeded===true&&!stream))&&
     !(Number.isSafeInteger(pending)&&pending>=0))
    failures.push("PENDING_EVIDENCE");
  const reported=c.sourceFailures?.errorsReported;
  if(!Number.isSafeInteger(reported)||reported<0)failures.push("ERROR_COUNTER");
  if(Array.isArray(errors)&&Number.isSafeInteger(reported)&&reported!==errors.length)
    failures.push("ERROR_COUNTER_MISMATCH");
  const hasSourceIssue=(Array.isArray(errors)&&errors.length>0)||
    (Number.isSafeInteger(reported)&&reported>0);
  if(c.complete===true && (c.partial!==false||c.deadlineExceeded!==false||
     pending!==0||hasSourceIssue)) failures.push("FALSE_COMPLETE");
  if(c.partial===false && (c.complete!==true||hasSourceIssue||c.deadlineExceeded===true))
    failures.push("FALSE_CLEAN");
  if(c.complete===false&&c.partial!==true)failures.push("MISSING_PARTIAL");
  if(body?.cache?.mode==="fresh" && c.partial===true)
    failures.push("PARTIAL_FRESH_CACHE");
  if(Array.isArray(offers))for(const offer of offers){
    if(!offer||typeof offer!=="object"||typeof offer.title!=="string"||
      !offer.title.trim()||typeof offer.merchant!=="string"||!offer.merchant.trim()||
      !Number.isFinite(Number(offer.productPrice))||Number(offer.productPrice)<=0||
      !/^[A-Z]{3}$/.test(String(offer.currency||""))) {
      failures.push("INVALID_OFFER");break;
    }
    try{
      const url=new URL(offer.sourceUrl);
      if(url.protocol!=="https:"||url.username||url.password){
        failures.push("UNSAFE_OFFER_URL");break;
      }
    }catch{failures.push("UNSAFE_OFFER_URL");break;}
  }
  return {pass:failures.length===0,failures:[...new Set(failures)],
    offers:Array.isArray(offers)?offers.length:null,
    sourceErrors:Array.isArray(errors)?errors.length:null,
    complete:c.complete===true,partial:c.partial===true,
    deadlineExceeded:c.deadlineExceeded===true,
    providersPending:pending??null,cacheMode:body?.cache?.mode??null};
}
