import {createBackgroundBoss} from "./background-boss.mjs";
import {createOfferIngestionHandler,registerOfferIngestionWorker,OFFER_INGESTION_QUEUE} from "./offer-ingestion-worker.mjs";
import {createSignedSourceVerifier} from "./source-attestation.mjs";
import {CERTIFIED_SOURCE_HOSTS} from "../../src/certified-source-hosts.mjs";

// An explicitly-started, offline-capable worker. It does not run at HTTP
// startup, scrape websites, authenticate externally, or require paid services.
export async function startCertifiedIngestionWorker({
 env=process.env,bossFactory=createBackgroundBoss,sourceHosts=CERTIFIED_SOURCE_HOSTS,
 record,teamSize=1
}={}){
 if(env.NAWAA_ENABLE_BACKGROUND_JOBS!=="1"||env.NAWAA_ENABLE_CERTIFIED_INGESTION!=="1")
   throw new Error("certified_ingestion_disabled");
 if(typeof env.NAWAA_INGESTION_SIGNING_KEY!=="string"||
    Buffer.byteLength(env.NAWAA_INGESTION_SIGNING_KEY,"utf8")<32)
   throw new Error("ingestion_signing_key_required");
 const boss=bossFactory({env});
 try{
   await boss.start();
   await boss.createQueue(OFFER_INGESTION_QUEUE,{retryLimit:2,retryDelay:5,retryBackoff:true});
   const handler=createOfferIngestionHandler({
     verify:createSignedSourceVerifier({sourceHosts,key:env.NAWAA_INGESTION_SIGNING_KEY}),
     ...(record?{record}:{})
   });
   await registerOfferIngestionWorker(boss,{handler,teamSize});
   return {boss,stop:()=>boss.stop(),handler};
 }catch(error){
   try{await boss.stop();}catch{}
   throw error;
 }
}
