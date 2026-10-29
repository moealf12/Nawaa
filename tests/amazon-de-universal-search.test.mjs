import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSearchQuery } from "../src/search-query.mjs";
import {
  amazonDeCandidateFromUrl,amazonDeDiscoveredCandidates,searchAmazonDeUniversal,
} from "../server/providers/amazon-de-universal.mjs";
import {amazonDeCustomerPriceDecision} from "../src/amazon-de-price-gate.mjs";

const a = "B0FQFW3423", b = "B0ABC12345";
const u = id => "https://www.amazon.de/dp/" + id;
const discovery = (items = [u(a), u(b)]) => ({
  candidates: items.length, failures: 0, offers: [],
  diagnostics: {
    customerPublicationGate: {
      status: "BUYBOX_SAME_OFFER_PARITY_UNVERIFIED",
      customerPublishable: false,
    },
    sourceObservation: "HTTP_200_HTML",
    candidateSamples: items,
    amazonDeCandidateSamples: items,
  },
});
test("candidate URL deduplication rejects off-domain and ASIN mismatch", () => {
  assert.deepEqual(amazonDeCandidateFromUrl(u(a)), {asin:a,url:u(a)});
  assert.equal(amazonDeCandidateFromUrl("https://amazon.de.evil.example/dp/"+a),null);
  assert.equal(amazonDeCandidateFromUrl("https://www.amazon.de/s?k=watch"),null);
  assert.equal(amazonDeCandidateFromUrl("http://www.amazon.de/dp/"+a),null);
  assert.deepEqual(amazonDeDiscoveredCandidates(discovery([
    u(a),u(a)+"?ref=dup",u(b),"https://evil.example/dp/"+a]),2),[
    {asin:a,url:u(a)}, {asin:b,url:u(b)}
  ]);
});
test("ALL dynamic shopper queries reach source-owned catalog search, no static product filter",async()=>{
  const inputs = [
    "iPhone 17 256GB","PlayStation 5 Slim","Samsung Galaxy S25",
    "سماعات لاسلكية","عطر رجالي","مكنسة روبوت","كرت شاشة RTX",
    "كاميرا رقمية","Nike running shoes","بطارية لابتوب",
  ];
  const calls=[];
  for(const query of inputs) {
    const result=await searchAmazonDeUniversal(query,{
      discover:async(id,q,options)=>{
        calls.push({id,q,options});
        return discovery();
      },
    });
    assert.equal(result.provider,"amazon-de-universal");
    assert.equal(result.sourceId,"amazon-de");
    assert.equal(result.ok,true);
    assert.deepEqual(result.offers,[]);
    assert.equal(result.diagnostics.sourceQueryDriven,true);
    assert.equal(result.diagnostics.customerPublishable,false);
    assert.equal(result.diagnostics.eligibleCandidateCount,2);
    assert.deepEqual(result.diagnostics.productChecks,[]);
  }
  assert.equal(calls.length,inputs.length);
  for(let i=0;i<inputs.length;i++){
    assert.equal(calls[i].id,"amazon-de");
    assert.equal(calls[i].q,normalizeSearchQuery(inputs[i]));
    assert.equal(calls[i].options.matchingQuery,normalizeSearchQuery(inputs[i]));
    assert.equal(calls[i].options.productPageLimit,0);
  }
});
test("even a returned fake priced offer cannot bypass customer publication hold",async()=>{
  const r=await searchAmazonDeUniversal("iPhone",{
    discover:async()=>({...discovery(),offers:[{
      merchant:"Amazon Germany",productPrice:9,currency:"EUR",
      sourceUrl:u(a),verified:true,
    }]}),
  });
  assert.deepEqual(r.offers,[]);
  assert.equal(r.diagnostics.pricePublicationHeld,true);
  assert.equal(amazonDeCustomerPriceDecision({sourceId:"amazon-de",sourceUrl:u(a)}).customerPublishable,false);
});
test("missing/open source gate, access failure, empty query and abort fail closed",async()=>{
  const opened=await searchAmazonDeUniversal("iPhone",{
    discover:async()=>({...discovery(),diagnostics:{
      customerPublicationGate:{customerPublishable:true},
    }})
  });
  assert.equal(opened.diagnostics.status,"PRICE_GATE_MISSING_OR_OPEN");
  assert.deepEqual(opened.offers,[]);
  const failed=await searchAmazonDeUniversal("iPhone",{discover:async()=>{throw Error("403 source denied");}});
  assert.equal(failed.diagnostics.status,"SOURCE_SEARCH_UNAVAILABLE");
  assert.equal(failed.ok,false);
  let called=0;
  for(const q of ["", "   ", "x".repeat(500)]) {
    const r=await searchAmazonDeUniversal(q,{discover:async()=>{called++;return discovery()}});
    assert.equal(r.diagnostics.status,"QUERY_NOT_ELIGIBLE");
  }
  const ac=new AbortController();ac.abort();
  const stopped=await searchAmazonDeUniversal("iPhone",{
    signal:ac.signal,discover:async()=>{called++;return discovery()},
  });
  assert.equal(stopped.diagnostics.status,"ABORTED");
  assert.equal(called,0);
});
test("optional CI inspection consumes dynamic source ASIN candidates, remains unpublishable",async()=>{
  const probes=[];
  const r=await searchAmazonDeUniversal("تلفزيون OLED",{
    discover:async()=>discovery([u(a),u(b)]),
    inspectProducts:true,maxPdpChecks:100,
    probe:async item=>{probes.push(item);return {
      status:"SAME_PAGE_PARITY_CANDIDATE_NOT_ATTESTED",
      samePageParityObserved:true,customerPublishable:false,
    }},
  });
  assert.equal(probes.length,2);
  assert.deepEqual(probes.map(p=>p.asin),[a,b]);
  assert.equal(r.diagnostics.productChecks.length,2);
  assert.equal(r.diagnostics.productChecks[0].samePageParityObserved,true);
  assert.deepEqual(r.offers,[]);
  assert.equal(r.diagnostics.customerPublishable,false);
});
test("bounded in-flight searches reject overload without extra fetches",async()=>{
  let release;
  const gate=new Promise(r=>{release=r});
  let inFlight=0;
  const discover=async()=>{inFlight++;await gate;inFlight--;return discovery()};
  const first=searchAmazonDeUniversal("search one",{discover});
  const second=searchAmazonDeUniversal("search two",{discover});
  const third=await searchAmazonDeUniversal("search three",{discover});
  assert.equal(third.diagnostics.status,"SOURCE_BUSY");
  assert.equal(inFlight,2);
  release();
  const [r1,r2]=await Promise.all([first,second]);
  assert.equal(r1.ok,true);
  assert.equal(r2.ok,true);
  assert.equal(inFlight,0);
});
