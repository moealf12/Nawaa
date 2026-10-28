import test from "node:test";
import assert from "node:assert/strict";
import {
  bike24PdpId,bike24GarminEdition,bike24Identity,bike24QueryEdition,bike24MatchesQuery,
  compareBike24SearchPdp,verifyBike24SearchCards,
} from "../src/bike24-product-truth.mjs";
import {extractBike24Product,isBike24GarminEdge540Page} from "../server/bike24-adapter.mjs";
import {extractionCandidates} from "../server/url-resolver.mjs";
import {merchantRequestHeaders,productPageRequestHeaders,NAWAA_INDEXER_USER_AGENT}
  from "../src/source-http-profile.mjs";
const URL="https://www.bike24.com/p2735527.html";
const title="Garmin Edge 540 GPS Cycling Computer - black";
const variant={title,sourceUrl:URL,mpn:"010-02694-01",gtin:"753759299811"};
const product=(price=247.05,extra={})=>({
  "@context":"https://schema.org","@type":"Product",name:title,url:URL,
  mpn:"010-02694-01",gtin13:"753759299811",
  offers:{"@type":"Offer",price,priceCurrency:"EUR"},...extra
});
const html=(schema=product(),price="247,05 €")=>
 '<html><head><meta property="og:image" content="https://www.bike24.com/images/edge540.jpg">'+
 '<script type="application/ld+json">'+JSON.stringify(schema)+'</script></head>'+
 '<body><main><h1>'+title+'</h1><p>'+price+'</p><button>Add to cart</button>'+
 '<section>Fact Sheet</section><p>Item Code: GAR643304</p><p>manufacturer item code: 010-02694-01</p>'+
 '<p>GTINs: 753759299811</p></main></body></html>';

