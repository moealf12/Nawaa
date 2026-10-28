// NAWAA v22.07 — source-grant authenticity boundary.
// Ed25519 verification is anchored to an OPERATOR-INSTALLED public key,
// NEVER a key supplied by a feed, incoming request or approval document.
// No production authority key is installed in NAWAA. Without one, deny.
import {createPublicKey,verify} from "node:crypto";

const CLAIMS=[
  "keyId","approvalId","sourceId","verificationStatus",
  "feedTransport","evidenceReference","permittedPurposes",
  "country","merchantHost","validFrom","validUntil",
  "approvedPayloadSha256",
];
const EXPECTED_KEYS=new Set([...CLAIMS,"signature"]);
const SAFE_ID=/^[a-zA-Z0-9_.-]{1,96}$/;
const PURPOSES=new Set(["product_discovery","price_comparison"]);
const DATE=/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/;

function sourceClaims(grant){
  if(!grant||typeof grant!=="object"||Array.isArray(grant))return null;
  if(Object.keys(grant).some(key=>!EXPECTED_KEYS.has(key)))return null;
  if(CLAIMS.some(key=>!Object.hasOwn(grant,key)))return null;
  if(!SAFE_ID.test(grant.keyId)||!SAFE_ID.test(grant.approvalId)||
     !SAFE_ID.test(grant.sourceId)||grant.verificationStatus!=="INDEPENDENTLY_VERIFIED"||
     grant.feedTransport!=="MERCHANT_SUPPLIED_FILE"||
     typeof grant.evidenceReference!=="string"||!grant.evidenceReference.trim()||
     grant.evidenceReference.length>160||grant.country!=="SA"||
     !/^[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+$/.test(grant.merchantHost)||
     !DATE.test(grant.validFrom)||!DATE.test(grant.validUntil)||
     !/^[0-9a-f]{64}$/i.test(grant.approvedPayloadSha256))return null;
  if(!Array.isArray(grant.permittedPurposes)||
     grant.permittedPurposes.length!==2||
     new Set(grant.permittedPurposes).size!==2||
     !grant.permittedPurposes.every(x=>PURPOSES.has(x)))return null;
  const notBefore=Date.parse(grant.validFrom),until=Date.parse(grant.validUntil);
  if(!Number.isFinite(notBefore)||!Number.isFinite(until)||notBefore>=until)
    return null;
  return CLAIMS.map(key=>grant[key]);
}
export function buildPartnerGrantSigningPayload(grant){
  const values=sourceClaims(grant);
  if(!values)throw Error("INVALID_PARTNER_GRANT_CLAIMS");
  // Domain-separate from other signed approvals and bind all authorized
  // fields, including digest and time window. JSON array has stable order.
  return Buffer.from(JSON.stringify(["nawaa.partner-grant.ed25519.v1",...values]),"utf8");
}
export function verifyPartnerGrantSignature(grant,{
  authorityPublicKeyBase64=process.env.NAWAA_PARTNER_AUTHORITY_PUBLIC_KEY_SPKI_B64,
  authorityKeyId=process.env.NAWAA_PARTNER_AUTHORITY_KEY_ID,
}={}){
  // This verifier is internal to the source gate. The real call site never
  // forwards an attacker-provided key; tests can supply the trusted operator
  // pin only by their own process environment.
  if(!grant||typeof authorityPublicKeyBase64!=="string"||
     typeof authorityKeyId!=="string"||
     !SAFE_ID.test(authorityKeyId)||grant.keyId!==authorityKeyId||
     typeof grant.signature!=="string"||
     !/^[a-zA-Z0-9+/]{86}==$/.test(grant.signature))return false;
  try{
    const keyBytes=Buffer.from(authorityPublicKeyBase64,"base64");
    if(keyBytes.length>1024||keyBytes.length<30)return false;
    const key=createPublicKey({key:keyBytes,format:"der",type:"spki"});
    if(key.asymmetricKeyType!=="ed25519")return false;
    const signature=Buffer.from(grant.signature,"base64");
    if(signature.length!==64)return false;
    return verify(null,buildPartnerGrantSigningPayload(grant),key,signature);
  }catch{return false;}
}
