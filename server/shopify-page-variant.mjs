// Public page initData is an observed Shopify shape, not a stable API.
// Read only literal JSON; never execute scripts or expose customer/cart data.
const MAX_PAYLOAD = 1500000;
const CURRENCIES = new Set(['USD','SAR','EUR','GBP','CAD','AUD','HKD','AED']);

function objectAt(source,start) {
  let depth=0,quoted=false,escaped=false;
  for(let i=start;i<source.length && i-start<MAX_PAYLOAD;i++) {
    const ch=source[i];
    if(quoted) {
      if(escaped) escaped=false;
      else if(ch==='\\') escaped=true;
      else if(ch==='"') quoted=false;
    } else if(ch==='"') quoted=true;
    else if(ch==='{') depth++;
    else if(ch==='}' && --depth===0) {
      try {return {data:JSON.parse(source.slice(start,i+1)),end:i};}catch{return null;}
    }
  }
  return null;
}

function initPayloads(script) {
  const result=[];
  let quote=null,escaped=false,lineComment=false,blockComment=false,depth=0,loaderDepth=null;
  for(let i=0;i<script.length;i++) {
    const ch=script[i],next=script[i+1];
    if(lineComment){if(ch==='\n'||ch==='\r')lineComment=false;continue;}
    if(blockComment){if(ch==='*'&&next==='/'){blockComment=false;i++;}continue;}
    if(quote){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch===quote)quote=null;continue;}
    if(ch==='/'&&next==='/'){lineComment=true;i++;continue;}
    if(ch==='/'&&next==='*'){blockComment=true;i++;continue;}
    if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue;}
    if(ch==='w'&&!/[\w$.]/.test(script[i-1] || '')) {
      const call=script.slice(i,i+80).match(/^wpmLoader\s*\(\s*\{/);
      if(call){depth++;loaderDepth=depth;i+=call[0].length-1;continue;}
    }
    if(ch==='{'){depth++;continue;}
    if(ch==='}'){depth--;if(loaderDepth!==null&&depth<loaderDepth)loaderDepth=null;continue;}
    if(loaderDepth===null||depth!==loaderDepth||ch!=='i'||/[\w$]/.test(script[i-1] || ''))continue;
    const marker=script.slice(i,i+80).match(/^initData\s*:\s*/);
    if(!marker)continue;
    if(script[i+marker[0].length]!=='{')return null;
    const parsed=objectAt(script,i+marker[0].length);
    if(!parsed)return null;
    result.push(parsed.data);i=parsed.end;
  }
  return loaderDepth===null ? result : null;
}

const text=value=>typeof value==='string' && value.trim() ? value.trim() : null;
const host=url=>url.hostname.toLowerCase().replace(/^www\./,'');
const path=url=>url.pathname.replace(/\/+$/,'');
const secure=url=>url.protocol==='https:' && !url.username && !url.password && (!url.port||url.port==='443');

export function extractShopifyVariantState(html,url) {
  let requested;
  try{requested=new URL(url);}catch{return null;}
  const id=requested.searchParams.get('variant');
  if(!secure(requested)||!/^\d{1,20}$/.test(id || '')||requested.searchParams.getAll('variant').length!==1)return null;
  const matches=[];
  for(const block of String(html || '').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const script=block[1];
    if(!/\bwpmLoader\b/.test(script))continue;
    const payloads=initPayloads(script);
    if(!payloads)return null;
    for(const data of payloads) {
      if(!Array.isArray(data?.productVariants))continue;
      if(data.productVariants.length>500)return null;
      for(const variant of data.productVariants) {
        if(variant && String(variant.id)===id)matches.push(variant);
      }
    }
  }
  if(matches.length!==1)return null;
  const variant=matches[0],product=variant.product;
  if(typeof variant.id==='number'&&!Number.isSafeInteger(variant.id))return null;
  let productUrl;
  try{if(!text(product?.url))return null;productUrl=new URL(product.url,requested);}catch{return null;}
  if(!secure(productUrl)||host(productUrl)!==host(requested)||path(productUrl)!==path(requested)||
    (productUrl.searchParams.has('variant') && (productUrl.searchParams.getAll('variant').length!==1||productUrl.searchParams.get('variant')!==id)))return null;
  const amount=variant.price?.amount,currency=variant.price?.currencyCode;
  if(!(typeof amount==='number'||(typeof amount==='string'&&/^\d+(?:\.\d+)?$/.test(amount))) ||
    !Number.isFinite(Number(amount))||Number(amount)<0||!CURRENCIES.has(currency)||!text(product.title))return null;
  productUrl.searchParams.set('variant',id);
  let image=null;
  try{const value=text(variant.image?.src);if(value){const parsed=new URL(value,requested);if(secure(parsed))image=parsed.href;}}catch{}
  return {
    name:product.title,image,brand:null,vendor:text(product.vendor),productType:text(product.type),shopifyVariantEvidence:true,
    offers:{name:text(variant.title),sku:text(variant.sku),image,price:Number(amount),priceCurrency:currency,url:productUrl.href},
  };
}
