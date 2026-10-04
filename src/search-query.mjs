// Shared by the API and browser: aliases affect matching and provider queries alike.
const ALIASES = [
  ["قهوه", "coffee"], ["بن", "coffee"], ["قميص", "shirt"], ["ملابس", "clothing"],
  ["اي فون", "iphone"], ["ايفون", "iphone"], ["اير بودز", "airpods"], ["ايربودز", "airpods"],
  ["بلاي ستيشن", "playstation"], ["بلايستيشن", "playstation"],
  ["سامسونج", "samsung"], ["جالاكسي", "galaxy"], ["جالكسي", "galaxy"],
  ["ابل", "apple"], ["دايسون", "dyson"], ["سوني", "sony"],
  ["سواروفسكي", "swarovski"], ["سوارفسكي", "swarovski"],
  ["شي ان", "shein"], ["شيين", "shein"], ["نايك", "nike"], ["اديداس", "adidas"],
  ["زارا", "zara"], ["اتش اند ام", "hm"], ["ايكيا", "ikea"], ["سيفورا", "sephora"],
  ["نمشي", "namshi"], ["سنتر بوينت", "centrepoint"], ["سنتر بوينتس", "centrepoint"],
  ["ماكس فاشن", "maxfashion"], ["ديكاتلون", "decathlon"], ["نايس ون", "niceone"],
  ["ايسر", "acer"], ["ايسير", "acer"], ["ام اس اي", "msi"],
  ["مايكروسوفت", "microsoft"], ["نينتندو", "nintendo"],
  ["كانون", "canon"], ["نيكون", "nikon"], ["ابسون", "epson"], ["براذر", "brother"],
  ["ال جي", "lg"], ["بوش", "bosch"], ["لوجيتك", "logitech"], ["جي بي ال", "jbl"], ["بوز", "bose"],
  ["هواوي", "huawei"], ["شاومي", "xiaomi"], ["هونر", "honor"], ["ون بلس", "oneplus"],
  ["اوبو", "oppo"], ["ريلمي", "realme"], ["نوكيا", "nokia"],
  ["قلاده", "necklace"], ["سلسال", "necklace"], ["عقد", "necklace"], ["تعليقه", "pendant"],
  ["اسوره", "bracelet"], ["سوار", "bracelet"], ["خاتم", "ring"], ["اقراط", "earrings"], ["قرط", "earrings"], ["مجوهرات", "jewelry"],
  ["ساعه", "watch"], ["ساعات", "watch"],
  ["فساتين", "dress"], ["فستان", "dress"], ["عبايات", "abaya"], ["عبايه", "abaya"],
  ["قمصان", "shirt"], ["بنطلون", "pants"], ["بناطيل", "pants"], ["جاكيت", "jacket"], ["جاكيتات", "jacket"],
  ["احذيه", "shoes"], ["حذاء", "shoes"], ["شنط", "bags"], ["شنطه", "bag"], ["حقائب", "bags"], ["حقيبه", "bag"],
  ["مكياج", "makeup"], ["عطر", "perfume"], ["عطور", "perfume"], ["عنايه بالبشره", "skincare"],
  ["اثاث", "furniture"], ["كنب", "sofa"], ["كرسي", "chair"], ["كراسي", "chair"], ["طاوله", "table"], ["طاولات", "table"],
  ["مطبخ", "kitchen"], ["العاب اطفال", "toys"], ["لعب اطفال", "toys"],
  ["كتب", "books"], ["كتاب", "book"], ["رياضه", "sports"], ["مستلزمات رياضيه", "sports"],
  ["حيوانات اليفه", "pet"], ["مستلزمات حيوانات", "pet"], ["سياره", "automotive"], ["سيارات", "automotive"],
  ["مكتب", "office"], ["مكتبيه", "office"], ["بقاله", "grocery"], ["مواد غذائيه", "grocery"],
  ["برو", "pro"], ["ماكس", "max"], ["بلس", "plus"], ["الترا", "ultra"], ["اير", "air"],
  ["جيجابايت", "gb"], ["جيجا بايت", "gb"], ["جيجا", "gb"], ["تيرابايت", "tb"],
  ["اسود", "black"], ["ابيض", "white"], ["لافندر", "lavender"], ["ازرق", "blue"],
  ["اخضر", "green"], ["ذهبي", "gold"], ["فضي", "silver"],
  ["كفر", "case"], ["حافظه", "case"], ["شاحن", "charger"], ["كيبل", "cable"],
  ["مجدد", "refurbished"], ["مستعمل", "used"], ["جديد", "new"],
  ["اشرطه", "games"], ["العاب", "games"], ["لعبه", "game"],
  ["جهاز", "console"], ["رقمي", "digital"], ["ديجيتال", "digital"], ["اقراص", "disc"], ["سليم", "slim"],
  ["يد تحكم", "controller"], ["يد", "controller"],
  ["اتش بي", "hp"], ["ديل", "dell"], ["لينوفو", "lenovo"], ["اسوس", "asus"],
  ["لابتوب", "laptop"], ["لابتوبات", "laptop"], ["لاب توب", "laptop"], ["حاسوب محمول", "laptop"],
  ["طابعه", "printer"], ["طابعات", "printer"], ["جوال", "phone"], ["جوالات", "phone"],
  ["تلفزيون", "tv"], ["تلفزيونات", "tv"], ["شاشه", "monitor"], ["شاشات", "monitor"],
  ["سماعات", "headphones"], ["سماعه", "headphones"], ["ماوس", "mouse"], ["كيبورد", "keyboard"],
];

