// Owner-retired source registry; 404 is NAWAA's catalog classification,
// not a fabricated HTTP 404 response from a merchant.
export const RETIRED_SOURCE_CATALOG = Object.freeze({
  "bike24-de": Object.freeze({
    status:"SOURCE_RETIRED", catalogCode:404, reason:"OWNER_DEPRIORITIZED",
    observedHttpStatus:null, active:false,
  }),
});
export function retiredSourceRecord(id){return RETIRED_SOURCE_CATALOG[id] || null;}
export function isRetiredSourceUrl(raw){
  try {
    const host=new URL(raw).hostname.toLowerCase();
    return host==="bike24.com"||host.endsWith(".bike24.com")||
      host==="bike24.de"||host.endsWith(".bike24.de");
  }catch{return false;}
}
