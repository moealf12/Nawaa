// Resolve only Schema.org evidence already present in a single fetched HTML document.
// References are looked up by exact @id in this document: NEVER issue network requests.
const MAX_NODES = 512;
const MAX_VARIANTS = 100;

function hasType(node, name) {
  const values = Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]];
  return values.some(value => {
    const kind = String(value || "").toLowerCase().replace(/\/$/, "").split(/[\/#]/).pop();
    return kind === name.toLowerCase();
  });
}
function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function list(value) { return Array.isArray(value) ? value : value ? [value] : []; }

export function resolveStructuredProductNodes(nodes = []) {
  const capped = Array.isArray(nodes) ? nodes.slice(0, MAX_NODES) : [];
  const byId = new Map(), duplicateIds = new Set();
  for (const node of capped) {
    if (!isObject(node) || typeof node["@id"] !== "string") continue;
    const id = node["@id"];
    if (!id || id.length > 1024) continue;
    if (byId.has(id)) duplicateIds.add(id);
    else byId.set(id, node);
  }
  const dereference = value => {
    if (!isObject(value)) return null;
    const id = value["@id"];
    if (typeof id !== "string" || !id) return value;
    if (duplicateIds.has(id)) return null;
    const indexed = byId.get(id);
    // A pure @id link is meaningful only when its target exists here.
    if (Object.keys(value).length === 1) return indexed || null;
    // Reject conflicting inline and graph evidence for a shared identifier.
    if (indexed && indexed !== value) {
      if (JSON.stringify(indexed) !== JSON.stringify(value)) return null;
    }
    return value;
  };
  const resolvedOffers = product => {
    const raw = product?.offers;
    // Do not treat nested AggregateOffer or unrelated Offer nodes as a
    // purchaser-selected product offer.
    if (!raw) return null;
    const arr = list(raw);
    return arr.map(value => {
      const offer = dereference(value);
      if (!offer || !hasType(offer, "Offer") && offer["@type"]) return { "@type":"UnverifiedOffer" };
      if (hasType(offer, "AggregateOffer")) return { "@type":"AggregateOffer" };
      return offer;
    });
  };

  const groupedIds = new Set();
  const groups = [];
  for (const group of capped.filter(node => hasType(node, "ProductGroup"))) {
    const declared = list(group.hasVariant);
    if (!declared.length || declared.length > MAX_VARIANTS) continue;
    const variants = declared.map(dereference);
    // Reserve every declared child @id even if the referenced node is absent,
    // malformed or ambiguous. Otherwise a surviving sibling can leak its price
    // into an incomplete group's generic product page.
    for (const declaredVariant of declared) {
      if (typeof declaredVariant?.["@id"] === "string") groupedIds.add(declaredVariant["@id"]);
    }
    for (const variant of variants) {
      if (variant && hasType(variant, "Product") && typeof variant["@id"] === "string") {
        groupedIds.add(variant["@id"]);
      }
    }
    // No partial acceptance: one unresolved/mismatched referenced variant
    // means the group cannot be assigned an individual purchasable price.
    const complete = variants.every(value => value && hasType(value, "Product"));
    if (!complete) {
      groups.push({ "@type":"Product",name:group.name || null,brand:group.brand || null,
        offers:declared.map(() => ({ "@type":"UnverifiedOffer" })) });
      continue;
    }
    const offers = variants.flatMap(variant => {
      if (typeof variant["@id"] === "string") groupedIds.add(variant["@id"]);
      const associated = resolvedOffers(variant);
      if (!associated?.length) return [{ "@type":"UnverifiedOffer" }];
      return associated.map(offer => ({
        ...offer,
        // Identity metadata belongs to THIS declared variant, never a sibling.
        sku:offer.sku || variant.sku || null,
        mpn:offer.mpn || variant.mpn || null,
        name:offer.name || variant.name || null,
        url:offer.url || variant.url || null,
        image:offer.image || variant.image || null,
        color:offer.color || variant.color || null,
      }));
    });
    groups.push({
      "@type":"Product",
      name:group.name || null,
      brand:group.brand || null,
      model:group.model || null,
      // A generic group intentionally has multiple offers; its resolver
      // must NOT choose the first/lowest priced variant.
      offers,
    });
  }

  const individual = capped
    .filter(node => hasType(node, "Product") && !groupedIds.has(node?.["@id"]))
    .map(node => {
      const offers=resolvedOffers(node);
      return offers ? { ...node, offers: offers.length===1 ? offers[0] : offers } : node;
    });
  return [...groups, ...individual];
}