export function normalizeSearchQuery(value = "") {
  let text = String(value).normalize("NFKC").toLowerCase()
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();

  text = text.replace(/\b(\d+)(?:st|nd|rd|th)\b/g, "$1")
    .replace(/([ء-ي])(?=\d)/g, "$1 ").replace(/(\d)(?=جيجا|تيرا)/g, "$1 ");
  for (const [alias, canonical] of ALIASES) {
    text = text.replace(new RegExp("(^| )" + alias + "(?= |$)", "g"), "$1" + canonical);
  }
  if (/\b(?:iphone|galaxy)\b/.test(text)) text = text.replace(/\b(64|128|256|512|1024)(?= |$)(?!\s+(?:gb|tb)\b)/g, "$1gb");
  return text.replace(/(^| )(?:ابغي|ابي|اريد|ابحث|عن|لي|بافضل|افضل|ارخص|سعر|اشتري|please|find)(?= |$)/g, " ")
    .replace(/\b(iphone|airpods|ps)\s*(\d+)/g, "$1 $2")
    .replace(/\bplaystation\s+(\d+)\b/g, "ps $1")
    .replace(/\bps\s+(\d+)\b/g, "ps$1")
    .replace(/\b(\d+)\s+(gb|tb|mb|mah|mp)\b/g, "$1$2")
    .replace(/\s+/g, " ").trim();
}

