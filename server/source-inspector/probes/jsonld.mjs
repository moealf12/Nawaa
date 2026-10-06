function flatten(value, out = []) {
  if (!value) return out;
  if (Array.isArray(value)) {
    for (const item of value) flatten(item, out);
    return out;
  }
  if (typeof value === "object") {
    out.push(value);
    if (value["@graph"]) flatten(value["@graph"], out);
    if (value.itemListElement) flatten(value.itemListElement.map((entry) => entry?.item || entry), out);
  }
  return out;
}

function firstOffer(product) {
  return Array.isArray(product?.offers) ? product.offers[0] : product?.offers || {};
}

function imageOf(product) {
  const image = Array.isArray(product?.image) ? product.image[0] : product?.image;
  return typeof image === "object" ? image?.url : image;
}

function brandOf(product) {
  return typeof product?.brand === "object" ? product.brand?.name : product?.brand;
}

export function extractJsonLdProducts(html = "") {
  const blocks = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(String(html)))) {
    try {
      flatten(JSON.parse(match[1].trim()), blocks);
    } catch {}
  }

  return blocks
    .filter((node) => {
      const type = node?.["@type"];
      return Array.isArray(type)
        ? type.some((value) => /product/i.test(String(value)))
        : /product/i.test(String(type || ""));
    })
    .map((product) => {
      const offer = firstOffer(product);
      return {
        sourceProductId: product.productID ?? product.sku ?? product.mpn ?? null,
        title: product.name ?? null,
        brand: brandOf(product) ?? null,
        model: product.model ?? null,
        sku: product.sku ?? null,
        gtin: product.gtin13 ?? product.gtin12 ?? product.gtin ?? null,
        mpn: product.mpn ?? null,
        price: Number(offer?.price ?? offer?.lowPrice ?? offer?.highPrice) || null,
        originalPrice: null,
        currency: offer?.priceCurrency ?? null,
        availability: offer?.availability ?? null,
        imageUrl: imageOf(product) ?? null,
        productUrl: product.url ?? offer?.url ?? null,
        raw: product,
      };
    });
}

export function probeJsonLd(html = "") {
  const products = extractJsonLdProducts(html);
  const priced = products.filter((product) => product.price > 0);
  return {
    strategy: "jsonld",
    ok: products.length > 0,
    blocks: products.length,
    products: products.length,
    pricedProducts: priced.length,
    coverage: products.length ? priced.length / products.length : 0,
    sample: products.slice(0, 3).map(({ raw, ...product }) => product),
  };
}
