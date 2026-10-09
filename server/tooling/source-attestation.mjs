import {createHmac,timingSafeEqual} from "node:crypto";
import {validateCandidateOffer} from "./offer-schema.mjs";

// This signature proves that a trusted ingestion process issued the observation.
// It is NOT independent proof that a merchant published the price: the issuer must
// only sign an offer after its certified extractor checked the original merchant.
const MAX_AGE_MS=15*60*1000;
function allowedMerchant(sourceId,offer,sourceHosts) {
  const hosts=sourceHosts?.[sourceId];
  if(!Array.isArray(hosts)||!hosts.length)return false;
  try{
    const target=new URL(offer.sourceUrl).hostname.toLowerCase().replace(/\.$/,"");
    return hosts.some(host=>{
      const expected=String(host).toLowerCase().replace(/^www\./,"").replace(/\.$/,"");
      return expected.includes(".")&&(target===expected||target.endsWith("."+expected));
    });
  }catch{return false;}
}
function signedBody(sourceId,offer,issuedAt) {
  // A fixed field order binds the signature to price, currency, product URL,
  // image and identity. Extra untrusted job metadata is not authoritative.
  return JSON.stringify([1,sourceId,issuedAt,offer.sourceUrl,offer.title,
    offer.productPrice,offer.currency,offer.merchant||"",offer.image||"",
    offer.imageUrl||"",offer.sku||""]);
}
function assertKey(key) {
  if(typeof key!=="string"||Buffer.byteLength(key,"utf8")<32)throw new Error("source_signing_key_required");
  return key;
}
function validOffer(sourceId,offer,sourceHosts) {
  return /^[a-z0-9][a-z0-9-]{1,79}$/.test(sourceId||"")
    &&validateCandidateOffer(offer).valid
    &&allowedMerchant(sourceId,offer,sourceHosts);
}
export function issueSourceAttestation({sourceId,offer,sourceHosts,key,clock=Date.now}={}) {
  assertKey(key);
  if(!validOffer(sourceId,offer,sourceHosts))throw new Error("unverified_source_domain");
  const issuedAt=clock();
  if(!Number.isSafeInteger(issuedAt)||issuedAt<0)throw new Error("invalid_attestation_time");
  const signature=createHmac("sha256",key).update(signedBody(sourceId,offer,issuedAt)).digest("hex");
  return `v1.${issuedAt}.${signature}`;
}
export function verifySourceAttestation({sourceId,offer,attestation,sourceHosts,key,clock=Date.now}={}) {
  if(!validOffer(sourceId,offer,sourceHosts))return false;
  try {
    assertKey(key);
    const match=/^v1\.(\d{13})\.([a-f0-9]{64})$/.exec(String(attestation||""));
    if(!match)return false;
    const issuedAt=Number(match[1]),age=clock()-issuedAt;
    if(!Number.isSafeInteger(issuedAt)||age< -30000||age>MAX_AGE_MS)return false;
    const expected=createHmac("sha256",key).update(signedBody(sourceId,offer,issuedAt)).digest();
    return timingSafeEqual(expected,Buffer.from(match[2],"hex"));
  }catch{return false;}
}
export function createSignedSourceVerifier({sourceHosts,key,clock=Date.now}={}) {
  return ({sourceId,offer,job})=>verifySourceAttestation({
    sourceId,offer,attestation:job?.attestation,sourceHosts,key,clock
  });
}
