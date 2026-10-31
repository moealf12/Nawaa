// R04 bounded public read-only evidence. Labels use predeclared identity rules;
// NEVER use exactMatch/matchConfidence, price or ranking position as ground truth.
import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {groupComparableOffers} from "../src/search-core.mjs";

const ORIGIN="https://nawaa-search-api.onrender.com";
const MAX_BYTES=3_000_000;
const EXPECTED=process.env.NAWAA_EXPECT_LIVE_SHA||"";
const QUERIES=[
  ["Q01","iPhone 17 256GB","iphone"],
  ["Q02","ايفون 17 256 جيجا","iphone"],
  ["Q03","Samsung Galaxy S25 Ultra","galaxy"],
  ["Q04","سامسونج جالكسي S25 الترا","galaxy"],
  ["Q05","PS5 Digital Edition","ps5"],
  ["Q06","بلايستيشن 5 ديجيتال","ps5"],
  ["Q11","JBL Bluetooth headphones","jbl"],
  ["Q12","سماعات بلوتوث جي بي ال","jbl"],
  ["Q15","HP laptop 16GB RAM","laptop"],
  ["Q16","لابتوب اتش بي 16 رام","laptop"],
];
const norm=v=>String(v??"").normalize("NFKC").toLowerCase()
  .replace(/[\u064b-\u065f\u0670\u0640]/g,"")
  .replace(/[أإآ]/g,"ا").replace(/ى/g,"ي")
  .replace(/[^\p{L}\p{N}]+/gu," ").replace(/\s+/g," ").trim();
