import test from "node:test";
import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";

// Disposable HTTP acceptance with synthetic upstream responses, no live merchant claims.
test("R06-B: Amazon page denial is PARTIAL in both JSON and SSE while eXtra offers survive",async()=>{
  const script=`
    import http from "node:http";
    process.env.PORT="0";
    process.env.DATABASE_URL="";
    process.env.SEARCH_REQUEST_DEADLINE_MS="4800";
    process.env.SEARCH_STREAM_DEADLINE_MS="4700";
    process.env.NAWAA_TEST_TRANSPORT="fetch";
    const html='<html><div data-component-type="s-search-result" data-asin="B0ABC12345"><h2><a href="/HP-Laptop/dp/B0ABC12345/ref=sr_1_1"><span>HP OmniBook 5 Laptop 16GB 512GB</span></a></h2><span class="a-price"><span class="a-offscreen">SAR 2,999.50</span></span></div></html>';
    const counts={amazon:0,denied:0,extra:0};
    globalThis.fetch=async input=>{
      const address=String(input?.url||input);
      if(address.startsWith("https://search.unbxd.io/")){
        counts.extra++;
        return Response.json({response:{products:[{
          id:"qa-r06-extra-hp",name:"HP Pavilion Laptop 16GB RAM",
          currentPrice:2799,imageUrl:"https://www.extra.com/qa.jpg",
          featureEnBrandName:"HP",featureEnDeviceType:"Laptop",available:true,
        }]}});
      }
      if(address.startsWith("https://www.amazon.sa/")){
        counts.amazon++;
        const page=new URL(address).searchParams.get("page")||"1";
        if(page==="3"){counts.denied++;return new Response("Denied",{status:403});}
        return new Response(html,{status:200,headers:{"content-type":"text/html"}});
      }
      if(address.startsWith("https://ac.cnstrc.com/"))return new Response("{}",{status:200,headers:{"content-type":"application/json"}});
      return new Response("",{status:200,headers:{"content-type":"text/html"}});
    };
    const get=(port,path)=>new Promise((resolve,reject)=>{
      http.get({host:"127.0.0.1",port,path},res=>{
        let data="";
        res.on("data",chunk=>data+=chunk);
        res.on("end",()=>resolve({status:res.statusCode,body:data}));
      }).on("error",reject);
    });
    const originalListen=http.Server.prototype.listen;
    http.Server.prototype.listen=function(...args){
      this.once("listening",async()=>{
        try{
          const port=this.address().port;
          const sse=await get(port,"/api/search/stream?q=hp+laptop");
          const snapshots=sse.body.split("\\n\\n").filter(x=>x.startsWith("event: snapshot\\n"))
            .map(x=>JSON.parse(x.match(/^data: (.*)$/m)[1]));
          const last=snapshots.at(-1);
          const json=await get(port,"/api/search?q=hp+laptop");
          const parsed=JSON.parse(json.body);
          const isAmazonError=e=>e.sourceId==="free-storefronts:amazon-sa" &&
            e.error==="amazon_incomplete_source_evidence";
          console.log("RESULT "+JSON.stringify({
            sseStatus:sse.status,sseDone:sse.body.includes("event: done"),
            sseAmazonError:last?.errors?.some(isAmazonError),
            ssePartial:last?.coverage?.partial,sseComplete:last?.coverage?.complete,
            sseExtra:last?.offers?.some(o=>o.provider==="extra-unbxd"&&o.productPrice===2799),
            sseErrorCount:last?.errors?.length,
            jsonStatus:json.status,
            jsonAmazonError:parsed.errors?.some(isAmazonError),
            jsonPartial:parsed.coverage?.partial,jsonComplete:parsed.coverage?.complete,
            jsonExtra:parsed.offers?.some(o=>o.provider==="extra-unbxd"&&o.productPrice===2799),
            jsonCacheMode:parsed.cache?.mode,
            counts,
          }));
        }catch(e){console.log("FAIL "+e.stack);process.exitCode=1}
        finally{this.close(()=>process.exit(process.exitCode||0))}
      });
      return originalListen.apply(this,args);
    };
    await import("./server/server.mjs");
  `;
  const {stdout}=await promisify(execFile)(process.execPath,["--input-type=module","-e",script],{
    cwd:new URL("..",import.meta.url),timeout:20000,maxBuffer:2*1024*1024,
  });
  const fail=stdout.split("\n").find(line=>line.startsWith("FAIL "));
  assert.equal(fail,undefined,fail);
  const row=stdout.split("\n").find(line=>line.startsWith("RESULT "));
  assert.ok(row,stdout);
  const data=JSON.parse(row.slice(7));
  assert.equal(data.sseStatus,200);
  assert.equal(data.sseDone,true);
  assert.equal(data.sseAmazonError,true);
  assert.equal(data.ssePartial,true);
  assert.equal(data.sseComplete,false);
  assert.equal(data.sseExtra,true);
  assert.equal(data.jsonStatus,200);
  assert.equal(data.jsonAmazonError,true);
  assert.equal(data.jsonPartial,true);
  assert.equal(data.jsonComplete,false);
  assert.equal(data.jsonExtra,true);
  assert.equal(data.jsonCacheMode,"miss");
  assert.ok(data.counts.denied>=2,JSON.stringify(data.counts));
});
