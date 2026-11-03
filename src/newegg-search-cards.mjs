// Native Newegg search-card evidence for NAWAA.
// Does not fetch, evade restrictions, or assert Saudi delivery.
const ORIGIN="https://www.newegg.com";
const SKU=/^N82E168\d{8}$/i;
const MAX_HTML=4_000_000;
const MAX_CARDS=160;
const unescape=s=>String(s||"").replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{
  const v=n[0].toLowerCase()==="x"?parseInt(n.slice(1),16):Number(n);
  return Number.isInteger(v)&&v>0&&v<=0x10ffff&&!(v>=0xd800&&v<=0xdfff)?String.fromCodePoint(v):"";
}).replace(/&quot;/gi,'"').replace(/&apos;|&#39;/gi,"'").replace(/&amp;/gi,"&").replace(/&nbsp;/gi," ").replace(/&lt;/gi,"<").replace(/&gt;/gi,">");
const strip=s=>unescape(String(s||"").replace(/<[^>]*>/g," ")).replace(/\s+/g," ").trim();
function attr(tag,key){
  const rx=new RegExp("\\s"+key+"\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')","i");
  const m=String(tag||"").match(rx);
  return unescape(m?.[1]??m?.[2]??"");
}
function tagWithClass(block,tag,className){
  const rx=new RegExp("<"+tag+"\\b(?=[^>]*\\bclass\\s*=[\"'][^\"']*\\b"+className+"\\b)[^>]*>","i");
  return rx.exec(block);
}
function productUrl(raw){
  try{
    const url=new URL(raw,ORIGIN);
    if(url.origin!==ORIGIN||url.username||url.password||url.port)return null;
    const id=url.pathname.match(/\/p\/(N82E168\d{8})(?:\/|$)/i)?.[1]?.toUpperCase();
    if(!id||!SKU.test(id))return null;
    return {id,url:ORIGIN+url.pathname.replace(/\/$/,"")};
  }catch{return null;}
}
function imageFromCard(card){
  const link=tagWithClass(card,"a","goods-img");
  if(!link)return null;
  const img=card.slice(link.index+link[0].length,link.index+2500).match(/<img\b[^>]*>/i)?.[0];
  try{
    const url=new URL(attr(img,"src")||attr(img,"data-src"));
    return url.protocol==="https:"&&/^c\d+\.neweggimages\.com$/i.test(url.hostname)?url.href:null;
  }catch{return null;}
}
function priceFromCard(card){
  const root=tagWithClass(card,"div","goods-price-current");
  if(!root)return null;
  const remaining=card.slice(root.index+root[0].length);
  const end=remaining.indexOf("</div>");
  if(end<0||end>1400)return null;
  const block=remaining.slice(0,end);
  const currency=tagWithClass(block,"span","goods-price-symbol");
  if(!currency||strip(block.slice(currency.index+currency[0].length).split("</span>")[0])!=="$")return null;
  const value=tagWithClass(block,"span","goods-price-value");
  if(!value)return null;
  const raw=strip(block.slice(value.index+value[0].length).split("</span>")[0]).replace(/\s/g,"");
  if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{2})?$/.test(raw))return null;
  const n=Number(raw.replace(/,/g,""));
  return Number.isFinite(n)&&n>0&&n<10_000_000?n:null;
}
export function neweggSearchUrl(query){
  const q=String(query??"").trim().replace(/\s+/g," ");
  if(!q||q.length>160||/[\u0000-\u001f\u007f]/.test(q))throw new Error("NEWEGG_INVALID_QUERY");
  const url=new URL("/p/pl",ORIGIN);
  url.searchParams.set("d",q);
  return url.href;
}
export function verifyNeweggSearchContext({requestedUrl,finalUrl,query}={}){
  try{
    const req=new URL(requestedUrl);
    const fin=new URL(finalUrl||requestedUrl);
    return req.origin===ORIGIN&&fin.origin===ORIGIN&&
      req.pathname==="/p/pl"&&fin.pathname==="/p/pl"&&
      req.searchParams.get("d")===query&&fin.searchParams.get("d")===query;
  }catch{return false;}
}
// Strictly extract the visible US-listing price; no crossed-out or sidebar prices.
export function extractNeweggSearchCards(html,query,{requestedUrl,finalUrl,limit=MAX_CARDS}={}){
  const diag={status:"UNVERIFIED",cardsSeen:0,pricedCards:0,conflicts:0,customerShippingVerified:false};
  if(!verifyNeweggSearchContext({requestedUrl,finalUrl,query}))
    return {offers:[],diagnostics:{...diag,status:"SEARCH_CONTEXT_MISMATCH"}};
  const src=String(html||"");
  if(src.length>MAX_HTML)return {offers:[],diagnostics:{...diag,status:"HTML_SIZE_EXCEEDED"}};
  if(!/\bclass=["'][^"']*\bplp-results-section\b/i.test(src))
    return {offers:[],diagnostics:{...diag,status:"LISTING_LAYOUT_MISSING"}};
  if(!/<html\b[^>]*\blang=["']en-us["']/i.test(src))
    return {offers:[],diagnostics:{...diag,status:"CURRENCY_MARKET_UNVERIFIED"}};
  const start=src.search(/\bclass=["'][^"']*\bplp-results-section\b/i);
  const listing=src.slice(start);
  const columns=[...listing.matchAll(/<div\b(?=[^>]*\bclass=["'][^"']*\bgrid-col\b)(?=[^>]*\bdata-item-position=["']?\d+)[^>]*>/gi)].slice(0,MAX_CARDS+1);
  const byId=new Map(),conflicted=new Set();
  const cap=Math.min(MAX_CARDS,Number.isFinite(limit)?Math.max(0,Math.floor(limit)):MAX_CARDS);
  for(let i=0;i<Math.min(columns.length,cap);i++){
    const card=listing.slice(columns[i].index,columns[i+1]?.index??Math.min(listing.length,columns[i].index+25_000));
    if(!/\bclass=["'][^"']*\bgoods-container\b/i.test(card))continue;
    diag.cardsSeen++;
    const titleTag=tagWithClass(card,"a","goods-title");
    if(!titleTag)continue;
    const title=strip(card.slice(titleTag.index+titleTag[0].length).split("</a>")[0]);
    const url=productUrl(attr(titleTag[0],"href"));
    const price=priceFromCard(card);
    if(!title||!url||price===null)continue;
    diag.pricedCards++;
    const condition=/\bopen[- ]box\b/i.test(title)?"open_box":/\b(?:refurbished|renewed)\b/i.test(title)?"renewed":/\bused\b/i.test(title)?"used":"new";
    const offer={productId:url.id,title,image:imageFromCard(card),price,currency:"USD",sourceUrl:url.url,condition,pdpPriceEvidence:"US_SEARCH_CARD_ONLY"};
    const existing=byId.get(url.id);
    if(existing&&(existing.price!==price||existing.title!==title)){
      conflicted.add(url.id);diag.conflicts++;
    }else if(!existing)byId.set(url.id,offer);
  }
  for(const id of conflicted)byId.delete(id);
  return {offers:[...byId.values()],diagnostics:{...diag,status:diag.cardsSeen?"PARSED_US_LISTING":"NO_CARDS"}};
}