const has=(v,re)=>re.test(v);
const accessory=/(?:\bcase\b|\bcover\b|\bprotector\b|\bsleeve\b|\bskin\b|\bcharger\b|\bcable\b|\badapter\b|\bheatsink\b|\bfaceplate\b|\bband\b|\bstrap\b|\bholder\b|\bstand\b|\bfor\s+(?:iphone|galaxy|ps5)\b|كفر|غطاء|حافظه|حامي|شاحن|سلك|جراب|اكسسوار|ملحق|حزام|قاعدة)/;
const iphone=/(?:iphone\s*17|ايفون\s*17)/;
const galaxy=/(?:s25|اس\s*25)/;
const ps5=/(?:ps\s*5|playstation\s*5|بلايستيشن\s*5)/;
const jbl=/(?:\bjbl\b|جي\s*بي\s*ال)/;
const hp=/(?:\bhp\b|اتش\s*بي)/;
const laptop=/(?:\blaptop\b|\bnotebook\b|\bpavilion\b|\belitebook\b|\bprobook\b|\benvy\b|\bomen\b|\bspectre\b|\bomni\b|لابتوب|لاب\s*توب)/;
const headphones=/(?:\bheadphones?\b|\bheadset\b|سماعات|سماعه)/;
const wireless=/(?:\bbluetooth\b|\bwireless\b|بلوتوث|لاسلكي)/;
// Grade 0 = proven wrong product/accessory; 2 = related but not exact;
// 3 = positive strict identity/spec evidence; null = genuinely uncertain.
// No grade 1 unless separately adjudicated. Never map null to irrelevant.
export function provisionalLabel(queryKind,offer){
  const title=norm(offer?.title);
  const model=norm([offer?.specs?.deviceType,offer?.specs?.modelNumber].filter(Boolean).join(" "));
  const specs=norm([offer?.specs?.storage,offer?.specs?.ram].filter(Boolean).join(" "));
  const combined=[title,model].filter(Boolean).join(" ");
  if(!title)return {grade:null,reason:"missing_title"};
  // Proof of the item being sold dominates its compatible-device keywords.
  // Recorded live R04 top-ten evidence includes multilingual screen protectors,
  // memory upgrade kits, camera parts, books and a PS5 stand.
  const peripheralSubject=/(?:\bphoto\s*stick\b|\bflash\s*drive\b|\busb\s*memory\b|\bscreen\s*protectors?\b|\buser\s*guide\b|\bmanual\b|\bglass\s*film\b|\bpanzerfolie\b|\bschutzfolie\b|\bschutzglas\b|\bvetro\s*posteriore\b|\bcoperchio\s*batteria\b|\bdigitizer\b|\blcd\s*display\b|\brear\s*camera\s*(?:set|replacement|repair)\b|\bfor\s*repair\b|\bstan(?:d|dfusse|dfu\w*e)\b|\bhalterung\b|\b2x\s*\d+gb\s*\d+gb\s*ram\b)/i;
  if(has(title,peripheralSubject) ||
     (queryKind==="laptop" && /^(?:\d+x )?\d+gb(?: \d+gb)? ram memory\b/.test(title)))
    return {grade:0,reason:"retail_peripheral_subject"};
  // Bundled games, installed SSDs and included DualSense are not standalone
  // peripherals when a complete PlayStation console is the sold item.
  const completeConsole=has(title,/(?:\\bconsole\\b|بلايستيشن\\s*5\\s*جهاز)/);
  if(has(title,accessory) &&
     !(queryKind==="ps5" && completeConsole && has(title,/(?:\\bwith\\b|\\bbundle\\b|\\bincluding\\b)/)))
    return {grade:0,reason:"explicit_accessory_cue"};
  if(queryKind==="iphone"){
    if(!has(combined,iphone))return {grade:null,reason:"iphone_family_unproven"};
    if(has(combined,/(?:\bpro\b|\bplus\b|\bair\b|\bmax\b)/))return {grade:2,reason:"different_phone_variant"};
    if(has([title,specs].join(" "),/(?:\b256\s*gb\b|\b256\s*جيجا\b|\b256gb\b)/))
      return {grade:3,reason:"iphone17_256_explicit"};
    return {grade:2,reason:"iphone17_capacity_not_confirmed"};
  }
  if(queryKind==="galaxy"){
    if(!has(combined,galaxy))return {grade:null,reason:"galaxy_family_unproven"};
    return has(combined,/(?:\bultra\b|\bالترا\b)/)
      ?{grade:3,reason:"s25_ultra_explicit"}:{grade:2,reason:"s25_ultra_unconfirmed"};
  }
  if(queryKind==="ps5"){
    if(!has(combined,ps5))return {grade:null,reason:"ps5_family_unproven"};
    if(!completeConsole && has(title,/(?:\bdisc\s*drive\b|\bcontroller\b|\bdualsense\b|\bssd\b|\bnvme\b|يد\s*تحكم|قارئ\s*اقراص|قرص\s*صلب)/))
      return {grade:0,reason:"peripheral_not_console"};
    const digital=has(title,/(?:\bdigital\b|\bdigitale\b|ديجيتال|رقمي)/);
    const disc=has(title,/(?:\bdisc\s*edition\b|\bdisc\s*version\b|نسخه\s*الاقراص)/);
    const chassis=has(title,/(?:\bconsole\b|\bplaystation\b|\bps\s*5\b|بلايستيشن|جهاز)/);
    if(digital&&chassis&&!disc)return {grade:3,reason:"ps5_digital_chassis"};
    if(disc||chassis)return {grade:2,reason:"ps5_edition_not_confirmed"};
    return {grade:null,reason:"ps5_product_type_unknown"};
  }
  if(queryKind==="jbl"){
    if(!has(combined,jbl))return {grade:null,reason:"jbl_brand_unproven"};
    if(has(title,/(?:\bspeaker\b|\bsoundbar\b|\bearbuds\b|سبيكر|مكبر\s*صوت|ساوندبار)/))
      return {grade:2,reason:"jbl_other_audio_category"};
    if(!has(title,headphones))return {grade:null,reason:"headphone_type_not_evidenced"};
    return has(title,wireless)?{grade:3,reason:"jbl_wireless_headphones_explicit"}:
      {grade:2,reason:"jbl_headphones_bluetooth_unconfirmed"};
  }
  if(queryKind==="laptop"){
    if(!has(combined,hp))return {grade:null,reason:"hp_brand_unproven"};
    if(!has(title,laptop))return {grade:null,reason:"complete_laptop_not_evidenced"};
    if(has(title,/(?:\bssd\s+(?:for|upgrade)\b|\breplacement\b|\bram\s+for\b|لترقيه|بديل)/))
      return {grade:0,reason:"component_not_laptop"};
    return has([title,specs].join(" "),/(?:\b16\s*gb\b|\b16\s*ram\b|\b16\s*جيجا\b|\b16gb\b|\b16\s*رام\b)/)
      ?{grade:3,reason:"hp_laptop_16gb_explicit"}:{grade:2,reason:"hp_laptop_ram_unconfirmed"};
  }
  return {grade:null,reason:"unknown_query_kind"};
}
export function judgedMetrics(rows){
  const known=rows.filter(x=>Number.isInteger(x.judgment?.grade));
  const unknown=rows.length-known.length;
  // A single unjudged result invalidates exact DCG/IDCG. Retain the packet
  // for independent review instead of assigning unknown grade 0.
  if(unknown||!rows.length)return {ndcg10:null,mrr10:null,
    judged:known.length,unjudged:unknown,metricStatus:"INCOMPLETE_JUDGMENTS"};
  const grades=rows.map(x=>x.judgment.grade);
  const ideal=[...grades].sort((a,b)=>b-a);
  const dcg=arr=>arr.reduce((v,g,i)=>v+(2**g-1)/Math.log2(i+2),0);
  const idealDcg=dcg(ideal);
  return {ndcg10:idealDcg?Number((dcg(grades)/idealDcg).toFixed(6)):null,
    mrr10:(()=>{const n=grades.indexOf(3);return n<0?0:1/(n+1)})(),
    judged:known.length,unjudged:0,metricStatus:idealDcg?"PROVISIONAL_RULE_LABELS":"NO_RELEVANT_JUDGMENTS"};
}
const boundedText=(v,n=180)=>String(v??"").slice(0,n);
async function get(path,timeout=26000){
  const res=await fetch(new URL(path,ORIGIN),{headers:{accept:"application/json"},redirect:"error",signal:AbortSignal.timeout(timeout)});
  if(Number(res.headers.get("content-length")||0)>MAX_BYTES)throw Error("BODY_LIMIT_HEADER");
  const arr=await res.arrayBuffer();
  if(arr.byteLength>MAX_BYTES)throw Error("BODY_LIMIT");
  return {status:res.status,body:JSON.parse(new TextDecoder().decode(arr))};
}
async function run(){
  const result={schemaVersion:"nawaa.r04.live-ranking-evidence.v1",
    mode:"READ_ONLY_PUBLIC_PRODUCTION",labelProvenance:"PRECOMMITTED_INDEPENDENT_RULES_NOT_HUMAN_ADJUDICATION",
    uiParityVerified:false,synthetic:false,origin:ORIGIN,expectedSha:EXPECTED,
    recordedAt:new Date().toISOString(),requests:[],health:null};
  let fatal=null;
  try{
    if(!/^[0-9a-f]{40}$/.test(EXPECTED))throw Error("EXPECTED_SHA_INVALID");
    const h=await get("/health",60000);
    result.health={httpStatus:h.status,ok:h.body?.ok===true,revision:h.body?.revision||null};
    if(h.status!==200||h.body?.revision!==EXPECTED||h.body?.ok!==true)throw Error("LIVE_SHA_MISMATCH");
    for(const [id,query,kind] of QUERIES){
      const row={id,query,kind,status:"NOT_RUN",httpStatus:null,partial:null,errors:null,
        offersTotal:0,groupsTotal:0,firstTen:[],metrics:null};
      result.requests.push(row);
      try{
        const res=await get("/api/search?q="+encodeURIComponent(query),26000);
        row.httpStatus=res.status;
        if(res.status!==200||!Array.isArray(res.body?.offers))throw Error("SEARCH_RESPONSE_INVALID");
        row.status="OBSERVED";row.offersTotal=res.body.offers.length;
        row.partial=res.body?.coverage?.partial===true;
        row.errors=Array.isArray(res.body?.errors)?res.body.errors.length:null;
        const groups=groupComparableOffers(res.body.offers);
        row.groupsTotal=groups.length;
        row.firstTen=groups.slice(0,10).map((g,index)=>{
          const offer=g.bestOffer||{};
          return {position:index+1,title:boundedText(offer.title,180),
            merchant:boundedText(offer.merchant,70),
            provider:boundedText(offer.provider,60),
            sourceUrl:boundedText(offer.sourceUrl,400),
            modelNumber:boundedText(offer.specs?.modelNumber,70),
            storage:boundedText(offer.specs?.storage,50),
            ram:boundedText(offer.specs?.ram,50),
            price:Number.isFinite(offer.productPrice)?offer.productPrice:null,
            currency:boundedText(offer.currency,4),
            systemExact:offer.exactMatch===true,systemConfidence:Number.isFinite(offer.matchConfidence)?offer.matchConfidence:null,
            judgment:provisionalLabel(kind,offer)};
        });
        row.metrics=judgedMetrics(row.firstTen);
        console.log("R04_LIVE_QUERY "+JSON.stringify({id,query,status:row.status,offers:row.offersTotal,groups:row.groupsTotal,
          topTen:row.firstTen.map(o=>({position:o.position,title:o.title,grade:o.judgment.grade,reason:o.judgment.reason})),
          metrics:row.metrics,partial:row.partial,sourceErrors:row.errors}));
      }catch(e){row.status="REQUEST_FAILED";row.failure=boundedText(e?.name||"ERROR",80);
        console.log("R04_LIVE_QUERY_FAILURE "+JSON.stringify({id,failure:row.failure}));}
    }
  }catch(e){fatal=boundedText(e?.message||e,120);}
  result.completedAt=new Date().toISOString();
  result.summary={attempted:result.requests.length,observed:result.requests.filter(x=>x.status==="OBSERVED").length,
    completedQueries:result.requests.filter(x=>x.status==="OBSERVED"&&x.firstTen.length>0).length,
    rows:result.requests.reduce((n,x)=>n+x.firstTen.length,0),
    provisionalNdcgQueries:result.requests.filter(x=>x.metrics?.ndcg10!==null&&Number.isFinite(x.metrics?.ndcg10)).length,
    failed:result.requests.filter(x=>x.status!=="OBSERVED").length,
    unjudged:result.requests.reduce((n,x)=>n+(x.metrics?.unjudged||0),0),
    partial:result.requests.filter(x=>x.partial).length,
    fatal};
  writeFileSync("r04-live-ranking-evidence.json",JSON.stringify(result,null,2)+"\n");
  console.log("R04_LIVE_SUMMARY "+JSON.stringify(result.summary));
  if(fatal||result.summary.failed||result.summary.observed!==QUERIES.length)process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await run();