// Editorial category priorities, not measured popularity. Unknown brands use relevance.
export const BRAND_CATEGORY_PRIORITIES = {
  hp: ['laptop','printer','desktop','monitor'], dell: ['laptop','desktop','monitor'],
  lenovo: ['laptop','desktop','tablet','monitor'], asus: ['laptop','desktop','monitor','network'],
  acer: ['laptop','monitor','desktop'], msi: ['laptop','desktop','monitor'],
  apple: ['phone','laptop','tablet','watch','audio','desktop'],
  samsung: ['phone','tv','tablet','monitor','appliance','audio'],
  sony: ['tv','console','audio','camera','game'], microsoft: ['laptop','console','accessory'],
  nintendo: ['console','game','accessory'], canon: ['camera','printer'], nikon: ['camera'],
  epson: ['printer','projector'], brother: ['printer'], dyson: ['vacuum','beauty','appliance'],
  lg: ['tv','appliance','monitor','audio'], bosch: ['appliance','tool'],
  logitech: ['accessory','audio'], jbl: ['audio'], bose: ['audio'],
  huawei: ['phone','tablet','watch','audio','laptop'],
  xiaomi: ['phone','tablet','watch','appliance','audio'],
  honor: ['phone','tablet','laptop','watch','audio'],
  oneplus: ['phone','tablet','audio'], oppo: ['phone','tablet','audio'],
  realme: ['phone','tablet','audio'], nokia: ['phone','tablet'],
  swarovski: ['jewelry','watch','other','accessory'],
  shein: ['clothing','shoes','bag','beauty','home','jewelry'],
  nike: ['shoes','clothing','sports'], adidas: ['shoes','clothing','sports'],
  zara: ['clothing','shoes','bag'], hm: ['clothing','home'], ikea: ['furniture','home','kitchen'],
  sephora: ['beauty','perfume'],
  namshi: ['clothing','shoes','bag','beauty','sports'],
  centrepoint: ['clothing','shoes','bag','home','toy','baby'],
  maxfashion: ['clothing','shoes','bag','baby','home'],
  decathlon: ['sports','shoes','clothing','bag'],
  niceone: ['beauty','perfume','grocery'],
};
export const PRODUCT_CATEGORIES = [
  ['accessory','ملحقات وإكسسوارات', /\b(?:mouse|keyboard|charger|cable|adapter|adaptor|cases?|covers?|protector|cartridge|toner|ink|controller|dualsense|charging station|stick module|remote|gift card|atomizer|perfume bottle|empty bottle|laptop screen|replacement screen|replacement display|display panel|lcd panel|lcd screen)\b/],
  ['laptop','لابتوبات', /\b(?:laptops?|notebooks?|macbook|chromebook|zenbook|vivobook|thinkpad|ideapad|elitebook|probook|omnibook|spectre|envy|pavilion|inspiron|latitude|loq)\b/],
  ['printer','طابعات', /\b(?:printers?|laserjet|deskjet|officejet|ecotank|smart tank)\b/],
  ['desktop','كمبيوتر مكتبي', /\b(?:desktop|imac|mac mini|all in one|tower pc|optiplex|prodesk)\b/],
  ['phone','جوالات', /\b(?:phones?|smartphone|iphone|galaxy s\d+|galaxy a\d+|galaxy z|pixel \d+)\b/],
  ['tablet','أجهزة لوحية', /\b(?:tablets?|ipad|galaxy tab|surface pro)\b/],
  ['tv','تلفزيونات', /\b(?:tv|television|bravia|oled tv|qled tv)\b/],
  ['monitor','شاشات', /\b(?:monitors?|display screen)\b/],
  ['audio','سماعات وصوتيات', /\b(?:headphones?|earphones?|earbuds?|airpods|headset|speaker|soundbar|walkman)\b/],
  ['jewelry','مجوهرات', /\b(?:jewelry|jewellery|necklaces?|pendants?|bracelets?|bangles?|earrings?|rings?|brooch(?:es)?|charms?)\b/],
  ['watch','ساعات', /\b(?:watch|smartwatch)\b/],
  ['camera','كاميرات', /\b(?:camera|dslr|mirrorless|eos)\b/],
  ['vacuum','مكانس', /\b(?:vacuum|hoover|dyson v\d+)\b/],
  ['beauty','عناية شخصية', /\b(?:airwrap|supersonic|hair dryer|straightener|shaver|trimmer)\b/],
  ['appliance','أجهزة منزلية', /\b(?:refrigerator|fridge|washer|washing machine|dryer|dishwasher|oven|microwave|air conditioner|purifier|blender|kettle|coffee maker)\b/],
  ['network','شبكات', /\b(?:router|modem|wifi|wi fi|network switch)\b/],
  ['projector','بروجكترات', /\bprojector\b/],
  ['coffee','قهوة', /\b(?:coffee|ground coffee|coffee beans)\b/],
  ['clothing','ملابس وأزياء', /\b(?:clothing|fashion|dress(?:es)?|abaya|shirts?|tees?|t shirts?|hoodies?|pants?|jeans|jackets?|coats?|sweaters?|skirts?|blouses?|abito|abiti|robe|robes|kleid|kleider|vestido|vestidos|vestito|vestiti)\b/],
  ['shoes','أحذية', /\b(?:shoes?|sneakers?|boots?|sandals?|heels?|slippers?|loafers?)\b/],
  ['bag','حقائب', /\b(?:bags?|handbags?|backpacks?|luggage|wallets?|purses?|totes?)\b/],
  ['beauty','تجميل وعناية', /\b(?:makeup|cosmetics?|skincare|skin care|lipstick|mascara|foundation|serum|moisturizer|hair care)\b/],
  ['perfume','عطور', /\b(?:perfumes?|fragrances?|eau de parfum|eau de toilette|cologne)\b/],
  ['furniture','أثاث', /\b(?:furniture|sofas?|couches?|chairs?|tables?|desks?|beds?|wardrobes?|cabinets?)\b/],
  ['kitchen','مطبخ', /\b(?:kitchen|cookware|pans?|pots?|cutlery|tableware|air fryer|toaster|cooktop)\b/],
  ['home','منزل ومعيشة', /\b(?:home decor|bedding|duvet|pillows?|curtains?|rugs?|storage organizer|lighting|lamp)\b/],
  ['sports','رياضة', /\b(?:sports?|fitness|gym|running|football|soccer|basketball|cycling|camping|hiking)\b/],
  ['toy','ألعاب أطفال', /\b(?:toys?|dolls?|lego|building blocks|plush|kids game)\b/],
  ['baby','رضع وأمومة', /\b(?:baby|infant|stroller|diaper|feeding bottle|car seat)\b/],
  ['pet','مستلزمات حيوانات', /\b(?:pet|pets|cat food|dog food|cat litter|pet toy|pet bed)\b/],
  ['automotive','سيارات', /\b(?:automotive|car accessories|car part|engine oil|tire|tyre|brake|wiper)\b/],
  ['book','كتب', /\b(?:books?|paperback|hardcover|kindle)\b/],
  ['grocery','بقالة ومواد غذائية', /\b(?:grocery|groceries|snacks?|chocolate|tea|rice|pasta|cereal|spices?)\b/],
  ['office','مكتبية', /\b(?:office supplies|stationery|notebook|pens?|pencils?|paper shredder)\b/],
  ['tool','أدوات', /\b(?:drill|saw|screwdriver|power tool)\b/],
];
export function productCategory(offer = {}) {
  const gaming = describeProduct(offer);
  if (gaming.kind !== 'product') return gaming.kind;
  const text = normalizeSearchQuery([offer.title,offer.productType,offer.specs?.deviceType,offer.specs?.series].filter(Boolean).join(' ')).replace(/\b(?:backlit|integrated|built in) keyboard\b/g, '');
  const explicitTypes = ['accessory','printer','desktop'].map(key=>PRODUCT_CATEGORIES.find(([id])=>id===key));
  return explicitTypes.find(([, , pattern])=>pattern.test(text))?.[0] || PRODUCT_CATEGORIES.find(([, , pattern])=>pattern.test(text))?.[0] || 'other';
}
export function categoryLabel(key) {
  return PRODUCT_CATEGORIES.find(([id])=>id===key)?.[1] || ({console:'أجهزة ألعاب',game:'ألعاب',accessory:'ملحقات وإكسسوارات',other:'منتجات أخرى'})[key] || 'منتجات أخرى';
}

