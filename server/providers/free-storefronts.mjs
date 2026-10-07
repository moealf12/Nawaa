import { resolveProductUrl } from "../url-resolver.mjs";
import { assessOfferMatch, normalizeSearchQuery, parseSearchIntent, filterQueryOffers, queryMatchReasons, BRAND_CATEGORY_PRIORITIES } from "../../src/search-query.mjs";
import { sourceReliability } from "../source-reliability.mjs";
import { moneyToSAR } from "../fx.mjs";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const STORES = [
  {
    id:"shein-sa", name:"SHEIN", countryCode:"SA", countryNameAr:"السعودية", enabled:false, disabledReason:"unstable_shein_risk_challenge", brands:["shein"], categories:["clothing","shoes","bag","beauty","jewelry","home","toy"],
    search:(q)=>"https://ar.shein.com/pdsearch/"+encodeURIComponent(q).replace(/%20/g,"-")+"/",
    productPath:/-p-\d+\.html(?:[?#]|$)/i,
  },
  {
    id:"aliexpress-cn", name:"AliExpress", countryCode:"CN", countryNameAr:"الصين", categories:["*"],
    search:(q)=>"https://www.aliexpress.com/w/wholesale-"+encodeURIComponent(q).replace(/%20/g,"-")+".html",
    productPath:/\/item\/\d+\.html(?:[?#]|$)/i,
  },
  {
    id:"temu-global", name:"Temu", countryCode:"CN", countryNameAr:"الصين", enabled:false, disabledReason:"no_product_candidates_live_search", categories:["*"],
    search:(q)=>"https://www.temu.com/search_result.html?search_key="+encodeURIComponent(q)+"&search_method=user",
    productPath:/\/(?:goods|item)\.html(?:[?#]|$)|-g-\d+\.html/i,
  },
  {
    id:"iherb-sa", name:"iHerb", countryCode:"US", countryNameAr:"الولايات المتحدة", enabled:false, disabledReason:"http_403_live_search", categories:["beauty","grocery","pet","baby","other"],
    search:(q)=>"https://sa.iherb.com/search?kw="+encodeURIComponent(q),
    productPath:/\/pr\/[^?#]+\/\d+(?:[/?#]|$)/i,
  },
  {
    id:"ikea-sa", name:"IKEA Saudi", countryCode:"SA", countryNameAr:"السعودية", brands:["ikea"], categories:["furniture","home","kitchen","office"],
    search:(q)=>"https://www.ikea.com/sa/en/search/?q="+encodeURIComponent(q),
    productPath:/\/p\/[^?#]+-\d+(?:[/?#]|$)/i,
  },
  {
    id:"asos-global", name:"ASOS", countryCode:"GB", countryNameAr:"بريطانيا", brands:["asos"], categories:["clothing","shoes","bag","beauty"],
    search:(q)=>"https://www.asos.com/search/?q="+encodeURIComponent(q),
    productPath:/\/prd\/\d+(?:[/?#]|$)/i,
  },
  // GCC discovery tier: trusted regional storefronts are searched after Saudi sources
  // and before the wider global catalog. Shipping to Saudi is metadata, never a gate.
  {
    id:"amazon-sa", name:"Amazon Saudi", countryCode:"SA", countryNameAr:"السعودية", categories:["*"],
    search:(q)=>"https://www.amazon.sa/s?k="+encodeURIComponent(q),
    productPath:/\/dp\/[A-Z0-9]{10}(?:[/?#]|$)|\/gp\/product\/[A-Z0-9]{10}(?:[/?#]|$)/i,
  },
  {
    id:"amazon-ae", name:"Amazon UAE", countryCode:"AE", countryNameAr:"الإمارات", categories:["*"],
    search:(q)=>"https://www.amazon.ae/s?k="+encodeURIComponent(q),
    productPath:/\/dp\/[A-Z0-9]{10}(?:[/?#]|$)|\/gp\/product\/[A-Z0-9]{10}(?:[/?#]|$)/i,
  },
  {
    id:"noon-ae", name:"noon UAE", countryCode:"AE", countryNameAr:"الإمارات", categories:["*"],
    search:(q)=>"https://www.noon.com/uae-en/search?q="+encodeURIComponent(q),
    productPath:/\/[^?#]+\/p\/?(?:[?#]|$)|\/p-[A-Z0-9]+(?:[/?#]|$)/i,
  },
  {
    id:"sharafdg-ae", name:"Sharaf DG UAE", countryCode:"AE", countryNameAr:"الإمارات", categories:["phone","laptop","desktop","monitor","audio","camera","appliance","tv","console","game","accessory"],
    search:(q)=>"https://uae.sharafdg.com/?q="+encodeURIComponent(q)+"&post_type=product",
    productPath:/\/product\/[^/?#]+(?:[/?#]|$)/i,
  },
  {
    id:"virgin-ae", name:"Virgin Megastore UAE", countryCode:"AE", countryNameAr:"الإمارات", categories:["phone","laptop","audio","console","game","book","toy","accessory","other"],
    // The app host exposes the same public catalog with materially better server-side
    // rendering/reachability than the www search endpoint. Keep query search generic;
    // category pages are used as deterministic fallbacks for major product families.
    search:(q)=>"https://app.virginmegastore.ae/en/search/?text="+encodeURIComponent(q),
    productPath:/\/p\/\d+(?:[/?#]|$)|\/[^?#]+\/p(?:[/?#]|$)/i,
  },
  {
    id:"xcite-kw", name:"X-cite Kuwait", countryCode:"KW", countryNameAr:"الكويت", categories:["phone","laptop","desktop","monitor","audio","camera","appliance","tv","console","game","accessory"],
    search:(q)=>"https://www.xcite.com/search?q="+encodeURIComponent(q),
    productPath:/\/[^?#]+\/p(?:[/?#]|$)|\/products?\/[^/?#]+(?:[/?#]|$)/i,
  },
  {
    id:"lulu-ae", name:"LuLu UAE", countryCode:"AE", countryNameAr:"الإمارات", categories:["phone","laptop","audio","appliance","tv","grocery","baby","home","other"],
    search:(q)=>"https://www.luluhypermarket.com/en-ae/search?q="+encodeURIComponent(q),
    productPath:/\/[^?#]+\/p\/\d+(?:[/?#]|$)|\/product\/[^/?#]+(?:[/?#]|$)/i,
  },
  {
    id:"lulu-sa", name:"LuLu Saudi", countryCode:"SA", countryNameAr:"السعودية", categories:["*"],
    search:(q)=>"https://gcc.luluhypermarket.com/en-sa/list/?search_text="+encodeURIComponent(q),
    productPath:/\/[^?#]+\/p\/\d+(?:[/?#]|$)|\/product\/[^/?#]+(?:[/?#]|$)/i,
  },
  {
    id:"samsung-sa", name:"Samsung Saudi", countryCode:"SA", countryNameAr:"السعودية", brands:["samsung"], categories:["phone","tablet","tv","monitor","audio","appliance","accessory"],
    search:(q)=>"https://www.samsung.com/sa_en/search/?searchvalue="+encodeURIComponent(q),
    productPath:/\/sa_en\/[^?#]+\/buy\/(?:[?#]|$)|\/sa_en\/[^?#]+(?:[?#].*)?$/i,
  },
  {
    id:"carrefour-ae", name:"Carrefour UAE", countryCode:"AE", countryNameAr:"الإمارات", categories:["*"],
    search:(q)=>"https://www.carrefouruae.com/mafuae/en/search?keyword="+encodeURIComponent(q),
    productPath:/\/mafuae\/en\/[^?#]+\/p\/\d+(?:[/?#]|$)|\/p\/\d+(?:[/?#]|$)/i,
  },
  {
    id:"microless-ae", name:"Microless UAE", countryCode:"AE", countryNameAr:"الإمارات", categories:["phone","laptop","desktop","monitor","audio","camera","tv","console","game","accessory","network","appliance"],
    search:(q)=>"https://uae.microless.com/search/?query="+encodeURIComponent(q),
    productPath:/\/product\/[^/?#]+(?:[/?#]|$)|\/products?\/[^/?#]+(?:[/?#]|$)/i,
  },
  {
    id:"jumbo-ae", name:"Jumbo Electronics UAE", countryCode:"AE", countryNameAr:"الإمارات", categories:["phone","laptop","desktop","monitor","audio","camera","tv","console","game","accessory","network","appliance"],
    search:(q)=>"https://www.jumbo.ae/search/"+encodeURIComponent(q),
    productPath:/\/product\/[^/?#]+(?:[/?#]|$)|\/products?\/[^/?#]+(?:[/?#]|$)|\/[^/?#]+-\d+(?:[/?#]|$)/i,
  },
  {
    id:"farfetch-sa", name:"Farfetch", countryCode:"GB", countryNameAr:"بريطانيا", enabled:false, disabledReason:"http_403_live_search", brands:["farfetch"], categories:["clothing","shoes","bag","jewelry","watch"],
    search:(q)=>"https://www.farfetch.com/sa/shopping/items.aspx?q="+encodeURIComponent(q),
    productPath:/\/shopping\/[^?#]+\/item-\d+\.aspx(?:[?#]|$)/i,
  },
  {
    id:"etsy-global", name:"Etsy", countryCode:"US", countryNameAr:"الولايات المتحدة", enabled:false, disabledReason:"http_403_live_search", brands:["etsy"], categories:["jewelry","clothing","bag","home","furniture","toy","office","other"],
    search:(q)=>"https://www.etsy.com/search?q="+encodeURIComponent(q),
    productPath:/\/listing\/\d+(?:[/?#]|$)/i,
  },
  {
    id:"newegg-global", name:"Newegg", countryCode:"US", countryNameAr:"الولايات المتحدة", categories:["phone","laptop","desktop","monitor","audio","camera","accessory","network","appliance"],
    search:(q)=>"https://www.newegg.com/global/sa-en/p/pl?d="+encodeURIComponent(q),
    productPath:/\/p\/(?!pl(?:[/?#]|$))[A-Z0-9-]+(?:[/?#]|$)/i,
  },
  {
    id:"bhphoto-us", name:"B&H Photo", countryCode:"US", countryNameAr:"الولايات المتحدة", categories:["camera","audio","laptop","phone","tablet","accessory","other"],
    search:(q)=>"https://www.bhphotovideo.com/c/search?q="+encodeURIComponent(q)+"&sts=ma",
    productPath:/\/c\/product\/\d+(?:-[A-Z0-9_-]+)?(?:[/?#]|$)/i,
  },
  {
    id:"walmart-us", name:"Walmart", countryCode:"US", countryNameAr:"الولايات المتحدة", enabled:false, disabledReason:"walmart_blocked", categories:["*"],
    search:(q)=>"https://www.walmart.com/search?q="+encodeURIComponent(q),
    productPath:/\/ip\/[^?#]+\/\d+(?:[/?#]|$)/i,
  },
  {
    id:"bestbuy-us", name:"Best Buy", countryCode:"US", countryNameAr:"الولايات المتحدة", categories:["phone","laptop","desktop","monitor","audio","camera","appliance","tv","console","game","accessory"],
    search:(q)=>"https://www.bestbuy.com/site/searchpage.jsp?st="+encodeURIComponent(q),
    productPath:/\/(?:site\/[^?#]+\/\d+\.p|product\/[^?#]+\/[^/?#]+\/sku\/\d+)(?:[?#]|$)/i,
  },
  {
    id:"adidas-sa", name:"adidas Saudi", countryCode:"SA", countryNameAr:"السعودية", enabled:false, disabledReason:"http_403_live_search", brands:["adidas"], categories:["clothing","shoes","sports","bag"],
    search:(q)=>"https://www.adidas.sa/en/search?q="+encodeURIComponent(q),
    productPath:/\/[A-Z0-9_-]+\.html(?:[?#]|$)/i,
  },
  {
    id:"nike-sa", name:"Nike Saudi", countryCode:"SA", countryNameAr:"السعودية", brands:["nike"], categories:["clothing","shoes","sports","bag"],
    search:(q)=>"https://www.nike.sa/en/search?q="+encodeURIComponent(q),
    productPath:/\/[^?#]+(?:[?#].*)?$/i,
  },
  {
    id:"sephora-sa", name:"Sephora Saudi", countryCode:"SA", countryNameAr:"السعودية", enabled:false, disabledReason:"http_403_live_search", brands:["sephora"], categories:["beauty","perfume"],
    search:(q)=>"https://www.sephora.me/sa-en/search?q="+encodeURIComponent(q),
    productPath:/\/p\/[^?#]+(?:[?#]|$)/i,
  },
  {
    id:"namshi-sa", name:"Namshi", countryCode:"SA", countryNameAr:"السعودية", brands:["namshi"], categories:["clothing","shoes","bag","beauty","jewelry","sports","baby"],
    search:(q)=>"https://www.namshi.com/saudi-en/search?q="+encodeURIComponent(q),
    productPath:/\/saudi-en\/buy-[^?#]+\/[^/?#]+\/p\/?(?:[?#]|$)/i,
  },
  {
    id:"centrepoint-sa", name:"Centrepoint", countryCode:"SA", countryNameAr:"السعودية", brands:["centrepoint"], categories:["clothing","shoes","bag","beauty","home","furniture","toy","baby","sports"],
    search:(q)=>"https://www.centrepointstores.com/sa/en/search?q="+encodeURIComponent(q),
    productPath:/\/sa\/en\/(?:buy-[^?#]+\/p\/[^/?#]+|p\/[^/?#]+)(?:[/?#]|$)/i,
  },
  {
    id:"maxfashion-sa", name:"Max Fashion", countryCode:"SA", countryNameAr:"السعودية", brands:["maxfashion"], categories:["clothing","shoes","bag","baby","home"],
    search:(q)=>"https://www.maxfashion.com/sa/en/search?q="+encodeURIComponent(q),
    productPath:/\/sa\/en\/buy-[^?#]+\/p\/[^/?#]+(?:[/?#]|$)/i,
  },
  {
    id:"decathlon-sa", name:"Decathlon Saudi", countryCode:"SA", countryNameAr:"السعودية", brands:["decathlon"], categories:["sports","shoes","clothing","bag","toy","baby"],
    search:(q)=>"https://decathlon.com.sa/search?q="+encodeURIComponent(q),
    productPath:/\/products\/[^/?#]+(?:[/?#]|$)/i,
  },
  {
    id:"niceone-sa", name:"Nice One", countryCode:"SA", countryNameAr:"السعودية", brands:["niceone"], categories:["beauty","perfume","grocery","sports","baby","other"],
    search:(q)=>"https://niceonesa.com/en/search?q="+encodeURIComponent(q),
    productPath:/\/en\/[^?#]+-n\d+(?:[/?#]|$)/i,
  },
  {
    id:"goldenscent-sa", name:"Golden Scent", countryCode:"SA", countryNameAr:"السعودية", brands:["goldenscent"], categories:["beauty","perfume"],
    search:(q)=>"https://www.goldenscent.com/en/search?q="+encodeURIComponent(q), productPath:/\/(?!catalog\/product\/)[^?#]+\.html(?:[?#]|$)|\/products?\/[^/?#]+(?:[/?#]|$)/i,
  },
  {
    id:"ounass-sa", name:"Ounass", countryCode:"SA", countryNameAr:"السعودية", brands:["ounass"], categories:["clothing","shoes","bag","beauty","jewelry","watch"],
    search:(q)=>"https://saudi.ounass.com/search?q="+encodeURIComponent(q), productPath:/\/shop-[^?#]+(?:[?#]|$)|\/product\/[^/?#]+(?:[/?#]|$)/i,
  },
  {
    id:"sunandsand-sa", name:"Sun & Sand Sports", countryCode:"SA", countryNameAr:"السعودية", brands:["sunandsand"], categories:["sports","shoes","clothing","bag"],
    search:(q)=>"https://en-sa.sssports.com/search?q="+encodeURIComponent(q), productPath:/\/[^?#]+\.html(?:[?#]|$)|\/products?\/[^/?#]+(?:[/?#]|$)/i,
  },
  {
    id:"virgin-sa", name:"Virgin Megastore Saudi", countryCode:"SA", countryNameAr:"السعودية", brands:["virgin"], categories:["phone","laptop","audio","console","game","book","toy","accessory","other"],
    search:(q)=>"https://www.virginmegastore.sa/en/search/?text="+encodeURIComponent(q), productPath:/\/p\/\d+(?:[/?#]|$)|\/[^?#]+\/p(?:[/?#]|$)/i,
  },
  {
    id:"homecentre-sa", name:"Home Centre Saudi", countryCode:"SA", countryNameAr:"السعودية", brands:["homecentre"], categories:["furniture","home","kitchen","office"],
    search:(q)=>"https://www.homecentre.com/sa/en/search?q="+encodeURIComponent(q), productPath:/\/sa\/en\/buy-[^?#]+\/p\/[^/?#]+(?:[/?#]|$)/i,
  },
  {
    id:"mumzworld-sa", name:"Mumzworld", countryCode:"SA", countryNameAr:"السعودية", brands:["mumzworld"], categories:["baby","toy","clothing","grocery","other"],
    search:(q)=>"https://www.mumzworld.com/sa-en/search?q="+encodeURIComponent(q), productPath:/\/[^?#]+\.html(?:[?#]|$)|\/products?\/[^/?#]+(?:[/?#]|$)/i,
  },
  {
    id:"netaporter-global", name:"NET-A-PORTER", countryCode:"GB", countryNameAr:"بريطانيا", categories:["clothing","shoes","bag","beauty","jewelry","watch"],
    search:(q)=>"https://www.net-a-porter.com/en-sa/shop/search/"+encodeURIComponent(q), productPath:/\/shop\/product\/[^?#]+(?:[/?#]|$)/i,
  },
  {
    id:"mrporter-global", name:"MR PORTER", countryCode:"GB", countryNameAr:"بريطانيا", categories:["clothing","shoes","bag","beauty","jewelry","watch"],
    search:(q)=>"https://www.mrporter.com/en-sa/mens/shop/search/"+encodeURIComponent(q), productPath:/\/mens\/product\/[^?#]+(?:[/?#]|$)/i,
  },
  {
    id:"mytheresa-global", name:"Mytheresa", countryCode:"DE", countryNameAr:"ألمانيا", categories:["clothing","shoes","bag","jewelry","watch"],
    search:(q)=>{ const terms=normalizeSearchQuery(q).split(" ").filter(Boolean); const brand=terms.find(term=>["gucci","prada","fendi","loewe","balenciaga","burberry","valentino"].includes(term)); const category=terms.some(term=>/^(bag|bags|handbag|handbags|tote|shoulder)$/.test(term)) ? "bags" : null; return brand && category ? `https://www.mytheresa.com/me/en/women/designers/${encodeURIComponent(brand)}/bags` : brand ? `https://www.mytheresa.com/me/en/women/designers/${encodeURIComponent(brand)}` : category ? "https://www.mytheresa.com/me/en/women/bags" : "https://www.mytheresa.com/me/en/women"; }, productPath:/\/[^?#]+\.html(?:[?#]|$)/i,
  },
  {
    id:"ssense-global", name:"SSENSE", countryCode:"CA", countryNameAr:"كندا", categories:["clothing","shoes","bag","beauty","jewelry","watch"],
    search:(q)=>"https://www.ssense.com/en-sa/men?q="+encodeURIComponent(q), productPath:/\/en-sa\/(?:men|women)\/product\/[^?#]+(?:[/?#]|$)/i,
  },
  {
    id:"jomashop-global", name:"Jomashop", countryCode:"US", countryNameAr:"الولايات المتحدة", categories:["watch","jewelry","perfume","bag","accessory"],
    search:(q)=>"https://www.jomashop.com/search?q="+encodeURIComponent(q), productPath:/\/[^?#]+\.html(?:[?#]|$)/i,
  },
  {
    id:"fragrancex-global", name:"FragranceX", countryCode:"US", countryNameAr:"الولايات المتحدة", categories:["perfume","beauty"],
    search:(q)=>"https://www.fragrancex.com/search/search_results?search="+encodeURIComponent(q), productPath:/\/products\/[^?#]+(?:[/?#]|$)/i,
  },
  {
    id:"lookfantastic-global", name:"LOOKFANTASTIC", countryCode:"GB", countryNameAr:"بريطانيا", categories:["beauty","perfume"],
    search:(q)=>"https://www.lookfantastic.com/search/?q="+encodeURIComponent(q), productPath:/\/p\/[^?#]+\/\d+(?:[/?#]|$)/i,
  },
  {
    id:"cultbeauty-global", name:"Cult Beauty", countryCode:"GB", countryNameAr:"بريطانيا", categories:["beauty","perfume"],
    search:(q)=>"https://www.cultbeauty.com/search/?q="+encodeURIComponent(q), productPath:/\/p\/[^?#]+\/\d+(?:[/?#]|$)/i,
  },
  {
    id:"stockx-global", name:"StockX", countryCode:"US", countryNameAr:"الولايات المتحدة", categories:["shoes","clothing","bag","watch","accessory"],
    search:(q)=>"https://stockx.com/search?s="+encodeURIComponent(q), productPath:/https?:\/\/stockx\.com\/[^/?#]+(?:[/?#]|$)/i,
  },
  {
    id:"goat-global", name:"GOAT", countryCode:"US", countryNameAr:"الولايات المتحدة", categories:["shoes","clothing","accessory"],
    search:(q)=>"https://www.goat.com/search?query="+encodeURIComponent(q), productPath:/\/sneakers\/[^/?#]+(?:[/?#]|$)|\/apparel\/[^/?#]+(?:[/?#]|$)/i,
  },
];

function decodeHtml(value = "") {
  return String(value)
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function stripHtml(value = "") {
  return decodeHtml(String(value).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function canonicalizeCandidateUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch { return url; }
}

function searchPageDiagnostics(html, searchUrl, finalUrl = searchUrl) {
  const hrefs = [];
  const seen = new Set();
  const re = /href=["']([^"'#]+)["']/gi;
  let match;
  while ((match = re.exec(String(html || ""))) && hrefs.length < 12) {
    let url;
    try { url = new URL(decodeHtml(match[1]), searchUrl).href; } catch { continue; }
    if (seen.has(url)) continue;
    seen.add(url);
    hrefs.push(url);
  }
  const source = String(html || "");
  const hintPatterns = {
    ip: /(?:\\u002F|\\\/|\/)ip(?:\\u002F|\\\/|\/)/gi,
    prd: /(?:\\u002F|\\\/|\/)prd(?:\\u002F|\\\/|\/)/gi,
    item: /(?:\\u002F|\\\/|\/)item(?:\\u002F|\\\/|\/)/gi,
    productId: /["']?(?:productId|product_id|goods_id|skuId)["']?\s*[:=]/gi,
    canonicalUrl: /["']?(?:canonicalUrl|productUrl|url)["']?\s*[:=]/gi,
  };
  const hints = Object.fromEntries(Object.entries(hintPatterns).map(([key, regex]) => [key, (source.match(regex) || []).length]));
  const structuredUrlSamples = [];
  const structuredUrlRe = /["'](?:canonicalUrl|productUrl|url)["']\s*:\s*["']([^"']+)["']/gi;
  while ((match = structuredUrlRe.exec(source)) && structuredUrlSamples.length < 8) {
    structuredUrlSamples.push(match[1]);
  }
  const productIdSamples = [];
  const productIdRe = /["'](?:productId|product_id|goods_id|skuId)["']\s*:\s*["']?([A-Za-z0-9_-]+)["']?/gi;
  while ((match = productIdRe.exec(source)) && productIdSamples.length < 8) {
    productIdSamples.push(match[1]);
  }
  let blockedReason = null;
  try {
    const requested = new URL(searchUrl);
    const final = new URL(finalUrl || searchUrl);
    const host = final.hostname.toLowerCase();
    if (host.endsWith("shein.com") && (
      /\/risk\/challenge/i.test(final.pathname) ||
      /captcha_type=|risk-id=|\/risk\/challenge/i.test(source)
    )) blockedReason = "shein_risk_challenge";
    if (host.endsWith("temu.com") && /\/search_result\.html/i.test(requested.pathname) && (
      /\/(?:login|c)\.html$/i.test(final.pathname) ||
      /"originUrl":"\\u002F(?:login|c)\.html"/i.test(source) ||
      /login_scene/i.test(final.search)
    )) blockedReason = "temu_search_redirect";
    // A successful HTTP response can still be an anti-bot/bootstrap shell.
    // Treat abnormally small search HTML with no product evidence as a
    // transport/acquisition failure, never as a legitimate empty catalogue.
    const htmlBytes = new TextEncoder().encode(source).byteLength;
    const productEvidence = Object.values(hints).reduce((sum, count) => sum + Number(count || 0), 0);
    if (!blockedReason && /(?:temu\.com|aliexpress\.)$/i.test(host.replace(/^www\./, "")) && htmlBytes < 15000 && productEvidence === 0) {
      blockedReason = "thin_search_shell";
    }
    if (host.endsWith("walmart.com") && /\/blocked(?:\/|$)/i.test(final.pathname)) blockedReason = "walmart_blocked";
    if (host.endsWith("mytheresa.com") && (
      /\/failover\//i.test(source) ||
      /failstyles\.css/i.test(source)
    )) blockedReason = "mytheresa_failover";
  } catch {}
  return {
    htmlBytes:new TextEncoder().encode(source).byteLength,
    requestedUrl:searchUrl,
    finalUrl:finalUrl || searchUrl,
    blockedReason,
    hrefSamples:hrefs,
    hints,
    structuredUrlSamples,
    productIdSamples,
  };
}

function sameHost(candidate, base) {
  try {
    const a = new URL(candidate);
    const b = new URL(base);
    const ah = a.hostname.toLowerCase().replace(/^www\./, "");
    const bh = b.hostname.toLowerCase().replace(/^www\./, "");
    return ah === bh || ah.endsWith("." + bh) || bh.endsWith("." + ah);
  } catch { return false; }
}


const LANDMARK_BLOOMREACH = {
  "centrepoint-sa":{
    accountId:"7586",
    authKey:"afxfe9u8i2iwrxp4",
    domainKey:"centrepointstores",
    requestId:"7545662630568",
    host:"https://www.centrepointstores.com",
  },
  "maxfashion-sa":{
    accountId:"7585",
    authKey:"hcm9cb32yykxejee",
    domainKey:"maxfashion",
    requestId:"7545662630568",
    host:"https://www.maxfashion.com",
  },
};

const LANDMARK_ALGOLIA = {
  "centrepoint-sa":{
    appId:"LM8X36L8LA",
    apiKey:"889d60a488b9a65b7d1ba14716572255",
    index:"blc_prod_sa_cp_product",
    host:"https://www.centrepointstores.com",
  },
  "maxfashion-sa":{
    appId:"QNYHZLFWA8",
    apiKey:"a83ce90ce2870849c24015f7bee3355d",
    index:"blc_prod_sa_max_product",
    host:"https://www.maxfashion.com",
  },
};

export function parseLandmarkBloomreachPayload(payload, storeId) {
  const docs = Array.isArray(payload?.response?.docs) ? payload.response.docs : [];
  return parseLandmarkAlgoliaPayload({ hits:docs }, storeId);
}

async function searchLandmarkBloomreach(storeId, query, limit = Infinity) {
  const config = LANDMARK_BLOOMREACH[storeId];
  if (!config) return [];
  const finiteLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : Infinity;
  const rows = Number.isFinite(finiteLimit) ? Math.max(1, Math.min(100, finiteLimit)) : 100;
  const all = [];
  const seen = new Set();
  let start = 0;
  let total = Infinity;
  const signal = AbortSignal.timeout(6500);

  while (start < total && all.length < finiteLimit) {
    try {
    const params = new URLSearchParams({
      account_id:config.accountId,
      auth_key:config.authKey,
      domain_key:config.domainKey,
      request_id:config.requestId,
      request_type:"search",
      search_type:"keyword",
      q:query,
      rows:String(rows),
      start:String(start),
      fl:"pid,title,price,sale_price,low_price,low_sale_price,url,thumb_image,brand,inStock",
      url:config.host + "/sa/en/search?q=" + encodeURIComponent(query),
    });
    const response = await fetch("https://core.dxpapi.com/api/v1/core/?" + params.toString(), {
      headers:{
        accept:"application/json",
        "user-agent":USER_AGENT,
      },
      signal,
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 300);
      throw new Error("Landmark Bloomreach HTTP " + response.status + (detail ? ": " + detail : ""));
    }
    const payload = await response.json();
    total = Math.max(0, Number(payload?.response?.numFound) || 0);
    const batch = parseLandmarkBloomreachPayload(payload, storeId);
    const before = all.length;
    for (const item of batch) {
      if (seen.has(item.productId)) continue;
      seen.add(item.productId);
      all.push(item);
      if (all.length >= finiteLimit) break;
    }
    if (batch.length === 0 || all.length === before || signal.aborted) break;
    start += rows;
    } catch(error) {
      if(!all.length) throw error;
      all.paginationError=error.message || String(error);
      break;
    }
  }
  return all;
}

export function parseLandmarkAlgoliaPayload(payload, storeId) {
  const config = LANDMARK_ALGOLIA[storeId];
  if (!config) return [];
  const hits = Array.isArray(payload?.hits) ? payload.hits : [];
  const offers = [];
  const seen = new Set();

  for (const hit of hits) {
    const productId = String(hit?.pid || hit?.sku || hit?.objectID || "").trim();
    const title = String(hit?.title || hit?.name?.en || hit?.description?.en || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const price = Number(hit?.sale_price ?? hit?.low_sale_price ?? hit?.price ?? hit?.low_price);
    const path = String(hit?.url || hit?.uri || "").trim();
    if (!productId || !title || !Number.isFinite(price) || price <= 0 || !path) continue;
    if (seen.has(productId)) continue;
    seen.add(productId);

    let sourceUrl;
    try {
      const localizedPath = path.startsWith("/buy-") ? "/sa/en" + path : path;
      sourceUrl = new URL(localizedPath, config.host).href;
    } catch { continue; }

    const imageRaw = String(hit?.thumb_image || hit?.thumbnailImg || hit?.primaryAssetContentUrl || hit?.galleryImages?.[0]?.url || "").trim();
    let image = null;
    try { if (imageRaw) image = new URL(imageRaw, config.host).href; } catch {}

    offers.push({
      productId,
      title,
      image,
      price,
      currency:"SAR",
      sourceUrl,
      brand:String(hit?.brand || hit?.brandDisplayValue?.en || hit?.manufacturerNameAll?.[0] || "").trim() || null,
      inStock:hit?.inStock === 1 || hit?.inStock === true,
    });
  }

  return offers;
}

async function searchLandmarkAlgolia(storeId, query, limit = Infinity) {
  const config = LANDMARK_ALGOLIA[storeId];
  if (!config) return [];
  const app = config.appId.toLowerCase();
  const hosts = [
    app + "-dsn.algolia.net",
    app + ".algolia.net",
    app + "-1.algolianet.com",
    app + "-2.algolianet.com",
    app + "-3.algolianet.com",
  ];
  const all = [];
  const seen = new Set();
  const finiteLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : Infinity;
  const hitsPerPage = Number.isFinite(finiteLimit) ? Math.max(1, Math.min(100, finiteLimit)) : 100;
  let page = 0;
  let nbPages = 1;
  const signal = AbortSignal.timeout(6500);

  const requestPage = async (pageNumber) => {
    const errors = [];
    for (const host of hosts) {
      const endpoint = "https://" + host + "/1/indexes/" + encodeURIComponent(config.index) + "/query";
      try {
        const response = await fetch(endpoint, {
          method:"POST",
          headers:{
            accept:"application/json",
            "content-type":"application/json",
            "x-algolia-application-id":config.appId,
            "x-algolia-api-key":config.apiKey,
            "user-agent":USER_AGENT,
          },
          body:JSON.stringify({
            query,
            page:pageNumber,
            hitsPerPage,
            attributesToRetrieve:["*"],
          }),
          signal,
        });
        if (!response.ok) {
          const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 220);
          errors.push(host + " HTTP " + response.status + (detail ? " " + detail : ""));
          continue;
        }
        return await response.json();
      } catch (error) {
        const detail = error instanceof Error
          ? (error.cause?.code ? error.message + " (" + error.cause.code + ")" : error.message)
          : String(error);
        errors.push(host + " " + detail);
      }
    }
    throw new Error("Landmark Algolia hosts failed: " + errors.join(" | "));
  };

  while (page < nbPages && all.length < finiteLimit) {
    if(signal.aborted) break;
    let payload;
    try {payload = await requestPage(page);} catch(error) {
      if(!all.length) throw error;
      all.paginationError=error.message || String(error);break;
    }
    nbPages = Math.max(1, Number(payload?.nbPages) || 1);
    for (const item of parseLandmarkAlgoliaPayload(payload, storeId)) {
      if (seen.has(item.productId)) continue;
      seen.add(item.productId);
      all.push(item);
      if (all.length >= finiteLimit) break;
    }
    page += 1;
  }

  return all;
}

function extractAssignedJsonObject(source, marker, maxBytes = 5000000) {
  const text = String(source || "");
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = text.indexOf("{", markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  const endLimit = Math.min(text.length, start + maxBytes);
  for (let i = start; i < endLimit; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function stableTemuProductUrl(rawUrl, productId) {
  if (!rawUrl) return "https://www.temu.com/goods.html?goods_id=" + encodeURIComponent(productId);
  try {
    const url = new URL(rawUrl, "https://www.temu.com");
    if (/-g-\d+\.html$/i.test(url.pathname)) {
      url.search = "";
      url.hash = "";
      return url.href;
    }
    if (/\/goods\.html$/i.test(url.pathname)) {
      const id = url.searchParams.get("goods_id") || url.searchParams.get("goodsId") || productId;
      url.search = "";
      url.searchParams.set("goods_id", id);
      url.hash = "";
      return url.href;
    }
    url.hash = "";
    return url.href;
  } catch {
    return "https://www.temu.com/goods.html?goods_id=" + encodeURIComponent(productId);
  }
}

export function extractTemuSearchOffers(html, query) {
  const raw =
    extractAssignedJsonObject(html, "window.rawData=") ||
    extractAssignedJsonObject(html, "window.rawData =");
  const list = Array.isArray(raw?.store?.goodsList) ? raw.store.goodsList : [];
  const tokens = normalizeSearchQuery(query).split(" ").filter((token) => token.length >= 2);
  const offers = [];
  const seen = new Set();

  for (const entry of list) {
    const item = entry?.data && typeof entry.data === "object" ? entry.data : entry;
    if (!item || typeof item !== "object") continue;
    const productId = String(item.goodsId || item.goods_id || item.productId || "").trim();
    const title = String(item.title || item.goodsName || item.goods_name || "").replace(/\s+/g, " ").trim();
    const priceInfo = item.priceInfo || item.price_info || {};
    const rawPrice = Number(priceInfo.price ?? item.price);
    const currency = String(priceInfo.currency || item.currency || raw?.store?.localInfo?.currency || "").trim().toUpperCase();
    if (!productId || !title || !Number.isFinite(rawPrice) || rawPrice <= 0 || !currency) continue;

    const haystack = normalizeSearchQuery(title);
    const hits = tokens.filter((token) => haystack.includes(token)).length;
    if (tokens.length > 1 && hits / tokens.length < 0.2) continue;
    if (seen.has(productId)) continue;
    seen.add(productId);

    // Temu search hydration reports the integer price in minor currency units.
    const price = rawPrice / 100;
    if (!Number.isFinite(price) || price <= 0) continue;

    const sourceUrl = stableTemuProductUrl(item.seoLinkUrl || item.linkUrl || item.url, productId);
    const imageRaw = item.image?.url || item.imageUrl || item.image_url || null;
    let image = null;
    try { if (imageRaw) image = new URL(imageRaw, "https://www.temu.com").href; } catch {}

    offers.push({ productId, title, image, price, currency, sourceUrl });
  }
  return offers;
}


export function extractAliExpressSearchOffers(html, query) {
  const source = String(html || "");
  const tokens = normalizeSearchQuery(query).split(" ").filter((t) => t.length >= 2);
  const starts = [];
  const marker = /{"redirectedId"/g;
  let markerMatch;
  while ((markerMatch = marker.exec(source))) starts.push(markerMatch.index);
  const offers = [];
  const seen = new Set();

  const decodeJsonString = (value = "") => {
    try { return JSON.parse('"' + value + '"'); } catch { return decodeHtml(value).replace(/\\u0026/gi, "&").replace(/\\//g, "/"); }
  };

  for (let n = 0; n < starts.length; n++) {
    const start = starts[n];
    const end = starts[n + 1] ?? Math.min(source.length, start + 30000);
    const block = source.slice(start, end);
    if (!/"itemType":"productV3"/.test(block)) continue;

    const productId = block.match(/"productId":"?(\d+)"?/)?.[1] || null;
    const titleRaw = block.match(/"title":{"displayTitle":"((?:\\.|[^"\\])*)"/)?.[1] || null;
    const imageRaw = block.match(/"image":{"imgUrl":"((?:\\.|[^"\\])*)"/)?.[1] || null;
    const priceBlock =
      block.match(/"salePrice":{[\s\S]{0,1200}?}/)?.[0] ||
      block.match(/"originalPrice":{[\s\S]{0,1200}?}/)?.[0] ||
      null;
    const currency = priceBlock?.match(/"currencyCode":"([A-Z]{3})"/)?.[1] || null;
    const price = Number(priceBlock?.match(/"minPrice":([0-9]+(?:\.[0-9]+)?)/)?.[1]);
    const sourceRaw = block.match(/"productDetailUrl":"((?:\\.|[^"\\])*)"/)?.[1] || null;

    if (!productId || !titleRaw || !currency || !Number.isFinite(price) || price <= 0 || !sourceRaw) continue;
    const title = decodeJsonString(titleRaw);
    const haystack = normalizeSearchQuery(title);
    const hits = tokens.filter((token) => haystack.includes(token)).length;
    if (tokens.length > 1 && hits / tokens.length < 0.2) continue;
    if (seen.has(productId)) continue;
    seen.add(productId);

    let image = imageRaw ? decodeJsonString(imageRaw) : null;
    if (image?.startsWith("//")) image = "https:" + image;
    const sourceUrl = decodeJsonString(sourceRaw).replace(/&amp;/g, "&");
    offers.push({ productId, title, image, price, currency, sourceUrl });
  }
  return offers;
}



export function parseIkeaSikPayload(payload, query) {
  const tokens = normalizeSearchQuery(query).split(" ").filter((t) => t.length >= 2);
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const primary = results.find((entry) => entry?.component === "PRIMARY_AREA");
  const items = Array.isArray(primary?.items) ? primary.items : [];
  const offers = [];
  const seen = new Set();

  for (const item of items) {
    if (item?.type !== "PRODUCT" || !item.product) continue;
    const product = item.product;
    const productId = String(product.itemNo || "").trim();
    const title = String(product.name || "").trim();
    const price = Number(product.salesPrice?.numeral);
    const currency = String(product.salesPrice?.currencyCode || "").toUpperCase();
    const sourceUrl = product.pipUrl ? new URL(product.pipUrl, "https://www.ikea.com").href : null;
    const image = product.mainImageUrl ? new URL(product.mainImageUrl, "https://www.ikea.com").href : null;

    if (!productId || !title || !Number.isFinite(price) || price <= 0 || !currency || !sourceUrl) continue;
    const haystack = normalizeSearchQuery([
      title,
      product.typeName,
      product.itemMeasureReferenceText,
      product.productDescription,
    ].filter(Boolean).join(" "));
    const hits = tokens.filter((token) => haystack.includes(token)).length;
    if (tokens.length > 1 && hits / tokens.length < 0.2) continue;
    if (seen.has(productId)) continue;
    seen.add(productId);
    offers.push({ productId, title, image, price, currency, sourceUrl });
  }
  return offers;
}

async function searchIkeaSik(query) {
  const endpoint = "https://sik.search.blue.cdtapps.com/sa/en/search?c=sr&v=20260727";
  const body = {
    searchParameters:{ input:query, type:"QUERY" },
    allowAutocorrect:true,
    isUserLoggedIn:false,
    isB2B:false,
    listingABTest:true,
    components:[
      {
        component:"PRIMARY_AREA",
        columns:2,
        types:{ main:"PRODUCT", breakouts:["PLANNER","CATEGORY","CONTENT","MATTRESS_WARRANTY","FINANCIAL_SERVICES"] },
        filterConfig:{ "subcategories-style":"tree-navigation", "max-num-filters":5, presetFilters:false },
        window:{ size:24, offset:0 },
        allVariants:false,
        forceFilterCalculation:true,
      },
      { component:"CONTENT_AREA", types:{ main:"CONTENT", breakouts:[] }, window:{ size:12, offset:0 } },
      { component:"RELATED_SEARCHES" },
      { component:"QUESTIONS_AND_ANSWERS" },
      { component:"STORES" },
      { component:"CATEGORIES" },
      { component:"SIMILAR_PRODUCTS" },
      { component:"SEARCH_SUMMARY" },
      { component:"PAGE_MESSAGES" },
      { component:"RELATED_CATEGORIES" },
      { component:"PRODUCT_GROUP" },
    ],
  };
  const response = await fetch(endpoint, {
    method:"POST",
    headers:{
      accept:"*/*",
      "content-type":"text/plain;charset=UTF-8",
      "Session-Id":"6f29f48b-5fc4-4d56-9c66-5fdd72aa2026",
      origin:"https://www.ikea.com",
      referer:"https://www.ikea.com/sa/en/search/",
      "user-agent":USER_AGENT,
    },
    body:JSON.stringify(body),
    signal:AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 500);
    throw new Error("IKEA SIK HTTP " + response.status + (detail ? ": " + detail : ""));
  }
  return parseIkeaSikPayload(await response.json(), query);
}

export function extractIkeaSearchOffers(html, query) {
  const source=String(html||"");
  const tokens=normalizeSearchQuery(query).split(" ").filter(t=>t.length>=2);
  const offers=[]; const seen=new Set();
  const add=(productId,title,image,price,sourceUrl)=>{
    title=decodeHtml(String(title||"")).replace(/\\u0026/g,"&").replace(/\\n/g," ").replace(/\s+/g," ").trim();
    price=Number(String(price??"").replace(/,/g,""));
    try { sourceUrl=new URL(decodeHtml(String(sourceUrl||"")).replace(/\\u002F/gi,"/").replace(/\\\//g,"/"),"https://www.ikea.com").href; } catch { return; }
    const hay=normalizeSearchQuery(title); const hits=tokens.filter(t=>hay.includes(t)).length;
    if(!productId||!title||!Number.isFinite(price)||price<=0||(tokens.length>1&&hits/tokens.length<0.2)||seen.has(String(productId)))return;
    seen.add(String(productId)); offers.push({productId:String(productId),title,productType:title,image:image||null,price,currency:"SAR",sourceUrl});
  };
  // Render receives IKEA's SSR shell with product data serialized inside scripts.
  // Mine local neighborhoods around every Saudi PIP URL instead of depending on DOM card shape.
  const urlRe=/(?:https?:\\?\/\\?\/www\.ikea\.com)?\\?\/sa\\?\/en\\?\/p\\?\/[^"'<>\\s]+?-(s?\d{8})\\?\//gi;
  let m;
  while((m=urlRe.exec(source))){
    const block=source.slice(Math.max(0,m.index-7000),Math.min(source.length,m.index+9000));
    const rawUrl=m[0]; const productId=m[1].replace(/^s/i,"");
    const nameMatches=[...block.matchAll(/"(?:name|productName)"\s*:\s*"((?:\\.|[^"\\]){2,180})"/gi)];
    const typeMatches=[...block.matchAll(/"(?:typeName|productType)"\s*:\s*"((?:\\.|[^"\\]){2,100})"/gi)];
    const priceMatches=[...block.matchAll(/"(?:numeral|price|currentPrice)"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/gi)];
    const imageMatches=[...block.matchAll(/"(?:mainImageUrl|imageUrl|src)"\s*:\s*"((?:\\.|[^"\\])+?)"/gi)];
    const pathTitle=decodeHtml(rawUrl).replace(/\\u002F/gi,"/").replace(/\\\//g,"/").match(/\/p\/([^/?#]+?)-(?:s?\d{8})\/?(?:[?#]|$)/i)?.[1]?.replace(/[-_]+/g," ") || "";
    const structuredTitle=[nameMatches.at(-1)?.[1],typeMatches.at(-1)?.[1]].filter(Boolean).join(" ");
    const structuredRelevant=tokens.some(token=>normalizeSearchQuery(structuredTitle).includes(token));
    const title=structuredRelevant ? structuredTitle : pathTitle || structuredTitle;
    add(productId,title,imageMatches.at(-1)?.[1]||null,priceMatches.at(-1)?.[1],rawUrl);
  }
  return offers;
}

export function extractAmazonSearchOffers(html, query, origin = "https://www.amazon.sa") {
  const source=String(html||"");
  const tokens=normalizeSearchQuery(query).split(" ").filter(t=>t.length>=2);
  const offers=[]; const seen=new Set();
  const asinRe=/data-asin=["']([A-Z0-9]{10})["']/gi;
  const marks=[]; let m;
  while((m=asinRe.exec(source))) marks.push({asin:m[1],index:m.index});
  for(let i=0;i<marks.length;i++){
    const {asin,index}=marks[i];
    if(seen.has(asin))continue;
    const block=source.slice(index,Math.min(source.length,marks[i+1]?.index ?? index+30000));
    const imgMatch=block.match(/<img[^>]+alt=["']([^"']{3,})["'][^>]+(?:data-src|src)=["']([^"']+)["']/i) ||
      block.match(/<img[^>]+(?:data-src|src)=["']([^"']+)["'][^>]+alt=["']([^"']{3,})["']/i);
    let title="";
    let image=null;
    if(imgMatch){
      if(/^https?:/i.test(imgMatch[1])){image=decodeHtml(imgMatch[1]);title=decodeHtml(imgMatch[2]);}
      else {title=decodeHtml(imgMatch[1]);image=decodeHtml(imgMatch[2]);}
    }
    if(!title) title=stripHtml(block.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1]||"");
    if(!image) image=decodeHtml(block.match(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/i)?.[1]||"") || null;
    if(!title) title=decodeHtml(block.match(/aria-label=["']([^"']{8,})["']/i)?.[1]||"");
    // Crossed-out list prices are not the current selling price.
    const priceMatch=block.match(/<span\b[^>]*class=["'](?=[^"']*\ba-price\b)(?![^"']*\ba-text-price\b)[^"']*["'][^>]*>/i);
    const priceBlock=priceMatch ? block.slice(priceMatch.index+priceMatch[0].length,priceMatch.index+2000) : "";
    const offscreen=stripHtml(priceBlock.match(/^\s*<span[^>]*class=["'][^"']*a-offscreen[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]||"");
    const price=Number(offscreen.replace(/[^0-9.]/g,""));
    if(title.length<3||!Number.isFinite(price)||price<=0)continue;
    const haystack=normalizeSearchQuery(title);const hits=tokens.filter(t=>haystack.includes(t)).length;
    if(tokens.length>1&&hits/tokens.length<0.2)continue;
    const direct=block.match(/href=["']([^"']*\/dp\/[A-Z0-9]{10}[^"']*)["']/i)?.[1];
    let sourceUrl=origin+"/dp/"+asin;
    try {
      const candidate=new URL(decodeHtml(direct || sourceUrl),origin);
      if(candidate.origin===new URL(origin).origin && !candidate.username && !candidate.password && candidate.pathname.match(/\/dp\/([A-Z0-9]{10})(?:\/|$)/i)?.[1].toUpperCase()===asin.toUpperCase()) sourceUrl=candidate.href;
    } catch {}
    seen.add(asin);
    offers.push({productId:asin,title:stripHtml(title),image,price,currency:"SAR",sourceUrl});
  }
  return offers;
}

export function extractBestBuySearchOffers(html, query) {
  const source = String(html || "");
  const tokens = normalizeSearchQuery(query).split(" ").filter((t) => t.length >= 2);
  const offers = [];
  const seen = new Set();
  const priceRe = /"price":\{"customerPrice":([0-9]+(?:\.[0-9]+)?)[\s\S]{0,2200}?"skuId":"(\d+)"/g;
  let match;

  const decodeJsonString = (value = "") => {
    try { return JSON.parse('"' + value + '"'); } catch { return decodeHtml(value).replace(/\\"/g, '"').replace(/\\u0026/gi, "&").replace(/\\\//g, "/"); }
  };

  while ((match = priceRe.exec(source))) {
    const price = Number(match[1]);
    const sku = match[2];
    if (!Number.isFinite(price) || price <= 0 || seen.has(sku)) continue;

    const start = Math.max(0, match.index - 16000);
    const end = Math.min(source.length, match.index + 7000);
    const block = source.slice(start, end);

    const pdpMatches = [...block.matchAll(/"pdpUrl":"((?:\\.|[^"\\])+)"/g)]
      .map((item) => decodeJsonString(item[1]))
      .filter((url) => !/\/openbox(?:[/?#]|$)/i.test(url) && new RegExp("/sku/" + sku + "(?:[/?#]|$)", "i").test(url));
    const sourceUrl = pdpMatches.at(-1) || null;

    const nameMatches = [...block.matchAll(/"name":\{"short":"((?:\\.|[^"\\])*)"/g)];
    const title = nameMatches.length ? decodeJsonString(nameMatches.at(-1)[1]) : null;

    const imageMatches = [...block.matchAll(/"primaryImage":\{"piscesHref":"((?:\\.|[^"\\])*)"/g)];
    const image = imageMatches.length ? decodeJsonString(imageMatches.at(-1)[1]) : null;

    if (!sourceUrl || !title) continue;
    const haystack = normalizeSearchQuery(title);
    const hits = tokens.filter((token) => haystack.includes(token)).length;
    if (tokens.length > 1 && hits / tokens.length < 0.2) continue;

    seen.add(sku);
    offers.push({ productId:sku, title, image, price, currency:"USD", sourceUrl });
  }

  return offers;
}

export function extractSamsungSearchOffers(html, query) {
  const source = String(html || "");
  const tokens = normalizeSearchQuery(query).split(" ").filter(t => t.length >= 2);
  const offers = []; const seen = new Set();
  const itemRe = /<li class="aisearch__item">([\s\S]*?)(?=<li class="aisearch__item">|<\/ul>)/gi;
  let item;
  while ((item = itemRe.exec(source))) {
    const block = item[1];
    const link = block.match(/<a[^>]+class="aisearch-product__(?:image|name)"[^>]+href="([^"]+)"[^>]*data-modelcode="([^"]+)"[^>]*(?:aria-label="([^"]+)"|)[^>]*>/i)
      || block.match(/<a[^>]+href="([^"]+)"[^>]*data-modelcode="([^"]+)"[^>]*aria-label="([^"]+)"/i);
    const name = block.match(/class="aisearch-product__name"[^>]*>([\s\S]*?)<\/a>/i);
    const priceMatch = block.match(/data-modelprice="([\d.]+)"/i) || block.match(/aisearch-product__price-save[^>]*>[^\d]*([\d,]+(?:\.\d+)?)/i);
    if (!link || !priceMatch) continue;
    let sourceUrl;
    try { sourceUrl = canonicalizeCandidateUrl(new URL(decodeHtml(link[1]), "https://www.samsung.com").href); } catch { continue; }
    const title = stripHtml(name?.[1] || link[3] || "");
    const productId = String(link[2] || "").trim();
    const price = Number(String(priceMatch[1]).replace(/,/g, ""));
    const imageMatch = block.match(/(?:data-desktop-src|data-src)="([^"]+)"/i);
    const hay = normalizeSearchQuery(title + " " + productId + " " + sourceUrl);
    const hits = tokens.filter(t => hay.includes(t)).length;
    const key = productId + "|" + price;
    if (!title || !productId || !Number.isFinite(price) || price <= 0 || (tokens.length > 1 && hits / tokens.length < 0.2) || seen.has(key)) continue;
    seen.add(key);
    offers.push({ productId, title, image:imageMatch ? decodeHtml(imageMatch[1]) : null, price, currency:"SAR", sourceUrl });
  }
  return offers;
}

export function extractCarrefourSearchOffers(html, query) {
  const source = String(html || "");
  const tokens = normalizeSearchQuery(query).split(" ").filter(t => t.length >= 2);
  const offers = []; const seen = new Set();
  const re = /<a\b[^>]*href=["']([^"']*\/mafuae\/en\/[^"']*\/p\/\d+[^"']*)["'][^>]*>\s*<span[^>]*>([\s\S]*?)<\/span><\/a>\s*<div[^>]*>\s*<span[^>]*>AED<\/span>\s*<span[^>]*>([\d,.]+)<\/span>/gi;
  let match;
  while ((match = re.exec(source))) {
    let sourceUrl;
    try { sourceUrl = canonicalizeCandidateUrl(new URL(decodeHtml(match[1]), "https://www.carrefouruae.com").href); } catch { continue; }
    const title = stripHtml(match[2]);
    const price = Number(String(match[3]).replace(/,/g, ""));
    const hay = normalizeSearchQuery(title + " " + sourceUrl);
    const hits = tokens.filter(t => hay.includes(t)).length;
    const key = sourceUrl + "|" + price;
    if (!title || !Number.isFinite(price) || price <= 0 || (tokens.length > 1 && hits / tokens.length < 0.2) || seen.has(key)) continue;
    seen.add(key);
    const id = sourceUrl.match(/\/p\/(\d+)/i)?.[1] || sourceUrl;
    offers.push({ productId:id, title, image:null, price, currency:"AED", sourceUrl });
  }
  return offers;
}

export function extractEmbeddedSearchOffers(html, searchUrl, store, query) {
  const source = String(html || "");
  const tokens = normalizeSearchQuery(query).split(" ").filter(t => t.length >= 2);
  const offers = []; const seen = new Set();
  const scripts = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) || [];
  const visit = (node, depth = 0) => {
    if (!node || depth > 20) return;
    if (Array.isArray(node)) { for (const item of node) visit(item, depth + 1); return; }
    if (typeof node !== "object") return;
    const title = String(node.name ?? node.title ?? node.productName ?? node.displayName ?? "").replace(/\s+/g," ").trim();
    const rawPrice = node.price ?? node.currentPrice ?? node.salePrice ?? node.finalPrice ?? node.priceValue ?? node?.offers?.price ?? node?.price?.value ?? node?.price?.amount;
    const price = Number(typeof rawPrice === "object" ? (rawPrice?.value ?? rawPrice?.amount) : String(rawPrice ?? "").replace(/[^0-9.]/g,""));
    const currency = String(node.currency ?? node.currencyCode ?? node.priceCurrency ?? node?.offers?.priceCurrency ?? node?.price?.currency ?? "").trim().toUpperCase();
    const rawUrl = node.url ?? node.productUrl ?? node.canonicalUrl ?? node.pdpUrl ?? node.productDetailUrl ?? node.seoUrl ?? node?.offers?.url;
    let sourceUrl = null;
    try { if (rawUrl) sourceUrl = new URL(String(rawUrl).replace(/\\u002F/gi,"/").replace(/\\\//g,"/"), searchUrl).href; } catch {}
    const image = node.image ?? node.imageUrl ?? node.mainImageUrl ?? node.thumbnail ?? node?.images?.[0]?.url ?? null;
    if (title && sourceUrl && sameHost(sourceUrl, searchUrl) && store.productPath.test(sourceUrl) && Number.isFinite(price) && price > 0 && /^[A-Z]{3}$/.test(currency)) {
      const hay = normalizeSearchQuery(title + " " + sourceUrl);
      const hits = tokens.filter(t => hay.includes(t)).length;
      const key = canonicalizeCandidateUrl(sourceUrl) + "|" + price;
      if ((tokens.length <= 1 || hits / tokens.length >= 0.2) && !seen.has(key)) {
        seen.add(key);
        offers.push({ productId:String(node.id ?? node.productId ?? node.sku ?? node.skuId ?? sourceUrl), title, image:typeof image === "string" ? image : null, price, currency, sourceUrl:canonicalizeCandidateUrl(sourceUrl) });
      }
    }
    for (const value of Object.values(node)) if (value && typeof value === "object") visit(value, depth + 1);
  };
  for (const script of scripts) {
    const body = script.replace(/^<script\b[^>]*>/i,"").replace(/<\/script>$/i,"").trim();
    if (!body) continue;
    const candidates = [];
    if (body[0] === "{" || body[0] === "[") candidates.push(body);
    // Common SSR/hydration shapes: window.__STATE__ = {...},
    // self.__NEXT_DATA__ = {...}, __APOLLO_STATE__ = {...}.
    const assignment = body.match(/(?:window\.|self\.)?__[A-Z0-9_$]+__\s*=\s*([\[{][\s\S]*[\]}])\s*;?$/i);
    if (assignment?.[1]) candidates.push(assignment[1]);
    for (const candidate of candidates) {
      try { visit(JSON.parse(candidate)); } catch {}
    }
  }
  // Some frameworks HTML-escape hydration JSON inside script/template payloads.
  for (const match of source.matchAll(/(?:__NEXT_DATA__|__INITIAL_STATE__|__APOLLO_STATE__)[^>]*>([\s\S]{20,200000}?)<\//gi)) {
    const body = decodeHtml(match[1]).trim();
    try { visit(JSON.parse(body)); } catch {}
  }
  return offers;
}

function extractJsonLdSearchOffers(html, searchUrl, store, query) {
  const tokens = normalizeSearchQuery(query).split(" ").filter(t=>t.length>=2);
  const offers=[]; const seen=new Set();
  const scripts=String(html||"").match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi)||[];
  const visit=(node)=>{
    if(!node)return;
    if(Array.isArray(node)){ for(const item of node) visit(item); return; }
    if(typeof node!=="object")return;
    const type=String(node["@type"]||"").toLowerCase();
    if(type==="itemlist" && Array.isArray(node.itemListElement)){ for(const item of node.itemListElement) visit(item?.item||item); }
    if(type==="product"){
      const title=String(node.name||"").replace(/\s+/g," ").trim();
      const offer=Array.isArray(node.offers)?node.offers[0]:node.offers;
      const price=Number(offer?.price ?? offer?.lowPrice);
      const currency=String(offer?.priceCurrency||"").toUpperCase();
      let sourceUrl=node.url || offer?.url || null;
      try { if(sourceUrl) sourceUrl=new URL(sourceUrl,searchUrl).href; } catch { sourceUrl=null; }
      const hay=normalizeSearchQuery(title); const hits=tokens.filter(t=>hay.includes(t)).length;
      if(title && sourceUrl && Number.isFinite(price) && price>0 && currency && (tokens.length<=1 || hits/tokens.length>=0.2)){
        const key=sourceUrl+"|"+price; if(!seen.has(key)){seen.add(key); offers.push({productId:String(node.sku||node.productID||sourceUrl),title,image:Array.isArray(node.image)?node.image[0]:node.image||null,price,currency,sourceUrl});}
      }
    }
    if(Array.isArray(node["@graph"])) visit(node["@graph"]);
  };
  for(const script of scripts){
    const body=script.replace(/^<script\b[^>]*>/i,"").replace(/<\/script>$/i,"").trim();
    try { visit(JSON.parse(body)); } catch {}
  }
  return offers;
}

export function extractProductLinks(html, searchUrl, store, query, limit = Infinity) {
  const tokens = normalizeSearchQuery(query).split(" ").filter((t) => t.length >= 2);
  const out = [];
  const seen = new Set();
  const addCandidate = (rawUrl, rawLabel = "") => {
    let url;
    try { url = new URL(decodeHtml(rawUrl).replace(/\\u002F/gi, "/").replace(/\\\//g, "/"), searchUrl).href; } catch { return; }
    if (!sameHost(url, searchUrl) || !store.productPath.test(url)) return;
    // Product discovery must never promote static assets (images/fonts/etc.) to
    // product pages even when a loose storefront regex happens to match them.
    try {
      const pathname = new URL(url).pathname.toLowerCase();
      if (/\.(?:avif|gif|jpe?g|png|svg|webp|ico|woff2?|ttf|css|js)(?:\/)?$/.test(pathname)) return;
    } catch { return; }
    const label = stripHtml(rawLabel);
    const haystack = normalizeSearchQuery(label + " " + url);
    const hits = tokens.filter((token) => haystack.includes(token)).length;
    const score = tokens.length ? hits / tokens.length : 0.5;
    if (score < 0.2 && tokens.length > 1) return;
    url = canonicalizeCandidateUrl(url);
    if (seen.has(url)) return;
    seen.add(url);
    out.push({ url, label, score });
  };

  const anchorRe = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRe.exec(html))) addCandidate(match[1], match[2]);

  // Modern storefronts often hydrate search results in JSON instead of rendering
  // product anchors server-side. Scan quoted URL values as a second discovery path.
  for (const hydratedSource of [String(html || ""), decodeHtml(html)]) {
    const quotedUrlRe = /["']((?:https?:)?(?:\\?\/){1,2}[^"' <>\s]+)["']/gi;
    while ((match = quotedUrlRe.exec(hydratedSource))) addCandidate(match[1], "");

    const unicodeUrlRe = /["']((?:https?:)?(?:\\u002F){1,2}[^"'<>]+)["']/gi;
    while ((match = unicodeUrlRe.exec(hydratedSource))) addCandidate(match[1], "");

    // Some storefronts (notably Temu/SHEIN) hydrate product links under
    // structured keys without a leading slash, so the generic quoted-URL
    // scanner above cannot see them. Resolve those values relative to the
    // search URL and let the store-specific productPath validate them.
    const structuredUrlRe = /["'](?:canonicalUrl|productUrl|productDetailUrl|seoUrl|seoLinkUrl|linkUrl|url)["']\s*:\s*["']((?:\\.|[^"'\\])*)["']/gi;
    while ((match = structuredUrlRe.exec(hydratedSource))) {
      const structuredUrl = decodeHtml(match[1])
        .replace(/\\u002F/gi, "/")
        .replace(/\\\//g, "/");
      const rootedUrl = /^(?:https?:)?\/\//i.test(structuredUrl) || structuredUrl.startsWith("/")
        ? structuredUrl
        : "/" + structuredUrl;
      addCandidate(rootedUrl, "");
    }
  }

  if (store.id === "aliexpress-cn") {
    const productIdRe = /productIds(?:=|%3D|\\u003D)(\d{10,})/gi;
    while ((match = productIdRe.exec(String(html || "")))) {
      addCandidate("https://www.aliexpress.com/item/" + match[1] + ".html", query);
    }
  }
  const ranked = out.sort((a,b) => b.score - a.score);
  return Number.isFinite(limit) ? ranked.slice(0, Math.max(0, limit)) : ranked;
}

async function fetchText(url,{signal}={}) {
  const response = await fetch(url, {
    headers:{
      accept:"text/html,application/xhtml+xml",
      "accept-language":"en-US,en;q=0.9,ar-SA;q=0.8",
      "cache-control":"no-cache",
      pragma:"no-cache",
      "sec-fetch-dest":"document",
      "sec-fetch-mode":"navigate",
      "sec-fetch-site":"none",
      "upgrade-insecure-requests":"1",
      "user-agent":USER_AGENT,
    },
    redirect:"follow",
    signal:signal?AbortSignal.any([signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) throw new Error("non-html response");
  const text = await response.text();
  if (text.length > 5000000) throw new Error("search response too large");
  return { html:text, finalUrl:response.url || url };
}

function isRetryableAmazonSearchError(error){
  if(error?.name==="TimeoutError"||error?.name==="AbortError"||error instanceof TypeError)return true;
  return /^HTTP (?:408|425|429|5\d\d)\b/.test(String(error?.message||error||""));
}

export async function fetchAmazonSearchPages(searchUrl,{pageStart=1,pageCount=1,deadlineMs=10000,fetchPage=fetchText,wait=(ms)=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  const deadlineAt=Date.now()+Math.max(50,Math.min(15000,Number(deadlineMs)||10000));
  const controller=new AbortController();
  const pageUrls=Array.from({length:pageCount},(_,index)=>{
    const pageUrl=new URL(searchUrl);
    pageUrl.searchParams.set("page",String(pageStart+index));
    return {index,url:pageUrl.href};
  });
  const settleBeforeDeadline=async(operation)=>{
    const remaining=deadlineAt-Date.now();
    if(remaining<=0){const error=new Error("amazon_page_deadline_exceeded");error.name="TimeoutError";return {status:"rejected",reason:error};}
    let timeoutId;
    const timeout=new Promise(resolve=>{timeoutId=setTimeout(()=>{const error=new Error("amazon_page_deadline_exceeded");error.name="TimeoutError";controller.abort(error);resolve({status:"rejected",reason:error});},remaining);});
    try{
      return await Promise.race([
        Promise.resolve().then(operation).then(value=>({status:"fulfilled",value}),reason=>({status:"rejected",reason})),
        timeout,
      ]);
    }finally{clearTimeout(timeoutId);}
  };
  const first=await Promise.all(pageUrls.map(page=>settleBeforeDeadline(()=>fetchPage(page.url,{signal:controller.signal}))));
  const results=first.map((result,index)=>({index,result}));
  const retryable=results.filter(({result})=>result.status==="rejected"&&isRetryableAmazonSearchError(result.reason));
  if(retryable.length&&Date.now()<deadlineAt){
    const retried=await Promise.all(retryable.map(async({index})=>{
      const delay=Math.min(200*(index+1),Math.max(0,deadlineAt-Date.now()));
      if(delay)await wait(delay);
      return {index,result:await settleBeforeDeadline(()=>fetchPage(pageUrls[index].url,{signal:controller.signal}))};
    }));
    for(const replacement of retried)results[replacement.index]=replacement;
  }
  const fulfilled=results
    .filter(({result})=>result.status==="fulfilled")
    .sort((a,b)=>a.index-b.index)
    .map(({result})=>result.value);
  if(!fulfilled.length)throw results.find(({result})=>result.status==="rejected")?.result.reason||new Error("Amazon Saudi search pages unavailable");
  return fulfilled;
}

const GENERAL_STORE_IDS = new Set(["amazon-sa","amazon-ae","aliexpress-cn","temu-global","walmart-us"]);
const CATEGORY_NEIGHBORS = {
  phone:["tablet","accessory"], tablet:["phone","laptop","accessory"], laptop:["desktop","monitor","accessory"],
  desktop:["laptop","monitor","accessory"], monitor:["desktop","laptop","accessory"], audio:["accessory","phone"],
  camera:["accessory"], tv:["appliance","audio"], console:["game","accessory"], game:["console","accessory"],
  clothing:["shoes","bag"], shoes:["clothing","sports","bag"], bag:["clothing","shoes"],
  beauty:["perfume"], perfume:["beauty"], jewelry:["watch"], watch:["jewelry"],
  furniture:["home","kitchen","office"], home:["furniture","kitchen"], kitchen:["home","furniture"],
  sports:["shoes","clothing"], toy:["baby","home"], baby:["toy"], office:["home","furniture"],
  grocery:["beauty","baby"], pet:["grocery"], appliance:["home","kitchen"], other:[],
};

function routeScore(store, intent, normalizedQuery) {
  const reasons = [];
  let score = 0;
  const category = intent.category || "other";
  const exactCategory = store.categories.includes(category);
  const neighbors = new Set(CATEGORY_NEIGHBORS[category] || []);
  const adjacentCategory = store.categories.some((item) => neighbors.has(item));
  const broad = store.categories.includes("*");
  const explicitBrand = (store.brands || []).some((brand) => (" " + normalizedQuery + " ").includes(" " + brand + " "));

  if (explicitBrand) { score += 120; reasons.push("brand"); }
  if (exactCategory) { score += 65; reasons.push("category"); }
  else if (adjacentCategory) { score += 24; reasons.push("adjacent_category"); }
  if (broad) { score += 32; reasons.push("general_marketplace"); }
  // Geography is a light trust/context signal only. It must never overpower
  // category/brand relevance or prevent stronger-priced global offers surfacing.
  const GCC_COUNTRIES = new Set(["AE","KW","QA","BH","OM"]);
  if (store.countryCode === "SA") { score += 8; reasons.push("geo_saudi"); }
  else if (GCC_COUNTRIES.has(store.countryCode)) { score += 5; reasons.push("geo_gcc"); }
  else { score += 2; reasons.push("geo_global"); }
  if (GENERAL_STORE_IDS.has(store.id)) score += 8;
  // Keep a strong Saudi general marketplace in the first acquisition wave. Health
  // may reorder sources, but must not hide a productive broad source behind a cursor.
  if (GENERAL_STORE_IDS.has(store.id) && store.countryCode === "SA") { score += 24; reasons.push("local_marketplace"); }

  // Unknown/general queries should still have useful broad-market coverage,
  // but specialist stores are not queried just to fill a quota.
  if (category === "other" && !explicitBrand) {
    if (broad) score += 30;
    else if (store.categories.includes("other")) { score += 12; reasons.push("general_specialist"); }
  }

  return { score, reasons, exactCategory, explicitBrand, broad };
}

export function routeFreeStorefronts(query, limit = Infinity, options = {}) {
  const normalizedQuery = normalizeSearchQuery(query);
  const intent = parseSearchIntent(normalizedQuery);
  const stable = options.stable === true;
  const routed = STORES
    .filter((store)=>store.enabled !== false)
    .map((store) => {
      const base = routeScore(store, intent, normalizedQuery);
      const health = sourceReliability.view(store.id);
      // Reliability changes order only. It must never omit a relevant source: a
      // temporarily unhealthy merchant can recover and may hold the best offer.
      const healthAdjustment = stable ? 0 : Math.max(-20, Math.min(20, health.adjustment));
      return {
        store,
        ...base,
        score: base.score + healthAdjustment,
        reliability: health,
        skippedForCooldown:false,
      };
    })
    .filter((entry) => entry.score > 0 && !entry.skippedForCooldown)
    .sort((a,b) =>
      // An explicitly named merchant is the shopper's strongest routing signal.
      // Preserve that intent before applying the local-marketplace safety net.
      (Number(b.explicitBrand) - Number(a.explicitBrand)) ||
      // Category specialists remain ahead of broad marketplaces. The safety net
      // prevents Amazon Saudi from falling behind lower-relevance sources; it
      // does not replace stores purpose-built for the requested category.
      (Number(b.exactCategory) - Number(a.exactCategory)) ||
      // Productive Saudi broad marketplaces must stay in the first acquisition wave.
      // This is a routing priority, not an early-stop rule: all other relevant
      // sources remain available through subsequent cursor passes.
      (Number(GENERAL_STORE_IDS.has(b.store.id) && b.store.countryCode === "SA") - Number(GENERAL_STORE_IDS.has(a.store.id) && a.store.countryCode === "SA")) ||
      b.score - a.score ||
      (stable ? 0 : b.reliability.reliability - a.reliability.reliability) ||
      a.store.id.localeCompare(b.store.id)
    );

  // For a recognized category, require specialist/broad relevance. For an unknown
  // category, keep only general stores and stores explicitly named by the shopper.
  const relevant = routed.filter((entry) =>
    intent.category
      ? (entry.exactCategory || entry.broad || entry.explicitBrand || entry.reasons.includes("adjacent_category"))
      : intent.discoveryMode === "brand"
        // A brand-only query must not be trapped inside generic marketplaces.
        // Category-specialist stores can hold cheaper local or international
        // stock even when the merchant registry does not explicitly list the brand.
        ? (entry.broad || entry.explicitBrand || entry.exactCategory || entry.reasons.includes("adjacent_category") || entry.store.categories.some(category => (intent.brand && (BRAND_CATEGORY_PRIORITIES[intent.brand] || []).includes(category))))
        : (entry.broad || entry.explicitBrand || entry.reasons.includes("general_specialist"))
  );

  const ranked = relevant.map((entry, index) => ({
    ...entry,
    rank:index + 1,
    category:intent.category || null,
    brand:intent.brand || null,
  }));
  return Number.isFinite(limit) ? ranked.slice(0, Math.max(0, Math.floor(limit))) : ranked;
}

export function selectedStores(query) {
  return routeFreeStorefronts(query).map((entry) => entry.store);
}

export async function searchFreeStorefrontById(storeId, query, options = {}) {
  const store = STORES.find((entry) => entry.id === storeId);
  if (!store) throw new Error("unknown storefront: " + storeId);
  const requestedPerStore = Number(options.perStore);
  const perStore = Number.isFinite(requestedPerStore) && requestedPerStore > 0 ? requestedPerStore : Infinity;
  return searchStore(store, query, perStore, options.matchingQuery || query, options.catalogLimit ?? perStore, options);
}

function virginAeCatalogUrl(query) {
  const q = normalizeSearchQuery(query);
  if (/\b(?:iphone|ايفون|آيفون)\b/.test(q)) return "https://app.virginmegastore.ae/en/tech/apple/iphone";
  if (/\b(?:airpods?|earpods?)\b/.test(q)) return "https://app.virginmegastore.ae/en/electronics-accessories/apple/airpods-earpods/c/n010808";
  if (/\b(?:apple watch|watch series|watch ultra)\b/.test(q)) return "https://app.virginmegastore.ae/en/electronics-accessories/apple/apple-watch/c/n010803";
  if (/\b(?:macbook|mac book)\b/.test(q)) return "https://app.virginmegastore.ae/en/selection/tech-selection/13-14-inch-macbooks/c/n996307";
  if (/\b(?:playstation|ps5|ps 5)\b/.test(q)) return "https://app.virginmegastore.ae/en/gaming/playstation-hardware-accessories/playstation-consoles/c/n050102";
  return null;
}

async function searchStore(store, query, perStore = Infinity, matchingQuery = query, catalogLimit = perStore, options = {}) {
  const started = Date.now();
  const searchUrl = store.search(query);
  try {
    let html = "";
    let searchPageFinalUrl = searchUrl;
    let searchDiagnostics = null;
    let primarySearchOffers = [];
    let primarySearchError = null;
    // HTML is the universal first acquisition layer. It is cheap, cache-friendly,
    // and often contains JSON-LD/SSR state with complete product cards.
    // Store-specific APIs are fallbacks only when the HTML path yields no offers.
    let htmlFirstAttempted = false;
    try {
      if (store.id === "amazon-sa") {
        const pageStart = Math.max(1, Math.min(8, Math.floor(Number(options.amazonPageStart) || 1)));
        const requestedPages = Math.floor(Number(options.amazonPageCount ?? options.amazonPages ?? process.env.AMAZON_SA_SEARCH_PAGES ?? 5) || 5);
        const pageCount = Math.max(1, Math.min(8 - pageStart + 1, requestedPages));
        const fulfilled = await fetchAmazonSearchPages(searchUrl,{pageStart,pageCount});
        html = fulfilled.map(page => page.html).join("\n");
        searchPageFinalUrl = fulfilled[0].finalUrl || searchUrl;
        searchDiagnostics = {
          ...searchPageDiagnostics(html, searchUrl, searchPageFinalUrl),
          pageStart,
          pagesRequested:pageCount,
          pagesFetched:fulfilled.length,
        };
      } else {
        const page = await fetchText(searchUrl,{signal:options.signal});
        html = page.html;
        searchPageFinalUrl = page.finalUrl || searchUrl;
        searchDiagnostics = searchPageDiagnostics(html, searchUrl, searchPageFinalUrl);
      }
      htmlFirstAttempted = true;
      if (searchDiagnostics?.blockedReason) primarySearchError = "Storefront blocked: " + searchDiagnostics.blockedReason;
    } catch (error) {
      htmlFirstAttempted = true;
      primarySearchError = error instanceof Error ? error.message : String(error);
      // Virgin's generic search endpoint can reject server-side clients while its
      // public category catalog remains rendered and price-bearing. Fall back to a
      // deterministic family catalog before declaring the provider unavailable.
      if (store.id === "virgin-ae") {
        const catalogUrl = virginAeCatalogUrl(query);
        if (catalogUrl) {
          try {
            const page = await fetchText(catalogUrl,{signal:options.signal});
            html = page.html;
            searchPageFinalUrl = page.finalUrl || catalogUrl;
            searchDiagnostics = { ...searchPageDiagnostics(html, catalogUrl, searchPageFinalUrl), acquisitionFallback:"virgin-category-catalog" };
            primarySearchError = null;
          } catch (catalogError) {
            primarySearchError += " | category fallback: " + (catalogError instanceof Error ? catalogError.message : String(catalogError));
          }
        }
      }
    }
    let htmlFirstOffers =
      store.id === "aliexpress-cn" ? extractAliExpressSearchOffers(html, query) :
      store.id === "temu-global" ? extractTemuSearchOffers(html, query) :
      store.id === "bestbuy-us" ? extractBestBuySearchOffers(html, query) :
      store.id === "carrefour-ae" ? extractCarrefourSearchOffers(html, query) :
      store.id === "samsung-sa" ? extractSamsungSearchOffers(html, query) :
      store.id === "amazon-sa" ? extractAmazonSearchOffers(html, query, "https://www.amazon.sa") :
      store.id === "ikea-sa" ? extractIkeaSearchOffers(html, query) :
      (() => {
        const embedded = extractEmbeddedSearchOffers(html, searchPageFinalUrl || searchUrl, store, query);
        const jsonLd = extractJsonLdSearchOffers(html, searchPageFinalUrl || searchUrl, store, query);
        const merged = []; const seen = new Set();
        for (const offer of [...embedded, ...jsonLd]) {
          const key = canonicalizeCandidateUrl(offer.sourceUrl || "") + "|" + Number(offer.price) + "|" + String(offer.currency || "");
          if (!seen.has(key)) { seen.add(key); merged.push(offer); }
        }
        return merged;
      })();
    if (!htmlFirstOffers.length) {
      if (store.id === "namshi-sa" && /\bshoes?\b/i.test(normalizeSearchQuery(query))) {
        try {
          const pages = await Promise.all([
            fetchText("https://www.namshi.com/saudi-en/women-shoes/?page=1",{signal:options.signal}),
            fetchText("https://www.namshi.com/saudi-en/men-shoes/?page=1",{signal:options.signal}),
          ]);
          html = pages.map(page=>page.html).join("\n");
          searchPageFinalUrl = pages[0]?.finalUrl || searchUrl;
          searchDiagnostics = {
            ...searchPageDiagnostics(html, searchUrl, searchPageFinalUrl),
            acquisitionFallback:"namshi-shoes-category",
          };
          primarySearchError = null;
          const embedded = extractEmbeddedSearchOffers(html, searchPageFinalUrl || searchUrl, store, query);
          const jsonLd = extractJsonLdSearchOffers(html, searchPageFinalUrl || searchUrl, store, query);
          const merged = []; const seen = new Set();
          for (const offer of [...embedded, ...jsonLd]) {
            const key = canonicalizeCandidateUrl(offer.sourceUrl || "") + "|" + Number(offer.price) + "|" + String(offer.currency || "");
            if (!seen.has(key)) { seen.add(key); merged.push(offer); }
          }
          htmlFirstOffers = merged;
        } catch (categoryError) {
          primarySearchError ||= categoryError instanceof Error ? categoryError.message : String(categoryError);
        }
      }
      if (store.id === "ikea-sa") {
        try { primarySearchOffers = await searchIkeaSik(query); primarySearchError = null; }
        catch (error) { primarySearchError ||= error instanceof Error ? error.message : String(error); }
      } else if (LANDMARK_BLOOMREACH[store.id]) {
        try { primarySearchOffers = await searchLandmarkBloomreach(store.id, query, catalogLimit); primarySearchError = null; }
        catch (bloomError) {
          try { primarySearchOffers = await searchLandmarkAlgolia(store.id, query, catalogLimit); primarySearchError = null; }
          catch (algoliaError) {
            const a = bloomError instanceof Error ? bloomError.message : String(bloomError);
            const b = algoliaError instanceof Error ? algoliaError.message : String(algoliaError);
            primarySearchError = primarySearchError ? primarySearchError + " | fallback: " + a + " | " + b : a + " | fallback: " + b;
          }
        }
      }
    }
    primarySearchError ||= primarySearchOffers.paginationError || null;
    if (!htmlFirstOffers.length && !primarySearchOffers.length && !html) {
      // A failed HTML-first transport remains a real provider failure unless a
      // fallback produced verified offers. Never mask it as an empty catalog.
      if (primarySearchError && store.id !== "ikea-sa" && !LANDMARK_BLOOMREACH[store.id]) {
        throw new Error(primarySearchError);
      }
      try {
        if (store.id === "amazon-sa") {
          const pageStart = Math.max(1, Math.min(8, Math.floor(Number(options.amazonPageStart) || 1)));
          const requestedPages = Math.floor(Number(options.amazonPageCount ?? options.amazonPages ?? process.env.AMAZON_SA_SEARCH_PAGES ?? 5) || 5);
          const pageCount = Math.max(1, Math.min(8 - pageStart + 1, requestedPages));
          const fulfilled = await fetchAmazonSearchPages(searchUrl,{pageStart,pageCount});
          html = fulfilled.map((page) => page.html).join("\n");
          searchPageFinalUrl = fulfilled[0].finalUrl || searchUrl;
          searchDiagnostics = {
            ...searchPageDiagnostics(html, searchUrl, searchPageFinalUrl),
            pageStart,
            pagesRequested:pageCount,
            pagesFetched:fulfilled.length,
          };
        } else {
          const page = await fetchText(searchUrl,{signal:options.signal});
          html = page.html;
          searchPageFinalUrl = page.finalUrl || searchUrl;
          searchDiagnostics = searchPageDiagnostics(html, searchUrl, searchPageFinalUrl);
        }
        if (searchDiagnostics?.blockedReason && !primarySearchError) {
          primarySearchError = "Storefront blocked: " + searchDiagnostics.blockedReason;
        }
      }
      catch (error) {
        if (!primarySearchError) throw error;
        // Preserve the real primary-provider failure (e.g. Algolia/SIK) instead
        // of hiding it behind a secondary storefront-page 403.
        return {
          store,
          searchUrl,
          candidates:0,
          offers:[],
          failures:1,
          diagnostics:{
            searchPage:null,
            primarySearchError,
            candidateSamples:[],
            failureSamples:[],
            unpricedSamples:[],
          },
        };
      }
    }
    const candidateLimit = store.id === "amazon-sa" ? Infinity : perStore;
    const links = html ? extractProductLinks(html, searchUrl, store, query, candidateLimit) : [];
    const jsonLdOffers = html ? extractJsonLdSearchOffers(html, searchPageFinalUrl || searchUrl, store, query) : [];
    const directSearchOffers = htmlFirstOffers.length ? htmlFirstOffers : primarySearchOffers.length ? primarySearchOffers : jsonLdOffers;
    // Search-result offers are already price-verified. Do not fan out into slow product pages.
    const resolutionLinks = directSearchOffers.length ? [] : links;
    const settled = await Promise.allSettled(resolutionLinks.map((candidate) => resolveProductUrl(candidate.url,{signal:options.signal})));
    const resolvedOffers = settled
      .filter((result) => result.status === "fulfilled" && Number.isFinite(result.value?.productPrice))
      .map((result) => ({
        ...result.value,
        provider:"free-storefronts",
        providerMarket:store.id,
        merchant:result.value.merchant || store.name,
        merchantCountryCode:store.countryCode,
        merchantCountryNameAr:store.countryNameAr,
        canShipToSaudi:store.countryCode === "SA" ? true : result.value.canShipToSaudi,
        isLocal:store.countryCode === "SA",
        exactMatch:false,
        matchConfidence:0,
        sourceMeta:{
          ...(result.value.sourceMeta || {}),
          storefrontSearch:store.name,
          freeDiscovery:true,
          searchUrl,
        },
      }));
    const directOffers = (await Promise.all(directSearchOffers.map(async (item) => {
      const converted = await moneyToSAR(item.price, item.currency).catch(() => null);
      if (!converted) return null;
      return {
        provider:"free-storefronts",
        providerMarket:store.id,
        merchant:store.name,
        merchantCountryCode:store.countryCode,
        merchantCountryNameAr:store.countryNameAr,
        canShipToSaudi:store.countryCode === "SA" ? true : null,
        isLocal:store.countryCode === "SA",
        exactMatch:false,
        matchConfidence:0.9,
        sourceUrl:item.sourceUrl,
        image:item.image,
        title:item.title,
        productType:item.productType || null,
        specs:{ modelNumber:item.productId },
        condition:"new",
        availability:"unknown",
        productPrice:converted.value,
        originalProductPrice:item.price,
        shipping:null,
        importCost:null,
        tax:null,
        mandatoryFees:0,
        discount:0,
        currency:"SAR",
        originalCurrency:item.currency,
        deliveryDays:null,
        observedAt:new Date().toISOString(),
        dataKind:"live",
        fx:{ rate:converted.rate, source:converted.source, observedAt:converted.observedAt },
        sourceMeta:{ storefrontSearch:store.name, freeDiscovery:true, searchUrl, searchPageStructuredPrice:true },
      };
    }))).filter(Boolean);
    const allOffers = [...directOffers, ...resolvedOffers];
    const {offers:filteredOffers,queryFilter} = filterQueryOffers(matchingQuery, allOffers);
    const queryFilterSamples = allOffers
      .filter((offer) => !filteredOffers.includes(offer))
      .slice(0,5)
      .map((offer) => ({
        title:offer.title || null,
        productType:offer.productType || null,
        sourceUrl:offer.sourceUrl || null,
        productPrice:offer.productPrice ?? null,
        reasons:queryMatchReasons(matchingQuery, offer),
        assessment:assessOfferMatch(matchingQuery, offer),
      }));
    // Direct search-card extraction is cheap and already price-verified. Keep the
    // full Amazon result set so API/UI pagination can expose it instead of
    // silently truncating the merchant to the generic per-store cap.
    // Search-card extraction is already cheap and price-verified. Preserve the full
    // result set for every storefront so UI/API pagination can expose all relevant
    // offers instead of silently truncating recall after successful HTML extraction.
    // Generic per-store limits remain relevant only to expensive PDP resolution.
    const offers = directSearchOffers.length
      ? filteredOffers
      : filteredOffers.slice(0, perStore);
    const failures = settled.filter((result) => result.status === "rejected").length;
    const verificationBlocked = links.length > 0 && offers.length === 0 && failures === links.length;
    sourceReliability.record(store.id, {
      transportOk: !verificationBlocked,
      offers: offers.length,
      latencyMs: Date.now() - started,
      relevant: true,
    });
    return {
      store,
      searchUrl,
      candidates:directSearchOffers.length || links.length,
      offers,
      failures,
      diagnostics:{
        queryFilter,
        queryFilterSamples,
        searchPage:searchDiagnostics || (html ? searchPageDiagnostics(html, searchUrl, searchPageFinalUrl) : null),
        primarySearchError,
        candidateSamples:(directSearchOffers.length
          ? directSearchOffers.slice(0,5).map((item)=>item.sourceUrl)
          : links.slice(0,5).map((candidate)=>candidate.url)),
        failureSamples:settled
          .map((result,index)=>({result,candidate:resolutionLinks[index]}))
          .filter(({result})=>result.status === "rejected")
          .slice(0,5)
          .map(({result,candidate})=>({
            url:candidate?.url || null,
            error:result.reason instanceof Error ? result.reason.message : String(result.reason || "resolution_failed"),
          })),
        unpricedSamples:settled
          .map((result,index)=>({result,candidate:resolutionLinks[index]}))
          .filter(({result})=>result.status === "fulfilled" && !Number.isFinite(result.value?.productPrice))
          .slice(0,3)
          .map(({result,candidate})=>({
            url:candidate?.url || null,
            title:result.value?.title || null,
            originalProductPrice:result.value?.originalProductPrice ?? null,
            originalCurrency:result.value?.originalCurrency || null,
            strategy:result.value?.extraction?.strategy || null,
            availableStrategies:result.value?.extraction?.availableStrategies || [],
            domainAdapterId:result.value?.extraction?.domainAdapterId || null,
          })),
      },
    };
  } catch (error) {
    sourceReliability.record(store.id, {
      transportOk:false,
      offers:0,
      latencyMs:Date.now() - started,
      relevant:true,
    });
    throw error;
  }
}

export function configuredFreeStorefronts() {
  return STORES
    .filter((store)=>store.enabled !== false)
    .map(({id,name,countryCode,countryNameAr}) => ({id,name,countryCode,countryNameAr}));
}

export function quarantinedFreeStorefronts() {
  return STORES
    .filter((store)=>store.enabled === false)
    .map(({id,name,countryCode,countryNameAr,disabledReason}) => ({id,name,countryCode,countryNameAr,disabledReason}));
}

export async function searchFreeStorefronts(query, options = {}) {
  // Search a broad merchant set, but bound product-page fan-out per merchant.
  // Diversity comes from more stores, not dozens of serial product resolutions inside one store.
  const requestedStoreLimit = Number(options.storeLimit);
  const storeLimit = Number.isFinite(requestedStoreLimit) && requestedStoreLimit >= 0 ? Math.floor(requestedStoreLimit) : 16;
  const storeOffset = Math.max(0, Math.floor(Number(options.storeOffset) || 0));
  const excludedStoreIds = new Set(Array.isArray(options.excludeStoreIds) ? options.excludeStoreIds : []);
  const routes = routeFreeStorefronts(
      query,
      storeOffset + storeLimit + excludedStoreIds.size,
      {stable:options.stableRouting === true}
    )
    .filter((entry) => !excludedStoreIds.has(entry.store.id))
    .slice(storeOffset, storeOffset + storeLimit);
  const stores = routes.map((entry) => entry.store);
  const requestedProductPageLimit = Number(options.productPageLimit ?? options.perStore);
  const productPageLimit = Number.isFinite(requestedProductPageLimit) && requestedProductPageLimit > 0
    ? Math.min(20, Math.floor(requestedProductPageLimit))
    : 4;
  const requestedCatalogLimit = Number(options.catalogLimit);
  const catalogLimit = Number.isFinite(requestedCatalogLimit) && requestedCatalogLimit > 0
    ? Math.floor(requestedCatalogLimit)
    : Infinity;
  const storeDeadlineMs = Math.max(1500, Math.min(7500, Number(options.storeDeadlineMs) || 6500));
  const withDeadline = (operation, storeId) => {
    const controller=new AbortController();
    let timeoutId;
    const deadline=new Promise((_,reject)=>{
      timeoutId=setTimeout(()=>{
        const error=new Error("store_deadline_exceeded:"+storeId);
        controller.abort(error);
        reject(error);
      },storeDeadlineMs);
    });
    return Promise.race([Promise.resolve().then(()=>operation(controller.signal)),deadline])
      .finally(()=>clearTimeout(timeoutId));
  };
  const settled = await Promise.allSettled(stores.map((store) =>
    withDeadline((signal)=>searchStore(store, query, productPageLimit, options.matchingQuery || query, catalogLimit, {...options,signal}), store.id)
  ));
  const offers = [];
  const errors = [];
  const diagnostics = [];

  settled.forEach((result, index) => {
    const store = stores[index];
    if (result.status === "fulfilled") {
      offers.push(...result.value.offers);
      diagnostics.push({ store:store.id, routeRank:routes[index]?.rank, routeScore:routes[index]?.score, routeReasons:routes[index]?.reasons || [], reliability:sourceReliability.view(store.id), candidates:result.value.candidates, verifiedOffers:result.value.offers.length, failures:result.value.failures });
      if(result.value.diagnostics?.primarySearchError) errors.push({market:store.id,error:result.value.diagnostics.primarySearchError});
      if (!result.value.offers.length) errors.push({ market:store.id, error:"No verified structured-price product pages found" });
    } else {
      errors.push({ market:store.id, error:result.reason?.message || String(result.reason) });
      diagnostics.push({ store:store.id, routeRank:routes[index]?.rank, routeScore:routes[index]?.score, routeReasons:routes[index]?.reasons || [], reliability:sourceReliability.view(store.id), candidates:0, verifiedOffers:0, failures:1 });
    }
  });

  return {
    provider:"free-storefronts",
    ok:offers.length > 0,
    searchedMarkets:stores.map(({id,countryCode,countryNameAr}) => ({id,countryCode,countryNameAr})),
    offers,
    errors,
    diagnostics,
  };
}
