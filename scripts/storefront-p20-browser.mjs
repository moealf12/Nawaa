import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { chromium, webkit } from "playwright";

const root=resolve(import.meta.dirname,".."), evidence=join(root,"browser-artifacts","storefront-p20");
await mkdir(evidence,{recursive:true});
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,"http://127.0.0.1"),path=url.pathname;
 if(path==="/favicon.ico"){res.writeHead(204);res.end();return;}
 if(!["/","/index.html","/config.js"].includes(path)&&!/^\/assets\/[a-z0-9-]+\.(jpg|png|webp)$/.test(path)){
  res.writeHead(404);res.end("Not Found");return;
 }
 const local=resolve(root,path==="/"?"index.html":path.slice(1));
 try{
  const bytes=await readFile(local),ext=extname(local);
  res.writeHead(200,{"content-type":ext===".png"?"image/png":ext===".jpg"?"image/jpeg":ext===".js"?"text/javascript":"text/html; charset=utf-8","content-length":bytes.length});
  res.end(bytes);
 }catch(e){res.writeHead(500);res.end(String(e));}
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const address="http://127.0.0.1:"+server.address().port, results=[], opened=[];
const cases=[
 {engine:"chromium",name:"mobile-320",width:320,height:720,mobile:true},
 {engine:"chromium",name:"mobile-390",width:390,height:844,mobile:true},
 {engine:"chromium",name:"desktop-1440",width:1440,height:900,mobile:false},
 {engine:"webkit",name:"webkit-mobile-390",width:390,height:844,mobile:true}
];
try{
 for(const config of cases){
  const type=config.engine==="webkit"?webkit:chromium;
  const browser=await type.launch(config.engine==="chromium"?{channel:"chrome",headless:true}:{headless:true});opened.push(browser);
  const context=await browser.newContext({viewport:{width:config.width,height:config.height},isMobile:config.mobile,hasTouch:config.mobile,locale:"ar-SA"});
  const page=await context.newPage(),errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  page.on("response",r=>{if(r.url().startsWith(address)&&r.status()>=400)errors.push("HTTP "+r.status()+" "+r.url());});
  await page.goto(address+"/index.html",{waitUntil:"load",timeout:30000});
  assert.equal(await page.locator("#price").count(),1);
  assert.equal(await page.locator("#pricing-policy").count(),1);
  const missing=await page.evaluate(()=>[...document.querySelectorAll('a[href^="#"]')].filter(a=>!document.getElementById(a.hash.slice(1))).map(a=>a.outerHTML));
  assert.deepEqual(missing,[],"all internal href anchors resolve");
  const overflow=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth}));
  assert.ok(overflow.scroll<=overflow.viewport+1,"no horizontal page overflow: "+JSON.stringify(overflow));
  const original=await page.locator("#sculpture").evaluate(img=>({complete:img.complete,naturalWidth:img.naturalWidth}));
  assert.ok(original.complete&&original.naturalWidth>0,"original NAWAA sculpture must remain visible");
  if(config.mobile){
   await page.locator("#menuBtn").click();
   assert.equal(await page.locator("#drawer").getAttribute("aria-hidden"),"false");
   assert.equal(await page.locator("#menuBtn").getAttribute("aria-expanded"),"true");
   assert.equal(await page.evaluate(()=>document.activeElement.id),"drawerClose");
   await page.keyboard.press("Shift+Tab");
   assert.equal(await page.evaluate(()=>document.activeElement.getAttribute("href")),"#faq");
   await page.keyboard.press("Tab");
   assert.equal(await page.evaluate(()=>document.activeElement.id),"drawerClose");
   await page.locator('#drawerNav a[href="#pricing-policy"]').click();
   await page.waitForFunction(()=>document.activeElement?.id==="pricing-policy");
   assert.equal(await page.locator("#drawer").getAttribute("aria-hidden"),"true");
   assert.equal(await page.locator("#menuBtn").getAttribute("aria-expanded"),"false");
   assert.equal(new URL(page.url()).hash,"#pricing-policy");
  }else{
   await page.locator('.nav-links a[href="#price"]').click();
   assert.equal(new URL(page.url()).hash,"#price");
  }
  await page.locator('article.card').first().scrollIntoViewIfNeeded();
  await page.locator('article.card').first().focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#drawer").getAttribute("aria-hidden"),"false");
  assert.equal(await page.locator("#drawerTitle").textContent(),"العمل والدراسة");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#drawer").getAttribute("aria-hidden"),"true");
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute("data-title")),"العمل والدراسة");
  await page.keyboard.press(" ");
  assert.equal(await page.locator("#drawer").getAttribute("aria-hidden"),"false");
  await page.locator("#drawerClose").click();
  assert.equal(await page.locator("#drawer").getAttribute("aria-hidden"),"true");
  assert.deepEqual(errors,[],"JS and local asset errors");
  await page.screenshot({path:join(evidence,config.name+".png")});
  const record={name:config.name,passed:true,overflow:false,heroImageLoaded:true,anchors:true,keyboard:true,menu:config.mobile};
  results.push(record);console.log("STOREFRONT_P20_PASS "+JSON.stringify(record));
  await context.close();
 }
}finally{
 for(const browser of opened)await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
console.log("STOREFRONT_P20_ACCEPTED "+JSON.stringify({passed:results.length,total:cases.length}));
