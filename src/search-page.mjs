import {
  DEMO_CATALOG,
  findBestProduct,
  isLikelyUrl,
  rankOffers,
  summarizeOffers,
  groupComparableOffers,
  groupVariantFamilies,
  buildVariantSelectorState,
  buildCanonicalProductProfile,
  buildOfferIntelligence,
} from "./search-core.mjs";

const $ = (selector) => document.querySelector(selector);
const els = {
  form: $("#searchForm"),
  input: $("#searchInput"),
  results: $("#results"),
  recent: $("#recentSearches"),
  chips: $("#modeChips"),
  urlHint: $("#urlHint"),
  status: $("#searchStatus"),
  quoteModal: $("#quoteModal"),
  quoteBody: $("#quoteBody"),
  quoteClose: $("#quoteClose"),
};

const state = {
  mode: "lowest",
  product: null,
  query: "",
  variantSelections: {},
  selectorSelection: {},
};

const nf = new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 2 });
const fmt = (v) => Number.isFinite(v) ? nf.format(v) + " ر.س" : "غير مؤكد";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function readRecent() {
  try {
    return JSON.parse(localStorage.getItem("nawaa_recent_searches") || "[]").slice(0, 5);
  } catch {
    return [];
  }
}

function saveRecent(query) {
  if (!query || isLikelyUrl(query)) return;
  const next = [query, ...readRecent().filter((item) => item !== query)].slice(0, 5);
  localStorage.setItem("nawaa_recent_searches", JSON.stringify(next));
  renderRecent();
}

function renderRecent() {
  const items = readRecent();
  if (!items.length) {
    els.recent.innerHTML = '<span class="recent-label">جرّب:</span><button data-query="AirPods Pro 2 USB-C">AirPods Pro 2</button><button data-query="Dyson V15">Dyson V15</button><button data-query="PS5 Slim Disc">PS5 Slim</button>';
  } else {
    els.recent.innerHTML = '<span class="recent-label">آخر عمليات البحث:</span>' +
      items.map((item) => '<button data-query="' + escapeHtml(item) + '">' + escapeHtml(item) + '</button>').join("");
  }

  els.recent.querySelectorAll("button[data-query]").forEach((button) => {
    button.addEventListener("click", () => {
      els.input.value = button.dataset.query;
      runSearch(button.dataset.query);
    });
  });
}

