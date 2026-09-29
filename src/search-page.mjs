import {
  DEMO_CATALOG,
  findBestProduct,
  isLikelyUrl,
  rankOffers,
  summarizeOffers,
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

function offerCard(offer, index) {
  const best = index === 0 && offer.bucket === "confirmed";
  const eta = Number.isFinite(offer.deliveryDays) ? offer.deliveryDays + " يوم" : "غير مؤكد";
  return `
    <article class="offer-card ${best ? "is-best" : ""}">
      <div class="offer-rank">${best ? "BEST" : String(index + 1).padStart(2, "0")}</div>
      <div class="offer-store">
        <strong><span class="country-flag" title="${escapeHtml(offer.merchantCountryNameAr || "دولة المصدر")}">${countryFlag(offer.merchantCountryCode)}</span> ${escapeHtml(offer.merchant)}</strong>
        <span>${escapeHtml(offer.merchantCountryNameAr || "دولي")} · ${offer.dataKind === "verified_source" ? "مصدر موثق" : offer.dataKind === "live" ? "بحث حي" : "بيانات اختبار"} · ${bucketLabel(offer.bucket)} · تطابق ${Math.round((offer.matchConfidence || 0) * 100)}%</span>
        ${offer.sourceUrl ? '<a class="offer-source-link" href="' + escapeHtml(offer.sourceUrl) + '" target="_blank" rel="noopener">فتح المصدر ↗</a>' : ""}
      </div>
      <div class="offer-meta">
        <small>الوصول</small>
        <b>${eta}</b>
      </div>
      <div class="offer-price">
        <small>${offer.totalSAR === null ? "السعر المعلن" : "الإجمالي المقارن"}</small>
        <strong>${offer.totalSAR === null ? fmt(offer.productPrice) + " +" : fmt(offer.totalSAR)}</strong>
      </div>
    </article>
  `;
}

function renderProduct(product, query) {
  const ranked = rankOffers(product.offers, state.mode);
  const summary = summarizeOffers(product.offers);
  const comparable = ranked.filter((o) => ["confirmed", "estimated"].includes(o.bucket));
  const uncertain = ranked.filter((o) => !["confirmed", "estimated"].includes(o.bucket));
  const best = summary.bestConfirmed;

  const hasLive = product.offers.some((offer) => offer.dataKind === "live");
  els.status.textContent = hasLive
    ? `وجدنا ${summary.count} عرضًا حيًا من ${summary.sources} مصادر/بائعين`
    : `وجدنا ${summary.count} عروض تجريبية من ${summary.sources} مصادر`;
  els.urlHint.hidden = true;

  els.results.innerHTML = `
    <section class="result-head">
      <div>
        <span class="mini-kicker">NORMALIZED PRODUCT</span>
        <h2>${escapeHtml(product.nameAr)}</h2>
        <p>${escapeHtml(product.brand)} · ${escapeHtml(product.model)} · ${escapeHtml(product.variant || "")}</p>
      </div>
      <div class="identity-pill">✓ هوية المنتج عالية الثقة</div>
    </section>

    <section class="result-grid">
      <div class="offers-column">
        <div class="section-label"><span>العروض القابلة للمقارنة</span><b>${comparable.length}</b></div>
        ${comparable.length ? comparable.map(offerCard).join("") : '<div class="empty-state">لا يوجد عرض بإجمالي مكتمل حاليًا.</div>'}
      </div>

      <aside class="best-panel">
        <span class="mini-kicker">BEST CONFIRMED TOTAL</span>
        ${best ? `
          <small>أقل إجمالي مؤكد في بيانات الاختبار</small>
          <div class="best-price">${fmt(best.totalSAR)}</div>
          <div class="breakdown">${priceBreakdown(best)}</div>
          <button class="primary-action" id="quoteBestBtn">اطلب تسعيرة لهذا المنتج</button>
          <p>الضغط لا ينفذ شراءً أو دفعًا. يحفظ مسودة طلب فقط في هذه النسخة.</p>
        ` : `
          <div class="empty-state compact">لا يوجد عرض مؤكد بالكامل حتى الآن.</div>
          <button class="primary-action" id="quoteBestBtn">اطلب تسعيرة لهذا المنتج</button>
        `}
      </aside>
    </section>

    <section class="uncertain-block">
      <div class="section-label"><span>نتائج تحتاج تحقق — لا تدخل في ترتيب الأرخص</span><b>${uncertain.length}</b></div>
      ${uncertain.length ? uncertain.map(offerCard).join("") : '<div class="empty-state">لا توجد نتائج غير مؤكدة.</div>'}
    </section>

    <div class="integrity-note">
      <strong>قاعدة نواة:</strong>
      لا نسمّي عرضًا «الأرخص» إذا كانت مطابقة الموديل، حالة المنتج، الشحن، أو التكلفة النهائية غير مؤكدة.
    </div>
  `;

  $("#quoteBestBtn")?.addEventListener("click", () => openQuote(product, best, query));
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
        els.status.textContent = `بحث حي: ${data.offers.length} عرضًا · ${countries} دول · ${data.providersConfigured?.length || 0} موصلات`;
        return;
      }

      els.status.textContent = "البحث الحي لم يُرجع عروضًا مطابقة";
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
