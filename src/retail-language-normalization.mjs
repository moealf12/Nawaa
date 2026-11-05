// R04 source-neutral, curated multilingual retail vocabulary.
// A translation model is NOT used: only these unambiguous structural retail
// concepts may be canonicalized. The same transformation runs on the shopper
// query, merchant search query and merchant-owned sold-title evidence.
// Never translate model identifiers, sizes, prices, availability or claims.
//
// Longer phrases precede their constituents so "funda para" cannot leave
// the Spanish function word "para" as a fabricated variant constraint.
// Language is not inferred from the storefront hostname.
const RETAIL_EQUIVALENCES=Object.freeze([
  // Spanish: physical sold subjects and unambiguous buyer descriptors.
  ["fundas protectoras para","protective cases"],
  ["funda protectora para","protective case"],
  ["fundas para","cases"],
  ["funda para","case"],
  ["fundas","cases"],
  ["funda","case"],
  ["protector de pantalla","screen protector"],
  ["protectores de pantalla","screen protectors"],
  ["cargadores para","chargers"],
  ["cargador para","charger"],
  ["cargadores","chargers"],
  ["cargador","charger"],
  ["auriculares inalámbricos","wireless headphones"],
  ["auriculares inalambricos","wireless headphones"],
  ["auriculares","headphones"],
  ["reloj inteligente","smartwatch"],
  ["ordenadores portátiles","laptops"],
  ["ordenador portátil","laptop"],
  ["telefono movil","phone"],
  ["teléfono móvil","phone"],
  ["teléfono","phone"],
  ["telefono","phone"],
  ["sin sulfatos","sulfate free"],
  ["sin sulfato","sulfate free"],
  // French: preserve the ingredient-free constraint; do not reduce it
  // to the product category shampoo alone.
  ["shampoings sans sulfate","sulfate free shampoos"],
  ["shampoing sans sulfate","sulfate free shampoo"],
  ["sans sulfates","sulfate free"],
  ["sans sulfate","sulfate free"],
  ["shampoings","shampoos"],
  ["shampoing","shampoo"],
  ["chaussures de randonnée","hiking shoes"],
  ["chaussures de randonnee","hiking shoes"],
  ["chaussures","shoes"],
  ["randonnée","hiking"],
  ["randonnee","hiking"],
  ["imperméables","waterproof"],
  ["impermeables","waterproof"],
  ["imperméable","waterproof"],
  ["impermeable","waterproof"],
  ["écouteurs sans fil","wireless earbuds"],
  ["écouteurs","earbuds"],
  ["sans fil","wireless"],
  ["coques pour","cases"],
  ["coque pour","case"],
  ["coques","cases"],
  ["coque","case"],
  // German: strictly product/attribute terms, no guessed brand equivalence.
  ["schutzhüllen","cases"],
  ["schutzhülle","case"],
  ["kopfhörer","headphones"],
  ["kabellos","wireless"],
  ["laufschuhe","running shoes"],
]);

const aliases=new Map();
for(const [original,canonical] of RETAIL_EQUIVALENCES){
  if(aliases.has(original))throw Error("DUPLICATE_RETAIL_EQUIVALENCE");
  aliases.set(original,canonical);
}
const escapeRegex=s=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const sorted=[...aliases.keys()].sort((a,b)=>b.length-a.length||a.localeCompare(b));
const pattern=new RegExp("(^| )("+sorted.map(escapeRegex).join("|")+")(?= |$)","gu");

export function canonicalizeForeignRetailTerms(value=""){
  const text=String(value||"");
  if(!text)return text;
  return text.replace(pattern,(_,prefix,original)=>prefix+aliases.get(original));
}