const MODEL_PATTERN = /\b(?:iphone (?:air|\d+)(?: pro(?: max)?| plus)?|galaxy s\d+(?: ultra| plus| fe)?|ps\d+(?: slim| pro)?|airpods(?: pro)?(?: \d+)?|dyson v\d+)\b/;

function explicitModels(value) {
  // Preserve merchant line/option boundaries before punctuation normalization
  // can turn "Galaxy S25 - Ultra Hybrid" into a different device model.
  return String(value).split(/\s+[-–—|·]\s+|\s*\/\s*/).flatMap(segment=>{
    const text=normalizeSearchQuery(segment);
    return [...text.matchAll(new RegExp(MODEL_PATTERN.source,'g'))]
      .filter(match=>!(/^\s+series\b/.test(text.slice(match.index+match[0].length)) &&
        /^(?:iphone \d+|galaxy s\d+|ps\d+|airpods(?: \d+)?|dyson v\d+)$/.test(match[0])))
      .map(match=>match[0]);
  });
}

export function parseSearchIntent(value = "") {
  const normalizedQuery = normalizeSearchQuery(value);
  const brand = Object.keys(BRAND_CATEGORY_PRIORITIES).find(name => (' '+normalizedQuery+' ').includes(' '+name+' ')) || null;
  const categoryDefinition = PRODUCT_CATEGORIES.find(([, , pattern]) => pattern.test(normalizedQuery));
  const kind = queryProductKind(normalizedQuery);
  const category = kind === 'console' || kind === 'game' ? kind : categoryDefinition?.[0] || (kind === 'accessory' ? 'accessory' : null);
  const residual = normalizedQuery.replace(categoryDefinition?.[2] || /$^/, ' ').split(' ').filter(token => token && token !== brand);
  const discoveryMode = !kind && !/\b\d+(?:gb|tb)\b/.test(normalizedQuery) && (residual.length === 0 || (!brand && !category && residual.length === 1)) ? (brand ? 'brand' : category ? 'category' : 'general') : 'specific';
  const condition = normalizedQuery.match(/\b(refurbished|used|new)\b/)?.[1] || null;
  return {
    normalizedQuery,
    providerQuery: normalizedQuery.replace(/\b(refurbished|used|new)\b/g, "").replace(/\s+/g," ").trim(),
    model: normalizedQuery.match(MODEL_PATTERN)?.[0] || null,
    storage: normalizedQuery.match(/\b\d+(?:gb|tb)\b/)?.[0] || null,
    color: normalizedQuery.match(/\b(?:mist blue|desert titanium|natural titanium|black titanium|white titanium|cosmic orange|deep blue|black|white|lavender|sage|silver|gold|blue|green)\b/)?.[0] || null,
    condition,
    kind, brand, category, discoveryMode,
  };
}

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildProviderFallbackQueries(value = "") {
  const intent = parseSearchIntent(value);
  const primary = intent.providerQuery;
  const candidates = [];
  const push = (candidate) => {
    candidate = normalizeSearchQuery(candidate);
    if (candidate.length >= 2 && candidate !== primary && !candidates.includes(candidate)) candidates.push(candidate);
  };

  // Preserve explicit condition in every relaxation. It is a shopper constraint,
  // not noise. Relax model/storage/color around it when recall needs expansion.
  const condition = intent.condition ? " " + intent.condition : "";

  // Broad brand discovery needs category expansion; otherwise a query such as
  // "hp" repeatedly asks providers for the same brand string and recall stalls.
  // Use the brand's known primary categories as distinct provider searches.
  if (intent.discoveryMode === "brand" && intent.brand && !intent.category && !intent.model) {
    for (const category of (BRAND_CATEGORY_PRIORITIES[intent.brand] || []).slice(0, 4)) {
      push(intent.brand + " " + category);
    }
  }

  if (intent.model && (intent.storage || intent.color)) push(intent.model + condition);

  let relaxed = primary;
  for (const phrase of [intent.storage, intent.color].filter(Boolean)) {
    relaxed = relaxed.replace(new RegExp("(^| )" + escapeRegex(phrase) + "(?= |$)", "g"), " ");
  }
  push(relaxed.replace(/\s+/g, " ").trim());

  if (intent.brand && intent.category) push(intent.brand + " " + intent.category + condition);
  if (intent.brand && (intent.storage || intent.color || intent.category)) push(intent.brand + condition);
  if (intent.category && (intent.storage || intent.color)) push(intent.category + condition);
  return candidates;
}

