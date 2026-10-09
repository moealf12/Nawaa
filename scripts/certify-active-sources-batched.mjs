import {spawn} from "node:child_process";
import {copyFile, mkdir, writeFile} from "node:fs/promises";
import {resolve, join} from "node:path";
import {fileURLToPath} from "node:url";
import {configuredFreeStorefronts} from "../server/providers/free-storefronts.mjs";

// Explicit, auditable source order: exactly 39 live sources, in eight batches.
// At most 3 sources acquire data concurrently; the next group of 5 starts
// only when all attempts in the preceding group have completed.
export const SOURCE_BATCHES = [
  [
    {
      "id": "aliexpress-cn",
      "queries": [
        "charger",
        "cable"
      ]
    },
    {
      "id": "ikea-sa",
      "queries": [
        "chair",
        "table"
      ]
    },
    {
      "id": "asos-global",
      "queries": [
        "dress",
        "shirt"
      ]
    },
    {
      "id": "amazon-sa",
      "queries": [
        "iphone 17",
        "hp laptop"
      ]
    },
    {
      "id": "amazon-ae",
      "queries": [
        "iphone 17",
        "airpods"
      ]
    }
  ],
  [
    {
      "id": "noon-ae",
      "queries": [
        "iphone 17",
        "airpods"
      ]
    },
    {
      "id": "sharafdg-ae",
      "queries": [
        "hp laptop",
        "airpods"
      ]
    },
    {
      "id": "virgin-ae",
      "queries": [
        "airpods",
        "playstation 5"
      ]
    },
    {
      "id": "xcite-kw",
      "queries": [
        "hp laptop",
        "airpods"
      ]
    },
    {
      "id": "lulu-ae",
      "queries": [
        "iphone 17",
        "airpods"
      ]
    }
  ],
  [
    {
      "id": "lulu-sa",
      "queries": [
        "iphone 17",
        "samsung"
      ]
    },
    {
      "id": "samsung-sa",
      "queries": [
        "galaxy s25",
        "television"
      ]
    },
    {
      "id": "carrefour-ae",
      "queries": [
        "iphone 17",
        "laptop"
      ]
    },
    {
      "id": "microless-ae",
      "queries": [
        "iphone 17",
        "laptop"
      ]
    },
    {
      "id": "jumbo-ae",
      "queries": [
        "iphone 17",
        "airpods"
      ]
    }
  ],
  [
    {
      "id": "newegg-global",
      "queries": [
        "SSD",
        "laptop"
      ]
    },
    {
      "id": "bestbuy-us",
      "queries": [
        "laptop",
        "headphones"
      ]
    },
    {
      "id": "nike-sa",
      "queries": [
        "shoes",
        "shirt"
      ]
    },
    {
      "id": "namshi-sa",
      "queries": [
        "shoes",
        "shirt"
      ]
    },
    {
      "id": "centrepoint-sa",
      "queries": [
        "dress",
        "shirt"
      ]
    }
  ],
  [
    {
      "id": "maxfashion-sa",
      "queries": [
        "dress",
        "shirt"
      ]
    },
    {
      "id": "decathlon-sa",
      "queries": [
        "shoes",
        "backpack"
      ]
    },
    {
      "id": "niceone-sa",
      "queries": [
        "perfume",
        "lipstick"
      ]
    },
    {
      "id": "goldenscent-sa",
      "queries": [
        "perfume",
        "lipstick"
      ]
    },
    {
      "id": "ounass-sa",
      "queries": [
        "bag",
        "shoes"
      ]
    }
  ],
  [
    {
      "id": "sunandsand-sa",
      "queries": [
        "shoes",
        "shirt"
      ]
    },
    {
      "id": "virgin-sa",
      "queries": [
        "airpods",
        "iphone"
      ]
    },
    {
      "id": "homecentre-sa",
      "queries": [
        "chair",
        "table"
      ]
    },
    {
      "id": "mumzworld-sa",
      "queries": [
        "stroller",
        "baby"
      ]
    },
    {
      "id": "netaporter-global",
      "queries": [
        "dress",
        "bag"
      ]
    }
  ],
  [
    {
      "id": "mrporter-global",
      "queries": [
        "shoes",
        "shirt"
      ]
    },
    {
      "id": "mytheresa-global",
      "queries": [
        "bag",
        "shoes"
      ]
    },
    {
      "id": "ssense-global",
      "queries": [
        "shirt",
        "shoes"
      ]
    },
    {
      "id": "jomashop-global",
      "queries": [
        "watch",
        "seiko"
      ]
    },
    {
      "id": "fragrancex-global",
      "queries": [
        "perfume",
        "dior"
      ]
    }
  ],
  [
    {
      "id": "lookfantastic-global",
      "queries": [
        "cleanser",
        "serum"
      ]
    },
    {
      "id": "cultbeauty-global",
      "queries": [
        "serum",
        "cleanser"
      ]
    },
    {
      "id": "stockx-global",
      "queries": [
        "shoes",
        "sneakers"
      ]
    },
    {
      "id": "goat-global",
      "queries": [
        "shoes",
        "sneakers"
      ]
    }
  ]
];

