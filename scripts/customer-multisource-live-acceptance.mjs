// Read-only customer-path acceptance; never fabricates source availability.
// Use existing public production search endpoint. Fail closed on schema uncertainty.
const origin = "https://nawaa-search.onrender.com";
const queries = ["iPhone", "PS5", "سماعات بلوتوث", "laptop"];
const base = process.env.NAWAA_PRODUCTION_ORIGIN || origin;
const output = [];
for (const query of queries) {
  const url = new URL("/api/search", base);
  url.searchParams.set("q", query);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch(url, {signal: controller.signal, headers: {Accept:"application/json"}});
    const body = await response.text();
    let data;
    try { data = JSON.parse(body); } catch { data = null; }
    const array = Array.isArray(data) ? data : [data?.products, data?.offers, data?.results, data?.items].find(Array.isArray);
    const offers = Array.isArray(array) ? array : [];
    const merchantCounts = {};
    for (const item of offers) {
      const merchant = String(item?.storeId ?? item?.sourceId ?? item?.provider ?? item?.store ?? item?.merchant ?? "UNKNOWN").slice(0,40);
      merchantCounts[merchant] = (merchantCounts[merchant] || 0) + 1;
    }
    const row = {query,httpStatus:response.status,contentType:response.headers.get("content-type")?.split(";")[0],
      schemaRecognized:Array.isArray(array),offerCount:offers.length,merchantCounts};
    output.push(row);
    console.log(JSON.stringify(row));
  } catch(e) {
    const row={query,status:"ERROR",errorClass:e.name === "AbortError"?"TIMEOUT":e.name};
    output.push(row);console.log(JSON.stringify(row));
  } finally { clearTimeout(timer); }
}
const successful=output.filter(x=>x.httpStatus===200&&x.schemaRecognized&&x.offerCount>0);
const multisource=successful.filter(x=>Object.keys(x.merchantCounts).filter(k=>k!=="UNKNOWN").length>=2);
console.log(JSON.stringify({kind:"SUMMARY",queries:output.length,nonempty:successful.length,multisource:multisource.length}));
if (!multisource.length) process.exitCode=1;
