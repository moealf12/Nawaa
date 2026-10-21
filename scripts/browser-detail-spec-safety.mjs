// Independent real-Chromium proof for v21.16 product detail attribute safety.
// Uses the actual production server and product.html with a synthetic session
// snapshot; never requests real merchants or mutates persistent data.
import assert from "node:assert/strict";
import {chromium} from "playwright";
import {spawn} from "node:child_process";
import {once} from "node:events";
import net from "node:net";
import {existsSync} from "node:fs";

if(process.env.NODE_ENV!=="test") throw new Error("detail_browser_requires_test_env");
const executablePath=["/usr/bin/google-chrome","/usr/bin/google-chrome-stable","/usr/bin/chromium"].find(existsSync);
assert.ok(executablePath,"Chromium executable required");
const port=await new Promise((resolve,reject)=>{
  const server=net.createServer();
  server.once("error",reject);
  server.listen(0,"127.0.0.1",()=>{const port=server.address().port;server.close(()=>resolve(port));});
});
const base="http://127.0.0.1:"+port;
const server=spawn(process.execPath,["server/server.mjs"],{
  env:{...process.env,PORT:String(port),NODE_ENV:"test",DATABASE_URL:"",MEILI_HOST:"",MEILI_MASTER_KEY:""},
  stdio:["ignore","pipe","pipe"]
});
let browser;
try{
  let ready=false;
  for(let attempt=0;attempt<40;attempt++){
    try{const response=await fetch(base+"/product.html",{signal:AbortSignal.timeout(1200)});if(response.ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  assert.ok(ready,"local candidate product page failed to start");
  browser=await chromium.launch({headless:true,executablePath,args:["--no-sandbox"]});
  const snapshot={
    query:"HP laptop",product:{},offer:{
      merchant:"Jarir",title:"HP Pavilion 512GB",sourceUrl:"https://www.jarir.com/sa-en/model-1.html",
      productPrice:2999,condition:"new",availability:"in_stock",
      specs:{brand:"HP",deviceType:"Laptop",ram:"No",processor:"undefined",
        storage:"N/A",color:"unknown",screenType:false,regionVersion:"Saudi",
        waterproof:false,modelNumber:"HP-ZX/A1",barcode:"AB00071"}
    }
  };
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.addInitScript(value=>{
    sessionStorage.setItem("nawaa_product_detail",JSON.stringify(value));
  },snapshot);
  const page=await context.newPage();
  const pageErrors=[];
  page.on("pageerror",error=>pageErrors.push(String(error)));
  await page.goto(base+"/product.html",{waitUntil:"domcontentloaded"});
  await page.locator(".spec-table").waitFor({timeout:15000});
  await page.waitForFunction(()=>document.querySelector(".model-line")?.textContent?.includes("HP-ZX/A1"));
  const specs=await page.locator(".spec-table div").evaluateAll(nodes=>
    nodes.map(node=>[node.querySelector("span")?.textContent?.trim(),node.querySelector("b")?.textContent?.trim()]));
  const rows=new Map(specs);
  assert.equal(rows.get("العلامة التجارية"),"HP");
  assert.equal(rows.get("رقم الموديل"),"HP-ZX/A1");
  assert.equal(rows.get("الباركود"),"AB00071");
  assert.equal(rows.get("مقاومة الماء"),"لا");
  for(const invalid of ["الذاكرة RAM","المعالج","السعة","اللون","نوع الشاشة"]){
    assert.equal(rows.has(invalid),false,"invalid detail field: "+invalid);
  }
  for(const width of [320,390,1440]){
    await page.setViewportSize({width,height:844});
    const x=await page.evaluate(()=>({screen:innerWidth,scroll:document.documentElement.scrollWidth}));
    assert.ok(x.scroll<=x.screen+4,"horizontal overflow: "+JSON.stringify(x));
  }
  await page.locator("#quoteBtn").click();
  const draft=await page.evaluate(()=>JSON.parse(localStorage.getItem("nawaa_quote_draft")));
  assert.equal(draft.model,"HP-ZX/A1");
  assert.equal(draft.variant,"","invalid source placeholders must not contaminate quotation");
  assert.equal(draft.sourceUrl,snapshot.offer.sourceUrl);
  assert.equal(draft.observedProductPriceSAR,2999);
  assert.deepEqual(pageErrors,[],"uncaught browser runtime errors");
  console.log("NAWAA_V2116_DETAIL_BROWSER_PASS "+JSON.stringify({
    widths:[320,390,1440],specCount:specs.length,invalidFiltered:5,
    negativeBoolean:"لا",modelPreserved:true,quotePreserved:true
  }));
}finally{
  if(browser)await browser.close().catch(()=>{});
  if(server.exitCode===null){
    server.kill("SIGTERM");
    await Promise.race([once(server,"exit").catch(()=>{}),new Promise(resolve=>setTimeout(resolve,1200))]);
  }
}
