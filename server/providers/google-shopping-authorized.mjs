// Experimental user-authorized Google Shopping HTML extractor.
// Not registered as a provider: no DB writes, SSE, price ranking or crawling.
// Only co-located product title + image + explicit price + external merchant URL.
import {load} from "cheerio";

const SHOPPING_ORIGIN="https://www.google.com";
const MAX_CARDS=30;
const MAX_HTML_BYTES=1_200_000;
const IMAGE_HOST_EXCLUDED=/(^|\.)(?:google\.com|google\.co\.[a-z]{2}|google-analytics\.com)$/i;
const BLOCK_MARKERS=[
  /update your browser to continue/i,
  /our systems have detected unusual traffic/i,
  /verify (?:you are|that you are) (?:a )?human/i,
  /please enable javascript/i,
  /captcha/i,
];

function trimText(v,n=260){
  return typeof v==="string"?v.normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f]/g," ").replace(/\s+/gu," ").trim().slice(0,n):"";
}
function absHttps(raw,base=SHOPPING_ORIGIN){
  if(typeof raw!=="string"||raw.length>3000)return null;
  try{
    const u=new URL(raw,base);
    if(u.protocol!=="https:"||u.username||u.password||u.port&&u.port!=="443")return null;
    u.hash="";
    return u;
  }catch{return null;}
}
export function merchantProductLink(raw,depth=0){
  if(depth>2)return null;
  const u=absHttps(raw);
  if(!u)return null;
  if(u.hostname==="www.google.com"||u.hostname==="google.com"){
    if(u.pathname!=="/url")return null;
    const target=u.searchParams.get("url")||u.searchParams.get("q");
    if(!target)return null;
    return merchantProductLink(target,depth+1);
  }
  if(u.hostname.endsWith(".google.com")||u.hostname.endsWith(".googleusercontent.com")||
    u.hostname.endsWith(".gstatic.com")||u.hostname.endsWith(".googleadservices.com")||
    u.hostname==="googleadservices.com"||u.hostname==="google.com"||
    u.hostname==="accounts.google.com"||u.hostname.endsWith(".googlesyndication.com")||
    u.hostname==="googleusercontent.com"||u.hostname==="gstatic.com")
    return null;
  if(/(^|\.)localhost$|^127\.|^\[|^10\.|^172\.(1[6-9]|2\d|3[01])\.|^192\.168\.|\.internal$|\.local$/.test(u.hostname))
    return null;
  return u.href;
}
export function productImageUrl(raw){
  const u=absHttps(raw);
  if(!u||IMAGE_HOST_EXCLUDED.test(u.hostname))return null;
  if(/^https?:\/\/(?:127\.|10\.|192\.168\.)/.test(u.href))return null;
  return u.href;
}
function westernizeNumerals(v){
  return String(v).replace(/[٠-٩]/g,ch=>String(ch.codePointAt(0)-0x660))
    .replace(/[۰-۹]/g,ch=>String(ch.codePointAt(0)-0x6f0))
    .replaceAll("٬",",").replaceAll("٫",".");
}
function explicitMoney(raw){
  const s=westernizeNumerals(trimText(raw,100));
  if(!s||/(?:\/mo\b|per month|شهري|تقسيط)/i.test(s))return null;
  const currencies=[
    ["SAR",/(?:SAR|ر\.?\s*س\.?|ريال\s*سعودي)/iu],
    ["AED",/(?:AED|د\.?\s*إ\.?|درهم\s*إماراتي)/iu],
    ["USD",/(?:USD|US\s*\$|\$)/iu],
    ["EUR",/(?:EUR|€)/iu],
    ["GBP",/(?:GBP|£)/iu],
  ];
  const found=currencies.filter(([,rx])=>rx.test(s));
  if(found.length!==1)return null;
  const m=s.match(/(?:\d{1,3}(?:[,،]\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/u);
  if(!m)return null;
  const n=Number(m[0].replace(/[,،]/g,""));
  if(!Number.isFinite(n)||n<=0||n>=100_000_000)return null;
  return {displayedPrice:s,currency:found[0][0],numericAmount:n};
}
function jsonldMoney(raw,ccy){
  const n=Number(raw);
  if(!Number.isFinite(n)||n<=0||n>=100_000_000||!/^(SAR|AED|USD|EUR|GBP)$/.test(String(ccy)))return null;
  return {displayedPrice:String(n)+" "+ccy,currency:String(ccy),numericAmount:n};
}
function nameFrom(node){return trimText(node?.name||node?.title||"",240);}
function jsonldObjects(input,depth=0){
  if(depth>8||!input||typeof input!=="object")return [];
  if(Array.isArray(input))return input.slice(0,80).flatMap(x=>jsonldObjects(x,depth+1));
  const out=[input];
  for(const key of ["@graph","itemListElement","item","mainEntity","hasPart"])
    if(input[key])out.push(...jsonldObjects(input[key],depth+1));
  return out;
}
function isProductType(item){
  const t=item?.["@type"];
  return typeof t==="string"?t.split("/").pop()==="Product":
    Array.isArray(t)&&t.some(x=>typeof x==="string"&&x.split("/").pop()==="Product");
}
function collectStructured($){
  const cards=[];
  $('script[type="application/ld+json"]').slice(0,50).each((_,el)=>{
    const text=$(el).html()||"";
    if(text.length>200_000)return;
    let data;
    try{data=JSON.parse(text);}catch{return;}
    for(const node of jsonldObjects(data).filter(isProductType).slice(0,80)){
      const title=nameFrom(node);
      const imageRaw=Array.isArray(node.image)?node.image[0]:node.image;
      const image=productImageUrl(typeof imageRaw==="object"?imageRaw?.url:imageRaw);
      const offers=Array.isArray(node.offers)?node.offers.slice(0,10):[node.offers];
      for(const offer of offers){
        if(!offer||typeof offer!=="object")continue;
        const merchantUrl=merchantProductLink(offer.url||node.url);
        const money=jsonldMoney(offer.price,offer.priceCurrency);
        if(title.length<4||!image||!merchantUrl||!money)continue;
        cards.push({title,image,merchantUrl,...money,
          merchantName:trimText(offer.seller?.name||"",100)||null,
          evidenceType:"structured_data_product_offer",verifiedMerchantPdp:false,
          rankableInNawaa:false});
      }
    }
  });
  return cards;
}
function collectDom($){
  const cards=[];
  const containers='[data-docid],[data-product-id],[data-offer-id],article,[role="listitem"],li';
  $(containers).slice(0,350).each((_,node)=>{
    const el=$(node);
    const title=trimText(el.find("h3,h4,[data-testid*=title],.product-title").first().text(),240);
    if(title.length<4)return;
    const imageRaw=el.find("img").first().attr("src")||
      el.find("img").first().attr("data-src");
    const image=productImageUrl(imageRaw);
    if(!image)return;
    let merchantUrl=null;
    el.find("a[href]").slice(0,20).each((_,a)=>{
      if(merchantUrl)return;
      merchantUrl=merchantProductLink($(a).attr("href"));
    });
    if(!merchantUrl)return;
    const attrs=el.find('[data-testid*=price],[aria-label*="SAR"],[aria-label*="ر.س"],.price').slice(0,12);
    let money=null;
    attrs.each((_,p)=>{
      if(money)return;
      money=explicitMoney($(p).text())||explicitMoney($(p).attr("aria-label")||"");
    });
    if(!money){
      const text=trimText(el.text(),700);
      const fragment=text.match(/(?:SAR|AED|USD|EUR|GBP|ر\.?\s*س\.?|د\.?\s*إ\.?)\s*[\d,.،]+|[\d,.،]+\s*(?:SAR|AED|USD|EUR|GBP|ر\.?\s*س\.?|د\.?\s*إ\.?)/iu);
      if(fragment)money=explicitMoney(fragment[0]);
    }
    if(!money)return;
    cards.push({title,image,merchantUrl,...money,
      merchantName:null,evidenceType:"colocated_search_card",verifiedMerchantPdp:false,
      rankableInNawaa:false});
  });
  return cards;
}
export function extractAuthorizedGoogleShoppingHtml(html,{query,sourceUrl,observedAt=new Date().toISOString()}={}){
  const q=trimText(query,140);
  const url=absHttps(sourceUrl);
  if(!q||q.length<2||!url||url.origin!==SHOPPING_ORIGIN)
    return {status:"INVALID_PROBE_CONTEXT",cards:[],rejected:0};
  if(typeof html!=="string"||Buffer.byteLength(html)>MAX_HTML_BYTES)
    return {status:"HTML_UNAVAILABLE",cards:[],rejected:0};
  const $=load(html);
  const pageTitle=trimText($("title").first().text(),120);
  const text=$("body").text().slice(0,2000);
  if(BLOCK_MARKERS.some(p=>p.test(pageTitle)||p.test(text))){
    return {status:"PAGE_INTERSTITIAL_OR_ACCESS_CHALLENGE",
      cards:[],rejected:0,pageTitle};
  }
  const raw=[...collectStructured($),...collectDom($)];
  const seen=new Set(),cards=[];let rejected=0;
  for(const c of raw){
    const key=[c.merchantUrl,c.title,c.numericAmount,c.currency].join("|");
    if(seen.has(key)){rejected++;continue;}
    seen.add(key);
    cards.push({
      ...c,query:q,observedAt,
      source:"google-shopping-direct",
      evidence:"search_html_observation",
      verifiedPrice:false,verifiedSku:false,merchantDeliveryToSaudiVerified:null,
      totalLandedCostSar:null,customerOffer:false,
    });
    if(cards.length>=MAX_CARDS)break;
  }
  return {status:cards.length?"UNVERIFIED_CANDIDATES":"NO_COMPLETE_FOUR_FIELD_CARDS",
    cards,rejected,pageTitle,rawCandidates:raw.length,verifiedPrices:0,
    publishableOffers:0,completeCards:cards.length};
}
export function authorizedGoogleShoppingSearchUrl(query){
  const q=trimText(query,140);
  if(Array.from(q).length<2||Array.from(q).length>140||/^(?:https?:\/\/|www\.)/iu.test(q)||
    /[\u202a-\u202e]/u.test(q))return null;
  const u=new URL(SHOPPING_ORIGIN+"/search");
  u.searchParams.set("tbm","shop");u.searchParams.set("q",q);
  u.searchParams.set("gl","sa");u.searchParams.set("hl","ar");
  return u.href;
}
