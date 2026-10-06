function flatten(value, out = []) {
  if (!value) return out;
  if (Array.isArray(value)) {
    for (const item of value) flatten(item, out);
    return out;
  }
  if (typeof value === "object") {
    out.push(value);
    if (value["@graph"]) flatten(value["@graph"], out);
  }
  return out;
}

export function probeJsonLd(html = "") {
  const blocks = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(String(html)))) {
    try {
      const parsed = JSON.parse(match[1].trim());
      flatten(parsed, blocks);
    } catch {}
  }
  const products = blocks.filter((node) => {
    const type = node?.["@type"];
    return Array.isArray(type) ? type.some((v) => /product/i.test(String(v))) : /product/i.test(String(type || ""));
  });
  const priced = products.filter((p) => {
    const offers = Array.isArray(p.offers) ? p.offers : [p.offers].filter(Boolean);
    return offers.some((o) => Number(o?.price ?? o?.lowPrice ?? o?.highPrice) > 0);
  });
  return {
    strategy: "jsonld",
    ok: products.length > 0,
    blocks: blocks.length,
    products: products.length,
    pricedProducts: priced.length,
    coverage: products.length ? priced.length / products.length : 0,
  };
}
