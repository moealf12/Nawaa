// Read-only actual production browser acceptance for the reported iPhone issue.
// No direct merchant requests, DB writes, screenshots containing prices or PII.
import {chromium} from "playwright";
import {existsSync} from "node:fs";
import assert from "node:assert/strict";
const url="https://nawaa-search-api.onrender.com";
const expected=process.env.NAWAA_EXPECT_LIVE_SHA;
assert.match(expected||"",/^[a-f0-9]{40}$/);
const health=await fetch(url+"/health",{signal:AbortSignal.timeout(70000)});
assert.equal(health.status,200);
const h=await health.json();
assert.equal(h.revision,expected,"Production must be at the exact tested SHA");
const binary=["/usr/bin/google-chrome","/usr/bin/google-chrome-stable","/usr/bin/chromium"].find(existsSync);
assert.ok(binary,"Test runner must have local free Chromium");
const browser=await chromium.launch({
  executablePath:binary,headless:true,
  args:["--no-sandbox","--disable-dev-shm-usage"]
});
try{
  const context=await browser.newContext({
    viewport:{width:390,height:844},locale:"ar-SA",
    timezoneId:"Asia/Riyadh",serviceWorkers:"block"
  });
  const page=await context.newPage();
  const t=Date.now();
  const response=await page.goto(url+"/search.html?q=iPhone",{
    waitUntil:"domcontentloaded",timeout:70000
  });
  assert.equal(response?.status(),200);
  let visible=false;
  try{
    await page.waitForFunction(()=>Array.from(
      document.querySelectorAll("#merchantFilter option")
    ).some(option=>option.value==="eXtra"),null,{timeout:80000});
    visible=true;
  }catch{}
  const report=await page.evaluate(()=>({
    merchants:Array.from(document.querySelectorAll("#merchantFilter option"))
      .map(o=>o.value).filter(Boolean).slice(0,18),
    cards:document.querySelectorAll(".match-result-card").length,
    status:(document.querySelector("#searchStatus")?.textContent||"").slice(0,120)
  }));
  const safe={test:"IPHONE_REAL_BROWSER_MERCHANT_VISIBILITY",
    revision:expected.slice(0,12),elapsedMs:Date.now()-t,
    extraVisible:visible,hasJarir:report.merchants.includes("Jarir"),
    merchantOptions:report.merchants,cardCount:report.cards};
  console.log("NAWAA_LIVE_IPHONE_UI "+JSON.stringify(safe));
  assert.ok(visible,"EXTRA_MISSING_FROM_CUSTOMER_MERCHANT_DROPDOWN");
}finally{
  await browser.close();
}
