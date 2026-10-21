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

export function visibleProductSpecifications(offer = {}) {
  const specs = offer?.specs || {};
  const result = [];
  for (const [label, key] of specFields) {
    const raw = specs[key];
    if (raw === null || raw === undefined || typeof raw === "object") continue;
    const value = String(raw).trim();
    if (!value || missingValue.test(value)) continue;
    if (booleanValue.test(value)) {
      if (key === "waterproof") {
        result.push([label, /^(?:yes|true)$/i.test(value) ? "نعم" : "لا"]);
      }
      // "No" is not a RAM size, but is valid as a negative water-resistance flag.
      continue;
    }
    result.push([label, value]);
    if (result.length === 10) break;
  }
  return result;
}