const GAMING_PLATFORM = /\b(?:ps[45]|xbox(?: series [sx])?|nintendo switch(?: 2)?)\b/;
const GAMING_ACCESSORY = /\b(?:controller|dualsense|dual sense|remote|camera|charging station|stick module|headset|adaptor|adapter|cover|case|accessory|accessories|gift card|recharge card)\b/;

function queryProductKind(query) {
  if (GAMING_PLATFORM.test(query)) {
    if (GAMING_ACCESSORY.test(query)) return "accessory";
    if (/\b(?:game|games)\b/.test(query)) return "game";
    const remainder = query.replace(GAMING_PLATFORM, "").replace(/\b(?:sony|microsoft|nintendo|console|slim|pro|digital|disc|edition|bundle|new|used|refurbished|black|white|\d+(?:gb|tb))\b/g, "").trim();
    return remainder ? "game" : "console";
  }
  return null;
}

export function describeProduct(offer = {}) {
  const title = normalizeSearchQuery(offer.title || "");
  const metadata = normalizeSearchQuery([offer.specs?.deviceType, offer.specs?.series].filter(Boolean).join(" "));
  const platform = title.match(GAMING_PLATFORM)?.[0] || metadata.match(GAMING_PLATFORM)?.[0] || null;
  const sku = String(offer.specs?.modelNumber || "").replace(/[^a-z0-9]/gi, "");
  const isBundle = /\bbundle\b/.test(title);
  let kind = "product";
  if (platform) {
    if (/\b(?:cover|case|accessory|accessories|gift card|recharge card)\b/.test(title + " " + metadata)) kind = "accessory";
    else if (GAMING_ACCESSORY.test(title) && !(isBundle && /\bconsole\b/.test(title))) kind = "accessory";
    else if (/\bconsole\b/.test(title) || /^CFI[127]\d/i.test(sku) || /\b(?:digital|disc) edition\b/.test(title) || /\b(?:825gb|1tb|2tb)\b/.test(title)) kind = "console";
    else if (/^(?:sony )?ps[45](?: slim| pro)?$/.test(title)) kind = "console";
    else kind = "game";
  }
  const edition = /\b(?:digital|dig)\b/.test(title + " " + metadata) ? "digital" : /\b(?:disc|blu ray)\b/.test(title) ? "disc" : null;
  const storage = normalizeSearchQuery(offer.specs?.storage || "").match(/\b\d+(?:gb|tb)\b/)?.[0] || title.match(/\b\d+(?:gb|tb)\b/)?.[0] || null;
  const form = /\bpro\b/.test(title) ? "Pro" : /\bslim\b/.test(title + " " + metadata) ? "Slim" : "";
  return {kind, platform, edition, storage, form, isBundle};
}

