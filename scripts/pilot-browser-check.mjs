import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createServer} from "node:net";
import {mkdir,writeFile} from "node:fs/promises";
import {chromium} from "playwright";

// Exercise real HTML, DOM controls and backend using genuine public-store requests.
// Never visit checkout or mutate merchant resources. The public Render service is untouched.
const port=await new Promise((resolve,reject)=>{
  const s=createServer();s.once("error",reject);
  s.listen(0,"127.0.0.1",()=>{
    const result=s.address().port;s.close(()=>resolve(result));
  });
});
const host="http://127.0.0.1:"+port;
const server=spawn(process.execPath,["server/server.mjs"],{
  env:{...process.env,PORT:String(port),NAWAA_ENABLE_CERTIFIED_PILOT:"1"},
  stdio:["ignore","pipe","pipe"],
});
let stderr="";
server.stderr.on("data",x=>{stderr=(stderr+String(x)).slice(-2500);});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let browser=null;
async function main(){
  let ready=false;
  for(let i=0;i<45;i++){
    if(server.exitCode!==null)throw Error("Pilot server exited: "+stderr);
    try{
      const response=await fetch(host+"/health",{signal:AbortSignal.timeout(3000)});
      if(response.ok){ready=true;break;}
    }catch{}
    await wait(500);
  }
  assert.ok(ready,"Server failed to start: "+stderr);
  await mkdir("pilot-browser-report",{recursive:true});
  browser=await chromium.launch({channel:"chrome",headless:true,args:["--no-sandbox"]});
  const page=await browser.newPage({viewport:{width:1440,height:960},locale:"ar-SA"});
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  const response=await page.goto(host+"/pilot.html",{waitUntil:"domcontentloaded",timeout:20000});
  assert.equal(response.status(),200);
  await page.locator(".source").first().waitFor({timeout:20000});
  const count=await page.locator(".source").count();
  assert.equal(count,15,"Pilot must render exactly 15 merchant cards");

  // Three representative markets/categories; full 15 already checked by API CI.
  const checks=[];
  for (const source of [
    {name:"IKEA Saudi",query:"chair"},
    {name:"ASOS",query:"dress"},
    {name:"Golden Scent",query:"perfume"},
  ]){
    const card=page.locator(".source").filter({hasText:source.name}).first();
    assert.equal(await card.count(),1,"Missing "+source.name);
    await card.locator("input").fill(source.query);
    await card.locator("button").click();
    await page.waitForFunction((name)=>{
      const cards=[...document.querySelectorAll(".source")];
      const current=cards.find(c=>c.querySelector("b")?.textContent?.includes(name));
      const status=current?.querySelector(".source-status")?.textContent||"";
      return status.startsWith("✓")||status.startsWith("لا توجد")||status.startsWith("تعذر");
    },source.name,{timeout:25000});
    const status=await card.locator(".source-status").innerText();
    const products=await page.locator("#results .product").count();
    const samples=await page.locator("#results .product").evaluateAll(cards=>
      cards.slice(0,3).map(card=>({
        title:card.querySelector("h3")?.textContent||"",
        displayedPrice:card.querySelector("b")?.textContent||"",
        imageSrc:card.querySelector("img")?.getAttribute("src")||"",
        destination:card.querySelector("a")?.href||"",
        imageLoaded:(card.querySelector("img")?.naturalWidth||0)>0,
      }))
    );
    const entry={source:source.name,query:source.query,status,products,samples};
    checks.push(entry);
    assert.ok(status.startsWith("✓"),"Live source UI failed: "+JSON.stringify(entry));
    assert.ok(products>0,"No live product cards: "+source.name);
    assert.ok(samples.every(x=>x.displayedPrice.includes("ر.س")||x.displayedPrice.includes("SAR")||x.displayedPrice.includes("ريال")),
      "SAR price is not visible: "+source.name);
    assert.ok(samples.every(x=>x.destination.startsWith("https://")),
      "A product lacks a secure source link: "+source.name);
    await page.screenshot({path:"pilot-browser-report/"+source.name.toLowerCase().replace(/\s+/g,"-")+".png",fullPage:true});
  }
  assert.equal(errors.length,0,"Browser JS failures: "+JSON.stringify(errors));
  const counts={sources:Number(await page.locator("#count").innerText()),
    checked:Number(await page.locator("#checked").innerText()),
    passed:Number(await page.locator("#passed").innerText())};
  assert.deepEqual(counts,{sources:15,checked:3,passed:3});
  const report={testedAt:new Date().toISOString(),url:host+"/pilot.html",environment:"CI branch ephemeral HTTP server (NOT Render production)",
    merchantCards:count,counts,checks,uncaughtBrowserErrors:errors,
    outcome:"PASS",note:"Prices are observed merchant offers; final shipping/import totals are not guaranteed."};
  await writeFile("pilot-browser-report/report.json",JSON.stringify(report,null,2)+"\n");
  console.log("PILOT_BROWSER_SUMMARY "+JSON.stringify({
    merchantCards:count,checks:checks.map(x=>({source:x.source,products:x.products,
      loadedSampleImages:x.samples.filter(s=>s.imageLoaded).length,reportedSampleImages:x.samples.length})),counts,uncaughtBrowserErrors:errors.length,
  }));
}
try{await main();}
catch(error){console.error("PILOT_BROWSER_FAILURE "+String(error?.stack||error));process.exitCode=1;}
finally{await browser?.close();server.kill("SIGTERM");}
