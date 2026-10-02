import { parseMoney } from "./provider-utils.mjs";

const MAX_DEPTH = 14;
const MAX_ARRAY_ITEMS = 600;
const MAX_SCRIPT_BYTES = 1500000;

function firstValue(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function walkJson(node, visit, depth = 0, seen = new Set()) {
  if (!node || typeof node !== "object" || depth > MAX_DEPTH || seen.has(node)) return;
  seen.add(node);
  visit(node);
  if (Array.isArray(node)) {
    for (const item of node.slice(0, MAX_ARRAY_ITEMS)) walkJson(item, visit, depth + 1, seen);
    return;
  }
  for (const value of Object.values(node)) walkJson(value, visit, depth + 1, seen);
}

function parseScriptJson(html) {
  const payloads = [];
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(String(html || "")))) {
    const raw = match[1].trim();
    if (!raw || raw.length > MAX_SCRIPT_BYTES || !/^[\[{]/.test(raw)) continue;
    try { payloads.push(JSON.parse(raw)); } catch {}
  }
  return payloads;
}

function imageValue(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return imageValue(value[0]);
  if (value && typeof value === "object") {
    return firstValue(value, ["url","src","imageUrl","image_url","origin_image","thumbnail"]) || null;
  }
  return null;
}

function normalizeAvailability(value) {
  const text = String(value || "").toLowerCase();
  if (/in.?stock|available|instock|true|1/.test(text)) return "instock";
  if (/out.?of.?stock|sold.?out|unavailable|false|0/.test(text)) return "outofstock";
  return text;
}

function buildCandidate(node, config) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  const title = firstValue(node, config.titleKeys);
  const rawPrice = firstValue(node, config.priceKeys);
  const priceObject = rawPrice && typeof rawPrice === "object" ? rawPrice : null;
  const price = parseMoney(priceObject ? firstValue(priceObject, ["amount","value","price","salePrice"]) : rawPrice);
  const currency = firstValue(node, config.currencyKeys) ||
    (priceObject && firstValue(priceObject, ["currency","currencyCode","priceCurrency"]));
  if (typeof title !== "string" || title.trim().length < 3 || price === null || !currency) return null;

  const brandRaw = firstValue(node, config.brandKeys);
  const brand = typeof brandRaw === "string" ? brandRaw :
    brandRaw && firstValue(brandRaw, ["name","title","brandName"]);
  const image = imageValue(firstValue(node, config.imageKeys));
  const sku = firstValue(node, config.skuKeys);
  const availability = firstValue(node, config.availabilityKeys);

  return {
    name: title.trim(),
    image: image || null,
    brand: brand || null,
    sku: sku ? String(sku) : null,
    offers: {
      price,
      priceCurrency: String(currency).toUpperCase(),
      availability: normalizeAvailability(availability),
    },
  };
}

function score(candidate) {
  if (!candidate) return 0;
  let value = 1;
  if (candidate.image) value += 2;
  if (candidate.brand) value += 1;
  if (candidate.sku) value += 1;
  if (candidate.offers?.availability) value += 0.5;
  return value;
}

const COMMON = {
  brandKeys: ["brand","brandName","brand_name","designerName"],
  availabilityKeys: ["availability","stockStatus","stock_status","inventoryStatus","isInStock","inStock"],
};

export const DOMAIN_ADAPTERS = [
  {
    id: "shein",
    hosts: ["shein.com","shein.co.uk","shein.com.mx","shein.com.br"],
    titleKeys: ["goods_name","goodsName","productName","product_name","name","title"],
    priceKeys: ["salePrice","sale_price","retailPrice","retail_price","unitPrice","price"],
    currencyKeys: ["currency","currencyCode","priceCurrency","currency_code"],
    imageKeys: ["goods_img","goodsImg","goods_image","image","imageUrl","image_url"],
    skuKeys: ["goods_id","goodsId","sku","productId","product_id"],
    ...COMMON,
  },
  {
    id: "centrepoint",
    hosts: ["centrepointstores.com","centrepointstores.com.sa"],
    titleKeys: ["productName","product_name","name","title"],
    priceKeys: ["salePrice","sellingPrice","finalPrice","price","currentPrice"],
    currencyKeys: ["currency","currencyCode","priceCurrency"],
    imageKeys: ["image","imageUrl","image_url","thumbnail","primaryImage"],
    skuKeys: ["sku","productId","product_id","code"],
    ...COMMON,
  },
  {
    id: "maxfashion",
    hosts: ["maxfashion.com","maxfashion.com.sa"],
    titleKeys: ["productName","product_name","name","title"],
    priceKeys: ["salePrice","sellingPrice","finalPrice","price","currentPrice"],
    currencyKeys: ["currency","currencyCode","priceCurrency"],
    imageKeys: ["image","imageUrl","image_url","thumbnail","primaryImage"],
    skuKeys: ["sku","productId","product_id","code"],
    ...COMMON,
  },
];

export function findDomainAdapter(urlOrHost) {
  let host = String(urlOrHost || "").toLowerCase();
  try { host = new URL(urlOrHost).hostname.toLowerCase(); } catch {}
  host = host.replace(/^www\./, "");
  return DOMAIN_ADAPTERS.find((adapter) =>
    adapter.hosts.some((domain) => host === domain || host.endsWith("." + domain))
  ) || null;
}

export function extractDomainProduct(url, html) {
  const adapter = findDomainAdapter(url);
  if (!adapter) return null;

  const candidates = [];
  for (const payload of parseScriptJson(html)) {
    walkJson(payload, (node) => {
      const candidate = buildCandidate(node, adapter);
      if (candidate) candidates.push(candidate);
    });
  }

  candidates.sort((a,b) => score(b) - score(a));
  const product = candidates[0] || null;
  return product ? { adapterId: adapter.id, product } : null;
}
