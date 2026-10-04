import { parseSearchIntent, assessOfferMatch, describeProduct, productCategory, categoryLabel } from "./search-query.mjs";
import {
  DEMO_CATALOG,
  findBestProduct,
  isLikelyUrl,
  rankOffers,
  summarizeOffers,
  groupComparableOffers,
  buildDiscoverySections,
  groupVariantFamilies,
  buildVariantSelectorState,
  buildCanonicalProductProfile,
  buildOfferIntelligence,
  offerVariantDimensions,
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
  availability: "all",
  merchant: "all",
  category: "all",
  visibleCounts: {},
  comparisonOpen: false,
  selectedGroupKey: null,
  nextCursor: null,
  remoteLoading: false,
  remoteExhausted: false,
  requestId: 0,
};

const nf = new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 2 });
const fmt = (v) => Number.isFinite(v) ? nf.format(v) + " ر.س" : "غير مؤكد";

const NAWAA_PRICE_HISTORY_KEY = "nawaa_price_history_v1";
const MAX_PRICE_HISTORY_POINTS = 800;

function readPriceHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(NAWAA_PRICE_HISTORY_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writePriceHistory(points) {
  try {
    localStorage.setItem(
      NAWAA_PRICE_HISTORY_KEY,
      JSON.stringify(points.slice(-MAX_PRICE_HISTORY_POINTS))
    );
  } catch {
    // History is an enhancement only; search must keep working if storage is unavailable.
  }
}

function offerObservedValue(offer = {}) {
  return Number.isFinite(offer.totalSAR) ? offer.totalSAR :
    Number.isFinite(offer.productPrice) ? offer.productPrice : null;
}

function recordPriceHistory(offers = []) {
  if (!Array.isArray(offers) || !offers.length) return;
  const groups = groupComparableOffers(offers, "lowest");
  const history = readPriceHistory();

  for (const group of groups) {
    for (const offer of group.offers || []) {
      if (offer.dataKind !== "live" && offer.dataKind !== "verified_source") continue;
      const value = offerObservedValue(offer);
      if (!Number.isFinite(value) || !offer.merchant) continue;

      const observedAt = offer.observedAt || new Date().toISOString();
      const sameStream = history
        .filter((point) => point.variantKey === group.key && point.merchant === offer.merchant)
        .sort((a, b) => String(a.lastSeenAt || a.observedAt).localeCompare(String(b.lastSeenAt || b.observedAt)));
      const latest = sameStream.at(-1);
      const basis = Number.isFinite(offer.totalSAR) ? "comparable_total" : "advertised_price";

      if (latest && latest.value === value && latest.priceBasis === basis) {
        latest.lastSeenAt = observedAt;
        latest.sourceUrl = offer.sourceUrl || latest.sourceUrl || null;
        continue;
      }

      history.push({
        variantKey: group.key,
        merchant: offer.merchant,
        value,
        priceBasis: basis,
        observedAt,
        lastSeenAt: observedAt,
        sourceUrl: offer.sourceUrl || null,
      });
    }
  }

  history.sort((a, b) => String(a.observedAt || "").localeCompare(String(b.observedAt || "")));
  writePriceHistory(history);
}

function dateLabel(value) {
  if (!value) return "غير معروف";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "غير معروف";
  return new Intl.DateTimeFormat("ar-SA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function priceHistoryForGroup(group) {
  if (!group?.key) return null;
  const points = readPriceHistory()
    .filter((point) => point.variantKey === group.key && Number.isFinite(point.value))
    .sort((a, b) => String(a.observedAt || "").localeCompare(String(b.observedAt || "")));

  if (!points.length) return null;

  const currentOffers = group.offers || [];
  const currentBest = currentOffers
    .map((offer) => ({
      merchant: offer.merchant,
      value: offerObservedValue(offer),
      priceBasis: Number.isFinite(offer.totalSAR) ? "comparable_total" : "advertised_price",
    }))
    .filter((item) => Number.isFinite(item.value))
    .sort((a, b) => a.value - b.value)[0] || null;

  const lowest = points.reduce((best, point) => !best || point.value < best.value ? point : best, null);
  const highest = points.reduce((best, point) => !best || point.value > best.value ? point : best, null);
  const firstSeenAt = points[0]?.observedAt || null;
  const latestSeenAt = points.reduce((latest, point) =>
    String(point.lastSeenAt || point.observedAt) > String(latest || "") ? (point.lastSeenAt || point.observedAt) : latest
  , null);

  const merchants = [...new Set(currentOffers.map((offer) => offer.merchant).filter(Boolean))].map((merchant) => {
    const merchantPoints = points.filter((point) => point.merchant === merchant);
    const currentOffer = currentOffers.find((offer) => offer.merchant === merchant);
    const currentValue = offerObservedValue(currentOffer);
    const distinct = [];
    for (const point of merchantPoints) {
      if (!distinct.length || distinct.at(-1).value !== point.value) distinct.push(point);
    }
    const previous = distinct.length >= 2 ? distinct.at(-2) : null;
    const delta = previous && Number.isFinite(currentValue) ? currentValue - previous.value : 0;
    return {
      merchant,
      currentValue,
      previousValue: previous?.value ?? null,
      delta,
      direction: delta < 0 ? "down" : delta > 0 ? "up" : "flat",
      lastSeenAt: merchantPoints.at(-1)?.lastSeenAt || merchantPoints.at(-1)?.observedAt || null,
      changes: Math.max(0, distinct.length - 1),
    };
  });

  return {
    points,
    currentBest,
    lowest,
    highest,
    firstSeenAt,
    latestSeenAt,
    merchants,
  };
}

function priceHistoryMarkup(history) {
  if (!history) {
    return `
      <div class="price-history-empty">
        أول رصد لهذه النسخة. من الآن فصاعدًا سنحفظ تغيّر السعر على هذا الجهاز.
      </div>
    `;
  }

  const current = history.currentBest?.value;
  const lowest = history.lowest?.value;
  const gapFromLow = Number.isFinite(current) && Number.isFinite(lowest) ? current - lowest : null;
  const status = Number.isFinite(gapFromLow) && gapFromLow === 0
    ? "السعر الحالي يساوي أقل سعر رصدناه"
    : Number.isFinite(gapFromLow) && gapFromLow > 0
      ? "السعر الحالي أعلى من أقل رصد بـ " + fmt(gapFromLow)
      : "لا توجد مقارنة كافية بعد";

  const merchantRows = history.merchants.map((item) => {
    const movement = item.direction === "down"
      ? '<span class="history-move down">↓ نزل ' + fmt(Math.abs(item.delta)) + '</span>'
      : item.direction === "up"
        ? '<span class="history-move up">↑ ارتفع ' + fmt(item.delta) + '</span>'
        : '<span class="history-move flat">— بدون تغيّر مسجل</span>';

    return `
      <div class="history-merchant">
        <div><strong>${escapeHtml(item.merchant)}</strong><small>آخر رصد ${dateLabel(item.lastSeenAt)}</small></div>
        <div><b>${fmt(item.currentValue)}</b>${movement}</div>
      </div>
    `;
  }).join("");

  return `
    <div class="price-history-stats">
      <div><small>السعر الحالي</small><strong>${fmt(current)}</strong></div>
      <div><small>أقل سعر رصدناه</small><strong>${fmt(lowest)}</strong></div>
      <div><small>أعلى سعر رصدناه</small><strong>${fmt(history.highest?.value)}</strong></div>
      <div><small>بدأ الرصد</small><strong>${dateLabel(history.firstSeenAt)}</strong></div>
    </div>
    <div class="price-history-status">${escapeHtml(status)}</div>
    <div class="history-merchants">${merchantRows}</div>
  `;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithRetry(url, options = {}, attempts = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let timeout;
    try {
      const controller = new AbortController();
      const timeoutMs = attempt === 1 ? 25000 : 45000;
      timeout = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        ...options,
        mode: "cors",
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new Error("invalid_json_response");
      }

      if (!response.ok) {
        const error = new Error(data?.message || data?.error || "request_failed_" + response.status);
        error.status = response.status;
        error.nonRetryable = response.status >= 400 && response.status < 500;
        throw error;
      }

      if (!data?.offers?.length && data?.errors?.some(error => error.provider === "cache")) {
        throw new Error("search_snapshot_invalidated");
      }

      return data;
    } catch (error) {
      lastError = error;
      if (error?.nonRetryable) break;
      if (attempt < attempts) await sleep(attempt * 1200);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error("request_failed");
}

async function wakeSearchApi(apiBase) {
  try {
    await fetchJsonWithRetry(apiBase + "/health", {
      headers: { accept: "application/json" },
    }, 2);
    return true;
  } catch {
    return false;
  }
}

function renderLiveSearchError(query, error) {
  state.product = null;
  const message = error?.name === "AbortError"
    ? "استغرق محرك البحث وقتًا أطول من المتوقع."
    : "تعذر الاتصال بمحرك البحث الحي.";

  els.status.textContent = "البحث الحي غير متاح مؤقتًا";
  const directSearchUrl = "https://nawaa-search-api.onrender.com/search.html?q=" + encodeURIComponent(query);
  els.results.innerHTML = `
    <section class="live-search-error">
      <span class="mini-kicker">LIVE SEARCH INTERRUPTED</span>
      <h2>${escapeHtml(message)}</h2>
      <p>لن نعرض بيانات Demo بدل نتائج السوق. أعد المحاولة، أو افتح نسخة البحث المباشرة التي تعمل من نفس دومين محرك البحث لتجاوز قيود المتصفحات المضمنة.</p>
      <div class="live-error-actions">
        <button type="button" class="primary-action" id="retryLiveSearch">إعادة البحث الحي</button>
        <a class="secondary-action" href="${escapeHtml(directSearchUrl)}">فتح البحث المباشر</a>
      </div>
      <small>الاستعلام: ${escapeHtml(query)}</small>
    </section>
  `;

  $("#retryLiveSearch")?.addEventListener("click", () => runSearch(query));
}

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
  try { localStorage.setItem("nawaa_recent_searches", JSON.stringify(next)); } catch {}
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

async function renderUrlState(query, requestId) {
  const apiBase = String(window.NAWAA_API_BASE || "").replace(/\/$/, "");
  if (!apiBase) {
    renderLiveSearchError(query, new Error("live_api_not_configured"));
    return;
  }
  els.urlHint.hidden = true;
  els.status.textContent = "نستخرج المنتج ونقارن عروضه…";
  els.results.innerHTML = '<div class="empty-state live-loading">جاري قراءة رابط المنتج والبحث عن عروضه في المتاجر…</div>';
  try {
    await wakeSearchApi(apiBase);
    const data = await fetchJsonWithRetry(apiBase + "/api/search?url=" + encodeURIComponent(query));
    if (!data.resolvedOffer || !Array.isArray(data.offers) || !data.offers.length) {
      throw new Error("product_identity_missing");
    }
    if (requestId !== state.requestId) return;
    const source = data.resolvedOffer;
    const product = {
      id: null, brand: source.specs?.brand || "رابط مباشر", model: data.comparisonQuery || source.title,
      variant: "", nameAr: source.title, nameEn: source.title, offers: data.offers,
    };
    recordPriceHistory(data.offers);
    state.product = product;
    renderProduct(product, query);
    els.status.textContent = `مقارنة الرابط: ${data.offers.length} عروض · ${data.providersConfigured?.length || 0} مصادر بحث`;
    els.urlHint.hidden = false;
    els.urlHint.innerHTML = '<div><strong>تم استخراج المنتج والبحث عن عروضه</strong><p>المصدر الأصلي محفوظ. أي اختلاف في النسخة أو رقم الموديل يبقى خارج المطابقات المباشرة.</p></div>';
    if (data.errors?.length) {
      els.urlHint.innerHTML += '<small>تعذر فحص بعض المصادر؛ المقارنة تعرض العروض المتاحة فقط.</small>';
    }
  } catch (error) {
    if (requestId !== state.requestId) return;
    renderLiveSearchError(query, error);
  }
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
  const priceLabel = intel?.priceBasis === "comparable_total" ? "تكلفة الوصول المؤكدة" : "سعر المنتج";
  const availability = offer.sourceMeta?.jeddahInStock === true
    ? "متوفر في جدة"
    : offer.sourceMeta?.jeddahInStock === false
      ? "غير متوفر حاليًا في جدة"
      : offer.availability === "in_stock"
        ? "متوفر لدى المتجر"
        : offer.availability === "out_of_stock" ? "غير متوفر لدى المتجر" : "التوفر التفصيلي غير مؤكد";

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
        ${offer.matchReason ? '<span class="match-reason">'+escapeHtml(offer.matchReason)+'</span>' : ""}
        ${badges}
        ${warnings}
      </div>
      <div class="merchant-price">
        <small>${priceLabel}</small>
        <b>${fmt(price)}</b>
        ${deltaMarkup}
        ${intel?.priceBasis !== "comparable_total" && offer.bucket === "confirmed" ? `<span>تكلفة الوصول المؤكدة: ${fmt(offer.totalSAR)}</span>` : ""}
        ${isLowest ? '<em>' + (intelligence?.priceBasis === "comparable_total" || group.priceBasis === "comparable_total" ? "أقل إجمالي مؤكد" : "أقل سعر معلن") + '</em>' : ""}
      </div>
      <div class="merchant-actions">
        <button class="product-detail-btn" type="button" data-source="${escapeHtml(offer.sourceUrl || "")}">التفاصيل</button>
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
          <p class="match-reason">${escapeHtml(offer.matchReason || "نسخة تختلف عن طلبك")}</p>
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
  options = (options || []).filter(option => option.label && !["غير محدد", "unknown", "unknown-model"].includes(option.label));
  if (options.length < 2) return "";
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
    regionVersion: "نسخة المنطقة",
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

function productDisplayTitle(offer) {
  const description = describeProduct(offer);
  const specs = offer.specs || {};
  if (description.kind === "console") return [description.platform.toUpperCase(), description.form,
    description.edition === "digital" ? "نسخة رقمية" : description.edition === "disc" ? "نسخة الأقراص" : "",
    description.storage?.toUpperCase(), description.isBundle ? "حزمة مع إضافات" : ""].filter(Boolean).join(" · ");
  if (productCategory(offer) !== "phone") return offer.title || specs.series || specs.deviceType || "المنتج";
  return [specs.deviceType || specs.series || offer.title, specs.storage, specs.color].filter(Boolean).join(" · ");
}

function additionalResultsSection(label, groups) {
  if (!groups.length) return "";
  return `<details class="additional-results result-details"><summary>${label} <span>${groups.length}</span></summary>
    <div class="additional-grid">${groups.map(group => {
      const offer = group.bestOffer || group.offers[0];
      return `<article class="additional-card">
        <div class="additional-image">${selectedProductMedia(offer)}</div>
        <div><h4>${escapeHtml(offer.title)}</h4><p>${escapeHtml(offer.matchReason || "يختلف عن المنتج المطلوب")}</p>
        <span>${escapeHtml(offer.merchant || "")}</span><strong>${fmt(offer.productPrice)}</strong>
        <small>السعر المعلن قبل الشحن والرسوم</small>
        <button class="product-detail-btn" type="button" data-source="${escapeHtml(offer.sourceUrl || "")}">عرض التفاصيل</button></div>
      </article>`;
    }).join("")}</div></details>`;
}

function productImageMarkup(offer, group, title, fallbackClass) {
  const images = [...new Set([offer, ...(group?.offers || [])].map(item => item?.image).filter(url => /^https?:\/\//i.test(url || "")))];
  const fallback = '<span class="' + fallbackClass + '" style="display:' + (images.length ? 'none' : 'grid') + '">صورة غير متاحة</span>';
  if (!images.length) return fallback;
  return '<img src="' + escapeHtml(images[0]) + '" alt="' + escapeHtml(title) + '" loading="lazy" referrerpolicy="no-referrer" data-image-options="' + escapeHtml(JSON.stringify(images)) + '" data-image-index="0" onerror="const urls=JSON.parse(this.dataset.imageOptions);const next=Number(this.dataset.imageIndex)+1;this.dataset.imageIndex=next;if(next &lt; urls.length){this.src=urls[next]}else{this.style.display=\'none\';this.nextElementSibling.style.display=\'grid\';}">' + fallback;
}

function exactMatchCard(group, selectedGroup, comparisonMarkup = "") {
  const available = (group.offers || []).filter(item => item.availability !== "out_of_stock" && item.canShipToSaudi !== false);
  const priced = available.filter(item => Number.isFinite(item.productPrice)).sort((a,b)=>a.productPrice-b.productPrice);
  const offer = priced[0] || group.bestOffer || group.offers?.[0];
  if (!offer) return "";
  const title = productDisplayTitle(offer);
  const uniqueMerchants = new Set((group.offers || []).map(item => item.merchant).filter(Boolean)).size;
  const countries = [...new Map((group.offers || []).filter(item => item.merchantCountryCode).map(item => [item.merchantCountryCode,item.merchantCountryNameAr || item.merchantCountryCode])).entries()];
  const selected = selectedGroup?.key === group.key;
  const image = productImageMarkup(offer, group, title, "match-card-fallback");
  const specs = specEntries(offer).filter(([label]) => !(describeProduct(offer).kind === "console" && label === "اللون")).slice(0,3);
  const confirmed = available.filter(item => item.bucket === "confirmed" && Number.isFinite(item.totalSAR)).sort((a,b)=>a.totalSAR-b.totalSAR)[0];
  const price = priced[0]?.productPrice ?? null;

  return `
    <article class="product-summary-card ${selected ? "is-expanded" : ""}">
    <button type="button" class="match-result-card ${selected ? "active" : ""}" data-group-key="${escapeHtml(group.key)}" aria-expanded="${selected}">
      <div class="match-card-image">${image}</div>
      <div class="match-card-copy">
        <span class="mini-kicker">${escapeHtml(categoryLabel(productCategory(offer)))}</span>
        <strong>${escapeHtml(title)}</strong>
        <div class="card-specs">${specs.map(([label,value])=>`<span>${escapeHtml(label)}: ${escapeHtml(value)}</span>`).join("")}<span>${conditionDisplay(offer.condition || "unknown")}</span></div>
        <div class="card-coverage"><small>${group.offers.length} عروض · ${uniqueMerchants} ${uniqueMerchants === 1 ? "متجر" : "متاجر"}</small>
          <span class="card-countries">${countries.slice(0,3).map(([code,name])=>`<span aria-label="${escapeHtml(name)}" title="${escapeHtml(name)}">${countryFlag(code)}</span>`).join("")}${countries.length > 3 ? `<small>+${countries.length-3}</small>` : ""}</span>
        </div>
      </div>
      <div class="match-card-price"><div><small>${priced.length ? "سعر المنتج من" : "سعر متوفر غير مؤكد"}</small><b>${fmt(price)}</b></div><span class="card-expand-label">${selected ? "إغلاق العروض ↑" : "مقارنة العروض ↓"}</span></div>
      <small class="card-delivery">${confirmed ? `أقل تكلفة وصول مؤكدة: ${fmt(confirmed.totalSAR)}` : "الشحن والرسوم تُحسب في التسعيرة"}</small>
    </button>
    ${selected ? comparisonMarkup : ""}
    </article>
  `;
}

function selectedProductMedia(offer, group = null) {
  const title = offer?.sourceMeta?.nameAr || offer?.title || "المنتج";
  return productImageMarkup(offer, group, title, "config-image-fallback");
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
  try { sessionStorage.setItem("nawaa_product_detail", JSON.stringify(payload)); } catch {}
  try { localStorage.setItem("nawaa_selected_offer", JSON.stringify(payload)); } catch {}
  const params = new URLSearchParams();
  if (offer?.sourceUrl) params.set("source", offer.sourceUrl);
  if (query) params.set("q", query);
  location.href = "./product.html?" + params.toString();
}

function renderProduct(product, query) {
  const filteredOffers = product.offers.filter(offer =>
    (state.merchant === "all" || offer.merchant === state.merchant) &&
    (state.availability === "all" || offer.availability === "in_stock" || offer.sourceMeta?.jeddahInStock === true));
  const ranked = rankOffers(filteredOffers, state.mode);
  const summary = summarizeOffers(product.offers);
  const groups = groupComparableOffers(filteredOffers, state.mode);

  const intent = parseSearchIntent(isLikelyUrl(query) ? product.model : query);
  const exactGroups = groups.filter((group) =>
    group.bestOffer?.exactMatch === true &&
    (group.bestOffer?.matchConfidence || 0) >= 0.9 &&
    group.bestOffer?.condition === (intent.condition || "new")
  );
  const discoverySections = buildDiscoverySections(query, exactGroups);
  const displayedSections = state.category === 'all' ? discoverySections : discoverySections.filter(section => section.key === state.category);
  const selectorGroups = state.selectedGroupKey ? exactGroups.filter(group => group.key === state.selectedGroupKey) : discoverySections.flatMap(section=>section.groups);
  const selectorGroupKeys = new Set(exactGroups.map((group) => group.key));
  const relatedGroups = groups.filter((group) => !selectorGroupKeys.has(group.key));

  const selector = buildVariantSelectorState(selectorGroups, state.selectorSelection);
  state.selectorSelection = { ...selector.selection };

  const selectedGroup = selector.selectedGroup;
  const selectedIntelligence = selectedGroup ? buildOfferIntelligence(selectedGroup) : null;
  const featuredOffer = selectedIntelligence?.baselineOffer || selectedGroup?.bestPriceOffer || selectedGroup?.bestOffer || null;
  const featuredValue = selectedIntelligence?.baselineValue ?? selectedGroup?.bestValue ?? null;
  const featuredConfirmed = selectedIntelligence?.priceBasis === "comparable_total" && featuredOffer?.bucket === "confirmed";
  const canonicalProfile = buildCanonicalProductProfile(selectedGroup?.offers || []);

  const modelCount = selector.options.models.length;
  const storageCount = selector.options.storages.length;
  const colorCount = selector.options.colors.length;
  const conditionCount = selector.options.conditions.length;
  const hasLive = product.offers.some((offer) => offer.dataKind === "live");

  els.status.textContent = hasLive
    ? `بحث حي: ${summary.count} عرضًا · ${discoverySections.length} فئات · ${summary.sources} متاجر/بائعين`
    : `وجدنا ${summary.count} عروض · ${discoverySections.length} فئات · ${summary.sources} مصادر`;
  els.urlHint.hidden = true;

  const selectedSpecs = featuredOffer?.specs || {};
  const selectedTitle = featuredOffer ? productDisplayTitle(featuredOffer) : product.model;

  const comparisonMarkup = `
    <details class="selected-comparison" ${state.comparisonOpen ? 'open' : 'hidden'}>
    <summary>مقارنة عروض المنتج المختار${state.comparisonOpen && featuredOffer ? ' · '+escapeHtml(selectedTitle) : ''}</summary>
    <section class="result-grid comparison-layout">
      <div class="offers-column">
        ${featuredOffer ? `
          <article class="product-configurator">
            <div class="config-hero">
              <div class="config-image">${selectedProductMedia(featuredOffer, selectedGroup)}</div>
              <div class="config-title">
                <span class="mini-kicker">المنتج المختار</span>
                <h3>${escapeHtml(selectedTitle)}</h3>
                <div class="config-summary">
                  <span>${selectedGroup.merchantCount} ${selectedGroup.merchantCount === 1 ? "متجر" : "متاجر"}</span>
                  <span>${conditionDisplay(featuredOffer.condition || "unknown")}</span>
                  ${selectedSpecs.regionVersion ? '<span>' + escapeHtml(selectedSpecs.regionVersion) + '</span>' : ""}
                  ${selectedSpecs.sim ? '<span>' + escapeHtml(selectedSpecs.sim) + '</span>' : ""}
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
              ${selectorRow("النسخة", "editionKey", selector.options.editions, selector.selection.editionKey)}
              ${selectorRow("السعة", "storageKey", selector.options.storages, selector.selection.storageKey)}
              ${describeProduct(featuredOffer).kind !== "console" ? selectorRow("اللون", "colorKey", selector.options.colors, selector.selection.colorKey) : ""}
              ${selectorRow("الحالة", "conditionKey", selector.options.conditions, selector.selection.conditionKey)}
              ${selector.options.skus?.length > 1
                ? selectorRow("رقم الموديل", "skuKey", selector.options.skus, selector.selection.skuKey)
                : ""}
            </div>

            <div class="comparison-head">
              <div>
                <span class="mini-kicker">مقارنة المتاجر</span>
                <h4>نفس النسخة، بين المتاجر</h4>
              </div>
              ${Number.isFinite(selectedGroup.savingsToNext)
                ? '<span class="saving-pill">فرق ' + fmt(selectedGroup.savingsToNext) + ' عن العرض التالي</span>'
                : ""}
            </div>
            <div class="merchant-comparison">
              ${selectedGroup.offers.map((item, offerIndex) => offerComparisonRow(item, offerIndex, selectedGroup, selectedIntelligence)).join("")}
            </div>
            <details class="result-details"><summary>ملخص التوفر والتكلفة والفروقات</summary>${comparisonIntelligenceMarkup(selectedIntelligence)}</details>
            <details class="price-history-section result-details"><summary>سجل السعر على هذا الجهاز</summary>
              <div class="price-history-head">
                <div>
                  <span class="mini-kicker">PRICE HISTORY / LOCAL</span>
                  <h4>سجل السعر على هذا الجهاز</h4>
                </div>
                <p>يبدأ من أول بحث على هذا الجهاز، وليس تاريخًا شاملًا للسوق.</p>
              </div>
              ${priceHistoryMarkup(priceHistoryForGroup(selectedGroup))}
            </details>

            <details class="canonical-section result-details"><summary>المواصفات الموحّدة ومصادرها</summary>
              <div class="canonical-head">
                <div>
                  <span class="mini-kicker">CANONICAL PRODUCT PROFILE</span>
                  <h4>المواصفات الموحّدة</h4>
                </div>
                <p>نجمع معلومات المتاجر للنسخة المختارة، ونظهر أي اختلاف بدل إخفائه.</p>
              </div>
              <div class="canonical-grid">${canonicalProfileMarkup(canonicalProfile)}</div>
            </details>

          </article>
        ` : '<div class="empty-state">اختر منتجًا مطابقًا للمقارنة، أو استكشف الأقسام الإضافية أدناه.</div>'}
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

    </details>
  `;

  els.results.innerHTML = `
    <section class="result-head">
      <div>
        <span class="mini-kicker">نتائج البحث</span>
        <h2>${escapeHtml(product.nameAr)}</h2>
        <p>${intent.discoveryMode === "brand" ? "منتجات الشركة حسب الفئة. اختر منتجًا لمقارنة عروض المتاجر." : "اختر الفئة والمنتج، ثم قارن عروض المتاجر للنسخة نفسها."}</p>
      </div>
      <div class="identity-pill">${intent.discoveryMode === "brand"
        ? `${exactGroups.length} منتجات من العلامة · ${relatedGroups.length} نتائج أقل صلة`
        : `${exactGroups.length} منتجات مطابقة · ${relatedGroups.length} بدائل`}</div>
    </section>

    <div class="results-toolbar">
      <label>التوفر <select id="availabilityFilter"><option value="all" ${state.availability === "all" ? "selected" : ""}>كل حالات التوفر</option><option value="in_stock" ${state.availability === "in_stock" ? "selected" : ""}>المتوفر فقط</option></select></label>
      <label>المتجر <select id="merchantFilter"><option value="all">كل المتاجر</option>${[...new Set(product.offers.map(o => o.merchant).filter(Boolean))].map(merchant => '<option value="'+escapeHtml(merchant)+'" '+(state.merchant === merchant ? 'selected' : '')+'>'+escapeHtml(merchant)+'</option>').join("")}</select></label>
      <span>${filteredOffers.length} من ${product.offers.length} عرضًا</span>
      <button id="resetResultFilters" type="button">مسح الفلاتر</button>
    </div>
    ${!exactGroups.length ? '<div class="search-notice" role="status">'+(!filteredOffers.length ? 'لا توجد عروض ضمن الفلاتر الحالية. جرّب مسح الفلاتر.' : 'لم نجد النسخة المطلوبة مطابقةً بالكامل. البدائل أدناه تختلف عن طلبك؛ تحقق من الموديل والسعة واللون قبل الاختيار.')+'</div>' : ''}
    ${discoverySections.length > 1 ? `<nav class="category-tabs" aria-label="فئات النتائج">
      <button type="button" class="category-tab ${state.category === 'all' ? 'active' : ''}" aria-pressed="${state.category === 'all'}" data-category="all">الكل <span>${exactGroups.length}</span></button>
      ${discoverySections.map(section=>`<button type="button" class="category-tab ${state.category === section.key ? 'active' : ''}" aria-pressed="${state.category === section.key}" data-category="${escapeHtml(section.key)}">${escapeHtml(section.label)} <span>${section.groups.length}</span></button>`).join('')}
    </nav>` : ''}
    ${displayedSections.map(section=>{
      const limit = state.visibleCounts[section.key] || 10;
      return `<section class="match-results-section" aria-label="${escapeHtml(section.label)}">
        <div class="section-label"><h3>${escapeHtml(section.label)}</h3><b>${section.groups.length} منتجات</b></div>
        <div class="match-results-grid">${section.groups.filter((group,index)=>index < limit || (state.comparisonOpen && group.key === state.selectedGroupKey)).map(group=>exactMatchCard(group,state.comparisonOpen ? selectedGroup : null,comparisonMarkup)).join('')}</div>
        ${section.groups.length > limit ? `<button type="button" class="show-category" data-show-category="${escapeHtml(section.key)}">عرض المزيد من ${escapeHtml(section.label)} (${section.groups.length-limit})</button>` : ''}
      </section>`;
    }).join('')}
    ${!displayedSections.length ? '<div class="empty-state">لا توجد منتجات مطابقة ضمن الفلاتر الحالية.</div>' : ''}

    ${!state.comparisonOpen ? '<details class="selected-comparison" hidden></details>' : ""}

    ${state.nextCursor ? `<div class="remote-more"><button type="button" class="show-category" id="loadMoreRemote" ${state.remoteLoading ? "disabled" : ""}>${state.remoteLoading ? "جاري توسيع البحث…" : "جلب نتائج إضافية من مصادر أكثر"}</button><small>يطلب هذا بحثًا أعمق من الخادم؛ لا يكرر كشف النتائج الموجودة في الصفحة.</small></div>` : state.remoteExhausted ? '<div class="remote-more exhausted"><small>وصلنا إلى أعمق نطاق بحث متاح حاليًا لهذه الجلسة.</small></div>' : ""}

    ${additionalResultsSection("نسخ ومنتجات أخرى", relatedGroups.filter(group => !["game","accessory"].includes(describeProduct(group.bestOffer).kind)))}
    ${additionalResultsSection("ألعاب للجهاز", relatedGroups.filter(group => describeProduct(group.bestOffer).kind === "game"))}
    ${additionalResultsSection("ملحقات وإكسسوارات", relatedGroups.filter(group => describeProduct(group.bestOffer).kind === "accessory"))}

    <div class="integrity-note">
      <strong>قاعدة نواة:</strong>
      لا نخلط موديلًا أو سعة أو لونًا أو حالة مختلفة في المقارنة نفسها. والمواصفات الموحّدة تحتفظ بمصدر كل قيمة وتكشف التعارضات بين المصادر.
    </div>
  `;

  els.results.querySelectorAll('.category-tab').forEach(button=>button.addEventListener('click',()=>{
    state.category=button.dataset.category; state.comparisonOpen=false; renderProduct(product,query);
  }));
  els.results.querySelectorAll('.show-category').forEach(button=>{
    const category=button.dataset.showCategory;
    if(!category)return;
    button.addEventListener('click',()=>{
      state.visibleCounts[category]=(state.visibleCounts[category] || 10)+10; renderProduct(product,query);
    });
  });
  $("#loadMoreRemote")?.addEventListener("click",()=>loadMoreRemote(query));
  document.querySelector('.selected-comparison')?.addEventListener('toggle',event=>{ if (event.target.isConnected === false) return; if (state.comparisonOpen !== event.target.open) { state.comparisonOpen=event.target.open; if (!event.target.open) renderProduct(product,query); } });
  $("#availabilityFilter")?.addEventListener("change", event => { state.availability = event.target.value; state.visibleCounts = {}; state.selectorSelection = {}; state.selectedGroupKey = null; state.comparisonOpen = false; renderProduct(product, query); });
  $("#merchantFilter")?.addEventListener("change", event => { state.merchant = event.target.value; state.visibleCounts = {}; state.selectorSelection = {}; state.selectedGroupKey = null; state.comparisonOpen = false; renderProduct(product, query); });
  $("#resetResultFilters")?.addEventListener("click", () => { state.availability = "all"; state.merchant = "all"; state.visibleCounts = {}; state.selectorSelection = {}; state.selectedGroupKey = null; state.comparisonOpen = false; renderProduct(product, query); });
  els.results.querySelectorAll(".match-result-card").forEach((button) => {
    button.addEventListener("click", () => {
      const group = exactGroups.find((item) => item.key === button.dataset.groupKey);
      const offer = group?.bestPriceOffer || group?.bestOffer;
      if (!offer) return;
      state.comparisonOpen = !(state.comparisonOpen && state.selectedGroupKey === group.key);
      state.selectedGroupKey = group.key;
      const dimensions = offerVariantDimensions(offer);
      state.selectorSelection = {
        modelKey: dimensions.modelKey,
        editionKey: dimensions.editionKey,
        storageKey: dimensions.storageKey,
        colorKey: dimensions.colorKey,
        conditionKey: dimensions.conditionKey,
        skuKey: dimensions.skuKey,
      };
      renderProduct(product, query);
      if (state.comparisonOpen) requestAnimationFrame(() => {
        document.querySelector(".product-configurator")?.scrollIntoView({ behavior:"smooth", block:"start" });
      });
    });
  });

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

function offerMergeKey(offer = {}) {
  return offer.sourceUrl || [offer.provider,offer.providerMarket,offer.merchant,offer.title,offer.productPrice].join("|");
}

function mergeSearchOffers(current = [], incoming = []) {
  const merged = new Map();
  for (const offer of [...current,...incoming]) {
    const key = offerMergeKey(offer);
    const previous = merged.get(key);
    if (!previous || String(offer.observedAt || "") >= String(previous.observedAt || "")) merged.set(key,offer);
  }
  return [...merged.values()];
}

async function loadMoreRemote(query) {
  if (!state.nextCursor || state.remoteLoading || !state.product) return;
  const apiBase = String(window.NAWAA_API_BASE || "").replace(/\/$/, "");
  if (!apiBase) return;
  const requestId = state.requestId;
  state.remoteLoading = true;
  renderProduct(state.product, query);
  els.status.textContent = "نوسّع البحث إلى مصادر ونتائج إضافية…";

  try {
    let cursor = state.nextCursor;
    let added = 0;
    let lastData = null;
    for (let step=0; step<2 && cursor && added===0; step+=1) {
      const data = await fetchJsonWithRetry(
        apiBase + "/api/search?q=" + encodeURIComponent(query) + "&cursor=" + encodeURIComponent(cursor),
        {headers:{accept:"application/json"}},
        2
      );
      if (requestId !== state.requestId) return;
      const before = state.product.offers.length;
      const merged = mergeSearchOffers(state.product.offers, Array.isArray(data.offers) ? data.offers : []);
      added = merged.length - before;
      state.product = {...state.product,offers:merged};
      if (Array.isArray(data.offers)) recordPriceHistory(data.offers);
      cursor = data.nextCursor || null;
      lastData = data;
    }
    state.nextCursor = cursor;
    state.remoteExhausted = !cursor;
    state.visibleCounts = {};
    renderProduct(state.product,query);
    els.status.textContent = added > 0
      ? `أضفنا ${added} عرضًا جديدًا · الإجمالي ${state.product.offers.length} عرضًا`
      : (state.remoteExhausted ? "اكتمل أعمق نطاق بحث متاح حاليًا" : "لم تظهر نتائج جديدة في هذه الدفعة");
    if (lastData?.errors?.length) els.status.textContent += " · بعض المصادر أعادت نتائج جزئية";
  } catch (error) {
    if (requestId !== state.requestId) return;
    console.warn("NAWAA remote expansion failed",error);
    els.status.textContent = error?.status === 429 ? "تم بلوغ حد الطلبات مؤقتًا؛ أعد المحاولة بعد قليل" : "تعذر توسيع البحث حاليًا";
  } finally {
    if (requestId === state.requestId) {
      state.remoteLoading = false;
      if (state.product) renderProduct(state.product,query);
    }
  }
}
async function runSearch(rawQuery) {
  const query = String(rawQuery || "").trim();
  if (query.length < 2) {
    els.status.textContent = "اكتب حرفين على الأقل";
    els.input.focus();
    return;
  }

  const requestId = ++state.requestId;
  if (state.query !== query) {
    state.availability = "all"; state.merchant = "all";
    state.variantSelections = {};
    state.selectorSelection = {};
    state.category = "all"; state.visibleCounts = {}; state.comparisonOpen = false; state.selectedGroupKey = null;
  }
  state.query = query;
  state.nextCursor = null;
  state.remoteLoading = false;
  state.remoteExhausted = false;
  saveRecent(query);

  if (isLikelyUrl(query)) {
    state.product = null;
    await renderUrlState(query, requestId);
    return;
  }

  const apiBase = String(window.NAWAA_API_BASE || "").replace(/\/$/, "");
  if (apiBase) {
    els.status.textContent = "نجهّز محرك البحث الحي…";
    els.results.innerHTML = '<div class="empty-state live-loading">جاري إيقاظ محرك البحث وجمع العروض الحية من المتاجر… قد تستغرق المحاولة الأولى عدة ثوانٍ.</div>';

    try {
      await wakeSearchApi(apiBase);
      if (requestId !== state.requestId) return;
      els.status.textContent = "نبحث الآن في المصادر الحية…";

      const data = await fetchJsonWithRetry(
        apiBase + "/api/search?q=" + encodeURIComponent(query),
        { headers: { accept: "application/json" } },
        3
      );

      if (requestId !== state.requestId) return;
      state.nextCursor = data.nextCursor || null;
      state.remoteExhausted = !state.nextCursor;
      if (Array.isArray(data.offers) && data.offers.length) {
        recordPriceHistory(data.offers);
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
        if (data.errors?.length) els.status.textContent += " · نتائج جزئية: تعذر فحص بعض المصادر";
        else if (data.cache?.hit) els.status.textContent += " · رصد منذ " + Math.ceil(data.cache.ageMs / 1000) + " ثانية";
        return;
      }

      const attempted = (data.providers || []).reduce((sum, p) => sum + (p.searchedMarkets?.length || 0), 0);
      state.product = null;
      els.status.textContent = `لم نجد عروضًا حية · تم فحص ${attempted} أسواق/متاجر`;
      els.results.innerHTML = `
        <div class="no-match">
          <span class="mini-kicker">NO LIVE OFFERS</span>
          <h2>ما ظهر لنا عرض حي لهذا البحث.</h2>
          <p>تم تنفيذ البحث على المصادر المتاحة بدون الرجوع إلى بيانات Demo.</p>
          <button class="primary-action" id="retryLiveSearch">أعد البحث</button>
        </div>
      `;
      $("#retryLiveSearch")?.addEventListener("click", () => runSearch(query));
      return;
    } catch (error) {
      if (requestId !== state.requestId) return;
      console.warn("NAWAA live search unavailable", error);
      renderLiveSearchError(query, error);
      return;
    }
  }

  // Local demo catalog is used only in explicit offline/development mode when no API base is configured.
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
  if (window.NAWAA_QUOTE_URL) {
    const destination = new URL(window.NAWAA_QUOTE_URL, location.href);
    destination.searchParams.set("request", [offer?.title || product.nameAr || sourceQuery,
      offer?.specs?.modelNumber ? "SKU: " + offer.specs.modelNumber : "", offer?.sourceUrl || ""].filter(Boolean).join(" — ").slice(0, 2000));
    location.href = destination.href;
    return;
  }
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

const initialQuery = new URLSearchParams(location.search).get("q");
if (initialQuery && initialQuery.trim().length >= 2) {
  els.input.value = initialQuery.trim();
  runSearch(initialQuery.trim());
}
