// STAGED 1688 mobile homepage diagnostics. Never converts a promotional card
// into a purchasable NAWAA offer without canonical SKU/PDP/MOQ validation.
import { load } from "cheerio";

export function inspect1688MobileHomepage(html, { finalUrl, httpStatus = 200 } = {}) {
  const sample = typeof html === "string" ? html : "";
  const size = Buffer.byteLength(sample);
  const result = {
    schema: "nawaa.1688.mobile-home.v1",
    httpStatus,
    htmlBytes: size,
    source: "1688-cn",
    canonicalOfferIds: 0,
    promotionalCards: 0,
    visiblePriceCandidatesCny: 0,
    cardsWithImages: 0,
    cardsWithTitles: 0,
    trackingOnlyLinks: 0,
    retailMoqVerified: 0,
    skuVariantVerified: 0,
    pdpPriceVerified: 0,
    customerPublishable: false,
    samples: [],
    state: "NOT_OBSERVED",
  };
  let origin;
  try { origin = new URL(finalUrl || "https://m.1688.com/"); }
  catch { result.state = "INVALID_FINAL_URL"; return result; }
  if (origin.protocol !== "https:" || !["m.1688.com", "www.1688.com"].includes(origin.hostname)
      || /\/_____tmd_____\/|\/login\b|\/punish\b/.test(origin.pathname)) {
    result.state = "LOGIN_OR_PUNISH_REDIRECT"; return result;
  }
  if (httpStatus !== 200) {
    result.state = httpStatus === 403 ? "HTTP_403_DENIED" :
      httpStatus === 429 ? "HTTP_429_RATE_LIMITED" : "HTTP_NOT_OK";
    return result;
  }
  if (!sample || size > 2_000_000) {
    result.state = sample ? "RESPONSE_TOO_LARGE" : "NO_HTML";
    return result;
  }
  if (/Sorry,\s*we have detected unusual traffic|_____tmd_____|验证码|人机验证/i.test(sample)) {
    result.state = "CHALLENGE_SHELL"; return result;
  }
  const $ = load(sample);
  const nodes = $("a.goods-container, a[class*='goods-container']");
  result.promotionalCards = Math.min(nodes.length, 1000);
  const seen = new Set();
  nodes.slice(0, 80).each((_, node) => {
    const card = $(node);
    const href = card.attr("href") || "";
    let linkType = "UNTRUSTED";
    try {
      const u = new URL(href, origin);
      if (u.protocol === "https:" && !u.username && !u.password) {
        if (u.hostname === "dj.1688.com" && u.pathname === "/ci_bb")
          linkType = "FIRST_PARTY_TRACKING";
        else if (/^(?:m|detail)\.1688\.com$/.test(u.hostname) &&
            /^\/offer\/\d{6,20}\.html$/.test(u.pathname))
          linkType = "CANONICAL_OFFER";
      }
    } catch {}
    if (linkType === "FIRST_PARTY_TRACKING") result.trackingOnlyLinks++;
    if (linkType === "CANONICAL_OFFER") result.canonicalOfferIds++;
    const visible = card.text().replace(/\s+/g, " ").trim();
    const title = visible.replace(/[¥￥]\s*\d[\d,]*(?:\.\d{1,2})?.*$/s,"")
      .replace(/包邮|退货包运费|已售\d+(?:\.\d+)?(?:万)?件/g, " ").trim();
    const priceMatches = [...visible.matchAll(/[¥￥]\s*(\d{1,8}(?:\.\d{1,2})?)/g)];
    const price = priceMatches.length === 1 ? Number(priceMatches[0][1]) : null;
    const meaningfulTitle = title.length >= 8 && title.length <= 320;
    const imgSrcs = card.find("img").map((_, el) =>
      $(el).attr("src") || $(el).attr("data-src") || "").get();
    const validImg = imgSrcs.some(raw => {
      try {
        const url = new URL(raw, origin);
        return url.protocol === "https:" &&
          (url.hostname === "alicdn.com" || url.hostname.endsWith(".alicdn.com") ||
           url.hostname === "1688.com" || url.hostname.endsWith(".1688.com"));
      } catch { return false; }
    });
    if (price !== null && price > 0) result.visiblePriceCandidatesCny++;
    if (validImg) result.cardsWithImages++;
    if (meaningfulTitle) result.cardsWithTitles++;
    // Keep only a tiny bounded evidence sample; never store redirect-token URLs.
    const key = title.slice(0, 140) + ":" + (price ?? "");
    if (result.samples.length < 5 && meaningfulTitle && !seen.has(key)) {
      seen.add(key);
      result.samples.push({
        title: title.slice(0, 140),
        displayedPriceCny: price,
        hasImage: validImg,
        linkType,
        retailUnitPriceVerified: false,
      });
    }
  });
  result.state = result.promotionalCards && result.visiblePriceCandidatesCny &&
    result.cardsWithImages ? "PROMOTIONAL_PRODUCT_EVIDENCE_ONLY" :
    result.promotionalCards ? "UNPRICED_PROMOTIONAL_CARDS" : "NO_MOBILE_CARD_EVIDENCE";
  return result;
}
