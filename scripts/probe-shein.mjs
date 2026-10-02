const query = process.argv.slice(2).join(" ") || "dress";

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

function mergeCookies(jar, response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  for (const value of values) {
    const pair = String(value || "").split(";")[0];
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
}
function cookieHeader(jar) {
  return [...jar.entries()].map(([k,v]) => k + "=" + v).join("; ");
}
function cookieNames(jar) {
  return [...jar.keys()].sort();
}

async function bootstrap() {
  const jar = new Map();
  for (const url of ["https://ar.shein.com/", "https://ar.shein.com/pdsearch/" + encodeURIComponent(query) + "/"]) {
    const response = await fetch(url, {
      headers:{
        accept:"text/html,application/xhtml+xml",
        "accept-language":"ar-SA,ar;q=0.9,en;q=0.8",
        "user-agent":UA,
      },
      redirect:"follow",
      signal:AbortSignal.timeout(15000),
    });
    mergeCookies(jar, response);
    await response.arrayBuffer();
    console.log(JSON.stringify({
      bootstrapUrl:url,
      status:response.status,
      finalUrl:response.url,
      cookieNames:cookieNames(jar),
    }, null, 2));
  }
  return jar;
}

const jar = await bootstrap().catch(() => new Map());
const commonHeaders = {
  accept:"application/json, text/plain, */*",
  "accept-language":"ar-SA,ar;q=0.9,en;q=0.8",
  "user-agent":UA,
  referer:"https://ar.shein.com/pdsearch/" + encodeURIComponent(query) + "/",
  origin:"https://ar.shein.com",
  "x-requested-with":"XMLHttpRequest",
  ...(jar.size ? {cookie:cookieHeader(jar)} : {}),
};

const bff = new URL("https://ar.shein.com/bff-api/product/get_products_by_keywords");
for (const [k,v] of Object.entries({
  _ver:"1.1.8", _lang:"en", cate_type:"4", keywords:query, channelId:"8",
  source:"search", page:"1", limit:"20", force_suggest:"0", poskey:"SearchPageSort",
  scene:"all", search_source:"1",
})) bff.searchParams.set(k,v);

const legacy = new URL("https://ar.shein.com/api/productList/info/get");
for (const [k,v] of Object.entries({
  _ver:"1.1.8", _lang:"en", type:"search", routeId:query, search_source:"1",
  src_identifier:"st=5\u0060sc="+query+"\u0060sr=0\u0060ps=1", src_module:"search",
  src_tab_page_id:"page_search", page:"1", requestType:"firstload", _currency:"SAR",
})) legacy.searchParams.set(k,v);

const probes = [
  {name:"bff-post", url:bff.href, method:"POST", headers:{"content-type":"application/json"}, body:""},
  {name:"legacy-get", url:legacy.href, method:"GET", headers:{}, body:undefined},
];

for (const probe of probes) {
  try {
    const response = await fetch(probe.url, {
      method:probe.method,
      headers:{...commonHeaders,...probe.headers},
      body:probe.body,
      redirect:"follow",
      signal:AbortSignal.timeout(15000),
    });
    mergeCookies(jar, response);
    const raw = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch {}
    const products =
      parsed?.info?.products ||
      parsed?.data?.products ||
      parsed?.data?.goods ||
      parsed?.products ||
      parsed?.goods ||
      [];
    console.log(JSON.stringify({
      probe:probe.name,
      status:response.status,
      finalUrl:response.url,
      contentType:response.headers.get("content-type"),
      cookieNames:cookieNames(jar),
      json:Boolean(parsed),
      topKeys:parsed && typeof parsed === "object" ? Object.keys(parsed) : [],
      productCount:Array.isArray(products) ? products.length : 0,
      firstProduct:Array.isArray(products) ? products[0] || null : null,
      rawPreview:parsed ? null : raw.slice(0,1200),
    }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({probe:probe.name,error:error instanceof Error ? error.message : String(error)}, null, 2));
  }
}