const ACCESSORY_TERMS = [
  "case","cover","screen protector","protector","charger","cable","adapter",
  "atomizer","perfume bottle","empty bottle","laptop screen","replacement screen","replacement display","display panel","lcd panel","lcd screen",
  "حافظه","كفر","شاحن","كيبل","سلك","حمايه","لزقه"
];

const UNREQUESTED_VARIANT_TERMS = [
  "pro","max","plus","ultra","air","fold","flip","fe",
  "برو","ماكس","بلس","الترا","اير"
];

export function assessOfferMatch(query, offer) {
  const intent = parseSearchIntent(query);
  const normalizedQuery = intent.providerQuery;
  const matchedCategory = PRODUCT_CATEGORIES.find(([, , pattern]) => pattern.test(normalizedQuery));
  const effectiveCategory = intent.category || matchedCategory?.[0] || null;
  const categoryPattern = matchedCategory?.[2] || /$^/;
  const categoryTokenRequested = Boolean(matchedCategory);
  const semanticQuery = normalizedQuery.replace(categoryPattern, " ").replace(/\s+/g, " ").trim();
  const q = semanticQuery.split(" ").filter(token => token && !["console", "game", "games"].includes(token));
  const title = normalizeSearchQuery([offer?.title, offer?.productType, offer?.brand, offer?.vendor, offer?.specs?.brand, offer?.specs?.storage, offer?.specs?.color].filter(Boolean).join(" "));
  if (!normalizedQuery || !title) return { exactMatch: false, matchConfidence: 0 };

  const titleTokens = new Set(title.split(" ").filter(Boolean));
  const hits = q.filter((token) => titleTokens.has(token)).length;
  let confidence = q.length ? hits / q.length : 1;
  const description = describeProduct(offer);
  const offerCategory = productCategory(offer);
  // Product-type words (mouse, laptop, perfume...) are structural intent rather
  // than free-text tokens: reward the matching category without polluting model/
  // variant token matching.
  if (categoryTokenRequested && effectiveCategory && offerCategory === effectiveCategory) {
    // The category term itself was removed from semanticQuery, so a matching
    // structural category is equivalent to that requested term matching.
    confidence = q.length ? Math.min(1, (hits + 1) / (q.length + 1)) : 1;
  }
  const kindMismatch = Boolean((intent.kind && intent.kind !== description.kind) || (effectiveCategory && effectiveCategory !== offerCategory));
  if (kindMismatch) confidence *= 0.2;

  const hasPhrase = (text, term) => (" " + text + " ").includes(" " + normalizeSearchQuery(term) + " ");
  // Brand-only discovery must not be hijacked by accessories merely carrying the brand
  // name (e.g. "Nike" returning Apple Watch Nike bands). Accessories are allowed only
  // when the shopper actually asks for an accessory or the brand itself is accessory-led.
  const accessoryLedBrands = new Set(["logitech"]);
  const explicitAccessoryQuery = PRODUCT_CATEGORIES.find(([key]) => key === "accessory")?.[2]?.test(normalizedQuery) || false;
  const queryHasAccessoryIntent = effectiveCategory === "accessory" ||
    explicitAccessoryQuery ||
    ACCESSORY_TERMS.some((term) => hasPhrase(normalizedQuery, term)) ||
    (intent.discoveryMode === "brand" && accessoryLedBrands.has(intent.brand));
  const titleHasAccessory = ACCESSORY_TERMS.some((term) => hasPhrase(title, term));
  if (!queryHasAccessoryIntent && titleHasAccessory) confidence *= 0.12;

  // For brand-only searches, prefer the brand's primary editorial categories and
  // strongly demote unrelated co-branded products.
  if (intent.discoveryMode === "brand" && intent.brand) {
    const offerCategory = productCategory(offer);
    const priorities = BRAND_CATEGORY_PRIORITIES[intent.brand] || [];
    const priorityIndex = priorities.indexOf(offerCategory);
    // Editorial brand priorities apply only to true brand-only discovery.
    // An explicit category such as "hp mouse" must not be demoted merely
    // because accessories are intentionally hidden from plain "hp".
    if (!categoryTokenRequested) {
      if (priorityIndex >= 0) confidence = Math.min(1, confidence + Math.max(0.08, 0.24 - priorityIndex * 0.04));
      else if (offerCategory) confidence *= 0.3;
    }
  }

  const queryTokens = new Set(q);
  const hasUnrequestedVariant = intent.discoveryMode === "specific" && (
    intent.model && intent.category === 'accessory'
      ? explicitModels([offer?.title,offer?.specs?.deviceType,offer?.specs?.series].filter(Boolean).join(' ')).some(model=>model!==intent.model)
      : UNREQUESTED_VARIANT_TERMS.some((term) => titleTokens.has(term) && !queryTokens.has(term))
  );
  if (hasUnrequestedVariant) confidence *= 0.82;

  const titleSignalsUsed = /\b(?:used|pre owned|pre-owned|b grade|c grade|grade [bc])\b/.test(title);
  const titleSignalsRefurbished = /\b(?:refurbished|renewed|remanufactured)\b/.test(title);
  const inferredTitleCondition = titleSignalsRefurbished ? "refurbished" : titleSignalsUsed ? "used" : null;
  const effectiveCondition = inferredTitleCondition || offer?.condition || null;
  const conditionMismatch = intent.condition ? effectiveCondition !== intent.condition : effectiveCondition && effectiveCondition !== "new";
  if (conditionMismatch) confidence -= 0.15;
  confidence = Math.max(0, Math.min(1, confidence));

  const missingTerms = q.filter((token) => !titleTokens.has(token));
  const structuralTermsMatch = !categoryTokenRequested || (effectiveCategory && offerCategory === effectiveCategory);
  const exactMatch = confidence >= 0.92 && hits === q.length && structuralTermsMatch &&
      !(!queryHasAccessoryIntent && titleHasAccessory) &&
      !hasUnrequestedVariant && !conditionMismatch && !kindMismatch;
  return {
    exactMatch,
    matchConfidence: Math.round(confidence * 100) / 100,
    missingTerms,
    productKind: description.kind,
    matchReason: exactMatch ? "يطابق مواصفات بحثك" : kindMismatch ?
      (description.kind === "game" ? "لعبة للجهاز، وليست الجهاز نفسه" : description.kind === "accessory" ? "ملحق للجهاز، وليس الجهاز نفسه" : "نوع المنتج يختلف عن المطلوب") : conditionMismatch ? "حالة المنتج تختلف عن المطلوب" :
      !queryHasAccessoryIntent && titleHasAccessory ? "ملحق للمنتج، وليس الجهاز المطلوب" :
      hasUnrequestedVariant ? "نسخة مختلفة عن الموديل المطلوب" : "بعض مواصفات البحث غير موجودة في بيانات العرض",
  };
}

