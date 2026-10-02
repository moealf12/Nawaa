const query = process.argv.slice(2).join(" ") || "iphone 17 case";

const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";
const searchPath = "/search_result.html?search_key=" + encodeURIComponent(query) + "&search_method=user";
const referer = "https://www.temu.com" + searchPath;

const probes = [
  {
    name:"seo",
    url:"https://www.temu.com/api/seo/get_search_page_goods",
    body:{ query, page:1, count:40, origin_url:searchPath },
  },
  {
    name:"poppy",
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

function summarize(value) {
  const result = value?.result;
  const data = result?.data;
  const goods =
    (Array.isArray(result?.goodsList) && result.goodsList) ||
    (Array.isArray(data?.goodsList) && data.goodsList) ||
    [];
  return {
    success:value?.success ?? null,
    msg:value?.msg ?? value?.error_msg ?? null,
    topKeys:value && typeof value === "object" ? Object.keys(value) : [],
    resultKeys:result && typeof result === "object" ? Object.keys(result) : [],
    dataKeys:data && typeof data === "object" ? Object.keys(data) : [],
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
        "user-agent":USER_AGENT,
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
