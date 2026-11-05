// Jarir-style first-party HTML / JSON-LD evidence, and Noon-UAE-style HTML
// session evidence. Analysis only, no offer publication or inferred landed cost.
import {load} from "cheerio";

const MAX_HTML = 2_000_000;
const PRODUCT_LINK = /^\/offer\/([0-9]{6,20})\.html$/;
export function canonical1688OfferUrl(raw, base = "https://s.1688.com") {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  try {
    const u = new URL(raw, base);
    if (u.protocol !== "https:" || u.username || u.password ||
        u.hostname.toLowerCase() !== "detail.1688.com") return null;
    const match = PRODUCT_LINK.exec(u.pathname);
    return match ? "https://detail.1688.com/offer/" + match[1] + ".html" : null;
  } catch {return null;}
}

function objNodes(data) {
  const result = [];
  const stack = [{node:data, depth:0}];
  while (stack.length && result.length < 120) {
    const {node,depth}=stack.pop();
    if (!node || depth>5 || typeof node!=="object") continue;
    if (Array.isArray(node)) {
      for (const child of node.slice(0,120)) stack.push({node:child,depth:depth+1});
    } else {
      if (node["@type"]==="Product" || (Array.isArray(node["@type"]) && node["@type"].includes("Product")))
        result.push(node);
      for(const key of ["@graph","itemListElement","item"]) if (node[key])
        stack.push({node:node[key],depth:depth+1});
    }
  }
  return result;
}

export function inspect1688SearchEvidence(html, {contentType="text/html", status=200, query=""} = {}) {
  const raw = typeof html==="string"?html:"";
  const bytes = Buffer.byteLength(raw);
  const empty = {state:"NOT_ATTESTED",htmlBytes:bytes,links:0,
    jsonLdProducts:0, currencyBoundPriceCandidates:0,
    independentlyVerifiedUnitPrices:0, publishedOffers:0,
    hydrationSignals:[], challenge:false};
  if (status!==200) return {...empty,state:"HTTP_"+status};
  if (!/^text\/html|^application\/xhtml\+xml/i.test(contentType))
    return {...empty,state:"NON_HTML"};
  if (!raw || bytes>MAX_HTML) return {...empty,state:raw?"HTML_TOO_LARGE":"EMPTY_HTML"};
  const challenge=/(?:punish|cloud_ip_bl|请登录|安全验证|人机验证|captcha|verify your identity|访问异常|滑块验证)/i.test(raw);
  const $ = load(raw);
  const urls = new Set();
  $("a[href]").slice(0,2500).each((_,element)=>{
    const url=canonical1688OfferUrl($(element).attr("href"));
    if (url) urls.add(url);
  });
  const priceKeys = new Set();
  const productKeys = new Set();
  let jsonParseErrors=0;
  $('script[type="application/ld+json"]').slice(0,25).each((_,element)=>{
    const script=$(element).html()||"";
    if (!script || script.length>250_000) return;
    let payload;
    try{payload=JSON.parse(script);}catch{jsonParseErrors++;return;}
    for(const product of objNodes(payload)) {
      const ownUrl=canonical1688OfferUrl(product.url||product["@id"]);
      if (!ownUrl || !urls.has(ownUrl)) continue;
      productKeys.add(ownUrl);
      const list=Array.isArray(product.offers)?product.offers:[product.offers];
      if (list.length!==1 || !list[0] || typeof list[0]!=="object") continue;
      const offer=list[0];
      const owner=canonical1688OfferUrl(offer.url);
      if (owner!==ownUrl || offer.priceCurrency!=="CNY") continue;
      // A search JSON-LD price is a *candidate*; it has not proved MOQ=1 or PDP parity.
      const value=String(offer.price||"");
      if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(value) || Number(value)<=0) continue;
      priceKeys.add(ownUrl);
    }
  });
  const hydrationSignals=[];
  const scripts=$("script").slice(0,100);
  const scriptStrings=scripts.map((_,x)=>($(x).html()||"").slice(0,200000)).get().join(" ");
  for (const [label,pattern] of [
    ["offerresultData",/offerresultData/],["__NEXT_DATA__",/__NEXT_DATA__/],
    ["mtop",/mtop[.]/],["priceRange",/priceRange|priceTiers/],
  ]) if (pattern.test(scriptStrings)) hydrationSignals.push(label);
  return {
    state:challenge?"CHALLENGE_OR_LOGIN_SHELL":urls.size?"UNPRICED_CATALOG_LINKS_OBSERVED":"NO_PRODUCT_LINK_EVIDENCE",
    htmlBytes:bytes,links:urls.size,
    jsonLdProducts:productKeys.size,
    currencyBoundPriceCandidates:priceKeys.size,
    independentlyVerifiedUnitPrices:0, publishedOffers:0,
    jsonParseErrors,
    hydrationSignals,
    challenge,
    queryLength:String(query||"").length,
  };
}
