const query = process.argv.slice(2).join(" ") || "iphone 17 case";

const CHROME_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";
const GOOGLEBOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const BINGBOT_UA = "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)";
const searchPath = "/search_result.html?search_key=" + encodeURIComponent(query) + "&search_method=user";
const referer = "https://www.temu.com" + searchPath;

const seoBodies = [
  { label:"pathname", body:{ query, page:1, count:40, origin_url:"/search_result.html" } },
  { label:"full-search-path", body:{ query, page:1, count:40, origin_url:searchPath } },
  { label:"sa-pathname", body:{ query, page:1, count:40, origin_url:"/sa-en/search_result.html" } },
];

const probes = [
  ...seoBodies.flatMap(({label,body}) => [
    { name:"seo-chrome-" + label, url:"https://www.temu.com/api/seo/get_search_page_goods", body, userAgent:CHROME_UA },
    { name:"seo-googlebot-" + label, url:"https://www.temu.com/api/seo/get_search_page_goods", body, userAgent:GOOGLEBOT_UA },
    { name:"seo-bingbot-" + label, url:"https://www.temu.com/api/seo/get_search_page_goods", body, userAgent:BINGBOT_UA },
  ]),
  {
    name:"poppy",
    url:"https://www.temu.com/api/poppy/v1/search",
    userAgent:CHROME_UA,
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
    topKeys:value && typeof value === "object" ? Object.keys(value) : [],
    resultKeys:result && typeof result === "object" ? Object.keys(result) : [],
    dataKeys:data && typeof data === "object" ? Object.keys(data) : [],
    total:result?.total ?? data?.total ?? null,
    goodsCount:goods.length,
    firstGood:goods[0] || null,
  };
}

for (const probe of probes) {
  try {
    const response = await fetch(probe.url, {
      method:"POST",
      headers:{
        accept:"application/json, text/plain, */*",
        "accept-language":"en-US,en;q=0.9,ar-SA;q=0.8",
        "content-type":"application/json",
        origin:"https://www.temu.com",
        referer,
        "x-origin-uri":searchPath,
        "user-agent":probe.userAgent || CHROME_UA,
      },
      body:JSON.stringify(probe.body),
      redirect:"follow",
      signal:AbortSignal.timeout(12000),
    });
    const raw = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch {}
    console.log(JSON.stringify({
      probe:probe.name,
      status:response.status,
      finalUrl:response.url,
      contentType:response.headers.get("content-type"),
      summary:parsed ? summarize(parsed) : null,
      rawPreview:parsed ? null : raw.slice(0,2000),
    }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({ probe:probe.name, error:error instanceof Error ? error.message : String(error) }, null, 2));
  }
}
