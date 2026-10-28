import test from "node:test";
import assert from "node:assert/strict";
import {
  thomannVariantIdentity,thomannQueryVariant,thomannVariantMatchesQuery,
  compareThomannSearchPdp,verifyThomannSearchCards,
} from "../src/thomann-product-truth.mjs";
import {extractThomannProduct} from "../server/thomann-adapter.mjs";
const URLS={
  BASE:"https://www.thomann.de/de/superlux_hd662.htm?type=quickSearch",
  F:"https://www.thomann.de/de/superlux_hd662_f.htm?type=quickSearch",
  B:"https://www.thomann.de/de/superlux_hd662_b.htm?type=quickSearch",
};
const names={BASE:"Superlux HD-662",F:"Superlux HD-662 F",B:"Superlux HD-662 B"};
const items=Object.fromEntries(Object.keys(URLS).map(id=>[id,{
  title:names[id],sourceUrl:URLS[id],price:33,currency:"EUR",
}]));
const pdp=id=>({
  title:names[id],sourceUrl:URLS[id],originalProductPrice:33,originalCurrency:"EUR"
});
const html=(name,sku)=>'<html><head><meta property="og:image" content="https://thumbs.static-thomann.de/pics/'+sku+'.jpg"></head>'+
  '<body><main><h1>'+name+'</h1><div>Artikelnummer '+sku+'</div>'+
  '<p>33 €</p><div>-51% UVP: 67 €</div><p>Alle Preise inkl. MwSt.</p>'+
  '<button>In den Warenkorb</button></main></body></html>';

test("Base, F, B generate independent deterministic SHA-256 identities",()=>{
  const ids=Object.fromEntries(Object.keys(URLS).map(k=>[k,thomannVariantIdentity(names[k],URLS[k])]));
  assert.equal(new Set(Object.values(ids).map(x=>x.identityHash)).size,3);
  for(const [key,identity] of Object.entries(ids)){
    assert.equal(identity.variant,key);
    assert.match(identity.identityHash,/^[a-f0-9]{64}$/);
    assert.equal(identity.identityHash,thomannVariantIdentity(names[key],URLS[key]).identityHash);
  }
});
test("Base query cannot be promoted to F/B; explicit suffix is isolated",()=>{
  assert.equal(thomannQueryVariant("superlux hd 662"),"BASE");
  assert.equal(thomannQueryVariant("superlux HD-662 F"),"F");
  assert.equal(thomannQueryVariant("superlux hd662b"),"B");
  for(const q of ["superlux hd 662","superlux hd 662 f","superlux hd 662 b"]){
    const wanted=thomannQueryVariant(q);
    for(const variant of Object.keys(URLS))
      assert.equal(thomannVariantMatchesQuery(q,names[variant],URLS[variant]),variant===wanted);
  }
  assert.equal(thomannVariantMatchesQuery("headphones",names.B,URLS.B),true);
});
test("Title URL conflict, unknown family suffix, URL disguise fail closed",()=>{
  assert.equal(thomannVariantIdentity("Superlux HD-662 F",URLS.BASE),null);
  assert.equal(thomannVariantIdentity("Superlux HD-662",URLS.F),null);
  assert.equal(thomannVariantIdentity("Superlux HD-662 BK Evo",URLS.BASE),null);
  assert.equal(thomannVariantIdentity("Superlux HD-662 F",URLS.F.replace("thomann.de","thomann.de.evil.invalid")),null);
  assert.equal(thomannVariantIdentity("Superlux HD-662 F",URLS.F.replace("https:","http:")),null);
});
test("Thomann PDP extractor propagates exact identity and refuses mislabeled variant",()=>{
  for(const [id,sku] of [["BASE","239735"],["F","245987"],["B","245988"]]){
    const result=extractThomannProduct(html(names[id],sku),URLS[id]);
    assert.equal(result?.mpn,"HD-662"+(id==="BASE"?"":" "+id));
    assert.equal(result?.identityHash,thomannVariantIdentity(names[id],URLS[id]).identityHash);
    assert.equal(result?.sku,sku);
    assert.equal(result?.offers?.price,33);
    assert.equal(extractThomannProduct(html(names.B,sku),URLS.BASE),null);
  }
});
test("Parity requires exact variant and cents, not the same family or lower price",()=>{
  assert.equal(compareThomannSearchPdp(items.BASE,pdp("BASE")).reason,"PDP_PARITY_CONFIRMED");
  assert.equal(compareThomannSearchPdp(items.BASE,pdp("F")).reason,"VARIANT_IDENTITY_CONFLICT");
  assert.equal(compareThomannSearchPdp({...items.F,price:32.99},pdp("F")).reason,"SEARCH_PDP_PRICE_CONFLICT");
  assert.equal(compareThomannSearchPdp({...items.B,currency:"SAR"},pdp("B")).reason,"CURRENCY_CONFLICT");
  assert.equal(compareThomannSearchPdp({...items.B,price:null},pdp("B")).reason,"PRICE_NOT_OBSERVED");
});
test("Bounded verifier accepts price parity and distinct SKUs",async()=>{
  const result=await verifyThomannSearchCards([items.BASE,items.F,items.B],{
    limit:2,resolvePdp:async url=>pdp(url.includes("_f.")?"F":"BASE"),
  });
  assert.equal(result.accepted.length,2);
  assert.deepEqual(result.diagnostics.map(x=>x.reason),
    ["PDP_PARITY_CONFIRMED","PDP_PARITY_CONFIRMED"]);
  assert.notEqual(result.accepted[0].thomannIdentity.identityHash,result.accepted[1].thomannIdentity.identityHash);
});
test("403/429 stops the PDP checks; no transport reroute",async()=>{
  let count=0;
  const result=await verifyThomannSearchCards([items.BASE,items.F],{
    limit:2,resolvePdp:async ()=>{count++;throw new Error("Product page returned 403")},
  });
  assert.equal(count,1);
  assert.deepEqual(result.accepted,[]);
  assert.deepEqual(result.diagnostics,[{reason:"PDP_ACCESS_DENIED"}]);
});
