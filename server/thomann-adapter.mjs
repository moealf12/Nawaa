import {load} from "cheerio";

// Dedicated Thomann German PDP extractor. Only the primary visible offer
// is eligible; recommendations, MSRP and B-Stock never create an offer.
export function isThomannProductUrl(value) {
  try {
    const u=new URL(value);
    return u.protocol==="https:" && u.hostname==="www.thomann.de" &&
      (!u.port || u.port==="443") && !u.username && !u.password &&
      /^\/de\/[a-z0-9_+-]+\.htm$/i.test(u.pathname);
  } catch {return false}
}
const normalize=v=>String(v||"").replace(/[\u00a0\u202f]/g," ").replace(/\s+/g," ").trim();
const euroPattern=/(?:^|[^\d.,])((?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?)\s*€/g;
function parseEuro(value){
  const n=Number(value.replace(/\./g,"").replace(",","."));
  return Number.isFinite(n)&&n>0?n:null;
}
function primaryPrice(text,title){
  const page=normalize(text),pos=page.indexOf(normalize(title));
  if(pos<0)return null;
  const body=page.slice(pos+normalize(title).length,pos+normalize(title).length+16000);
  const vat=/Alle\s+Preise\s+inkl\.?\s*MwSt\.?/i.exec(body);
  if(!vat)return null;
  const slice=body.slice(Math.max(0,vat.index-850),vat.index)
    .replace(/\bB[- ]Stock\b.{0,105}?(?:\bab\s*)?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?\s*€/gi," ")
    .replace(/UVP\s*:?\s*(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?\s*€/gi," ");
  const values=[];
  for(const m of slice.matchAll(euroPattern)){
    const price=parseEuro(m[1]);if(price!==null)values.push(price);
  }
  const distinct=[...new Set(values)];
  return distinct.length===1?distinct[0]:null;
}
function imageFromMerchant($){
  const imgs=[
    $('meta[property="og:image"]').attr("content"),
    $('meta[name="twitter:image"]').attr("content"),
    $('main img').first().attr("src"),
    $('main img').first().attr("data-src")];
  for(const raw of imgs){
    try{
      const u=new URL(raw),host=u.hostname.toLowerCase();
      if(u.protocol==="https:" &&
        (host==="www.thomann.de"||host==="thomann.de"||
         host==="static-thomann.de"||host.endsWith(".static-thomann.de")))
        return u.href;
    }catch{}
  }
  return null;
}
export function extractThomannProduct(html,url){
  if(!isThomannProductUrl(url)||typeof html!=="string"||html.length>5_000_000)return null;
  const $=load(html);
  const heading=$("h1").first(),title=normalize(heading.text());
  if(!heading.length||title.length<4||title.length>240)return null;
  const image=imageFromMerchant($);
  if(!image)return null;
  $("script,style,noscript,template,nav,footer,aside,[hidden],[aria-hidden='true']").remove();
  $("[class*='recommend'],[class*='accessor'],[class*='cross-sell'],[class*='upsell']").remove();
  const main=$("main").first();
  const root=main.length?main:$("body");
  // Cheerio .text() joins neighboring block nodes WITHOUT separators:
  // "Artikelnummer 153257" + "69 €" would look like "15325769 €".
  // Insert boundaries only for block-level elements, preserving inline price spans.
  root.find("p,div,section,article,li,dl,dt,dd,h1,h2,h3,h4,br").each((_,node)=>{
    $(node).prepend(" ");
    $(node).append(" ");
  });
  const plain=root.text();
  const price=primaryPrice(plain,title);
  if(price===null)return null;
  const sku=normalize(plain).match(/\bArtikelnummer\s+(\d{4,10})\b/i)?.[1]||null;
  return {name:title,image,brand:null,sku,offers:{price,priceCurrency:"EUR",availability:""}};
}