async function renderUrlState(query) {
  els.urlHint.hidden = false;
  els.results.innerHTML = "";
  els.status.textContent = "تم اكتشاف رابط منتج";

  const apiBase = String(window.NAWAA_API_BASE || "").replace(/\/$/, "");
  if (apiBase) {
    els.urlHint.innerHTML = `
      <div>
        <span class="mini-kicker">PRODUCT URL DETECTED</span>
        <strong>نستخرج بيانات المنتج من الرابط…</strong>
        <p>نحاول قراءة هوية المنتج والسعر والعملة من البيانات المنظمة في الصفحة، ثم نحول السعر إلى الريال بدون تخمين الشحن أو الرسوم.</p>
      </div>
    `;
    try {
      const response = await fetch(apiBase + "/api/resolve-url?url=" + encodeURIComponent(query), {
        headers: { accept: "application/json" },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.message || data?.error || "url_resolution_failed");

      const offer = data.offer;
      const liveProduct = {
        id: null,
        brand: "رابط مباشر",
        model: offer.title || "منتج خارجي",
        variant: offer.originalCurrency || "",
        nameAr: offer.title || "منتج من رابط خارجي",
        nameEn: offer.title || "External product",
        aliases: [],
        identifiers: [],
        offers: [offer],
      };

      state.product = liveProduct;
      renderProduct(liveProduct, query);
      els.urlHint.innerHTML = `
        <div>
          <span class="mini-kicker">URL RESOLVED</span>
          <strong>${escapeHtml(offer.title || "تم استخراج المنتج")}</strong>
          <p>${countryFlag(offer.merchantCountryCode)} ${escapeHtml(offer.merchantCountryNameAr || "دولي")} · ${offer.originalProductPrice ?? "—"} ${escapeHtml(offer.originalCurrency || "")} · السعر المحول للريال يظهر ضمن النتيجة إن توفرت العملة.</p>
        </div>
        <a class="secondary-action" href="${escapeHtml(offer.sourceUrl || query)}" target="_blank" rel="noopener">فتح المصدر ↗</a>
      `;
      els.status.textContent = "تم استخراج بيانات المنتج من الرابط";
      return;
    } catch (error) {
      console.warn("NAWAA URL resolver failed", error);
    }
  }

  els.urlHint.innerHTML = `
    <div>
      <span class="mini-kicker">PRODUCT URL DETECTED</span>
      <strong>اكتشفنا الرابط، لكن تعذر استخراج بياناته تلقائيًا.</strong>
      <p>نقدر نحفظه كمسودة طلب تسعيرة بدون ادعاء وجود سعر أو تكلفة شحن مؤكدة.</p>
    </div>
    <button class="secondary-action" id="urlQuoteBtn">احفظ كطلب تسعيرة</button>
  `;
  $("#urlQuoteBtn").addEventListener("click", () => openQuote({
    nameAr: "منتج من رابط خارجي",
    nameEn: query,
    model: "بانتظار الاستخراج",
    variant: "",
  }, null, query));
}

function priceBreakdown(offer) {
  return [
    ["سعر المنتج", offer.productPrice],
    ["الشحن", offer.shipping],
    ["الاستيراد", offer.importCost],
    ["الضريبة", offer.tax],
    ["الرسوم الإلزامية", offer.mandatoryFees],
    ["الخصم المؤكد", Number.isFinite(offer.discount) ? -offer.discount : null],
  ].map(([label, value]) => `
    <div><span>${label}</span><b>${Number.isFinite(value) ? fmt(value) : "غير مؤكد"}</b></div>
  `).join("");
}

function bucketLabel(bucket) {
  return ({
    confirmed: "إجمالي مؤكد",
    estimated: "إجمالي تقديري",
    probable: "مطابقة محتملة",
    incomplete: "تكلفة غير مكتملة",
    ineligible: "غير مؤهل للمقارنة",
  })[bucket] || bucket;
}

function countryFlag(code = "") {
  const cc = String(code).toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "🌐";
  return String.fromCodePoint(...[...cc].map((char) => 127397 + char.charCodeAt(0)));
}

function specEntries(offer) {
  const specs = offer.specs || {};
  const items = [
    ["اللون", specs.color],
    ["السعة", specs.storage],
    ["الذاكرة", specs.ram],
    ["المعالج", specs.processor],
    ["الشاشة", specs.screenSize],
    ["نوع الشاشة", specs.screenType],
    ["الشبكة", specs.network],
    ["الشريحة", specs.sim],
    ["النظام", specs.operatingSystem],
    ["الكاميرا الخلفية", specs.rearCamera],
    ["الكاميرا الأمامية", specs.frontCamera],
    ["البطارية", specs.battery],
    ["مقاومة الماء", specs.waterproof],
  ];
  return items.filter(([, value]) => value !== null && value !== undefined && String(value).trim()).slice(0, 10);
}

function specsMarkup(offer) {
  const items = specEntries(offer);
  if (!items.length) return '<span class="spec-empty">المواصفات التفصيلية غير متاحة من هذا المصدر حاليًا</span>';
  return items.map(([label, value]) =>
    '<span class="spec-chip"><small>' + escapeHtml(label) + '</small><b>' + escapeHtml(value) + '</b></span>'
  ).join("");
}

function availabilityMarkup(offer) {
  const parts = [];
  if (offer.sourceMeta?.jeddahInStock === true) parts.push('<span class="availability yes">● متوفر في جدة</span>');
  else if (offer.sourceMeta?.jeddahInStock === false) parts.push('<span class="availability no">● غير متوفر حاليًا في جدة</span>');
  if (offer.sourceMeta?.homeDeliveryEnabled === true) parts.push('<span class="availability">توصيل منزلي ✓</span>');
  if (offer.sourceMeta?.collectFromStoreEnabled === true) parts.push('<span class="availability">استلام من المعرض ✓</span>');
  return parts.join("");
}

function offerCard(offer, index) {
  const best = index === 0 && offer.bucket === "confirmed";
  const eta = Number.isFinite(offer.deliveryDays) ? offer.deliveryDays + " يوم" : "غير مؤكد";
  const title = offer.sourceMeta?.nameAr || offer.title || offer.merchant;
  const modelNumber = offer.specs?.modelNumber;
  const media = offer.image
    ? '<img src="' + escapeHtml(offer.image) + '" alt="' + escapeHtml(title) + '" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'grid\';"><span class="offer-image-fallback">لا توجد صورة</span>'
    : '<span class="offer-image-fallback visible">لا توجد صورة</span>';

  return `
    <article class="offer-card ${best ? "is-best" : ""}">
      <div class="offer-rank">${best ? "BEST" : String(index + 1).padStart(2, "0")}</div>

      <div class="offer-image">
        ${media}
      </div>

      <div class="offer-product">
        <div class="offer-product-top">
          <div>
            <h3>${escapeHtml(title)}</h3>
            <p>${modelNumber ? "رقم الموديل " + escapeHtml(modelNumber) + " · " : ""}${escapeHtml(offer.condition === "new" ? "جديد" : offer.condition || "")}</p>
          </div>
          <div class="offer-store">
            <strong><span class="country-flag" title="${escapeHtml(offer.merchantCountryNameAr || "دولة المصدر")}">${countryFlag(offer.merchantCountryCode)}</span> ${escapeHtml(offer.merchant)}</strong>
            <span>${escapeHtml(offer.merchantCountryNameAr || "دولي")} · ${offer.dataKind === "verified_source" ? "مصدر موثق" : offer.dataKind === "live" ? "بحث حي" : "بيانات اختبار"} · ${bucketLabel(offer.bucket)} · تطابق ${Math.round((offer.matchConfidence || 0) * 100)}%</span>
          </div>
        </div>

        <div class="spec-grid">${specsMarkup(offer)}</div>
        <div class="availability-row">
          ${availabilityMarkup(offer)}
          <span class="availability">الوصول: ${eta}</span>
        </div>

        <div class="offer-links">
          <button class="product-detail-btn" type="button" data-source="${escapeHtml(offer.sourceUrl || "")}">عرض التفاصيل</button>
          ${offer.sourceUrl ? '<a class="offer-source-link" href="' + escapeHtml(offer.sourceUrl) + '" target="_blank" rel="noopener">فتح المصدر ↗</a>' : ""}
        </div>
      </div>

      <div class="offer-price">
        <small>${offer.totalSAR === null ? "السعر المعلن" : "الإجمالي المقارن"}</small>
        <strong>${offer.totalSAR === null ? fmt(offer.productPrice) + " +" : fmt(offer.totalSAR)}</strong>
        <span>${offer.totalSAR === null ? "الشحن/الرسوم غير مكتملة" : "يشمل العناصر المؤكدة"}</span>
      </div>
    </article>
  `;
}

function offerComparisonRow(offer, index, group, intelligence = null) {
  const intel = intelligence?.rows?.find((row) => row.offer === offer) || null;
  const isLowest = intel ? intel.offer === intelligence.baselineOffer : index === 0;
  const price = intel?.value ?? (Number.isFinite(offer.totalSAR) ? offer.totalSAR : offer.productPrice);
  const priceLabel = Number.isFinite(offer.totalSAR) ? "الإجمالي المقارن" : "السعر المعلن";
  const availability = offer.sourceMeta?.jeddahInStock === true
    ? "متوفر في جدة"
    : offer.sourceMeta?.jeddahInStock === false
      ? "غير متوفر حاليًا في جدة"
      : offer.availability === "in_stock"
        ? "متوفر لدى المتجر"
        : "التوفر التفصيلي غير مؤكد";

  const deltaMarkup = intel && Number.isFinite(intel.delta) && intel.delta > 0
    ? '<span class="price-delta">+' + fmt(intel.delta) + ' · ' + intel.deltaPercent + '%</span>'
    : "";

  const badges = intel?.badges?.length
    ? '<div class="merchant-badges">' + intel.badges.slice(0, 4).map((badge) =>
        '<span>' + escapeHtml(badge) + '</span>'
      ).join("") + '</div>'
    : "";

  const warnings = intel?.warnings?.length
    ? '<div class="merchant-warnings">' + intel.warnings.slice(0, 3).map((warning) =>
        '<span>⚠ ' + escapeHtml(warning) + '</span>'
      ).join("") + '</div>'
    : "";

  return `
    <div class="merchant-row ${isLowest ? "is-lowest" : ""}">
      <div class="merchant-main">
        <strong><span class="country-flag">${countryFlag(offer.merchantCountryCode)}</span> ${escapeHtml(offer.merchant || "المصدر")}</strong>
        <span>${escapeHtml(availability)} · تطابق ${Math.round((offer.matchConfidence || 0) * 100)}%</span>
        ${badges}
        ${warnings}
      </div>
      <div class="merchant-price">
        <small>${priceLabel}</small>
        <b>${fmt(price)}</b>
        ${deltaMarkup}
        ${isLowest ? '<em>' + (intelligence?.priceBasis === "comparable_total" || group.priceBasis === "comparable_total" ? "أقل إجمالي مؤكد" : "أقل سعر معلن") + '</em>' : ""}
      </div>
      <div class="merchant-actions">
        <button class="product-detail-btn" type="button" data-source="${escapeHtml(offer.sourceUrl || "")}">التفاصيل</button>
        ${offer.sourceUrl ? '<a href="' + escapeHtml(offer.sourceUrl) + '" target="_blank" rel="noopener">المصدر ↗</a>' : ""}
      </div>
    </div>
  `;
}

function comparisonIntelligenceMarkup(intelligence) {
  if (!intelligence?.insights?.length) return "";
  return `
    <div class="comparison-intelligence">
      ${intelligence.insights.map((insight) => `
        <div class="intelligence-card tone-${escapeHtml(insight.tone || "neutral")}">
          <small>${escapeHtml(insight.title)}</small>
          <p>${escapeHtml(insight.text)}</p>
        </div>
      `).join("")}
    </div>
  `;
}

function colorSwatch(color = "") {
  const key = String(color).trim().toLowerCase();
  const map = {
    black: "#11151a",
    white: "#f4f2ed",
    lavender: "#b9a7d8",
    purple: "#8d6bb5",
    sage: "#9caf88",
    green: "#7e9d77",
    blue: "#6f9fcb",
    "mist blue": "#9ebbd4",
    silver: "#c9ced4",
    grey: "#8d949b",
    gray: "#8d949b",
    orange: "#d8783e",
    "cosmic orange": "#c96c38",
    gold: "#c6a05a",
    "light gold": "#d7be80",
    pink: "#d7a2b8",
    red: "#b94b55",
  };
  return map[key] || "linear-gradient(135deg,#71859a,#b8c4cf)";
}

function variantSelector(family, selectedGroup) {
  if (!family?.variants?.length || family.variants.length < 2) return "";
  return `
    <div class="variant-selector" role="group" aria-label="اختر اللون">
      <span class="variant-selector-label">اللون</span>
      <div class="variant-options">
        ${family.variants.map((variant) => {
          const color = variant.bestOffer?.specs?.color || "نسخة";
          const selected = variant.key === selectedGroup?.key;
          return `
            <button
              type="button"
              class="variant-selector-btn ${selected ? "active" : ""}"
              data-family-key="${escapeHtml(family.key)}"
              data-variant-key="${escapeHtml(variant.key)}"
              aria-pressed="${selected ? "true" : "false"}"
            >
              <i style="--swatch:${escapeHtml(colorSwatch(color))}"></i>
              <span>${escapeHtml(color)}</span>
              <small>${fmt(variant.bestValue)}</small>
            </button>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function variantFamilyCard(family, index) {
  if (!family?.variants?.length) return "";
  const selectedKey = state.variantSelections[family.key] || family.defaultVariantKey;
  const selectedGroup = family.variants.find((variant) => variant.key === selectedKey) || family.variants[0];
  if (!selectedGroup) return "";

  state.variantSelections[family.key] = selectedGroup.key;

  const offer = selectedGroup.bestOffer || selectedGroup.offers?.[0];
  if (!offer) return "";

  const specs = offer.specs || {};
  const title = [specs.deviceType || specs.series || offer.title, specs.storage]
    .filter(Boolean)
    .join(" · ");
  const selectedColor = specs.color || "غير محدد";
  const imageTitle = offer.sourceMeta?.nameAr || offer.title || title;
  const media = offer.image
    ? '<img src="' + escapeHtml(offer.image) + '" alt="' + escapeHtml(imageTitle) + '" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'grid\';"><span class="variant-image-fallback">لا توجد صورة</span>'
    : '<span class="variant-image-fallback visible">لا توجد صورة</span>';

  const savings = Number.isFinite(selectedGroup.savingsToNext)
    ? '<span class="saving-pill">وفر ' + fmt(selectedGroup.savingsToNext) + ' مقابل العرض التالي</span>'
    : "";

  return `
    <article class="variant-card variant-family-card" data-family="${escapeHtml(family.key)}">
      <div class="variant-family-bar">
        <div>
          <span class="mini-kicker">PRODUCT FAMILY / ${String(index + 1).padStart(2, "0")}</span>
          <strong>${escapeHtml(title || offer.title)}</strong>
        </div>
        <span>${family.variants.length} ألوان · ${family.merchantCount} متاجر</span>
      </div>

      ${variantSelector(family, selectedGroup)}

      <div class="variant-head">
        <div class="variant-image">${media}</div>
        <div class="variant-copy">
          <span class="selected-variant-label">اللون المختار: <b>${escapeHtml(selectedColor)}</b></span>
          <h3>${escapeHtml([title, selectedColor].filter(Boolean).join(" · "))}</h3>
          <div class="variant-badges">
            <span>${selectedGroup.merchantCount} ${selectedGroup.merchantCount === 1 ? "متجر" : "متاجر"}</span>
            <span>${offer.condition === "new" ? "جديد" : escapeHtml(offer.condition || "")}</span>
            ${savings}
          </div>
          <div class="spec-grid">${specsMarkup(offer)}</div>
        </div>
        <div class="variant-best">
          <small>${selectedGroup.priceBasis === "comparable_total" ? "أفضل إجمالي مؤكد" : "أقل سعر معلن"}</small>
          <strong>${fmt(selectedGroup.bestValue)}</strong>
          <span>${selectedGroup.priceBasis === "comparable_total" ? "التكلفة المقارنة مكتملة" : "قبل أي شحن/رسوم غير مؤكدة"}</span>
        </div>
      </div>

      ${comparisonIntelligenceMarkup(buildOfferIntelligence(selectedGroup))}
      <div class="merchant-comparison">
        ${selectedGroup.offers.map((item, offerIndex) => offerComparisonRow(item, offerIndex, selectedGroup, buildOfferIntelligence(selectedGroup))).join("")}
      </div>
    </article>
  `;
}

function variantGroupCard(group, index) {
  const family = {
    key: "single|" + group.key,
    variants: [group],
    defaultVariantKey: group.key,
    merchantCount: group.merchantCount,
  };
  return variantFamilyCard(family, index);
}

function conditionDisplay(value = "") {
  return ({
    new: "جديد",
    renewed: "مجدد",
    refurbished: "مجدّد",
    open_box: "Open Box",
    used: "مستعمل",
    unknown: "غير محدد",
  })[String(value).toLowerCase()] || value;
}

function selectorOptionMarkup(dimension, option, selectedKey) {
  const selected = option.key === selectedKey;
  const isColor = dimension === "colorKey";
  const label = dimension === "conditionKey" ? conditionDisplay(option.label) : option.label;
  const swatch = isColor
    ? '<i class="config-swatch" style="--swatch:' + escapeHtml(colorSwatch(option.label)) + '"></i>'
    : "";
  const price = Number.isFinite(option.minPrice) ? '<small>من ' + fmt(option.minPrice) + '</small>' : "";

  return '<button type="button" class="config-option ' + (isColor ? 'color-option ' : '') + (selected ? 'active' : '') +
    '" data-dimension="' + escapeHtml(dimension) + '" data-key="' + escapeHtml(option.key) +
    '" aria-pressed="' + (selected ? 'true' : 'false') + '">' +
    swatch + '<span>' + escapeHtml(label) + '</span>' + price + '</button>';
}

function selectorRow(label, dimension, options, selectedKey) {
  if (!options?.length) return "";
  return `
    <div class="config-row">
      <div class="config-row-label">
        <small>${escapeHtml(label)}</small>
        <span>${options.length} خيار</span>
      </div>
      <div class="config-options">
        ${options.map((option) => selectorOptionMarkup(dimension, option, selectedKey)).join("")}
      </div>
    </div>
  `;
}

function canonicalProfileMarkup(profile = {}) {
  const labels = {
    ram: "الذاكرة",
    processor: "المعالج",
    screenSize: "حجم الشاشة",
    screenType: "نوع الشاشة",
    network: "الشبكة",
    sim: "الشريحة",
    operatingSystem: "النظام",
    rearCamera: "الكاميرا الخلفية",
    frontCamera: "الكاميرا الأمامية",
    battery: "البطارية",
    waterproof: "مقاومة الماء",
    modelNumber: "رقم الموديل",
    barcode: "الباركود",
  };
  const order = Object.keys(labels);
  const rows = order
    .filter((field) => profile[field]?.value)
    .slice(0, 12)
    .map((field) => {
      const item = profile[field];
      const sources = item.sources?.length ? item.sources.join(" + ") : "مصدر واحد";
      const alternatives = item.alternatives?.length
        ? '<span class="spec-conflict">اختلاف: ' + item.alternatives.map((alt) =>
            escapeHtml(alt.value) + (alt.sources?.length ? ' (' + escapeHtml(alt.sources.join(" + ")) + ')' : '')
          ).join(" · ") + '</span>'
        : "";
      return `
        <div class="canonical-spec">
          <small>${escapeHtml(labels[field])}</small>
          <b>${escapeHtml(item.value)}</b>
          <span>المصدر: ${escapeHtml(sources)}</span>
          ${alternatives}
        </div>
      `;
    });

  return rows.length
    ? rows.join("")
    : '<div class="spec-empty">لا توجد مواصفات موحّدة كافية لهذه النسخة حتى الآن.</div>';
}

function selectedProductMedia(offer) {
  const title = offer?.sourceMeta?.nameAr || offer?.title || "المنتج";
  return offer?.image
    ? '<img src="' + escapeHtml(offer.image) + '" alt="' + escapeHtml(title) + '" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'grid\';"><span class="config-image-fallback">لا توجد صورة</span>'
    : '<span class="config-image-fallback visible">لا توجد صورة</span>';
}

function openProductDetails(product, offer, query) {
  const payload = {
    savedAt: new Date().toISOString(),
    query,
    product: {
      nameAr: product?.nameAr || offer?.sourceMeta?.nameAr || offer?.title || query,
      nameEn: product?.nameEn || offer?.title || query,
      brand: product?.brand || offer?.specs?.brand || null,
      model: product?.model || offer?.specs?.deviceType || null,
      variant: product?.variant || [offer?.specs?.storage, offer?.specs?.color].filter(Boolean).join(" · "),
    },
    offer,
  };
  sessionStorage.setItem("nawaa_product_detail", JSON.stringify(payload));
  localStorage.setItem("nawaa_selected_offer", JSON.stringify(payload));
  const params = new URLSearchParams();
  if (offer?.sourceUrl) params.set("source", offer.sourceUrl);
  if (query) params.set("q", query);
  location.href = "./product.html?" + params.toString();
}

function renderProduct(product, query) {
  const ranked = rankOffers(product.offers, state.mode);
  const summary = summarizeOffers(product.offers);
  const groups = groupComparableOffers(product.offers, state.mode);

  const selectorGroups = groups.filter((group) =>
    (group.bestOffer?.matchConfidence || 0) >= 0.7
  );
  const selectorGroupKeys = new Set(selectorGroups.map((group) => group.key));
  const relatedGroups = groups.filter((group) => !selectorGroupKeys.has(group.key));

  const selector = buildVariantSelectorState(selectorGroups.length ? selectorGroups : groups, state.selectorSelection);
  state.selectorSelection = { ...selector.selection };

  const selectedGroup = selector.selectedGroup;
  const selectedIntelligence = selectedGroup ? buildOfferIntelligence(selectedGroup) : null;
  const featuredOffer = selectedIntelligence?.baselineOffer || selectedGroup?.bestPriceOffer || selectedGroup?.bestOffer || null;
  const featuredValue = selectedIntelligence?.baselineValue ?? selectedGroup?.bestValue ?? null;
  const featuredConfirmed = Boolean(featuredOffer && Number.isFinite(featuredOffer.totalSAR));
  const canonicalProfile = buildCanonicalProductProfile(selectedGroup?.offers || []);

  const modelCount = selector.options.models.length;
  const storageCount = selector.options.storages.length;
  const colorCount = selector.options.colors.length;
  const conditionCount = selector.options.conditions.length;
  const hasLive = product.offers.some((offer) => offer.dataKind === "live");

  els.status.textContent = hasLive
    ? `بحث حي: ${summary.count} عرضًا · ${modelCount} موديلات · ${storageCount} سعات · ${colorCount} ألوان · ${summary.sources} متاجر/بائعين`
    : `وجدنا ${summary.count} عروض · ${modelCount} موديلات · ${summary.sources} مصادر`;
  els.urlHint.hidden = true;

  const selectedSpecs = featuredOffer?.specs || {};
  const selectedTitle = [
    selectedSpecs.deviceType || selectedSpecs.series || featuredOffer?.title || product.model,
    selectedSpecs.storage,
    selectedSpecs.color,
  ].filter(Boolean).join(" · ");

  els.results.innerHTML = `
    <section class="result-head">
      <div>
        <span class="mini-kicker">PRODUCT INTELLIGENCE</span>
        <h2>${escapeHtml(product.nameAr)}</h2>
        <p>اختر الموديل والسعة واللون والحالة؛ نواة يعيد بناء المقارنة والمواصفات فورًا.</p>
      </div>
      <div class="identity-pill">✓ مواصفات موحّدة + مقارنة نفس النسخة فقط</div>
    </section>

    <section class="result-grid comparison-layout">
      <div class="offers-column">
        ${featuredOffer ? `
          <article class="product-configurator">
            <div class="config-hero">
              <div class="config-image">${selectedProductMedia(featuredOffer)}</div>
              <div class="config-title">
                <span class="mini-kicker">SELECTED CONFIGURATION</span>
                <h3>${escapeHtml(selectedTitle)}</h3>
                <div class="config-summary">
                  <span>${selectedGroup.merchantCount} ${selectedGroup.merchantCount === 1 ? "متجر" : "متاجر"}</span>
                  <span>${conditionDisplay(featuredOffer.condition || "unknown")}</span>
                  <span>تطابق ${Math.round((featuredOffer.matchConfidence || 0) * 100)}%</span>
                </div>
              </div>
              <div class="config-price">
                <small>${featuredConfirmed ? "أفضل إجمالي مؤكد" : "أقل سعر معلن"}</small>
                <strong>${fmt(featuredValue)}</strong>
                <span>${featuredConfirmed ? "التكلفة مكتملة" : "الشحن/الرسوم قد تكون غير مكتملة"}</span>
              </div>
            </div>

            <div class="configurator-controls">
              ${selectorRow("الموديل", "modelKey", selector.options.models, selector.selection.modelKey)}
              ${selectorRow("السعة", "storageKey", selector.options.storages, selector.selection.storageKey)}
              ${selectorRow("اللون", "colorKey", selector.options.colors, selector.selection.colorKey)}
              ${selectorRow("الحالة", "conditionKey", selector.options.conditions, selector.selection.conditionKey)}
            </div>

            <div class="canonical-section">
              <div class="canonical-head">
                <div>
                  <span class="mini-kicker">CANONICAL PRODUCT PROFILE</span>
                  <h4>المواصفات الموحّدة</h4>
                </div>
                <p>نجمع معلومات المتاجر للنسخة المختارة، ونظهر أي اختلاف بدل إخفائه.</p>
              </div>
              <div class="canonical-grid">${canonicalProfileMarkup(canonicalProfile)}</div>
            </div>

            <div class="comparison-head">
              <div>
                <span class="mini-kicker">STORE COMPARISON</span>
                <h4>نفس النسخة، بين المتاجر</h4>
              </div>
              ${Number.isFinite(selectedGroup.savingsToNext)
                ? '<span class="saving-pill">فرق ' + fmt(selectedGroup.savingsToNext) + ' عن العرض التالي</span>'
                : ""}
            </div>
            ${comparisonIntelligenceMarkup(selectedIntelligence)}
            <div class="merchant-comparison">
              ${selectedGroup.offers.map((item, offerIndex) => offerComparisonRow(item, offerIndex, selectedGroup, selectedIntelligence)).join("")}
            </div>
          </article>
        ` : '<div class="empty-state">لا توجد نسخة قابلة للتكوين من النتائج الحالية.</div>'}
      </div>

      <aside class="best-panel">
        <span class="mini-kicker">${featuredConfirmed ? "SELECTED / CONFIRMED TOTAL" : "SELECTED / LOWEST PRICE"}</span>
        ${featuredOffer ? `
          <small>${featuredConfirmed ? "أفضل إجمالي مؤكد للنسخة المختارة" : "أقل سعر معلن للنسخة المختارة"}</small>
          <div class="best-price">${fmt(featuredValue)}</div>
          <div class="best-merchant">${countryFlag(featuredOffer.merchantCountryCode)} ${escapeHtml(featuredOffer.merchant || "")}</div>
          <div class="best-selected-variant">${escapeHtml(selectedTitle)}</div>
          <div class="breakdown">${priceBreakdown(featuredOffer)}</div>
          <button class="primary-action" id="quoteBestBtn">اطلب تسعيرة لهذه النسخة</button>
          <p>${featuredConfirmed
            ? "الإجمالي مبني على عناصر تكلفة مكتملة."
            : "هذا أقل سعر معلن للنسخة المختارة؛ لا نصفه بالأرخص نهائيًا قبل تأكيد الشحن والرسوم."}</p>
        ` : '<div class="empty-state compact">لا يوجد عرض مطابق مباشر حاليًا.</div>'}
      </aside>
    </section>

    <section class="uncertain-block">
      <div class="section-label">
        <span>نتائج أقل صلة — خارج الـConfigurator</span>
        <b>${relatedGroups.length}</b>
      </div>
      ${relatedGroups.length
        ? relatedGroups.slice(0, 6).map(variantGroupCard).join("")
        : '<div class="empty-state">لا توجد نتائج أقل صلة.</div>'}
      ${relatedGroups.length > 6 ? '<div class="results-truncated">تم إخفاء ' + (relatedGroups.length - 6) + ' مجموعة أقل صلة.</div>' : ""}
    </section>

    <div class="integrity-note">
      <strong>قاعدة نواة:</strong>
      لا نخلط موديلًا أو سعة أو لونًا أو حالة مختلفة في المقارنة نفسها. والمواصفات الموحّدة تحتفظ بمصدر كل قيمة وتكشف التعارضات بين المصادر.
    </div>
  `;

  els.results.querySelectorAll(".config-option").forEach((button) => {
    button.addEventListener("click", () => {
      const dimension = button.dataset.dimension || "";
      const key = button.dataset.key || "";
      if (!dimension || !key) return;
      state.selectorSelection = { ...state.selectorSelection, [dimension]: key };
      renderProduct(product, query);
    });
  });

  els.results.querySelectorAll(".variant-selector-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const familyKey = button.dataset.familyKey || "";
      const variantKey = button.dataset.variantKey || "";
      if (!familyKey || !variantKey) return;
      state.variantSelections[familyKey] = variantKey;
      renderProduct(product, query);
    });
  });

  els.results.querySelectorAll(".product-detail-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const source = button.dataset.source || "";
      const offer = ranked.find((item) => (item.sourceUrl || "") === source) || null;
      if (offer) openProductDetails(product, offer, query);
    });
  });

  $("#quoteBestBtn")?.addEventListener("click", () => {
    if (featuredOffer) openQuote(product, featuredOffer, query);
  });
}

