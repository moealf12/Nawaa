import {validateCandidateOffer} from "./offer-schema.mjs";
import {recordOffer} from "../persistence.mjs";
import {createHash} from "node:crypto";

// Opt-in ingestion worker logic, deliberately decoupled from pg-boss startup.
// The queue's message contains observed merchant data only; it cannot direct
// arbitrary URLs to be fetched or execute user-supplied code.
export const OFFER_INGESTION_QUEUE="nawaa-offer-ingestion";
export function createOfferIngestionHandler({record=recordOffer,validate=validateCandidateOffer,verify}={}) {
 return async function handle(job) {
  const payload=job?.data;
  if(!payload||typeof payload!=="object"||Array.isArray(payload))throw new Error("invalid_ingestion_job");
  const sourceId=String(payload.sourceId||"").trim();
  if(!/^[a-z0-9][a-z0-9-]{1,79}$/.test(sourceId))throw new Error("invalid_source_id");
  const result=validate(payload.offer);
  if(!result.valid)throw new Error("unverified_offer_rejected");
  const offer=result.offer;
  if(!offer.merchant || !payload.verifiedBySource || payload.verifiedBySource!==sourceId) {
    throw new Error("merchant_verification_required");
  }
  if(typeof verify!=="function" || await verify({sourceId,offer,job:payload})!==true) throw new Error("trusted_source_verifier_required");
  // Reuse the immutable observation + canonical UPSERT ACID implementation.
  const saved=await record({...offer,sourceName:sourceId,query:payload.query||sourceId,
    ...(job?.id?{ingestionId:String(job.id)}:{})});
  if(saved?.duplicate===true)return {recorded:true,duplicate:true,sourceId,observationId:null};
  if(!saved?.recorded)throw new Error("persistence_did_not_record");
  return {recorded:true,sourceId,observationId:saved.observationId??null};
 };
}
export async function enqueueVerifiedOffer(boss,{sourceId,offer,query,verifiedBySource,attestation}={}) {
 if(!boss||typeof boss.send!=="function")throw new Error("queue_not_started");
 const source=String(sourceId||"").trim();
 if(!/^[a-z0-9][a-z0-9-]{1,79}$/.test(source)||verifiedBySource!==source)throw new Error("merchant_verification_required");
 if(!validateCandidateOffer(offer).valid)throw new Error("unverified_offer_rejected");
 if(!/^v1\.\d{13}\.[a-f0-9]{64}$/.test(String(attestation||"")))throw new Error("attestation_required");
 const singletonKey=createHash("sha256").update(JSON.stringify([
   source,offer.sourceUrl,offer.title,offer.productPrice,offer.currency,offer.sku||""
 ])).digest("hex");
 return boss.send(OFFER_INGESTION_QUEUE,
   {sourceId:source,offer,query,verifiedBySource,attestation},
   {singletonKey,singletonSeconds:300,retryLimit:2,retryDelay:5,retryBackoff:true});

}
export async function registerOfferIngestionWorker(boss,{handler=createOfferIngestionHandler(),teamSize=1}={}) {
 if(!boss||typeof boss.work!=="function")throw new Error("queue_not_started");
 if(!Number.isInteger(teamSize)||teamSize<1||teamSize>4)throw new Error("invalid_team_size");
 return boss.work(OFFER_INGESTION_QUEUE,{teamSize},async jobs=>{
  for(const job of Array.isArray(jobs)?jobs:[jobs])await handler(job);
 });
}
