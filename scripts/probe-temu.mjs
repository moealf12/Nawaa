const query = process.argv.slice(2).join(" ") || "iphone 17 case";

const CHROME_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";
const GOOGLEBOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const searchPath = "/search_result.html?search_key=" + encodeURIComponent(query) + "&search_method=user";
const referer = "https://www.temu.com" + searchPath;

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
  for (const url of ["https://www.temu.com/", referer]) {
    const response = await fetch(url, {
      headers:{
        accept:"text/html,application/xhtml+xml",
        "accept-language":"en-US,en;q=0.9,ar-SA;q=0.8",
        "user-agent":CHROME_UA,
        ...(jar.size ? { cookie:cookieHeader(jar) } : {}),
      },
      redirect:"follow",
      signal:AbortSignal.timeout(12000),
    });
    mergeCookies(jar, response);
    await response.arrayBuffer();
  }
  return jar;
}

function summarize(value) {
  const result = value?.result;
  const data = result?.data;
  const goods =
    (Array.isArray(result?.goodsList) && result.goodsList) ||
    (Array.isArray(result?.goods_list) && result.goods_list) ||
    (Array.isArray(data?.goodsList) && data.goodsList) ||
    (Array.isArray(data?.goods_list) && data.goods_list) ||
    [];
  return {
    success:value?.success ?? null,
    errorCode:value?.error_code ?? null,
    msg:value?.msg ?? value?.message ?? value?.error_msg ?? null,
    resultKeys:result && typeof result === "object" ? Object.keys(result) : [],
    total:result?.total ?? data?.total ?? null,
    goodsCount:goods.length,
    firstGood:goods[0] || null,
  };
}

const jar = await bootstrap().catch(() => new Map());
console.log(JSON.stringify({bootstrapCookieNames:cookieNames(jar)}, null, 2));

const commonHeaders = {
  accept:"application/json, text/plain, */*",
  "accept-language":"en-US,en;q=0.9,ar-SA;q=0.8",
  "content-type":"application/json",
  origin:"https://www.temu.com",
  referer,
  "x-origin-uri":searchPath,
  "user-agent":CHROME_UA,
  ...(jar.size ? { cookie:cookieHeader(jar) } : {}),
};

const probes = [
  {
    name:"seo-session",
    url:"https://www.temu.com/api/seo/get_search_page_goods",
    body:{ query, page:1, count:40, origin_url:"/search_result.html" },
  },
  {
    name:"seo-googlebot-session",
    url:"https://www.temu.com/api/seo/get_search_page_goods",
    body:{ query, page:1, count:40, origin_url:"/search_result.html" },
    headers:{ "user-agent":GOOGLEBOT_UA },
  },
  {
    name:"poppy-session",
    url:"https://www.temu.com/api/poppy/v1/search",
    body:{
      listId:"NAWAA1",
      offset:0,
      pageSize:40,
      scene:"search",
      query,
      searchMethod:"user",
      sprefix:"",
      pageSn:10009,
      pageElSn:200049,
      source:10022,
      filterItems:"",
    },
  },
];

for (const probe of probes) {
  try {
    const response = await fetch(probe.url, {
      method:"POST",
      headers:{...commonHeaders,...(probe.headers || {})},
      body:JSON.stringify(probe.body),
      redirect:"follow",
      signal:AbortSignal.timeout(12000),
    });
    mergeCookies(jar, response);
    const raw = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch {}
    console.log(JSON.stringify({
      probe:probe.name,
      status:response.status,
      finalUrl:response.url,
      cookieNames:cookieNames(jar),
      summary:parsed ? summarize(parsed) : null,
      rawPreview:parsed ? null : raw.slice(0,2000),
    }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({ probe:probe.name, error:error instanceof Error ? error.message : String(error) }, null, 2));
  }
}