test("Tier 1 headers remain identifiable and domain-scoped",()=>{
  const original={accept:"text/html","user-agent":"original"};
  for(const name of ["bike24-de","amazon-de"]){
    const h=merchantRequestHeaders(name,original);
    assert.equal(h["user-agent"],NAWAA_INDEXER_USER_AGENT);
    assert.equal(h["sec-fetch-site"],undefined);
  }
  assert.equal(productPageRequestHeaders(URL,original)["user-agent"],NAWAA_INDEXER_USER_AGENT);
  assert.equal(productPageRequestHeaders("https://www.amazon.de/dp/B012345678",original)["user-agent"],NAWAA_INDEXER_USER_AGENT);
  for(const raw of ["https://www.bike24.com.evil.test/p2735527.html","http://www.bike24.com/p2735527.html","https://u@www.bike24.com/p2735527.html"])
    assert.deepEqual(productPageRequestHeaders(raw,original),original);
  assert.deepEqual(merchantRequestHeaders("jarir",original),original);
});
test("PDP URL pins exact BIKE24 product ID and forbids forged hosts",()=>{
  assert.equal(bike24PdpId(URL), "2735527");
  assert.equal(bike24PdpId(URL+"?origin=PDP"),"2735527");
  for(const raw of ["http://www.bike24.com/p2735527.html","https://www.bike24.com.evil.test/p2735527.html",
    "https://www.bike24.com/search?searchTerm=garmin","https://www.bike24.com/p2735527.html/other"])
    assert.equal(bike24PdpId(raw),null);
});
test("Edge 540, Solar, Bundle are distinct editions, not a silicone case",()=>{
  const base=bike24Identity(variant);
  const solar=bike24Identity({title:"Garmin Edge 540 Solar GPS Cycling Computer - black",sourceUrl:"https://www.bike24.com/p2735528.html"});
  const bundle=bike24Identity({title:"Garmin Edge 540 Sensor Bundle GPS Cycling Computer",sourceUrl:"https://www.bike24.com/p2735529.html"});
  assert.equal(base?.edition,"STANDARD");
  assert.equal(solar?.edition,"SOLAR");
  assert.equal(bundle?.edition,"BUNDLE");
  assert.equal(new Set([base?.identityHash,solar?.identityHash,bundle?.identityHash]).size,3);
  assert.equal(bike24GarminEdition("Garmin Silicone Case for Edge 540"),null);
  assert.equal(bike24QueryEdition("garmin edge 540"),"STANDARD");
  assert.equal(bike24MatchesQuery("garmin edge 540",variant),true);
  assert.equal(bike24MatchesQuery("garmin edge 540",{...variant,title:solar?.model+" Solar"}),false);
  assert.equal(bike24MatchesQuery("garmin edge 540",{
    ...variant,title:"Garmin Edge 540 Solar GPS Cycling Computer - black",
  }),false);
});
test("Search price parity checks exact SKU edition, MPN, GTIN and cents",()=>{
  const card={...variant,price:247.05,currency:"EUR"};
  const pdp={...variant,originalProductPrice:247.05,originalCurrency:"EUR"};
  assert.equal(compareBike24SearchPdp(card,pdp).reason,"SEARCH_PDP_PRICE_PARITY");
  assert.equal(compareBike24SearchPdp(card,{...pdp,sourceUrl:"https://www.bike24.com/p2735528.html"}).reason,"VARIANT_IDENTITY_CONFLICT");
  assert.equal(compareBike24SearchPdp(card,{...pdp,mpn:"010-02694-00"}).reason,"MPN_CONFLICT");
  assert.equal(compareBike24SearchPdp(card,{...pdp,gtin:"1234567890123"}).reason,"GTIN_CONFLICT");
  assert.equal(compareBike24SearchPdp(card,{...pdp,originalProductPrice:247.04}).reason,"SEARCH_PDP_PRICE_CONFLICT");
  assert.equal(compareBike24SearchPdp({...card,currency:"SAR"},pdp).reason,"CURRENCY_CONFLICT");
});
test("Dedicated PDP parser requires exact product owner and rejects conflicting prices",()=>{
  const item=extractBike24Product(html(),URL);
  assert.equal(item?.offers?.price,247.05);
  assert.equal(item?.offers?.priceCurrency,"EUR");
  assert.equal(item?.sku,"GAR643304");
  assert.equal(item?.mpn,"010-02694-01");
  assert.equal(item?.gtin,"753759299811");
  assert.equal(item?.identityHash,bike24Identity(variant).identityHash);
  assert.equal(extractionCandidates(html(),URL)[0]?.adapterId,"bike24");
  assert.equal(extractBike24Product(html(product(248)),URL),null);
  assert.equal(extractBike24Product(html(product(247.05), "248,05 €"),URL),null);
  assert.equal(extractBike24Product(html({...product(),url:"https://www.bike24.com/p2735528.html"}),URL)?.offers?.price,247.05);
});
test("Bounded verification fails closed on mismatched price and stops on 403",async()=>{
  const card={...variant,price:247.05,currency:"EUR"};
  const mismatch=await verifyBike24SearchCards([card],{resolvePdp:async()=>({
    ...variant,originalProductPrice:240,originalCurrency:"EUR",
  })});
  assert.equal(mismatch.accepted.length,0);
  assert.equal(mismatch.diagnostics[0].reason,"SEARCH_PDP_PRICE_CONFLICT");
  let calls=0;
  const denied=await verifyBike24SearchCards([card,{...card,sourceUrl:"https://www.bike24.com/p2735529.html"}],{
    resolvePdp:async()=>{calls++;throw Error("Product page returned 403")}
  });
  assert.equal(calls,1);
  assert.equal(denied.accepted.length,0);
  assert.equal(denied.diagnostics[0].reason,"PDP_ACCESS_DENIED");
});


test("Phase G Garmin gate leaves other BIKE24 PDPs on existing resolver",()=>{
  assert.equal(isBike24GarminEdge540Page(html(),URL),true);
  const otherUrl="https://www.bike24.com/p2735533.html";
  const other='<html><head><script type="application/ld+json">'+JSON.stringify({
    "@context":"https://schema.org","@type":"Product",
    name:"Garmin Forerunner 265 GPS Running Watch - black/light grey",
    image:"https://www.bike24.com/images/forerunner265.jpg",
    url:otherUrl,offers:{"@type":"Offer",price:279.82,priceCurrency:"EUR"}
  })+'</script></head><body><h1>Garmin Forerunner 265 GPS Running Watch</h1></body></html>';
  assert.equal(isBike24GarminEdge540Page(other,otherUrl),false);
  assert.ok(extractionCandidates(other,otherUrl).some(x=>x.strategy==="jsonld"));
});
