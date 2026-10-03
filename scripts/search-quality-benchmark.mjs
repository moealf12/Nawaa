// Broad, deterministic benchmark for NAWAA search intelligence.
// Live mode calls the deployed API; fixture mode can be added later for CI.
const BASE = process.env.NAWAA_BASE_URL || "https://nawaa-search-api.onrender.com";
const QUERIES = [
["exact","iphone 17 256gb"],["exact_ar","ايفون 17 256 جيجا"],["natural_ar","ابي ارخص ايفون 17 256"],
["brand","HP"],["category_ar","لابتوب"],["spec","gaming laptop rtx 5070"],["typo","سامسونق galaxy"],
["console","ps5 slim disc"],["console_ar","بلايستيشن 5 سليم اقراص"],["audio","airpods pro 2"],
["tv","Samsung 65 4k tv"],["camera","canon mirrorless camera"],["printer","hp laserjet printer"],
["appliance","dyson v15"],["appliance_ar","مكنسه دايسون"],["fashion","nike shoes"],["fashion_ar","جزمه نايك مقاس 44"],
["beauty","dior perfume men"],["beauty_ar","عطر ديور رجالي"],["jewelry","swarovski necklace"],
["jewelry_ar","سلسال سواروفسكي"],["home","office chair"],["home_ar","كرسي مكتب"],
["grocery","coffee beans"],["grocery_ar","بن قهوه"],["phone_budget","جوال سامسونج 2000 ريال"],
["generic","headphones"],["generic_ar","سماعات"],["accessory","iphone 17 case"],["mixed","Apple watch"],
];
const timeoutMs=Number(process.env.NAWAA_BENCH_TIMEOUT||20000);
const rows=[];
for(const [kind,q] of QUERIES){
 const started=Date.now(); let data=null,error=null;
 try{
  const c=new AbortController(); const t=setTimeout(()=>c.abort(),timeoutMs);
  const res=await fetch(BASE+"/api/search?q="+encodeURIComponent(q),{signal:c.signal}); clearTimeout(t);
  data=await res.json(); if(!res.ok) error=data?.message||data?.error||("HTTP "+res.status);
 }catch(e){error=e?.name==="AbortError"?"timeout":String(e?.message||e)}
 const offers=Array.isArray(data?.offers)?data.offers:[];
 const relevant=offers.filter(o=>o.exactMatch===true || Number(o.matchConfidence)>=.65);
 const exact=offers.filter(o=>o.exactMatch===true);
 const merchants=new Set(relevant.map(o=>o.merchant||o.provider).filter(Boolean));
 const badTop=offers.slice(0,10).filter(o=>!o.exactMatch && Number(o.matchConfidence||0)<.65).length;
 rows.push({kind,q,ok:!error,count:offers.length,relevant:relevant.length,exact:exact.length,merchants:merchants.size,badTop,ms:Date.now()-started,error});
}
const pass=rows.filter(r=>r.ok&&r.relevant>0&&r.badTop===0).length;
console.table(rows);
console.log(JSON.stringify({base:BASE,total:rows.length,pass,passRate:+(100*pass/rows.length).toFixed(1),zeroRelevant:rows.filter(r=>r.relevant===0).map(r=>r.q),errors:rows.filter(r=>r.error).map(r=>({q:r.q,error:r.error}))},null,2));
if(process.env.NAWAA_BENCH_STRICT==="1" && pass<Math.ceil(rows.length*.8)) process.exitCode=1;
