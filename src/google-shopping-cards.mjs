// Visual-only presentation of SerpApi Google Shopping observations.
// These NEVER become NAWAA's normalized merchant offers or cheapest-price claims.
function escapeHtml(v){
  return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
export function safeGoogleShoppingCardLink(raw){
  try{
    const u=new URL(raw);
    return u.protocol==="https:" && /(^|\.)google\.com$/i.test(u.hostname) &&
      /^\/shopping\/product\/\d+\/?$/.test(u.pathname) &&
      !u.username && !u.password ? u.href:null;
  }catch{return null;}
}
export function safeGoogleShoppingCardImage(raw){
  try{
    const u=new URL(raw);
    return u.protocol==="https:" && /(^|\.)(?:gstatic\.com|googleusercontent\.com)$/i.test(u.hostname) &&
      !u.username&&!u.password?u.href:null;
  }catch{return null;}
}
export function renderGoogleShoppingDiscoveryCards(rawCards){
  if(!Array.isArray(rawCards))return "";
  const seen=new Set(),items=[];
  for(const card of rawCards.slice(0,24)){
    if(!card || card.source!=="google-shopping" ||
       card.rankableInNawaa!==false || card.verifiedPrice!==false ||
       card.verifiedMerchantPdp!==false)continue;
    const target=safeGoogleShoppingCardLink(card.productUrl);
    const id=String(card.id||"");
    const pathId=target&&new URL(target).pathname.match(/\/shopping\/product\/(\d+)/)?.[1];
    if(!target||!id||id!==pathId||seen.has(id))continue;
    const title=String(card.title||"").trim().slice(0,250);
    const shop=String(card.merchantLabel||"").trim().slice(0,100);
    if(title.length<4||shop.length<1)continue;
    seen.add(id);
    const image=safeGoogleShoppingCardImage(card.image);
    const price=typeof card.displayedPrice==="string"&&card.displayedPrice.trim()?
      card.displayedPrice.trim().slice(0,100):"السعر غير متاح";
    const media=image?
      '<img loading="lazy" src="'+escapeHtml(image)+'" alt="'+escapeHtml(title)+'" referrerpolicy="no-referrer">':
      '<span class="google-shopping-card__fallback">صورة غير متوفرة</span>';
    items.push(
      '<article class="google-shopping-card">'+
        '<div class="google-shopping-card__image">'+media+'</div>'+
        '<div class="google-shopping-card__info">'+
          '<strong>'+escapeHtml(title)+'</strong>'+
          '<small>'+escapeHtml(shop)+'</small>'+
          '<span class="google-shopping-card__price" aria-label="السعر المعلن غير مؤكد">'+escapeHtml(price)+'</span>'+
          '<span class="google-shopping-card__disclaimer">سعر معلن في Google Shopping، غير متحقق من المتجر، ولا يدخل في ترتيب الأرخص</span>'+
          '<a href="'+escapeHtml(target)+'" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">تفاصيل المنتج في Google Shopping ↗</a>'+
        '</div>'+
      '</article>'
    );
  }
  return items.join("");
}
