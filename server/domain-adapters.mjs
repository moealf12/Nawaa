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

function extractBalancedJson(raw, marker) {
  const markerIndex = raw.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = raw.indexOf("{", markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < raw.length && i - start <= MAX_SCRIPT_BYTES; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(raw.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function parseScriptJson(html) {
  const payloads = [];
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  const assignmentMarkers = [
    "window.gbRawData",
    "gbRawData",
    "window.__INITIAL_STATE__",
    "__INITIAL_STATE__",
    "window.__PRELOADED_STATE__",
    "__PRELOADED_STATE__",
    "productIntroData",
    "goodsDetail",
  ];
  let match;
  while ((match = re.exec(String(html || "")))) {
    const raw = match[1].trim();
    if (!raw || raw.length > MAX_SCRIPT_BYTES) continue;
    if (/^[\[{]/.test(raw)) {
      try { payloads.push(JSON.parse(raw)); } catch {}
    }
    for (const marker of assignmentMarkers) {
      const parsed = extractBalancedJson(raw, marker);
      if (parsed) payloads.push(parsed);
    }
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
  if (/out.?of.?stock|sold.?out|unavailable|false|^0$/.test(text)) return "outofstock";
  if (/in.?stock|\bavailable\b|instock|true|^1$/.test(text)) return "instock";
  return text;
}

function normalizeCurrency(value) {
  const text = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  const aliases = {
    SR: "SAR",
    "S.R": "SAR",
    "S.R.": "SAR",
    "ر.س": "SAR",
    DHS: "AED",
    DH: "AED",
    "د.إ": "AED",
  };
  return aliases[text] || text;
}

function buildCandidate(node, config) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  const title = firstValue(node, config.titleKeys);
  const rawPrice = firstValue(node, config.priceKeys);
  const priceObject = rawPrice && typeof rawPrice === "object" ? rawPrice : null;
  const price = parseMoney(priceObject ? firstValue(priceObject, ["amount","value","price","salePrice","formattedValue"]) : rawPrice);
  const currency = firstValue(node, config.currencyKeys) ||
    (priceObject && firstValue(priceObject, ["currency","currencyCode","priceCurrency","currencyIso"]));
  if (typeof title !== "string" || title.trim().length < 3 || price === null || !currency) return null;

  const brandRaw = firstValue(node, config.brandKeys);
  const brand = typeof brandRaw === "string" ? brandRaw :
    brandRaw && firstValue(brandRaw, ["name","title","brandName"]);
  const image = imageValue(firstValue(node, config.imageKeys));
  const sku = firstValue(node, config.skuKeys);
  const pageId = config.pageIdKeys ? firstValue(node, config.pageIdKeys) : null;
  const availability = firstValue(node, config.availabilityKeys);

  return {
    name: title.trim(),
    image: image || null,
    brand: brand || null,
    sku: sku ? String(sku) : null,
    offers: {
      price,
      priceCurrency: normalizeCurrency(currency),
      availability: normalizeAvailability(availability),
    },
    _pageId: pageId ? String(pageId) : null,
  };
}

function score(candidate, pageProductId = null) {
  if (!candidate) return 0;
  let value = 1;
  if (candidate.image) value += 2;
  if (candidate.brand) value += 1;
  if (candidate.sku) value += 1;
  if (candidate.offers?.availability) value += 0.5;
  if (pageProductId && candidate._pageId && String(candidate._pageId) === String(pageProductId)) value += 8;
  return value;
}

function productIdFromUrl(url, adapterId) {
  const href = String(url || "");
  if (adapterId === "shein") {
    return href.match(/-p-(\d+)\.html/i)?.[1] || href.match(/[?&]goods_id=(\d+)/i)?.[1] || null;
  }
  if (adapterId === "newegg") {
    return href.match(/\/p\/([A-Z0-9-]+)/i)?.[1] || null;
  }
  if (adapterId === "asos") {
    return href.match(/\/prd\/(\d+)/i)?.[1] || null;
  }
  return null;
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
    priceKeys: ["salePrice","sale_price","retailPrice","retail_price","unitPrice","price","priceData"],
    currencyKeys: ["currency","currencyCode","priceCurrency","currency_code"],
    imageKeys: ["goods_img","goodsImg","goods_image","image","imageUrl","image_url","mainImage"],
    skuKeys: ["goods_sn","goodsSn","sku","goods_id","goodsId","productId","product_id"],
    pageIdKeys: ["goods_id","goodsId","productId","product_id"],
    ...COMMON,
  },
  {
    id: "asos",
    hosts: ["asos.com"],
    titleKeys: ["name","title","productName"],
    priceKeys: ["price","currentPrice","salePrice"],
    currencyKeys: ["currency","priceCurrency"],
    imageKeys: ["image","imageUrl"],
    skuKeys: ["productId","id","sku"],
    pageIdKeys: ["productId","id"],
    ...COMMON,
  },
  {
    id: "newegg",
    hosts: ["newegg.com"],
    titleKeys: ["Description","description","Title","title","productTitle","ProductTitle","name"],
    priceKeys: ["FinalPrice","finalPrice","CurrentPrice","currentPrice","SalePrice","salePrice","price","Price"],
    currencyKeys: ["CurrencyCode","currencyCode","currency","Currency","priceCurrency"],
    imageKeys: ["Image","image","ImageUrl","imageUrl","ItemCellImageName","itemCellImageName","thumbnail"],
    skuKeys: ["ItemNumber","itemNumber","ItemNo","itemNo","sku","Sku","productId"],
    pageIdKeys: ["ItemNumber","itemNumber","ItemNo","itemNo","sku","Sku","productId"],
    ...COMMON,
  },
  {
    id: "centrepoint",
    hosts: ["centrepointstores.com","centrepointstores.com.sa"],
    titleKeys: ["productName","product_name","name","title"],
    priceKeys: ["salePrice","sellingPrice","finalPrice","price","currentPrice","priceData"],
    currencyKeys: ["currency","currencyCode","priceCurrency","currencyIso"],
    imageKeys: ["image","imageUrl","image_url","thumbnail","primaryImage","productImage"],
    skuKeys: ["sku","productId","product_id","code"],
    ...COMMON,
  },
  {
    id: "maxfashion",
    hosts: ["maxfashion.com","maxfashion.com.sa"],
    titleKeys: ["productName","product_name","name","title"],
    priceKeys: ["salePrice","sellingPrice","finalPrice","price","currentPrice","priceData"],
    currencyKeys: ["currency","currencyCode","priceCurrency","currencyIso"],
    imageKeys: ["image","imageUrl","image_url","thumbnail","primaryImage","productImage"],
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


function decodeHtmlText(value = "") {
  return String(value || "")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function extractAsosHtmlProduct(html, url) {
  const source = String(html || "");
  const responseMatch = source.match(/stockPriceResponse\s*=\s*'([\\s\\S]*?)';/i);
  if (!responseMatch) return null;
  let rows;
  try {
    const decoded = responseMatch[1]
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
    rows = JSON.parse(decoded);
  } catch { return null; }
  const pageId = productIdFromUrl(url, "asos");
  const row = Array.isArray(rows)
    ? (rows.find((item) => String(item?.productId) === String(pageId)) || rows[0])
    : null;
  const price = parseMoney(row?.productPrice?.current?.value);
  const currency = normalizeCurrency(row?.productPrice?.currency);
  if (price === null || !currency) return null;
  const title =
    source.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    source.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1] ||
    source.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
    "ASOS product";
  const image =
    source.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    source.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1] ||
    null;
  return {
    name: decodeHtmlText(title),
    image,
    brand:null,
    sku:pageId,
    offers:{ price, priceCurrency:currency, availability:"" },
  };
}

function extractNeweggHtmlProduct(html) {
  const source = String(html || "");
  const title =
    source.match(/<h1[^>]*class=["'][^"']*product-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
    source.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    source.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1] ||
    null;
  const priceMatch =
    source.match(/class=["'][^"']*price-current[^"']*["'][^>]*>[\s\S]*?<strong>([\d,]+)<\/strong>[\s\S]*?<sup>\.?(\d{1,2})<\/sup>/i) ||
    source.match(/"price"\s*:\s*"?([0-9]+(?:\.[0-9]{1,2})?)"?/i);
  const image =
    source.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    source.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1] ||
    null;
  const integer = priceMatch?.[1]?.replace(/,/g, "");
  const price = priceMatch
    ? Number(priceMatch[2] !== undefined ? integer + "." + priceMatch[2] : integer)
    : null;
  if (!title || !Number.isFinite(price)) return null;
  return {
    name: decodeHtmlText(title),
    image: image || null,
    brand: null,
    sku: null,
    offers: { price, priceCurrency:"USD", availability:"" },
  };
}

export function extractDomainProduct(url, html) {
  const adapter = findDomainAdapter(url);
  if (!adapter) return null;

  const candidates = [];
  if (adapter.id === "asos") {
    const htmlProduct = extractAsosHtmlProduct(html, url);
    if (htmlProduct) candidates.push(htmlProduct);
  }
  if (adapter.id === "newegg") {
    const htmlProduct = extractNeweggHtmlProduct(html);
    if (htmlProduct) candidates.push(htmlProduct);
  }
  for (const payload of parseScriptJson(html)) {
    walkJson(payload, (node) => {
      const candidate = buildCandidate(node, adapter);
      if (candidate) candidates.push(candidate);
    });
  }

  const pageProductId = productIdFromUrl(url, adapter.id);
  candidates.sort((a,b) => score(b, pageProductId) - score(a, pageProductId));
  const product = candidates[0] || null;
  if (product) delete product._pageId;
  return product ? { adapterId: adapter.id, product } : null;
}
