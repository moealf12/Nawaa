import test from "node:test";
import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";

// Run ONLY against the explicitly provisioned disposable GitHub CI database.
// Never fall back to production DATABASE_URL.
const ciDatabase=process.env.NAWAA_TEST_DATABASE_URL||"";
test("R04 P3: real PostgreSQL commits verified source time and replays only its current revision",{
  skip:!ciDatabase,
},async()=>{
  const script=`
    import {randomUUID} from "node:crypto";
    import {recordOffer,searchPersistedOffers} from "./server/persistence.mjs";
    const id=randomUUID();
    const title="NAWAA R04P3 Retained Retail Evidence "+id;
    const sourceUrl="https://example.invalid/r04p3-e2e/"+id;
    const observedAt=new Date(Date.now()-2000).toISOString();
    const oldTime=new Date(Date.now()-120_000).toISOString();
    const base={
      sourceUrl,title,merchant:"CI Disposable Retailer",
      sourceName:"ci-test-source",currency:"SAR",
      condition:"new",availability:"in_stock",
      dataKind:"live",matchConfidence:1,exactMatch:true,
    };
    await recordOffer({...base,productPrice:2500,observedAt});
    await recordOffer({...base,productPrice:100,observedAt:oldTime});
    const result=await searchPersistedOffers("R04P3",{limit:120,now:Date.now()});
    const selected=result.offers.find(x=>x.sourceUrl===sourceUrl);
    console.log("PROOF "+JSON.stringify({
      configured:result.configured,
      found:!!selected,price:selected?.productPrice,
      exact:selected?.exactMatch,confidence:selected?.matchConfidence,
      dataKind:selected?.dataKind,observedAt:selected?.observedAt,
      sourceTime:observedAt,
    }));
    process.exit(0);
  `;
  const {stdout}=await promisify(execFile)(process.execPath,
    ["--input-type=module","-e",script],{
      cwd:new URL("..",import.meta.url),timeout:25000,
      env:{...process.env,DATABASE_URL:ciDatabase,DATABASE_SSL:"false",
        MEILI_HOST:"",MEILI_MASTER_KEY:"",NODE_ENV:"test"},
    });
  const line=stdout.split("\n").find(x=>x.startsWith("PROOF "));
  assert.ok(line,"missing disposable PostgreSQL evidence");
  const evidence=JSON.parse(line.slice(6));
  assert.equal(evidence.configured,true);
  assert.equal(evidence.found,true);
  assert.equal(evidence.price,2500,"older source price cannot overwrite newer");
  assert.equal(evidence.exact,false);
  assert.equal(evidence.confidence,0);
  assert.equal(evidence.dataKind,"persisted");
  assert.equal(evidence.observedAt,evidence.sourceTime);
});