function renderNoMatch(query) {
  els.urlHint.hidden = true;
  els.status.textContent = "لم نجد تطابقًا في كتالوج الاختبار";
  els.results.innerHTML = `
    <div class="no-match">
      <span class="mini-kicker">NO VERIFIED MATCH</span>
      <h2>ما نبي نخمن المنتج.</h2>
      <p>بحثنا عن <b>${escapeHtml(query)}</b> ولم نجد هوية منتج كافية داخل بيانات الاختبار الحالية. في المحرك الحي، تنتقل هذه الحالة إلى موصلات المصادر ثم Product Identity Resolver.</p>
      <button class="primary-action" id="manualQuoteBtn">اطلب من نواة البحث عنه</button>
    </div>
  `;
  $("#manualQuoteBtn").addEventListener("click", () => openQuote({
    nameAr: query,
    nameEn: query,
    model: "غير محدد",
    variant: "",
  }, null, query));
}

async function runSearch(rawQuery) {
  const query = String(rawQuery || "").trim();
  if (query.length < 2) {
    els.status.textContent = "اكتب حرفين على الأقل";
    els.input.focus();
    return;
  }

  if (state.query !== query) {
    state.variantSelections = {};
    state.selectorSelection = {};
  }
  state.query = query;
  saveRecent(query);

  if (isLikelyUrl(query)) {
    state.product = null;
    await renderUrlState(query);
    return;
  }

  const apiBase = String(window.NAWAA_API_BASE || "").replace(/\/$/, "");
  if (apiBase) {
    els.status.textContent = "نبحث الآن في المصادر العالمية…";
    els.results.innerHTML = '<div class="empty-state">جاري جمع العروض والتحقق من إمكانية الشحن إلى السعودية…</div>';

    try {
      const response = await fetch(apiBase + "/api/search?q=" + encodeURIComponent(query), {
        headers: { accept: "application/json" },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.message || data?.error || "live_search_failed");

      if (Array.isArray(data.offers) && data.offers.length) {
        const liveProduct = {
          id: null,
          brand: "بحث عالمي",
          model: query,
          variant: "إلى السعودية",
          nameAr: query,
          nameEn: query,
          aliases: [],
          identifiers: [],
          offers: data.offers,
        };
        state.product = liveProduct;
        renderProduct(liveProduct, query);
        const countries = new Set(data.offers.map((o) => o.merchantCountryCode).filter(Boolean)).size;
        const attempted = (data.providers || []).reduce((sum, p) => sum + (p.searchedMarkets?.length || 0), 0);
        els.status.textContent = `بحث حي: ${data.offers.length} عرضًا · ${countries} دول · ${data.providersConfigured?.length || 0} موصلات · ${attempted} أسواق/متاجر تم فحصها`;
        return;
      }

      const attempted = (data.providers || []).reduce((sum, p) => sum + (p.searchedMarkets?.length || 0), 0);
      els.status.textContent = `لم نجد عرضًا حيًا موثوقًا · تم فحص ${attempted} أسواق/متاجر`;
    } catch (error) {
      console.warn("NAWAA live search unavailable; using local catalog", error);
      els.status.textContent = "تعذر الوصول للمصادر الحية — نعرض الكتالوج المحلي مؤقتًا";
    }
  }

  const match = findBestProduct(query, DEMO_CATALOG);
  if (!match) {
    state.product = null;
    renderNoMatch(query);
    return;
  }

  state.product = match.product;
  renderProduct(match.product, query);
}

function openQuote(product, offer, sourceQuery) {
  const draft = {
    createdAt: new Date().toISOString(),
    productId: product.id || null,
    productName: product.nameAr || product.nameEn || sourceQuery,
    model: product.model || null,
    variant: product.variant || null,
    sourceQuery,
    observedMerchant: offer?.merchant || null,
    observedTotalSAR: offer?.totalSAR ?? null,
    status: "draft",
  };

  localStorage.setItem("nawaa_quote_draft", JSON.stringify(draft));
  els.quoteBody.innerHTML = `
    <span class="mini-kicker">QUOTE DRAFT</span>
    <h2>تم تجهيز مسودة الطلب.</h2>
    <p>هذه الخطوة لا ترسل الطلب إلى خادم ولا تنفذ دفعًا. حفظنا البيانات محليًا فقط حتى نربطها بدورة التسعير الفعلية.</p>
    <div class="quote-summary">
      <div><span>المنتج</span><b>${escapeHtml(draft.productName)}</b></div>
      <div><span>الموديل</span><b>${escapeHtml(draft.model || "غير محدد")}</b></div>
      <div><span>السعر المرصود</span><b>${draft.observedTotalSAR ? fmt(draft.observedTotalSAR) : "بانتظار التسعير"}</b></div>
    </div>
  `;
  els.quoteModal.classList.add("open");
  els.quoteModal.setAttribute("aria-hidden", "false");
}

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch(els.input.value);
});

els.chips.querySelectorAll("button[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    els.chips.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
    if (state.product) renderProduct(state.product, state.query);
  });
});

els.quoteClose.addEventListener("click", () => {
  els.quoteModal.classList.remove("open");
  els.quoteModal.setAttribute("aria-hidden", "true");
});

els.quoteModal.addEventListener("click", (event) => {
  if (event.target === els.quoteModal) els.quoteClose.click();
});

addEventListener("keydown", (event) => {
  if (event.key === "Escape") els.quoteClose.click();
});

renderRecent();
