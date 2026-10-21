// Customer-facing product-card presentation only: no search or source transformations.
const countForms = Object.freeze({
  offer: ["عرض", "عرضان", "عروض", "عرضًا", "عرض"],
  merchant: ["متجر", "متجران", "متاجر", "متجرًا", "متجر"],
  country: ["دولة", "دولتان", "دول", "دولةً", "دولة"],
});
const pluralRules = new Intl.PluralRules("ar");

export function arabicCount(count, kind) {
  const forms = countForms[kind];
  if (!forms || !Number.isSafeInteger(count) || count < 0) throw new RangeError("Invalid Arabic count");
  switch (pluralRules.select(count)) {
    case "one": return `${forms[0]} واحد${kind === "country" ? "ة" : ""}`;
    case "two": return forms[1];
    case "few": return `${count} ${forms[2]}`;
    case "many": return `${count} ${forms[3]}`;
    case "zero": return `${count} ${forms[2]}`;
    default: return `${count} ${forms[4]}`;
  }
}

// A negative boolean can be meaningful for water resistance. It is NOT a
// meaningful RAM, CPU, capacity or display specification and must not leak
// from merchant schemas as a textual placeholder.
const specFields = [
  ["اللون","color"], ["السعة","storage"], ["الذاكرة","ram"],
  ["المعالج","processor"], ["الشاشة","screenSize"], ["نوع الشاشة","screenType"],
  ["الشبكة","network"], ["الشريحة","sim"], ["النظام","operatingSystem"],
  ["الكاميرا الخلفية","rearCamera"], ["الكاميرا الأمامية","frontCamera"],
  ["البطارية","battery"], ["مقاومة الماء","waterproof"],
];
const missingValue = /^(?:n\/?a|not applicable|not available|unknown|undefined|null|none|غير محدد|غير متوفر|غير معروف|لا يوجد)$/i;
const booleanValue = /^(?:no|yes|false|true)$/i;

const detailSpecFields = [
  ["العلامة التجارية", "brand"], ["السلسلة", "series"],
  ["نوع الجهاز", "deviceType"], ["اللون", "color"],
  ["السعة", "storage"], ["الذاكرة RAM", "ram"],
  ["المعالج", "processor"], ["حجم الشاشة", "screenSize"],
  ["نوع الشاشة", "screenType"], ["الشبكة", "network"],
  ["نوع الشريحة", "sim"], ["نسخة المنطقة", "regionVersion"],
  ["نظام التشغيل", "operatingSystem"], ["الكاميرا الخلفية", "rearCamera"],
  ["الكاميرا الأمامية", "frontCamera"], ["البطارية", "battery"],
  ["مقاومة الماء", "waterproof"], ["رقم الموديل", "modelNumber"],
  ["الباركود", "barcode"],
];

// One field-sensitive presentation policy for cards, comparisons and details.
// Keep raw source evidence untouched. Identifiers preserve their exact text.
function visibleSpecificationRows(offer, fields, maxRows) {
  const specs = offer?.specs || {};
  const result = [];
  for (const [label, key] of fields) {
    const raw = specs[key];
    if (raw === null || raw === undefined || typeof raw === "object") continue;
    const value = String(raw).trim();
    if (!value || missingValue.test(value)) continue;
    if (booleanValue.test(value)) {
      if (key === "waterproof") {
        result.push([label, /^(?:yes|true)$/i.test(value) ? "نعم" : "لا"]);
      }
      continue;
    }
    result.push([label, value]);
    if (result.length === maxRows) break;
  }
  return result;
}

export function visibleProductSpecifications(offer = {}) {
  return visibleSpecificationRows(offer, specFields, 10);
}

export function visibleProductDetailSpecifications(offer = {}) {
  return visibleSpecificationRows(offer, detailSpecFields, Number.POSITIVE_INFINITY);
}
