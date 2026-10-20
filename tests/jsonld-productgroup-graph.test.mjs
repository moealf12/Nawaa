import test from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { resolveProductUrl } from "../server/url-resolver.mjs";
import { probeJsonLd } from "../server/source-inspector/probes/jsonld.mjs";

const page="https://fixture.example/products/iphone17";
const graph=(nodes)=>'<script type="application/ld+json">'+JSON.stringify({"@context":"https://schema.org","@graph":nodes})+'</script>';
const of=(id,price,variant)=>({"@type":"Offer","@id":"#"+id,price,priceCurrency:"SAR",url:page+"?variant="+variant});
const group=[
 {"@type":"ProductGroup","@id":"#group",name:"iPhone 17",brand:{"@type":"Brand",name:"Apple"},hasVariant:[{"@id":"#p256"},{"@id":"#p512"}]},
 {"@type":"Product","@id":"#p256",name:"iPhone 17 256GB",sku:"IPH17-256",offers:{"@id":"#offer256"}},
 {"@type":"Product","@id":"#p512",name:"iPhone 17 512GB",sku:"IPH17-512",offers:{"@id":"#offer512"}},
 of("offer256",3199,"256"),
 of("offer512",4199,"512"),
];
async function withHtml(html, fn){
 const original=globalThis.fetch, lookup=dns.lookup;
 try {
  dns.lookup=async()=>[{address:"93.184.216.34",family:4}];
  globalThis.fetch=async()=>new Response(html,{headers:{"content-type":"text/html"}});
  return await fn();
 }finally{globalThis.fetch=original;dns.lookup=lookup;}
}
test("v20.2 RED: @graph ProductGroup may not price generic page by arbitrary sibling",async()=>{
 await withHtml(graph(group),async()=>{
  const r=await resolveProductUrl(page);
  assert.equal(r.originalProductPrice,null,"generic group has two priced variants but no selected item");
  assert.equal(r.productPrice,null);
 });
});
test("v20.2 RED: exact variant URL selects linked Product @id and linked Offer @id",async()=>{
 await withHtml(graph(group),async()=>{
  const r=await resolveProductUrl(page+"?variant=512");
  assert.equal(r.originalProductPrice,4199);
  assert.equal(r.originalCurrency,"SAR");
  assert.equal(r.sku,"IPH17-512");
  assert.equal(r.variantId,"512");
  assert.equal(r.sourceUrl,page+"?variant=512");
 });
});
test("v20.2 RED: inspector resolves an unambiguous same-document Offer @id",()=>{
 const html=graph([
  {"@type":"Product","@id":"#p",name:"HP EliteBook 840 G10",sku:"ELITE-840",offers:{"@id":"#offer"}},
  of("offer",4999,"840")
 ]);
 const x=probeJsonLd(html);
 assert.equal(x.pricedProducts,1);
 assert.equal(x.sample[0].price,4999);
 assert.equal(x.sample[0].currency,"SAR");
});
test("v20.2: duplicate conflicting Offer @id cannot establish trusted variant price",async()=>{
 const html=graph([
  {"@type":"Product","@id":"#p",name:"HP EliteBook 840 G10",sku:"ELITE-840",offers:{"@id":"#offer"}},
  of("offer",4999,"840"),of("offer",19,"840")
 ]);
 assert.equal(probeJsonLd(html).pricedProducts,0);
 await withHtml(html,async()=>{
  const r=await resolveProductUrl(page);
  assert.equal(r.originalProductPrice,null);
 });
});
test("v20.2: unrelated Offer does not fill missing product price",async()=>{
 const html=graph([
  {"@type":"Product","@id":"#p",name:"HP EliteBook 840 G10",sku:"ELITE-840",offers:{"@id":"#never-exists"}},
  of("unrelated",19,"840")
 ]);
 assert.equal(probeJsonLd(html).pricedProducts,0);
 await withHtml(html,async()=>assert.equal((await resolveProductUrl(page)).originalProductPrice,null));
});

test("v20.2 RED: incomplete ProductGroup must not price generic URL via its remaining indexed sibling",async()=>{
 const partial=group.filter(node=>node["@id"]!=="#p512"&&node["@id"]!=="#offer512");
 const html=graph(partial);
 await withHtml(html,async()=>{
  const r=await resolveProductUrl(page);
  assert.equal(r.originalProductPrice,null,
    "incomplete group is not proof the remaining sibling is selected on a generic page");
 });
 const inspected=probeJsonLd(html);
 assert.equal(inspected.pricedProducts,0,
   "source coverage must not certify a partial ProductGroup sibling as the selected offer");
});

test("v20.3 RED: related/recommended JSON-LD Product price cannot replace generic ProductGroup price",async()=>{
 const recommendations=[
  ...group,
  {"@type":"Product","@id":"#recommendation","name":"iPhone 17 Protective Case",
   sku:"CASE-IPH17",offers:{"@type":"Offer",price:49,priceCurrency:"SAR",
     url:page+"/recommendations/case"}}
 ];
 const inspector=probeJsonLd(graph(recommendations));
 assert.equal(inspector.pricedProducts,0,
   "the recommended phone case must not count as the family's trusted item price");
 await withHtml(graph(recommendations),async()=>{
  const generic=await resolveProductUrl(page);
  assert.equal(generic.originalProductPrice,null,
    "do not assign an unrelated cross-sell Product's SAR49 price to iPhone 17 family");
  assert.notEqual(generic.title,"iPhone 17 Protective Case");
  const explicit=await resolveProductUrl(page+"?variant=512");
  assert.equal(explicit.originalProductPrice,4199);
  assert.equal(explicit.sku,"IPH17-512");
 });
});
