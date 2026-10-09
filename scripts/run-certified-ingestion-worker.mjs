// Dedicated and explicitly opted-in background process.
// Never imported by server/server.mjs or any customer-facing entrypoint.
import {startCertifiedIngestionWorker} from "../server/tooling/certified-ingestion-runtime.mjs";

const worker=await startCertifiedIngestionWorker();
console.log("NAWAA certified background worker ready (15 allowlisted pilot sources)");
let stopping=false;
async function stop() {
 if(stopping)return;
 stopping=true;
 try{await worker.stop();process.exitCode=0;}
 catch{process.exitCode=1;}
}
process.once("SIGTERM",stop);
process.once("SIGINT",stop);
