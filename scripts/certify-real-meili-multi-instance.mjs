// Deterministic cross-instance RED/GREEN proof. Prices and stock in this
// scenario are synthetic future test data, not actual merchant observations.
import assert from "node:assert/strict";
import http from "node:http";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {fileURLToPath} from "node:url";
import {MeiliSearch} from "meilisearch";
import {indexOffers} from "../server/search-index.mjs";

const mode=process.argv[2];
const host="http://127.0.0.1:7700";
const name="nawaa_ci_multi_instance";
const url="https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-677770.html";
const id=Buffer.from([url,"new"].join("|")).toString("base64url").slice(0,500);
const base={sourceUrl:url,title:"Sony PlayStation 5 Slim Disc 1 TB Bundle with DualSense Wireless Controller",
  merchant:"Jarir",currency:"SAR",condition:"new",availability:"unknown",
  sourceMeta:{productId:"677770"},specs:{modelNumber:"CFI2116ACFIZC"}};
assert.equal(process.env.NODE_ENV,"test");
assert.equal(process.env.MEILI_INDEX,name,"CI-only isolated index required");

if(mode==="writer"){
  assert.ok(process.env.MEILI_HOST?.startsWith("http://127.0.0.1:"));
  const kind=process.argv[3],observedAt=process.argv[4];
  assert.ok(["newer","older"].includes(kind));
  const result=await indexOffers([{...base,observedAt,
    productPrice:kind==="newer"?3199:3049,
    availability:kind==="newer"?"out_of_stock":"unknown"}]);
  console.log("REAL_MULTI_INSTANCE_WRITER "+JSON.stringify({kind,pid:process.pid,result}));
}else if(mode==="red"||mode==="green"){
  assert.equal(process.env.MEILI_HOST,host,"requires real disposable localhost Meili");
  const direct=new MeiliSearch({host,apiKey:process.env.MEILI_MASTER_KEY});
  const index=direct.index(name);
  const now=Date.now();
  const t0=new Date(now-6000).toISOString();
  const t1=new Date(now-4000).toISOString();
  const t2=new Date(now-2000).toISOString();
  try{
    const clear=await index.deleteAllDocuments();
    await index.waitForTask(clear.taskUid);
  }catch(error){if(error?.code!=="index_not_found")throw error;}
  const seed=await index.addDocuments([{...base,id,observedAt:t0,productPrice:2999}]);
  await index.waitForTask(seed.taskUid);
  assert.equal((await index.getDocument(id)).observedAt,t0);

  let reads=0,posts=0,olderHeld=0,newerTaskUid=null;
  const waitingReads=[];
  let releaseOlder;
  const newerPersisted=new Promise(resolve=>releaseOlder=resolve);
  const relay=async(req,res,body)=>{
    const r=await fetch(host+req.url,{
      method:req.method,
      headers:{authorization:req.headers.authorization||"",
        accept:req.headers.accept||"application/json",
        "content-type":req.headers["content-type"]||"application/json"},
      body:["GET","HEAD"].includes(req.method)?undefined:body});
    const bytes=Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status,{"content-type":r.headers.get("content-type")||"application/json"});
    res.end(bytes);
    return {status:r.status,bytes};
  };
  const proxy=http.createServer(async(req,res)=>{
    try{
      const chunks=[];for await(const c of req)chunks.push(c);
      const body=Buffer.concat(chunks);
      if(req.method==="GET"&&req.url?.includes("/indexes/"+name+"/documents/")){
        const r=await fetch(host+req.url,{headers:{authorization:req.headers.authorization||""}});
        waitingReads.push({res,status:r.status,bytes:Buffer.from(await r.arrayBuffer())});
        reads++;
        if(waitingReads.length===2)for(const x of waitingReads){
          x.res.writeHead(x.status,{"content-type":"application/json"});
          x.res.end(x.bytes);
        }
        return;
      }
      if(req.method==="POST"&&req.url?.includes("/indexes/"+name+"/documents")){
        const docs=JSON.parse(body.toString());
        const first=Array.isArray(docs)?docs[0]:docs;
        if(first?.productPrice===3049){
          olderHeld++;
          await newerPersisted;
          posts++;
          await relay(req,res,body);
          return;
        }
        assert.equal(first?.productPrice,3199);
        posts++;
        const out=await relay(req,res,body);
        assert.equal(out.status,202);
        newerTaskUid=JSON.parse(out.bytes.toString()).taskUid;
        const finished=await index.waitForTask(newerTaskUid,{timeOutMs:15000,intervalMs:100});
        assert.equal(finished.status,"succeeded");
        releaseOlder();
        return;
      }
      await relay(req,res,body);
    }catch(error){
      console.error("MULTI_INSTANCE_PROXY_ERROR",error);
      if(!res.headersSent)res.writeHead(502);
      res.end(String(error));
    }
  });
  proxy.listen(0,"127.0.0.1");
  await once(proxy,"listening");
  const proxyHost="http://127.0.0.1:"+proxy.address().port;
  const run=(kind,observedAt)=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[fileURLToPath(import.meta.url),"writer",kind,observedAt],
      {env:{...process.env,MEILI_HOST:proxyHost},stdio:["ignore","pipe","pipe"]});
    let out="",err="";
    child.stdout.on("data",c=>out+=c);
    child.stderr.on("data",c=>err+=c);
    child.on("error",reject);
    child.on("close",code=>code===0?
      resolve({pid:child.pid,kind,output:out.trim()}):
      reject(new Error(kind+" exit "+code+": "+err+" "+out)));
  });
  try{
    const children=await Promise.all([run("newer",t2),run("older",t1)]);
    assert.equal(reads,2,"both independent processes must read initial T0");
    assert.equal(posts,2,"both workers must submit");
    assert.equal(olderHeld,1,"older task must be reordered after newer task");
    const final=await index.getDocument(id);
    const evidence={mode,t0,t1,t2,reads,posts,olderHeld,newerTaskUid,children,
      final:{observedAt:final.observedAt,productPrice:final.productPrice,
        availability:final.availability,sku:final.sourceMeta?.productId,
        mpn:final.specs?.modelNumber},syntheticTransitions:true};
    console.log("REAL_MEILI_MULTI_INSTANCE "+JSON.stringify(evidence));
    if(mode==="red"){
      assert.equal(final.productPrice,3049,"historical race must be reproduced");
      assert.equal(final.observedAt,t1);
    }else{
      assert.equal(final.productPrice,3199,"stale cross-instance task overwrote newer");
      assert.equal(final.observedAt,t2);
      assert.equal(final.availability,"out_of_stock");
    }
  }finally{proxy.closeAllConnections();proxy.close();}
}else throw Error("usage: red | green | writer");
