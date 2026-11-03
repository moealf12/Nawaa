// R04: universal, non-destructive classification of already acquired offers.
// This module neither fetches sources nor changes merchant evidence, identity,
// price, availability, cache admission, or the published API schema.
import {normalizeSearchQuery, parseSearchIntent, productCategory} from "./search-query.mjs";

// These are *retail sold-subject* roles, not product-specific exclusion rules.
// Evidence is taken from the actual retail title before any "with/including"
// package extras. Do not use SEO URL or merchant/brand metadata to promote.
const GUIDE=/(?:^| )(?:guide for (?:seniors?|beginners?)|user (?:guide|manual)|(?:visual|comparison|mastering|setup|beginner'?s?|seniors?|instruction|step by step|complete) (?:guide|manual)|handbook|how to (?:use|master)|book(?:s)?|tutorial|guia (?:del )?usuario|gu[ií]a del usuario|guida utente|manual de usuario|دليل|كتاب|كتيب)(?: |$)/iu;
const ACCESSORY=/(?:^| )(?:replacement|compatible with|compatible for|protective|protector|screen protector|tempered glass|case|cover|strap|band|wristband|watchband|bracelet|loop band|holder|mount|dock|docking stand|filter|hose|wand|nozzle|attachment|brush head|cleaner head|spare|spare part|repair|controller|charger|charging cable|lens|tripod|gimbal|housing|shell|funda|protectora|pantalla|pelicula|pel[ií]cula|cargador|correa|سوار|حزام|فلتر|غطاء|حامل|حمايه|شاحن|عدسه|قطعه غيار|كفر|جراب)(?: |$)/iu;
const ACCESSORY_NOUN=/(?:^| )(?:lens|filters?|wands?|cases?|covers?|holders?|straps?|bands?|loops?|hoses?|nozzles?|tripods?|gimbals?|protectors?|chargers?|attachments?|brushes?|mop heads?|screen glass|disc drive|optical drive|controllers?|مستلزمات|ملحقات|اكسسوارات|سوار|عدسه|فلتر|غطاء|شاحن)(?: |$)/iu;
const PRINCIPAL=/(?:^| )(?:camera body|mirrorless camera|digital camera|dslr camera|vacuum cleaner|cordless vacuum|robot vacuum|smartwatch|watch series|iphone|smartphone|mobile phone|console|gaming console|office chair|coffee beans|whole beans|laptop|notebook|headphones?|earbuds?|speaker|television|tv|washing machine|refrigerator|perfume|necklace|jewellery|jewelry|ساعة|كاميرا|مكنسه|هاتف|لابتوب)(?: |$)/iu;
const EXCLUSIONS_FOR_QUERY=/(?:^| )(?:replacement|accessory|spare|filter|lens|case|cover|strap|band|holder|guide|manual|book|protector|gimbal|wand|charger|controller|disc drive|optical drive|ملحقات|اكسسوارات|قطع غيار|فلتر|عدسه|غطاء|سوار|كتاب|دليل)(?: |$)/iu;
const STOP=new Set(["for","the","and","with","of","in","on","a","an","to","new","by","plus","model","original","compatible","مناسب","مع","من","في","على","الجديد"]);

const tokens=s=>new Set(normalizeSearchQuery(s||"").split(" ").filter(x=>x.length>1&&!STOP.has(x)));
const containsPhrase=(text,part)=>(" "+text+" ").includes(" "+part+" ");
function titleEvidence(query,title,model){
 const qt=tokens(query), tt=tokens(title);
 let common=0;
 for(const word of qt)if(tt.has(word))common++;
 const coverage=qt.size?common/qt.size:0;
 const titleNorm=normalizeSearchQuery(title);
 const modelVerified= !model || containsPhrase(titleNorm,model);
 return {coverage,modelVerified,overlap:common};
}

export function inferSoldSubjectRole(title=""){
 const normalized=normalizeSearchQuery(title);
 if(!normalized)return "unknown";
 // Inclusion markers matter: a complete device "with a case/guide" is still
 // the complete device. "Compatible with" never grants package inclusion.
 const primary=normalized.replace(/\bcompatible with\b/g,"compatible_to")
   .split(/\b(?:with|including|includes)\b/,1)[0].trim();
 const whole=PRINCIPAL.test(primary);
 const documentation=GUIDE.test(primary)||
   /\b(?:for beginners|for seniors|learn to|how to use)\b/.test(primary);
 // A device title with "with Quick Start Guide" is *not* a book.
 if(documentation && !/^(?:apple |samsung |canon |dyson )?\w+\b.*\b(?:smartwatch|camera body|vacuum cleaner|cordless vacuum)\b.*\bwith\b/.test(normalized))
   return "guide";
 // An explicit sold accessory/part is an accessory even when a compatible
 // principal model is also mentioned in the SEO title.
 const strongPart=/\b(?:replacement|compatible_to|protector|protectora|funda|strap|bands?|holder|filters?|wand|attachment|mop head|screen glass|charger|spare parts?|gimbal|tripod|lens|controller)\b/.test(primary) ||
   /(?:ملحقات|اكسسوارات|قطع غيار|فلتر|حمايه|حامل|سوار|كفر)/u.test(primary);
 const completeFirst=/\b(?:camera body|mirrorless camera|digital camera|vacuum cleaner|cordless vacuum|smartwatch|office chair|iphone|laptop|console)\b/.test(primary.split(/\b(?:replacement|compatible_to|protectora|protector|holder|filter|strap|band|wand|lens|controller|gimbal|tripod|charger)\b/,1)[0]);
 if(strongPart && !completeFirst)return "accessory";
 if(ACCESSORY.test(primary) && !whole)return "accessory";
 // "Canon RF50mm" or "Nikon 50mm" are separately sold lenses, not camera
 // bodies. The manufacturer name is not enough to make them a principal.
 if(/\b(?:rf|ef|fe|af)[ -]?\d+(?:mm)?\b/.test(primary) &&
   /\b(?:mm|f1|f2|mount)\b/.test(primary) &&
   !/\b(?:camera body|mirrorless camera)\b/.test(primary))return "accessory";
 return "product";
}

function querySubjectRole(query,intent){
 const q=normalizeSearchQuery(query);
 const role=inferSoldSubjectRole(q);
 if(role==="guide"||role==="accessory")return role;
 if(intent.category==="accessory" && EXCLUSIONS_FOR_QUERY.test(q))return "accessory";
 if(/\b(?:disc drive|optical drive|controller)\b/.test(q) && !/\bconsole\b/.test(q))
   return "accessory";
 return "product";
}

const LANES=Object.freeze({
 alternative:{key:"alternative",label:"منتجات مشابهة وبدائل",order:1},
 accessory:{key:"accessory",label:"ملحقات وقطع متوافقة",order:2},
 guide:{key:"guide",label:"أدلة ومحتوى عن المنتج",order:3},
 other:{key:"other",label:"نتائج أخرى للتحقق",order:4}
});

export function classifyResultGroup(query,group,intent=parseSearchIntent(query)){
 const offer=group?.bestOffer||group?.offers?.[0]||null;
 if(!offer)return {lane:"other",role:"unknown",reason:"missing_offer",coverage:0};
 const title=String(offer.title||"");
 const role=inferSoldSubjectRole(title);
 const requestedRole=querySubjectRole(query,intent);
 const evidence=titleEvidence(intent.providerQuery||query,title,intent.model);
 const matched=offer.exactMatch===true&&Number(offer.matchConfidence)>=.9;
 const compatibleRole=role===requestedRole||(role==="product"&&requestedRole==="product");
 let lane="other", reason="insufficient_subject_evidence";
 if(role==="guide"&&requestedRole!=="guide"){lane="guide";reason="separately_sold_documentation";}
 else if(role==="accessory"&&requestedRole!=="accessory"){lane="accessory";reason="separately_sold_part_or_accessory";}
 else if(matched&&compatibleRole&&evidence.modelVerified&&
   (evidence.coverage>=.5 || (intent.category&&role==="product"&&evidence.overlap>0))){
   lane="direct";reason="title_evidenced_match";
 }else if(role===requestedRole&&evidence.coverage>0) {
   lane="alternative";reason="related_subject_unverified_variant";
 }else if(role==="guide"){lane="guide";reason="document_not_primary";}
 else if(role==="accessory"){lane="accessory";reason="related_part_or_accessory";}
 return {lane,role,reason,coverage:evidence.coverage,
   modelVerified:evidence.modelVerified,sourceExact:offer.exactMatch===true};
}

// Stable partition. Every input GROUP appears exactly once; no results vanish.
// Underlying offers stay inside their original identity groups unchanged.
// Group order is preserved, so trusted price/bucket rankings are not rewritten.
export function buildIntentAwareResultLanes(query,groups=[]){
 const intent=parseSearchIntent(query);
 const primaryGroups=[], secondary=new Map(Object.values(LANES).map(l=>[l.key,{...l,groups:[]}]));
 for(const group of groups){
   const decision=classifyResultGroup(query,group,intent);
   if(decision.lane==="direct")primaryGroups.push(group);
   else secondary.get(decision.lane).groups.push(group);
 }
 return {
   primaryGroups,
   secondarySections:[...secondary.values()].filter(x=>x.groups.length>0),
   inputGroups:groups.length,
   partitionedGroups:primaryGroups.length+[...secondary.values()].reduce((n,x)=>n+x.groups.length,0),
   classifierVersion:"r04-intent-lanes-v1",
 };
}
