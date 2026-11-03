import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname, join } from "node:path";
import { chromium, webkit } from "playwright";

const root=resolve(import.meta.dirname,"..");
const artifacts=join(root,"browser-artifacts","hero-hologram");
await mkdir(artifacts,{recursive:true});
const allowed=new Set(["/","/index.html","/config.js","/assets/nawaa-hero-sculpture.png","/assets/nawaa-work-study.jpg","/assets/nawaa-home.jpg"]);
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,"http://127.0.0.1").pathname;
 if(!allowed.has(path)){res.writeHead(404);res.end("Not Found");return;}
 try{
  const body=await readFile(resolve(root,path==="/"?"index.html":path.slice(1)));
  res.writeHead(200,{"content-type":extname(path)===".png"?"image/png":extname(path)===".jpg"?"image/jpeg":extname(path)===".js"?"text/javascript":"text/html; charset=utf-8","content-length":body.length});
  res.end(body);
 }catch(e){res.writeHead(500);res.end(String(e));}
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const port=server.address().port;
const configurations=[
 ["chromium","mobile-320",320,700,true],
 ["chromium","mobile-390",390,844,true],
 ["chromium","mobile-430",430,932,true],
 ["chromium","desktop-1440",1440,900,false],
 ["webkit","webkit-mobile-390",390,844,true]
];
const openBrowsers=new Map(),results=[];
try{
 for(const [engine,name,width,height,mobile] of configurations){
  if(!openBrowsers.has(engine)){
   const browser=engine==="chromium"?await chromium.launch({channel:"chrome",headless:true}):await webkit.launch({headless:true});
   openBrowsers.set(engine,browser);
  }
  const context=await openBrowsers.get(engine).newContext({viewport:{width,height},isMobile:mobile,hasTouch:mobile,locale:"ar-SA"});
  const page=await context.newPage(),errors=[];
  page.on("pageerror",error=>errors.push(String(error)));
  page.on("response",response=>{if(response.status()>=400&&new URL(response.url()).hostname==="127.0.0.1")errors.push("HTTP "+response.status()+" "+response.url());});
  const start=Date.now();
  await page.goto("http://127.0.0.1:"+port+"/index.html",{waitUntil:"load",timeout:30000});
  await page.locator("#sculpture").waitFor({state:"visible"});
  const geometry=await page.evaluate(()=>{
   const image=document.getElementById("sculpture");
   const tilt=document.getElementById("heroTilt").getBoundingClientRect();
   const sheen=getComputedStyle(document.querySelector(".hero-sheen"));
   return {complete:image.complete,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,
    viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,
    left:tilt.left,right:tilt.right,mask:sheen.webkitMaskImage||sheen.maskImage,
    searchPresent:!!document.getElementById("nawaaSearchForm")};
  });
  assert.ok(geometry.complete&&geometry.naturalWidth>0,"original sculpture image must load");
  assert.ok(geometry.mask&&geometry.mask!=="none","hologram uses transparent image mask");
  assert.ok(geometry.searchPresent,"original search form survives");
  assert.ok(geometry.scrollWidth<=geometry.viewport+1,"horizontal overflow: "+JSON.stringify(geometry));
  assert.ok(geometry.left>=-2&&geometry.right<=geometry.viewport+2,"art frame clipped: "+JSON.stringify(geometry));
  const spacing=await page.evaluate(()=>({titleTop:document.querySelector(".hero-title").getBoundingClientRect().top,artBottom:document.querySelector("#heroVisual").getBoundingClientRect().bottom}));
  assert.ok(spacing.titleTop>=spacing.artBottom-22,"headline overlaps hero art on "+name+": "+JSON.stringify(spacing));
  await page.screenshot({path:join(artifacts,name+"-hologram.png")});
  await page.locator("#heroOriginal").click();
  assert.equal(await page.locator("#heroVisual").getAttribute("data-hologram"),"off");
  assert.equal(await page.locator("#heroOriginal").getAttribute("aria-pressed"),"true");
  await page.locator("#heroHologram").click();
  assert.equal(await page.locator("#heroVisual").getAttribute("data-hologram"),"on");
  await page.locator("#heroPause").click();
  assert.equal(await page.locator("#heroVisual").getAttribute("data-motion"),"off");
  await page.locator("#heroPause").click();
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.waitForFunction(() => document.querySelector("#heroVisual").dataset.motion === "off", null, {timeout:2500});
  assert.equal(await page.locator("#heroVisual").getAttribute("data-motion"),"off");
  await page.emulateMedia({reducedMotion:"no-preference"});
  await page.waitForFunction(() => document.querySelector("#heroVisual").dataset.motion === "on", null, {timeout:2500});
  const box=await page.locator("#heroTilt").boundingBox();
  const x=box.x+box.width*.75,y=box.y+box.height*.4;
  if(mobile)await page.locator("#heroTilt").dispatchEvent("pointermove",{pointerType:"touch",clientX:x,clientY:y});
  else await page.mouse.move(x,y);
  await page.waitForTimeout(120);
  const tilt=await page.locator("#heroVisual").evaluate(el=>getComputedStyle(el).getPropertyValue("--tilt-y").trim());
  assert.ok(Math.abs(parseFloat(tilt))>.1,"tilt should respond to pointer: "+tilt);
  assert.deepEqual(errors,[],"no browser JS or local-resource failures");
  const row={name,passed:true,assetPixels:[geometry.naturalWidth,geometry.naturalHeight],noOverflow:true,tilt,elapsedMs:Date.now()-start};
  results.push(row);
  console.log("HERO_BROWSER_PASS "+JSON.stringify(row));
  await context.close();
 }
}finally{
 for(const browser of openBrowsers.values())await browser.close();
 await new Promise(r=>server.close(r));
}
console.log("HERO_HOLOGRAM_ACCEPTED "+JSON.stringify({total:results.length,passed:results.length,results}));
