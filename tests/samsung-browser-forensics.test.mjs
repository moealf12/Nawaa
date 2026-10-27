import test from "node:test";
import assert from "node:assert/strict";
import {
  summarizeSamsungHtml,
  compareSamsungHtml,
} from "../scripts/diagnose-samsung-browser.mjs";

const base="https://www.samsung.com/sa_en/search/?searchvalue=galaxy%20s25";
const anchor=(url,title)=>'<a href="'+url+'">'+title+'</a>';
const s25="https://www.samsung.com/sa_en/smartphones/galaxy-s25/buy/";
const other="https://www.samsung.com/sa_en/smartphones/galaxy-s26-ultra/buy/";

test("browser-forensics: rendered exact-model PDP only establishes a possible link, never an offer price",()=>{
  const raw=summarizeSamsungHtml('<html>'+anchor(other,'Galaxy S26 Ultra')+'</html>',base);
  const rendered=summarizeSamsungHtml('<html>'+anchor(other,'Galaxy S26 Ultra')+anchor(s25,'Galaxy S25')+'</html>',base);
  assert.equal(raw.discovery.exactModelBuyPdp,0);
  assert.equal(rendered.discovery.exactModelBuyPdp,1);
  const comparison=compareSamsungHtml(raw,rendered);
  assert.equal(comparison.newExactModelPdpAfterJs,true);
  assert.equal(comparison.finding,"ADDITIONAL_EXACT_PDP_LINKS_AFTER_JS");
  assert.equal(comparison.verifiedPrice,false);
  assert.equal("productPrice" in comparison,false);
});

test("browser-forensics: unchanged HTML hash cannot claim browser-added model discovery",()=>{
  const html='<html>'+anchor(other,'Galaxy S26 Ultra')+'</html>';
  const raw=summarizeSamsungHtml(html,base);
  const rendered=summarizeSamsungHtml(html,base);
  const comparison=compareSamsungHtml(raw,rendered);
  assert.equal(comparison.identicalHtmlHash,true);
  assert.equal(comparison.newExactModelPdpAfterJs,false);
  assert.equal(comparison.finding,"NO_ADDITIONAL_EXACT_PDP_LINKS_OBSERVED");
});

test("browser-forensics: foreign host and irrelevant navigation never become exact S25 PDP",()=>{
  const html='<html>'+anchor("https://invalid.example/sa_en/smartphones/galaxy-s25/buy/","Galaxy S25")
    +anchor("https://www.samsung.com/sa_en/about-us/","Galaxy S25")+"</html>";
  const result=summarizeSamsungHtml(html,base);
  assert.equal(result.discovery.exactModelBuyPdp,0);
  assert.equal(result.discovery.modelLinkOutcome,"MODEL_LINK_NOT_OBSERVED");
  assert.ok(!JSON.stringify(result).includes("searchvalue="));
});

test("browser-forensics: empty and invalid HTML never certify merchant recall",()=>{
  const missing=summarizeSamsungHtml("");
  assert.equal(missing.status,"NO_HTML");
  const result=compareSamsungHtml(summarizeSamsungHtml("<html></html>",base),missing);
  assert.equal(result.finding,"BROWSER_EVIDENCE_UNAVAILABLE");
  assert.equal(result.verifiedPrice,false);
});

test("browser-forensics: report caps HTML size and never prints scripts or raw URLs",()=>{
  const oversized=summarizeSamsungHtml("A".repeat(5_000_001),base);
  assert.equal(oversized.status,"HTML_LIMIT_EXCEEDED");
  assert.equal(oversized.sha256,null);
  const markup='<html><script>secret="session-token"</script>'+
    anchor(s25+'?token=private','Galaxy S25')+'</html>';
  const summary=summarizeSamsungHtml(markup,base);
  const serialized=JSON.stringify(summary);
  assert.equal(serialized.includes("session-token"),false);
  assert.equal(serialized.includes("token=private"),false);
  assert.ok(summary.discovery.exactModelPaths.includes("/sa_en/smartphones/galaxy-s25/buy/"));
});
