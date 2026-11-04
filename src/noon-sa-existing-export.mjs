// Adapts existing merchant/affiliate CSV, TSV or JSON catalogs into diagnostic
// Noon Saudi product/offer evidence. This is a NAWAA importer, not a claimed
// official Noon export schema. No customer-price publication is possible here.
import {noonSaudiProductIdentity} from "./noon-sa-catalog.mjs";
import {parseSearchIntent} from "./search-query.mjs";

const FIELDS=Object.freeze({
  title:["title","name","product_name","item_name","product_title"],
  product_url:["product_url","url","pdp_url","product_link","merchant_url","deeplink"],
  price:["price","sale_price","selling_price","current_price","product_price"],
  currency:["currency","currency_code","price_currency"],
  sku:["sku","noon_sku","product_sku","catalog_sku"],
  offer_code:["offer_code","offer_id","offer"],
  image_url:["image_url","image","image_link","picture_url"],
  observed_at:["observed_at","updated_at","price_updated_at","last_updated_at"],
});
const MAX_ROWS=5000,MAX_BYTES=8_000_000,MAX_COLS=64;
const OFFER=/^[a-z0-9-]{1,100}$/i;
const MAX_TITLE=350;

function normName(s){return String(s||"").trim().toLowerCase().replace(/[\s-]+/g,"_")}
function parseCsv(raw,separator){
  const rows=[];let row=[],cell="",quoted=false,closed=false;
  const pushCell=()=>{
    if(row.length>=MAX_COLS)throw new Error("TOO_MANY_COLUMNS");
    row.push(cell.trim());cell="";closed=false;
  };
  const pushRow=()=>{
    pushCell();
    if(row.some(c=>c!==""))rows.push(row);
    if(rows.length>MAX_ROWS+1)throw new Error("TOO_MANY_ROWS");
    row=[];
  };
  for(let i=0;i<raw.length;i++){
    const ch=raw[i];
    if(ch==="\0")throw new Error("INVALID_NULL_BYTE");
    if(quoted){
      if(ch==='"'&&raw[i+1]==='"'){cell+='"';i++}
      else if(ch==='"'){quoted=false;closed=true}
      else cell+=ch;
    }else if(ch==='"'&&cell===""){quoted=true}
    else if(ch===separator){pushCell()}
    else if(ch==="\r"||ch==="\n"){
      if(ch==="\r"&&raw[i+1]==="\n")i++;
      pushRow();
    }else if(ch==='"'||closed)throw new Error("MALFORMED_CSV_QUOTE");
    else cell+=ch;
    if(cell.length>60_000)throw new Error("FIELD_TOO_LARGE");
  }
  if(quoted)throw new Error("UNTERMINATED_CSV_QUOTE");
  if(cell||row.length)pushRow();
  return rows;
}
function csvRecords(raw,kind){
  const separator=kind==="tsv"?"\t":",";
  const rows=parseCsv(raw.replace(/^\uFEFF/,""),separator);
  if(!rows.length)throw new Error("EMPTY_EXPORT");
  const columns=rows[0].map(normName);
  if(new Set(columns).size!==columns.length)throw new Error("DUPLICATE_COLUMNS");
  const records=rows.slice(1).map(row=>{
    if(row.length!==columns.length)throw new Error("INCONSISTENT_CSV_COLUMNS");
    return Object.fromEntries(columns.map((key,i)=>[key,row[i]]));
  });
  return {columns,records};
}
function jsonRecords(raw){
  let payload;
  try{payload=JSON.parse(raw)}catch{throw new Error("INVALID_JSON")}
  const data=Array.isArray(payload)?payload:
    (payload&&typeof payload==="object"&&
      (payload.products||payload.records||payload.items||payload.data));
  if(!Array.isArray(data))throw new Error("UNSUPPORTED_JSON_SHAPE");
  if(data.length>MAX_ROWS)throw new Error("TOO_MANY_ROWS");
  if(data.some(v=>!v||typeof v!=="object"||Array.isArray(v)))
    throw new Error("INVALID_JSON_RECORD");
  const columns=[...new Set(data.flatMap(x=>Object.keys(x).map(normName)))].slice(0,MAX_COLS);
  return {columns,records:data.map(x=>Object.fromEntries(
    Object.entries(x).map(([k,v])=>[normName(k),v])))};
}
function fieldMap(cols,custom){
  if(custom!=null&&(!custom||typeof custom!=="object"||Array.isArray(custom)))
    throw new Error("INVALID_FIELD_MAP");
  const result={};
  for(const [name,aliases] of Object.entries(FIELDS)){
    let candidates=aliases;
    if(custom&&Object.hasOwn(custom,name)){
      if(typeof custom[name]!=="string"||custom[name].length>100)
        throw new Error("INVALID_FIELD_MAPPING_"+name);
      candidates=[custom[name]];
    }
    result[name]=candidates.map(normName).find(c=>cols.includes(c))||null;
  }
  if(!result.title||!result.product_url)throw new Error("MISSING_IDENTITY_COLUMNS");
  return result;
}
function noonIdentity(raw){
  if(typeof raw!=="string"||raw.length>2048)return null;
  try{
    const u=new URL(raw);
    if(u.protocol!=="https:"||u.username||u.password||u.hash||u.port||
       !["noon.com","www.noon.com"].includes(u.hostname.toLowerCase()))return null;
    // Some existing affiliate catalogs use Arabic Saudi URL prefixes.
    const normalized=new URL(u.href);
    normalized.pathname=normalized.pathname.replace(
      /^\/(?:saudi-ar|ar-sa|en-sa)\//i,"/saudi-en/");
    const identity=noonSaudiProductIdentity(normalized.href);
    if(!identity)return null;
    const codes=u.searchParams.getAll("o");
    const offerCode=codes.length===1&&OFFER.test(codes[0])?codes[0]:null;
    return {...identity,offerCode};
  }catch{return null}
}
// Strictly parses existing seller/affiliate export prices, without currency
// conversion, ambiguous decimal separators, scientific notation or sign marks.
// Allows a *correctly grouped* thousands comma and Arabic-Indic numerals.
function price(raw){
  if(typeof raw!=="number"&&typeof raw!=="string")return null;
  const digits=String(raw).trim()
    .replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-0x0660))
    .replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-0x06f0))
    .replace(/\u066C/g,",").replace(/\u066B/g,".");
  const ungrouped=/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/;
  const grouped=/^[1-9]\d{0,2}(?:,\d{3})+(?:\.\d{1,2})?$/;
  if(!ungrouped.test(digits)&&!grouped.test(digits))return null;
  const n=Number(digits.replace(/,/g,""));
  return Number.isFinite(n)&&n>0&&n<=10_000_000&&
    Math.abs(n*100-Math.round(n*100))<1e-6?n:null;
}
function isoTime(raw){
  if(typeof raw!=="string"||raw.length>40||raw.length<20||
     !/T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw))
    return null;
  const n=Date.parse(raw);
  return Number.isFinite(n)?new Date(n).toISOString():null;
}
function image(raw){
  if(typeof raw!=="string")return null;
  try{
    const u=new URL(raw);
    return u.protocol==="https:"&&!u.port&&!u.username&&!u.password&&
      (u.hostname==="f.nooncdn.com"||u.hostname.endsWith(".nooncdn.com"))
      ?u.href:null;
  }catch{return null}
}
function identityConsistent(title,id){
  const name=parseSearchIntent(title);
  const slug=id.canonicalUrl.split("/saudi-en/")[1]?.split("/")[0]
    .replace(/-/g," ")||"";
  const fromSlug=parseSearchIntent(slug);
  return !["model","storage","color"].some(k=>
    name[k]&&fromSlug[k]&&name[k]!==fromSlug[k]);
}
function observation(row,map){
  const value=k=>map[k]?row[map[k]]:null;
  const id=noonIdentity(value("product_url"));
  if(!id)return {error:"NON_NOON_SAUDI_PRODUCT_URL"};
  const title=value("title");
  if(typeof title!=="string"||title.trim().length<4||
     title.length>MAX_TITLE)return {error:"TITLE_INVALID"};
  if(!identityConsistent(title,id))return {error:"PRODUCT_VARIANT_CONFLICT"};
  if(value("sku")!=null&&String(value("sku")).trim()!==""
     &&String(value("sku")).trim().toUpperCase()!==id.sku)
    return {error:"SKU_MISMATCH"};
  const amount=price(value("price"));
  const currency=value("currency");
  const priceValid=amount!==null&&
    typeof currency==="string"&&currency.trim().toUpperCase()==="SAR";
  const sourceTime=isoTime(value("observed_at"));
  const code=value("offer_code");
  if(code!=null&&String(code).trim()!==""&&id.offerCode!==String(code).trim())
    return {error:"OFFER_CODE_MISMATCH"};
  const canUsePrice=priceValid&&id.offerCode!==null;
  return {
    sku:id.sku,offerCode:id.offerCode,
    title:title.trim(),
    sourceUrl:id.canonicalUrl+(id.offerCode?"?o="+encodeURIComponent(id.offerCode):""),
    price:canUsePrice?amount:null,
    currency:canUsePrice?"SAR":null,
    image:image(value("image_url")),
    sourceObservedAt:sourceTime,
    state:canUsePrice?"FEED_PRICE_OBSERVED_UNVERIFIED":
      "PRODUCT_DISCOVERED_PRICE_UNATTESTED",
    market:"SA",seller:null,shipping:null,
    customerPublishable:false,pdpVerified:false,
  };
}
export function inspectNoonExistingExport(raw,{format="csv",columnMap=null}={}){
  if(typeof raw!=="string"||Buffer.byteLength(raw,"utf8")>MAX_BYTES)
    return {state:"INVALID_OR_OVERSIZED_BODY",accepted:0,rejected:0,records:[],
      sourcePriceObservations:0,identityOnly:0,customerPublishable:false};
  try{
    if(!["csv","tsv","json"].includes(format))throw new Error("INVALID_FORMAT");
    const parsed=format==="json"?jsonRecords(raw):csvRecords(raw,format);
    const map=fieldMap(parsed.columns,columnMap);
    const observations=[];
    const rejections=Object.create(null);
    const byIdentity=new Map();
    let rejected=0,conflicts=0;
    for(const row of parsed.records){
      const item=observation(row,map);
      if(item.error){
        rejected++;
        rejections[item.error]=(rejections[item.error]||0)+1;
        continue;
      }
      const key=item.sku+"|"+(item.offerCode||"none");
      const prior=byIdentity.get(key);
      if(prior===null)continue;
      if(prior){
        if(prior.price!==item.price||prior.title!==item.title){
          byIdentity.set(key,null);conflicts++;
        }
      }else byIdentity.set(key,item);
    }
    observations.push(...[...byIdentity.values()].filter(Boolean));
    return {
      state:observations.length?"EXISTING_EXPORT_PARSED_DIAGNOSTIC_ONLY":"NO_VALID_NOON_RECORDS",
      accepted:observations.length,rejected,conflicts,rejections,
      sourcePriceObservations:observations.filter(r=>r.price!==null).length,
      identityOnly:observations.filter(r=>r.price===null).length,
      records:observations,
      feedScopeVerified:false,priceFreshnessVerified:false,
      customerPublishable:false,
    };
  }catch(e){
    return {state:String(e?.message||"UNKNOWN_PARSE_ERROR").slice(0,90),
      accepted:0,rejected:0,records:[],customerPublishable:false};
  }
}
