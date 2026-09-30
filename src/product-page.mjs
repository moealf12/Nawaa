const $ = (selector) => document.querySelector(selector);
const app = $("#productApp");

const nf = new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 2 });
const fmt = (value) => Number.isFinite(value) ? nf.format(value) + " ر.س" : "غير مؤكد";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function countryFlag(code = "") {
  const cc = String(code).toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "🌐";
  return String.fromCodePoint(...[...cc].map((char) => 127397 + char.charCodeAt(0)));
}

function specRows(offer) {
  const s = offer.specs || {};
  const rows = [
    ["العلامة التجارية", s.brand],
    ["السلسلة", s.series],
    ["نوع الجهاز", s.deviceType],
    ["اللون", s.color],
    ["السعة", s.storage],
    ["الذاكرة RAM", s.ram],
    ["المعالج", s.processor],
    ["حجم الشاشة", s.screenSize],
    ["الشبكة", s.network],
    ["نظام التشغيل", s.operatingSystem],
    ["الكاميرا الخلفية", s.rearCamera],
    ["البطارية", s.battery],
    ["مقاومة الماء", s.waterproof],
    ["رقم الموديل", s.modelNumber],
    ["الباركود", s.barcode],
  ];
  return rows.filter(([, value]) => value !== null && value !== undefined && String(value).trim());
}

function availabilityItems(offer) {
  const items = [];
  if (offer.sourceMeta?.jeddahInStock === true) items.push(["متوفر في جدة", "yes"]);
  else if (offer.sourceMeta?.jeddahInStock === false) items.push(["غير متوفر حاليًا في جدة", "no"]);
  if (offer.sourceMeta?.homeDeliveryEnabled === true) items.push(["التوصيل المنزلي متاح", "yes"]);
  if (offer.sourceMeta?.collectFromStoreEnabled === true) items.push(["الاستلام من المعرض متاح", "yes"]);
  if (offer.availability === "in_stock") items.push(["متوفر لدى المصدر", "yes"]);
  return items;
}

function pricingRows(offer) {
  return [
    ["سعر المنتج", offer.productPrice],
    ["الشحن", offer.shipping],
    ["الاستيراد", offer.importCost],
    ["الضريبة", offer.tax],
    ["الرسوم الإلزامية", offer.mandatoryFees],
    ["الخصم المؤكد", Number.isFinite(offer.discount) ? -offer.discount : null],
  ];
}

