import test from "node:test";
import assert from "node:assert/strict";
import {provisionalLabel,judgedMetrics} from "../scripts/verify-r04-live-ranking.mjs";
const p=(kind,title,more={})=>provisionalLabel(kind,{title,...more});
test("R04 live rubric: no ranking-score/price leakage into external identity labels",()=>{
 const a={title:"Apple iPhone 17 256GB",matchConfidence:0,exactMatch:false,productPrice:5000};
 const b={...a,matchConfidence:1,exactMatch:true,productPrice:1};
 assert.deepEqual(provisionalLabel("iphone",a),{grade:3,reason:"iphone17_256_explicit"});
 assert.deepEqual(provisionalLabel("iphone",a),provisionalLabel("iphone",b));
 assert.equal(p("iphone","iPhone 17 Pro 256GB").grade,2);
 assert.equal(p("iphone","Case for iPhone 17 256GB").grade,0);
 assert.equal(p("iphone","Unknown mobile accessory model").grade,null);
});
test("R04 live rubric: consoles, variants, peripherals and missing specifications",()=>{
 assert.equal(p("ps5","Sony PlayStation 5 Digital Edition Console").grade,3);
 assert.equal(p("ps5","PS5 Disc Edition Console").grade,2);
 assert.equal(p("ps5","PS5 Disc Drive for Digital").grade,0);
 assert.equal(p("galaxy","Samsung Galaxy S25 Ultra 256GB").grade,3);
 assert.equal(p("galaxy","Samsung Galaxy S25 Plus 256GB").grade,2);
 assert.equal(p("galaxy","Samsung device").grade,null);
});
test("R04 live rubric: explicit positive evidence only for audio and computing",()=>{
 assert.equal(p("jbl","JBL Bluetooth Headphones").grade,3);
 assert.equal(p("jbl","JBL wired headphones").grade,2);
 assert.equal(p("jbl","JBL Bluetooth Speaker").grade,2);
 assert.equal(p("laptop","HP Pavilion Laptop 16GB RAM").grade,3);
 assert.equal(p("laptop","HP Pavilion Laptop 8GB RAM").grade,2);
 assert.equal(p("laptop","HP Pavilion laptop sleeve").grade,0);
 assert.equal(p("laptop","16GB RAM Memory HP-Compaq Omen 15-dc1053ur Laptop Memory").grade,0);
 assert.equal(p("laptop","MacBook Pro 16GB RAM").grade,null);
});
test("R04 metrics: unknown relevance is never auto-converted into zero",()=>{
 const unknown=judgedMetrics([
  {judgment:{grade:3}},{judgment:{grade:null}},{judgment:{grade:0}}
 ]);
 assert.equal(unknown.ndcg10,null);assert.equal(unknown.mrr10,null);
 assert.equal(unknown.unjudged,1);
 const complete=judgedMetrics([{judgment:{grade:0}},{judgment:{grade:3}}]);
 assert.equal(complete.mrr10,.5);
 assert.ok(complete.ndcg10<1);
 assert.equal(complete.metricStatus,"PROVISIONAL_RULE_LABELS");
});

test("R04 recorded JBL Tune 125BT/135BT in-ear Bluetooth retail subjects have external manufacturer model evidence",()=>{
  const titles=[
    "JBL Tune 125BT In-Ear Earphones, Bluetooth, USB (Charging), Built-in Microphone, Black",
    "JBL Tune 125BT In-Ear Earphones, Bluetooth, USB (Charging), Built-in Microphone, White",
    "JBL Tune 135BT In-Ear Earphones, Bluetooth, Built-in Microphone, Black",
    "JBL Tune 135BT In-Ear Earphones, Bluetooth, Built-in Microphone, White",
  ];
  for(const title of titles){
    const judged=provisionalLabel("jbl",{title,matchConfidence:0,exactMatch:false});
    assert.deepEqual(judged,{grade:3,reason:"manufacturer_evidenced_jbl_wireless_in_ear"},title);
    assert.deepEqual(provisionalLabel("jbl",{title,matchConfidence:1,exactMatch:true}),
      judged,"do not borrow system confidence to build label");
  }
  assert.equal(p("jbl","JBL generic Bluetooth Earphones").grade,null,
    "unverified earphone models remain UNKNOWN, not silently exact");
  assert.equal(p("jbl","JBL Tune 125BT wired earphones").grade,null);
  assert.equal(p("jbl","JBL Tune 135BT Bluetooth Speaker").grade,2);
});