export function buildComparisonQuery(offer = {}) {
  const specs = offer.specs || {};
  const title = normalizeSearchQuery(String(offer.title || "").split("|")[0]);
  const knownModel = title.match(/\biphone (?:air|\d+)(?: pro(?: max)?| plus| air)?\b/)?.[0];
  const model = normalizeSearchQuery(specs.deviceType || specs.series || knownModel || "");
  const storage = normalizeSearchQuery(specs.storage || title.match(/\b\d+(?:gb|tb)\b/)?.[0] || "");
  const color = normalizeSearchQuery(specs.color || title.match(/\b(?:mist blue|desert titanium|natural titanium|black titanium|white titanium|cosmic orange|deep blue|black|white|lavender|sage|silver|gold|blue|green)\b/)?.[0] || "");
  return (model ? [model, storage, color].filter(Boolean).join(" ") : title).slice(0, 180).trim();
}

// Shared by provider output and the stricter source audit. Metadata may not
// hide a contradictory model or storage capacity explicitly present in a title.
export function queryMatchReasons(query, offer) {
  const reasons = [];
  const match = assessOfferMatch(query, offer);
  const { model, storage } = parseSearchIntent(query);
  const models = [offer?.title, offer?.specs?.deviceType, offer?.specs?.series, offer?.specs?.modelNumber]
    .filter(Boolean).flatMap(explicitModels);
  const titleModels = [offer?.title,offer?.specs?.deviceType].filter(Boolean).flatMap(explicitModels);
  if (model && models.some(value => value !== model)) reasons.push('model_conflict');
  const storageText = normalizeSearchQuery([offer?.title, offer?.specs?.storage].filter(Boolean).join(' '))
    .replace(/\b\d+(?:gb|tb)\s+(?:ram|رام)\b|\b(?:ram|رام)\s+\d+(?:gb|tb)\b/g, ' ');
  const capacities = storageText.match(/\b\d+(?:gb|tb)\b/g) || [];
  if (storage && capacities.some(value => value !== storage)) reasons.push('capacity_conflict');
  // Generic brand/category searches should retain strongly relevant products;
  // exact-match is reserved for model/variant-sensitive queries.
  const genericIntent = !model && !storage;
  if ((genericIntent ? match.matchConfidence < 0.65 : !match.exactMatch) || (model && !titleModels.includes(model))) reasons.push('query_mismatch');
  return reasons;
}