export function validateSourceBatches(batches = SOURCE_BATCHES,activeStores=configuredFreeStorefronts()){
  const ids=batches.flat().map(item=>item.id);
  const active=new Set(activeStores.map(item=>item.id));
  const counts=new Map(ids.map(id=>[id,ids.filter(item=>item===id).length]));
  const missing=[...active].filter(id=>!counts.has(id));
  const unexpected=ids.filter(id=>!active.has(id));
  const duplicates=[...counts].filter(([,n])=>n!==1).map(([id])=>id);
  const correctSizes=batches.length===8&&batches.every((batch,i)=>batch.length===(i===7?4:5));
  return {
    ok:correctSizes&&ids.length===39&&active.size===39&&!missing.length&&!unexpected.length&&!duplicates.length,
    expected:39,actual:ids.length,missing,unexpected,duplicates,
    batchSizes:batches.map(batch=>batch.length),
  };
}

function spawnCertification(item, timeoutMs=85000) {
  return new Promise((resolveResult)=>{
    const child=spawn(process.execPath,["scripts/certify-active-source.mjs",item.id,...item.queries],{
      cwd:resolve(fileURLToPath(new URL("..",import.meta.url))),
      stdio:["ignore","pipe","pipe"],
    });
    let stdout="",stderr="";
    const truncate=(s,chunk)=> (s+chunk).slice(-18000);
    child.stdout.on("data",chunk=>{stdout=truncate(stdout,String(chunk));});
    child.stderr.on("data",chunk=>{stderr=truncate(stderr,String(chunk));});
    let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill("SIGKILL");},timeoutMs);
    child.once("error",error=>{
      clearTimeout(timer);
      resolveResult({id:item.id,code:1,error:String(error),timedOut});
    });
    child.once("close",code=>{
      clearTimeout(timer);
      resolveResult({id:item.id,code:code??1,stdout,stderr,timedOut});
    });
  });
}

async function runBatch(items, maxConcurrent=3){
  const output=new Array(items.length);
  let next=0;
  await Promise.all(Array.from({length:Math.min(maxConcurrent,items.length)},async()=>{
    while(next<items.length){
      const index=next++;
      const item=items[index];
      const result=await spawnCertification(item);
      output[index]=result;
      try{
        await copyFile("active-source-"+item.id+".json",join("source-cert-artifacts","active-source-"+item.id+".json"));
      }catch(error){
        // Keep the failed or interrupted source visible in the final rollup.
        await writeFile(join("source-cert-artifacts","active-source-"+item.id+".json"),JSON.stringify({
          source:item.id,observedAt:new Date().toISOString(),passed:false,
          routeCoverage:[],cases:[{query:item.queries[0],pass:false,error:"No report: "+String(error)}],
        },null,2));
      }
      console.log("SOURCE "+JSON.stringify({
        id:item.id,status:result.code===0?"PASS":"FAIL",
        exitCode:result.code,timedOut:result.timedOut,
        error:result.code===0?null:(result.error||result.stderr?.slice(-500)||"certification failed"),
      }));
    }
  }));
  return output;
}

export async function runAllBatches(){
  const validation=validateSourceBatches();
  if(!validation.ok)throw new Error("Source registry mismatch: "+JSON.stringify(validation));
  await mkdir("source-cert-artifacts",{recursive:true});
  let failing=0;
  for(let i=0;i<SOURCE_BATCHES.length;i++){
    console.log("BEGIN BATCH "+(i+1)+"/8: "+SOURCE_BATCHES[i].map(x=>x.id).join(", "));
    const result=await runBatch(SOURCE_BATCHES[i],3);
    const failed=result.filter(x=>x?.code!==0);
    failing+=failed.length;
    console.log("END BATCH "+(i+1)+"/8: "+(result.length-failed.length)+" pass, "+failed.length+" fail");
  }
  console.log("39-SOURCE CERTIFICATION ATTEMPTS FINISHED; failures="+failing);
  // The aggregator owns the final CI gate. Do not stop after an early failure.
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.includes("--check")){
    const result=validateSourceBatches();
    console.log(JSON.stringify(result,null,2));
    if(!result.ok)process.exitCode=1;
  }else runAllBatches().catch(error=>{console.error(error);process.exitCode=1;});
}
