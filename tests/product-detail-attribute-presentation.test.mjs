import test from "node:test";
import assert from "node:assert/strict";
import {displayProductSpecification, visibleProductDetailSpecifications, visibleProductSpecifications} from "../src/product-card-presentation.mjs";

test("product detail reuses card field-sensitive truth while retaining detail-only identifiers", () => {
  const offer={specs:{
    brand:"HP",series:"Pavilion",deviceType:"Laptop",color:"unknown",storage:"512GB",
    ram:"No",processor:"undefined",screenSize:"14 inch",screenType:false,
    network:"N/A",sim:null,regionVersion:"Saudi",operatingSystem:"Windows 11",
    rearCamera:"none",frontCamera:"",battery:"5000mAh",waterproof:false,
    modelNumber:"HP-16GB/A1",barcode:"0088-ABC-19"
  }};
  const before=structuredClone(offer);
  const rows=visibleProductDetailSpecifications(offer);
  assert.ok(rows.some(([name,val])=>name==="العلامة التجارية"&&val==="HP"));
  assert.ok(rows.some(([name,val])=>name==="رقم الموديل"&&val==="HP-16GB/A1"));
  assert.ok(rows.some(([name,val])=>name==="الباركود"&&val==="0088-ABC-19"));
  assert.ok(rows.some(([name,val])=>name==="مقاومة الماء"&&val==="لا"));
  assert.ok(rows.some(([name,val])=>name==="السعة"&&val==="512GB"));
  assert.ok(rows.some(([name,val])=>name==="نسخة المنطقة"&&val==="Saudi"));
  for(const name of ["اللون","الذاكرة RAM","المعالج","نوع الشاشة","الشبكة","نوع الشريحة","الكاميرا الخلفية"]) {
    assert.equal(rows.some(([label])=>label===name),false,name);
  }
  assert.deepEqual(offer,before,"presentation must not mutate merchant evidence");
  assert.deepEqual(visibleProductSpecifications(offer).find(([name])=>name==="السعة"),["السعة","512GB"]);
});

test("adversarial values reject placeholders but preserve valid negatives and identifiers",()=>{
  const values=[["No",false],["false",false],[false,false],[null,false],["8GB",true],["16 GB",true],
    ["N/A",false],["undefined",false],["unknown",false],["512GB",true]];
  for(const [value,valid] of values){
    const a=visibleProductDetailSpecifications({specs:{ram:value}});
    assert.equal(a.some(([name])=>name==="الذاكرة RAM"),valid,String(value));
  }
  assert.deepEqual(visibleProductDetailSpecifications({specs:{waterproof:"Yes"}}),[["مقاومة الماء","نعم"]]);
  assert.deepEqual(visibleProductDetailSpecifications({specs:{waterproof:"No"}}),[["مقاومة الماء","لا"]]);
  assert.deepEqual(visibleProductDetailSpecifications({specs:{waterproof:false}}),[["مقاومة الماء","لا"]]);
  assert.deepEqual(visibleProductDetailSpecifications({specs:{modelNumber:"MG674AH/A",barcode:"123A-0",storage:"١ ت.ب",color:"أزرق / Blue"}}),
    [["اللون","أزرق / Blue"],["السعة","١ ت.ب"],["رقم الموديل","MG674AH/A"],["الباركود","123A-0"]]);
  assert.deepEqual(visibleProductDetailSpecifications({specs:{brand:"No",modelNumber:"N/A",barcode:"unknown"}}),[]);
  assert.deepEqual(visibleProductDetailSpecifications({specs:null}),[]);
});

test("actual product page DOM hides invalid RAM and retains quote handoff",async()=>{
  const snapshot={query:"HP laptop",product:{},offer:{
    merchant:"Jarir",title:"HP Pavilion Laptop 512GB",sourceUrl:"https://www.jarir.com/test",
    productPrice:2999,condition:"new",totalSAR:null,
    specs:{brand:"HP",ram:"No",storage:"512GB",waterproof:"No",modelNumber:"HP-ZX/A1"}
  }};
  const app={innerHTML:""};
  const button={events:{},addEventListener(kind,listener){this.events[kind]=listener;}};
  const written=new Map();
  globalThis.document={title:"",querySelector:(q)=>q==="#productApp"?app:q==="#quoteBtn"?button:null};
  globalThis.window={NAWAA_QUOTE_URL:null};
  globalThis.location={href:"https://nawaa.example/product.html"};
  globalThis.sessionStorage={getItem:(key)=>key==="nawaa_product_detail"?JSON.stringify(snapshot):null};
  globalThis.localStorage={getItem:()=>null,setItem:(key,value)=>written.set(key,value)};
  await import("../src/product-page.mjs?detail-specs-adversarial");
  assert.match(app.innerHTML,/HP-ZX\/A1/);
  assert.match(app.innerHTML,/512GB/);
  assert.match(app.innerHTML,/مقاومة الماء<\/span><b>لا<\/b>/);
  assert.doesNotMatch(app.innerHTML,/الذاكرة RAM<\/span><b>No<\/b>/);
  assert.doesNotMatch(app.innerHTML,/الذاكرة RAM<\/span><b>false<\/b>/);
  assert.equal(typeof button.events.click,"function");
  button.events.click();
  const draft=JSON.parse(written.get("nawaa_quote_draft"));
  assert.equal(draft.model,"HP-ZX/A1");
  assert.equal(draft.observedProductPriceSAR,2999);
  assert.equal(draft.sourceUrl,"https://www.jarir.com/test");
});


test("shared selected-variant display policy is field sensitive, pure and provenance neutral",()=>{
 const values={regionVersion:"No",sim:false,ram:"N/A",waterproof:"No",
   modelNumber:"MG674AH/A",barcode:"0012-AZ",storage:"512 GB",color:"أزرق / Blue"};
 const before=structuredClone(values);
 const visible=Object.fromEntries(Object.entries(values).map(([key,val])=>[key,displayProductSpecification(key,val)]));
 assert.deepEqual(visible,{
   regionVersion:null,sim:null,ram:null,waterproof:"لا",modelNumber:"MG674AH/A",
   barcode:"0012-AZ",storage:"512 GB",color:"أزرق / Blue"
 });
 for(const invalid of ["No","false","N/A","unknown","undefined","غير معروف"]){
   assert.equal(displayProductSpecification("regionVersion",invalid),null,invalid);
   assert.equal(displayProductSpecification("sim",invalid),null,invalid);
 }
 assert.equal(displayProductSpecification("regionVersion","Middle East"),"Middle East");
 assert.equal(displayProductSpecification("sim","Dual eSIM"),"Dual eSIM");
 assert.equal(displayProductSpecification("modelNumber","ZX-No/16"),"ZX-No/16");
 assert.equal(displayProductSpecification("waterproof",false),"لا");
 assert.equal(displayProductSpecification("waterproof",true),"نعم");
 assert.deepEqual(values,before);
});