export function filterQueryOffers(query, offers) {
  const retained = offers.filter(offer => queryMatchReasons(query, offer).length === 0);
  return { offers: retained, queryFilter: { input: offers.length, retained: retained.length, removed: offers.length - retained.length } };
}

function comparisonUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|campaign|gclid|fbclid|gad_|gbraid|wbraid)/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch { return String(value || ""); }
}

export function mergeComparisonOffers(source, candidates = []) {
  const query = buildComparisonQuery(source);
  const normalizeSku = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const sku = normalizeSku(source.specs?.modelNumber);
  const seen = new Set([comparisonUrl(source.sourceUrl)]);
  const offers = [{ ...source, exactMatch: true, matchConfidence: 1 }];
  for (const offer of candidates) {
    const url = comparisonUrl(offer.sourceUrl);
    if (url && seen.has(url)) continue;
    if (url) seen.add(url);
    const match = assessOfferMatch(query, offer);
    const candidateSku = normalizeSku(offer.specs?.modelNumber);
    const conflictingSku = sku && candidateSku && sku !== candidateSku;
    const conflictingCondition = source.condition !== offer.condition;
    offers.push({ ...offer, ...match,
      exactMatch: match.exactMatch && !conflictingSku && !conflictingCondition,
      matchConfidence: conflictingSku || conflictingCondition ? Math.min(match.matchConfidence, 0.69) : match.matchConfidence,
    });
  }
  return offers;
}
