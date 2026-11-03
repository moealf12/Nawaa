// Pure, source-scoped YesStyle listing evidence. No network activity.
// A USD listing price and a Saudi shipping policy are NOT a Saudi offer.
import {load} from "cheerio";

const ORIGIN="https://www.yesstyle.com";
const MAX_HTML=4_000_000;
const MAX_CARDS=120;
const clean=x=>String(x??"").replace(/[\u00a0\u202f\s]+/g," ").trim();

export function yesstyleSearchUrl(query){
  const q=clean(query);
  if(!q||q.length>160||/[\u0000-\u001f\u007f]/.test(q))
    throw new Error("YESSTYLE_INVALID_QUERY");
  const u=new URL("/en/list.html",ORIGIN);
  u.searchParams.set("bpt","48");
  u.searchParams.set("q",q);
  return u.href;
}
export function verifyYesstyleSearchContext({query,requestedUrl,finalUrl}={}){
  try{
    const q=clean(query);
    const requested=new URL(requestedUrl),actual=new URL(finalUrl||requestedUrl);
    return Boolean(q)&&[requested,actual].every(u=>
      u.origin===ORIGIN && u.pathname==="/en/list.html" &&
      !u.username&&!u.password && !u.port &&
      clean(u.searchParams.get("q"))===q);
  }catch{return false;}
}
export function parseYesstyleUSD(input){
  const s=clean(input);
  if(!/^US\$\s*(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}$/.test(s))return null;
  const n=Number(s.replace(/^US\$\s*/,"").replaceAll(",",""));
  return Number.isFinite(n)&&n>0&&n<1_000_000?Math.round(n*100)/100:null;
}
export function yesstyleProductIdentity(input){
  try{
    const url=new URL(input,ORIGIN);
    const m=url.pathname.match(/^\/en\/[a-z0-9-]+\/info\.html\/pid\.(\d{8,12})\/?$/i);
    if(url.origin!==ORIGIN||url.username||url.password||url.port||!m)return null;
    url.search="";url.hash="";
    return {productId:m[1],url:url.href};
  }catch{return null;}
}
function productImage(raw){
  try{
    const u=new URL(raw);
    return u.protocol==="https:" &&
      ["d1flfk77wl2xk4.cloudfront.net","ddvql06zg3s2o.cloudfront.net"].includes(u.hostname) &&
      u.pathname.startsWith("/Assets/")&&!u.username&&!u.password&&!u.port
      ?u.href:null;
  }catch{return null;}
}
export function extractYesstyleSearchCards(html,query,{requestedUrl,finalUrl,maxCards=100}={}){
  const d={status:"UNVERIFIED",market:"US_DISPLAY",currency:"USD",
    cardsSeen:0,accepted:0,rejected:0,conflicts:0,
    shippingToSaudiVerified:false,customerPublishable:false};
  const end=status=>({candidates:[],diagnostics:{...d,status}});
  if(!verifyYesstyleSearchContext({query,requestedUrl,finalUrl}))
    return end("SEARCH_CONTEXT_MISMATCH");
  if(typeof html!=="string"||!html||html.length>MAX_HTML)
    return end("HTML_MISSING_OR_OVERSIZED");
  const $=load(html);
  const h1=clean($("main h1").first().text()).replace(/^["“]|["”]$/g,"");
  if(h1.toLowerCase()!==clean(query).toLowerCase())
    return end("QUERY_HEADER_MISMATCH");
  const listing=$('main section[class*="__imageGridWrapper"]').first();
  if(!listing.length)return end("LISTING_MISSING");
  const take=Math.max(0,Math.min(MAX_CARDS,Number.isFinite(maxCards)?Math.floor(maxCards):100));
  const seen=new Map(),conflicts=new Set();
  listing.children('a[class*="__itemContainer"]').slice(0,take).each((_,el)=>{
    d.cardsSeen++;
    const a=$(el),identity=yesstyleProductIdentity(a.attr("href"));
    const title=clean(a.find('[class*="__itemTitle"]').first().text());
    const priceWrap=a.find('[class*="__itemPriceWrapper"]').first();
    // The displayed/current price uses a <b> within the card price wrapper.
    // Promotional banners, reviews and strike-through prices never qualify.
    const price=parseYesstyleUSD(priceWrap.find('b[class*="__itemPrice"]').first().text());
    const originalRaw=clean(priceWrap.find('span[class*="__itemSellPrice"]').first().text());
    const original=originalRaw?parseYesstyleUSD(originalRaw):null;
    if(!identity||!title||title.length>360||price===null||
       (originalRaw&&original===null)||(original!==null&&original<price)){
      d.rejected++;return;
    }
    const candidate={
      productId:identity.productId,sourceUrl:identity.url,title,
      image:productImage(a.find('img[src*="/Assets/"]').first().attr("src")),
      price,listPrice:original,currency:"USD",
      variantId:null,availability:"unknown",canShipToSaudi:null,
      shippingToSaudiVerified:false,priceEvidence:"VISIBLE_SEARCH_CARD_USD",
    };
    const past=seen.get(identity.productId);
    if(past&&(past.price!==candidate.price||past.title!==candidate.title||
       past.sourceUrl!==candidate.sourceUrl))
      {conflicts.add(identity.productId);d.conflicts++;}
    else if(!past)seen.set(identity.productId,candidate);
  });
  for(const id of conflicts)seen.delete(id);
  d.accepted=seen.size;
  return {candidates:[...seen.values()],
    diagnostics:{...d,status:d.cardsSeen?"PARSED_USD_SEARCH":"NO_VISIBLE_CARDS"}};
}