test("R04 independent live rank-2 Samsung S Pen is peripheral, full handset stays principal",()=>{
  const recorded="Samsung Galaxy Official S25 Ultra S Pen for Galaxy S25 Ultra Grey SM-S938N";
  assert.deepEqual(p("galaxy",recorded),{grade:0,reason:"explicit_accessory_cue"});
  assert.deepEqual(p("galaxy","Samsung Galaxy S25 Ultra 256GB Smartphone with included S Pen"),
    {grade:3,reason:"s25_ultra_explicit"});
});

test("R04 real first-screen retail parts are graded as spare parts, not principal devices",()=>{
  const recorded=[
    ["galaxy","Perzework 2 Sets Back Rear Camera Lens Glass Replacement for Samsung Galaxy S25 Ultra",0],
    ["galaxy","Samsung Galaxy S25 Ultra Benutzerhandbuch: Meistern Sie Ihr Gerät",0],
    ["galaxy","Originale Samsung Galaxy S25 ULTRA S938B presa di ricarica connettore dock USB microfono",0],
    ["galaxy","Genuine Samsung Galaxy S25 Ultra S938B Lcd+frame Jet Black Assembled GH82-36387D",0],
    ["jbl","Ear Pads Replacement Cushion for JBL E35 E45bt E45 Bluetooth Wireless Headphones",0],
    ["laptop","16GB Memoria RAM HP-Compaq Pavilion Notebook 15-da3000nia",0],
    ["laptop","16GB RAM SO DIMM DDR5 5600Mhz PC5-5600B for HP Notebook Omen Laptop 16-b1xxx",0],
  ];
  for(const [kind,title,grade] of recorded){
    const a=provisionalLabel(kind,{title,exactMatch:true,matchConfidence:1,productPrice:1});
    const b=provisionalLabel(kind,{title,exactMatch:false,matchConfidence:0,productPrice:100000});
    assert.equal(a.grade,grade,title);
    assert.deepEqual(a,b,"retail part truth cannot depend on system rank/confidence/price");
  }
});
test("R04 independent rubric keeps sold principal device with explicitly included accessory",()=>{
  const positives=[
    ["galaxy","Samsung Galaxy S25 Ultra 256GB Smartphone with included camera lens protector",3],
    ["jbl","JBL Tune 520BT Bluetooth Headphones with replacement ear pads included",3],
    ["laptop","HP EliteBook 840 G6 16GB RAM Laptop Intel Core i7 with included protective sleeve",3],
  ];
  for(const [kind,title,grade] of positives)
    assert.equal(provisionalLabel(kind,{title}).grade,grade,title);
});

test("R04 postdeploy negative control: a real observed peripheral at top rank must lower NDCG and MRR",()=>{
  const observedParts=[
    ["galaxy","Originale Samsung Galaxy S25 ULTRA S938B presa di ricarica connettore dock USB microfono"],
    ["jbl","Ear Pads Replacement Cushion for JBL E35 E45bt E45 Bluetooth Wireless Headphones"],
    ["laptop","16GB Memoria RAM HP-Compaq Pavilion Notebook 15-da3000nia"],
  ];
  for(const [kind,title] of observedParts){
    const judgment=provisionalLabel(kind,{title});
    assert.equal(judgment.grade,0,title);
    const rank1Bad=judgedMetrics([{judgment},{judgment:{grade:3}}]);
    assert.equal(rank1Bad.mrr10,0.5,title);
    assert.ok(rank1Bad.ndcg10<1,title);
    assert.equal(rank1Bad.metricStatus,"PROVISIONAL_RULE_LABELS");
  }
});

test("R04 real Q15 motherboard must be independently labeled as a spare part",()=>{
  const title="L34280-601 für HP EliteBook x360 1030 G3 mit Intel Core i7-8650U und 16 GB RAM";
  const a=provisionalLabel("laptop",{title,exactMatch:true,matchConfidence:1,productPrice:1});
  const b=provisionalLabel("laptop",{title,exactMatch:false,matchConfidence:0,productPrice:100000});
  assert.deepEqual(a,{grade:0,reason:"verified_hp_mainboard_spare_part"});
  assert.deepEqual(a,b);
  const legitimate="HP EliteBook 840 G6 Business Laptop Intel Core i7 16GB RAM with included spare motherboard";
  assert.equal(provisionalLabel("laptop",{title:legitimate}).grade,3);
});