function render(snapshot) {
  const offer = snapshot.offer || {};
  const product = snapshot.product || {};
  const title = offer.sourceMeta?.nameAr || offer.title || product.nameAr || product.nameEn || "منتج";
  const specs = specRows(offer);
  const availability = availabilityItems(offer);
  const total = Number.isFinite(offer.totalSAR) ? offer.totalSAR : null;

  document.title = title + " — نواة";

  app.innerHTML = `
    <section class="product-hero">
      <div class="product-media">
        ${offer.image
          ? '<img src="' + escapeHtml(offer.image) + '" alt="' + escapeHtml(title) + '" referrerpolicy="no-referrer" onerror="this.style.display=\'none\';this.nextElementSibling.hidden=false;"><div class="media-fallback" hidden>تعذر تحميل صورة المنتج</div>'
          : '<div class="media-fallback">صورة المنتج غير متاحة</div>'}
      </div>

      <div class="product-copy">
        <div class="source-line">
          <span class="flag">${countryFlag(offer.merchantCountryCode)}</span>
          <span>${escapeHtml(offer.merchant || "مصدر خارجي")}</span>
          <span>·</span>
          <span>${escapeHtml(offer.merchantCountryNameAr || "دولي")}</span>
          ${offer.dataKind === "live" ? '<b>بحث حي</b>' : ""}
        </div>

        <span class="eyebrow">PRODUCT DETAIL / NAWAA</span>
        <h1>${escapeHtml(title)}</h1>
        <p class="model-line">
          ${offer.specs?.modelNumber ? "رقم الموديل " + escapeHtml(offer.specs.modelNumber) + " · " : ""}
          ${escapeHtml(offer.condition === "new" ? "جديد" : offer.condition || "")}
        </p>

        <div class="price-block">
          <span>${total === null ? "السعر المعلن" : "الإجمالي المقارن"}</span>
          <strong>${total === null ? fmt(offer.productPrice) : fmt(total)}</strong>
          <small>${total === null ? "الشحن أو الرسوم النهائية غير مؤكدة بعد." : "الإجمالي مبني على العناصر المؤكدة حاليًا."}</small>
        </div>

        <div class="availability-grid">
          ${availability.length
            ? availability.map(([label, kind]) => '<span class="' + kind + '">' + escapeHtml(label) + '</span>').join("")
            : '<span>التوفر التفصيلي غير متاح من هذا المصدر.</span>'}
        </div>

        <div class="actions">
          <button class="primary" id="quoteBtn">اطلب تسعيرة عبر نواة</button>
          ${offer.sourceUrl ? '<a class="secondary" href="' + escapeHtml(offer.sourceUrl) + '" target="_blank" rel="noopener">فتح المصدر ↗</a>' : ""}
        </div>
      </div>
    </section>

    <section class="detail-grid">
      <article class="panel specs-panel">
        <div class="panel-head">
          <span class="eyebrow">SPECIFICATIONS</span>
          <h2>المواصفات</h2>
        </div>
        <div class="spec-table">
          ${specs.length
            ? specs.map(([label, value]) => '<div><span>' + escapeHtml(label) + '</span><b>' + escapeHtml(value) + '</b></div>').join("")
            : '<p class="empty">المصدر لم يرسل مواصفات تفصيلية لهذا المنتج.</p>'}
        </div>
      </article>

      <article class="panel pricing-panel">
        <div class="panel-head">
          <span class="eyebrow">PRICE INTEGRITY</span>
          <h2>تفصيل السعر</h2>
        </div>
        <div class="pricing-table">
          ${pricingRows(offer).map(([label, value]) =>
            '<div><span>' + escapeHtml(label) + '</span><b>' + (Number.isFinite(value) ? fmt(value) : "غير مؤكد") + '</b></div>'
          ).join("")}
        </div>
        <div class="integrity">
          <b>قاعدة نواة</b>
          <p>لا نسمّي السعر «الأرخص نهائيًا» إذا كانت الشحن أو الرسوم أو مطابقة المنتج غير مكتملة.</p>
        </div>
      </article>
    </section>

    <section class="source-card">
      <div>
        <span class="eyebrow">SOURCE SNAPSHOT</span>
        <h3>${escapeHtml(offer.merchant || "المصدر")}</h3>
        <p>آخر رصد: ${escapeHtml(offer.observedAt ? new Date(offer.observedAt).toLocaleString("ar-SA") : "غير متاح")}</p>
      </div>
      <div class="source-meta">
        <span>مطابقة ${Math.round((offer.matchConfidence || 0) * 100)}%</span>
        <span>${offer.canShipToSaudi === true ? "يشحن/يوصل للسعودية" : "الشحن للسعودية غير مؤكد"}</span>
      </div>
    </section>
  `;

  $("#quoteBtn")?.addEventListener("click", () => {
    const draft = {
      createdAt: new Date().toISOString(),
      productName: title,
      model: offer.specs?.modelNumber || product.model || null,
      variant: [offer.specs?.storage, offer.specs?.color].filter(Boolean).join(" · "),
      sourceQuery: snapshot.query || null,
      observedMerchant: offer.merchant || null,
      observedProductPriceSAR: Number.isFinite(offer.productPrice) ? offer.productPrice : null,
      observedTotalSAR: total,
      sourceUrl: offer.sourceUrl || null,
      status: "draft",
    };
    localStorage.setItem("nawaa_quote_draft", JSON.stringify(draft));
    const button = $("#quoteBtn");
    button.textContent = "تم حفظ مسودة التسعيرة ✓";
    button.disabled = true;
  });
}

async function load() {
  let snapshot = null;
  try {
    snapshot = JSON.parse(localStorage.getItem("nawaa_selected_offer") || "null");
  } catch {}

  const source = new URL(location.href).searchParams.get("source");

  if ((!snapshot || !snapshot.offer) && source) {
    const apiBase = String(window.NAWAA_API_BASE || "").replace(/\/$/, "");
    if (apiBase) {
      app.innerHTML = '<div class="loading">جاري تحميل بيانات المنتج من المصدر…</div>';
      try {
        const response = await fetch(apiBase + "/api/resolve-url?url=" + encodeURIComponent(source), {
          headers: { accept: "application/json" },
        });
        const data = await response.json();
        if (response.ok && data.offer) {
          snapshot = { savedAt: new Date().toISOString(), query: source, product: {}, offer: data.offer };
        }
      } catch {}
    }
  }

  if (!snapshot || !snapshot.offer) {
    app.innerHTML = `
      <div class="missing">
        <span class="eyebrow">NO PRODUCT SELECTED</span>
        <h1>ما عندنا منتج محدد بعد.</h1>
        <p>ارجع لصفحة البحث واختر «عرض التفاصيل» من إحدى النتائج.</p>
        <a class="primary link-button" href="./search.html">العودة للبحث</a>
      </div>
    `;
    return;
  }

  render(snapshot);
}

load();
