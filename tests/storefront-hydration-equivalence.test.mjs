import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,unlinkSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {fileURLToPath,pathToFileURL} from "node:url";
import {dirname,resolve} from "node:path";
import {extractProductLinks as optimized} from "../server/providers/free-storefronts.mjs";
import {makeFixture} from "../scripts/profile-storefront-acquisition-cpu.mjs";

// Reconstruct the exact old implementation from the candidate module, replacing
// ONLY the hydrated view selection. Put it temporarily next to the source file
// so all real relative imports resolve; remove immediately after import.
const sourcePath=fileURLToPath(new URL("../server/providers/free-storefronts.mjs",import.meta.url));
const source=readFileSync(sourcePath,"utf8");
const start=source.indexOf("  // A byte-identical decoded view");
const anchor="  for (const hydratedSource of hydratedViews) {";
const end=source.indexOf(anchor,start);
assert.ok(start>=0&&end>start&&source.indexOf(anchor,end+1)<0,
  "candidate hydrated-view code changed: manual audit required");
const historicalSource=source.slice(0,start)+
  '  for (const hydratedSource of [String(html || ""), decodeHtml(html)]) {'+
  source.slice(end+anchor.length);
const tmp=resolve(dirname(sourcePath),".hydration-baseline-"+process.pid+"-"+randomUUID()+".mjs");
let legacy;
try{
  writeFileSync(tmp,historicalSource,{flag:"wx"});
  ({extractProductLinks:legacy}=await import(pathToFileURL(tmp).href));
}finally{
  try{unlinkSync(tmp);}catch{}
}
assert.equal(typeof legacy,"function");

const BASE="https://fixture.invalid/search?q=iphone+17";
const store=(flags="")=>({
  id:"synthetic-fixture",
  productPath:new RegExp("\\/product\\/\\d+(?:[/?#]|$)",flags),
});
const cases=[
  ["empty",""],
  ["normal anchors",'<a href="/product/12345?name=iphone-17">Apple iPhone 17</a>'],
  ["quoted hydration",'{"url":"/product/12345?name=iphone-17","sku":"12345"}'],
  ["entity escaped quotes",'&#34;url&#34;:&#34;/product/22345?name=iphone-17&#34;'],
  ["named-entity quotes",'&quot;url&quot;:&quot;/product/32345?name=iphone-17&quot;'],
  ["hydration unicode escapes",'{"productUrl":"\\u002Fproduct\\u002F42345?name=iphone-17"}'],
  ["canonical duplicate",'{"url":"/product/12345?name=iphone-17"}<a href="/product/12345?name=iphone-17">iPhone 17</a>'],
  ["cross-host rejected",'<a href="https://outside.invalid/product/52345?name=iphone-17">iPhone 17</a>'],
  ["static asset rejected",'<a href="/product/62345.png">iPhone 17</a>'],
  ["mixed price unrelated",'&#34;url&#34;:&#34;/product/72345?name=iphone-17&#34;<a href="/product/82345">console controller</a>'],
  ["amazon-style entity query",'<a href="/product/92345?name=iphone-17&amp;sort=price">Apple iPhone 17</a>'],
  ["large mixed fixture",makeFixture(200)+
    '&quot;canonicalUrl&quot;:&quot;/product/99999?name=iphone-17&quot;'],
];

test("optimized hydrated extraction is EXACTLY historical for decoded/identical inputs",()=>{
  for(const [name,html] of cases){
    for(const query of ["iPhone 17","آيفون ١٧","PS5","iPhone"]){
      for(const limit of [0,1,4,Infinity]){
        const original=legacy(html,BASE,store(),query,limit);
        const revised=optimized(html,BASE,store(),query,limit);
        assert.deepEqual(revised,original,JSON.stringify({name,query,limit}));
      }
    }
  }
});

test("critical negative control: HTML-entity decoding MUST retain source-only products",()=>{
  const encoded='&quot;url&quot;:&quot;/product/22345?name=iphone-17&quot;';
  const found=optimized(encoded,BASE,store(),"iPhone 17");
  assert.equal(found.length,1,JSON.stringify(found));
  assert.equal(found[0].url,"https://fixture.invalid/product/22345?name=iphone-17");
  assert.deepEqual(found,legacy(encoded,BASE,store(),"iPhone 17"));
});

test("stateful global/sticky productPath regexes retain historical calls and results",()=>{
  const html='<a href="/product/12345">iPhone 17</a>'+
    '{"url":"/product/12345?name=iphone-17","url":"/product/12345?name=iphone-17"}';
  for(const flags of ["g","y","gi"]){
    assert.deepEqual(optimized(html,BASE,store(flags),"iPhone 17"),
      legacy(html,BASE,store(flags),"iPhone 17"),flags);
  }
});

test("canonical link ownership, deduplication, ranking and limits unchanged",()=>{
  const html='<a href="/product/12345">iPhone 17</a>'+
    '<a href="/product/12345">iPhone 17</a>'+
    '<a href="https://outside.invalid/product/99999">iPhone 17</a>'+
    '<a href="/product/98765.png">iPhone 17</a>';
  const items=optimized(html,BASE,store(),"iPhone 17",5);
  assert.deepEqual(items,legacy(html,BASE,store(),"iPhone 17",5));
  assert.equal(items.length,1);
  assert.equal(items[0].url,"https://fixture.invalid/product/12345");
});

test("paired CPU benchmark has exact outputs, no production P95 claims",()=>{
  const html=makeFixture(200);
  const timings={original:[],optimized:[]};
  const measure=(name,fn)=>{
    const cpu=process.cpuUsage();
    const offers=fn(html,BASE,store(),"iPhone 17",Infinity);
    const u=process.cpuUsage(cpu);
    timings[name].push((u.user+u.system)/1000);
    return offers;
  };
  const baseline=legacy(html,BASE,store(),"iPhone 17");
  assert.deepEqual(optimized(html,BASE,store(),"iPhone 17"),baseline);
  for(let i=0;i<5;i++){
    const order=i%2?[["optimized",optimized],["original",legacy]]:
      [["original",legacy],["optimized",optimized]];
    for(const [name,fn] of order) assert.deepEqual(measure(name,fn),baseline);
  }
  const median=x=>x.slice().sort((a,b)=>a-b)[Math.floor(x.length/2)];
  console.log("NAWAA_HYDRATED_SCAN_CPU "+JSON.stringify({
    kind:"synthetic_only",products:200,htmlBytes:Buffer.byteLength(html),
    rounds:5,semanticParity:true,
    baselineMedianCpuMs:Math.round(median(timings.original)*100)/100,
    candidateMedianCpuMs:Math.round(median(timings.optimized)*100)/100,
    note:"Process CPU; no merchant traffic; not production P95 or source wait."
  }));
  assert.ok(timings.original.every(Number.isFinite));
  assert.ok(timings.optimized.every(Number.isFinite));
});
