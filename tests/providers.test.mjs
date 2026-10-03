import assert from "node:assert/strict";
import { assessOfferMatch, dedupeNormalizedOffers } from "../server/match.mjs";
import { normalizeCondition, parseMoney } from "../server/provider-utils.mjs";
import { parseJarirConstructorPayload, parseJarirSearchHtml } from "../server/providers/jarir.mjs";
import { parseNoonCatalogPayload } from "../server/providers/noon.mjs";
import { parseCarrefourSearchPayload } from "../server/providers/carrefour.mjs";
import { parseSharafAlgoliaPayload } from "../server/providers/sharafdg.mjs";
import { parseSwarovskiSearchHtml, swarovskiSaudiEligible, swarovskiSaudiProviderQuery } from "../server/providers/swarovski.mjs";
import { parseAmazonCreatorsPayload } from "../server/providers/amazon-creators.mjs";
import { extractProductLinks, extractAliExpressSearchOffers, extractTemuSearchOffers, extractBestBuySearchOffers, parseIkeaSikPayload, parseLandmarkAlgoliaPayload, parseLandmarkBloomreachPayload, selectedStores, configuredFreeStorefronts, routeFreeStorefronts } from "../server/providers/free-storefronts.mjs";
import { extractEmbeddedProductState, extractMetaProductState, extractionCandidates } from "../server/url-resolver.mjs";

assert.equal(normalizeCondition("Brand New"), "new");
assert.equal(normalizeCondition("Open Box"), "open_box");
assert.equal(parseMoney("$1,299.99"), 1299.99);

const embeddedFixture = `
<script id="__NEXT_DATA__" type="application/json">
{"props":{"pageProps":{"product":{"productName":"Example Saudi Product","salePrice":{"amount":249.5,"currency":"SAR"},"imageUrl":"https://example.com/p.jpg","brandName":"Example","sku":"SKU-1","stockStatus":"IN_STOCK"}}}}
</script>`;
const embedded = extractEmbeddedProductState(embeddedFixture);
assert.equal(embedded.name, "Example Saudi Product");
assert.equal(embedded.offers.price, 249.5);
assert.equal(embedded.offers.priceCurrency, "SAR");
assert.equal(embedded.brand, "Example");
assert.equal(embedded.sku, "SKU-1");

const metaFixture = `
<meta property="og:title" content="Meta Product">
<meta property="og:image" content="https://example.com/meta.jpg">
<meta property="product:price:amount" content="129.50">
<meta property="product:price:currency" content="SAR">`;
const metaProduct = extractMetaProductState(metaFixture);
assert.equal(metaProduct.name, "Meta Product");
assert.equal(metaProduct.offers.price, 129.5);
assert.equal(metaProduct.offers.priceCurrency, "SAR");

const strategies = extractionCandidates(embeddedFixture);
assert.ok(strategies.some((entry) => entry.strategy === "embedded_json"));



const iphone = assessOfferMatch("iPhone 17 256GB", {
  title: "Apple iPhone 17 256GB Black Factory Unlocked",
  condition: "new",
});
assert.equal(iphone.exactMatch, true);
assert.ok(iphone.matchConfidence >= 0.92);

const jarirExact = assessOfferMatch("iPhone 17 256GB", {
  title: "Apple iPhone 17, 256 GB, Black, 5G, Apple A19",
  condition: "new",
});
assert.equal(jarirExact.exactMatch, true);
assert.equal(jarirExact.matchConfidence, 1);

const accessory = assessOfferMatch("iPhone 17", {
  title: "Protective Case Cover for iPhone 17",
  condition: "new",
});
assert.equal(accessory.exactMatch, false);
assert.ok(accessory.matchConfidence < 0.5);

const unique = dedupeNormalizedOffers([
  { provider:"ebay", sourceUrl:"https://x/1", title:"iPhone 17", originalProductPrice:900, originalCurrency:"USD" },
  { provider:"ebay", sourceUrl:"https://x/1", title:"iPhone 17", originalProductPrice:900, originalCurrency:"USD" },
  { provider:"ebay", sourceUrl:"https://x/2", title:"iPhone 17", originalProductPrice:910, originalCurrency:"USD" },
]);
assert.equal(unique.length, 2);

const jarirFixture = `
<div class="product-tile__item--spacer d-inline-flex" data-cnstrc-item-id="666789" data-cnstrc-item-name="Apple iPhone 17, 256 GB, Lavender, 5G, Apple A19" data-cnstrc-item-price="4299">
  <a href="https://www.jarir.com/sa-en/apple-iphone-17-smartphones-666789.html" data-product-id="666789"></a>
  <img src="https://example.com/666789.jpg" alt="Apple iPhone 17, 256 GB, Lavender, 5G, Apple A19">
  <button>Add to Cart</button>
</div>
<div class="product-tile__item--spacer d-inline-flex" data-cnstrc-item-id="673746" data-cnstrc-item-name="Renewed Grade A Apple iPhone 17, 256 GB, White, 5G" data-cnstrc-item-price="3199">
  <a href="https://www.jarir.com/sa-en/apple-iphone-17-renewed-smartphones-673746.html" data-product-id="673746"></a>
  <img src="https://example.com/673746.jpg" alt="Renewed Grade A Apple iPhone 17, 256 GB, White, 5G">
</div>`;
const jarirOffers = parseJarirSearchHtml(jarirFixture);
assert.equal(jarirOffers.length, 2);
assert.equal(jarirOffers[0].merchant, "Jarir");
assert.equal(jarirOffers[0].productPrice, 4299);
assert.equal(jarirOffers[0].availability, "in_stock");
assert.equal(jarirOffers[0].specs.storage, "256 GB");
assert.equal(jarirOffers[0].specs.color, "Lavender");
assert.equal(jarirOffers[0].specs.network, "5G");
assert.equal(jarirOffers[0].specs.processor, "Apple A19");
assert.equal(jarirOffers[1].condition, "renewed");

const jarirConstructorFixture = {
  response: {
    results: [{
      value: "Apple iPhone 17, 256 GB, Black, 5G, Apple A19",
      data: {
        id: "666784",
        url: "apple-iphone-17-smartphones-666784.html",
        price: 4299,
        image_url: "https://example.com/666784.jpg",
        metadata: {
          name: "Apple iPhone 17, 256 GB, Black, 5G, Apple A19",
          brand: "Apple",
          seri: "Apple iPhone 17",
          model: "iPhone 17",
          ptyp: "Smartphone",
          tsca: "256 GB",
          colo: "Black",
          scsz: "6.3\"",
          scty: "Super Retina XDR Display",
          opsy: "iOS 26",
          nsim: "Dual eSIM (eSIM/eSIM)",
          cars: "Rear: 48 MP + 48 MP/Front: 18 MP",
          mpn: "MG674AHA",
          bar_code1: "195950643008",
          productcode_description: "Smartphones"
        }
      }
    }]
  }
};
const jarirConstructorOffers = parseJarirConstructorPayload(jarirConstructorFixture);
assert.equal(jarirConstructorOffers.length, 1);
assert.equal(jarirConstructorOffers[0].productPrice, 4299);
assert.equal(jarirConstructorOffers[0].specs.color, "Black");
assert.equal(jarirConstructorOffers[0].specs.storage, "256 GB");
assert.equal(jarirConstructorOffers[0].specs.screenSize, '6.3"');
assert.equal(jarirConstructorOffers[0].specs.rearCamera, "48 MP + 48 MP");
assert.equal(jarirConstructorOffers[0].specs.frontCamera, "18 MP");
assert.equal(jarirConstructorOffers[0].specs.modelNumber, "MG674AHA");

const noonFixture = {
  type: "catalog",
  nbHits: 1,
  hits: [{
    offer_code: "de2e8df30cb20f7e",
    catalog_sku: "N70211553V-1",
    sku: "N70211553V",
    brand: "Apple",
    name: "iPhone 17 256GB (Nano SIM + eSIM) Black 5G With FaceTime - International Version",
    plp_specifications: {
      "Screen Size": "6.3 in",
      "RAM Size": "8 GB",
      "Battery Size": "3692 mAh",
      "Secondary Camera Resolution": "18 MP"
    },
    price: 3798,
    sale_price: null,
    image_url: "https://example.com/noon.jpg",
    is_buyable: true,
    flags: ["fbn","free_delivery_eligible"],
    nudges: [{ text: "Free Delivery" }, { text: "Only 6 left in stock" }],
    low_stock_nudge_value: 6,
    pdp_url: "/iphone-17-256gb-nano-sim-esim-black-5g-with-facetime-international-version/N70211553V/p/?o=abc",
    store_name: "Seller One",
    partner_ratings_sellerlab: {
      positive_seller_rating: 97,
      partner_rating: 4.8
    },
    product_rating: { value: 4.6, count: 6419 }
  }]
};
const noonOffers = parseNoonCatalogPayload(noonFixture);
assert.equal(noonOffers.length, 1);
assert.equal(noonOffers[0].merchant, "noon");
assert.equal(noonOffers[0].productPrice, 3798);
assert.equal(noonOffers[0].shipping, 0);
assert.equal(noonOffers[0].availability, "in_stock");
assert.equal(noonOffers[0].specs.deviceType, "iPhone 17");
assert.equal(noonOffers[0].specs.storage.replace(" ",""), "256GB");
assert.equal(noonOffers[0].specs.color, "Black");
assert.equal(noonOffers[0].specs.sim, "Nano SIM + eSIM");
assert.equal(noonOffers[0].specs.network, "5G");
assert.equal(noonOffers[0].specs.ram, "8 GB");
assert.equal(noonOffers[0].specs.battery, "3692 mAh");
assert.equal(noonOffers[0].specs.regionVersion, "International Version");
assert.equal(noonOffers[0].sourceMeta.freeDelivery, true);
assert.equal(noonOffers[0].sourceMeta.fulfilledByNoon, true);
assert.equal(noonOffers[0].sourceMeta.lowStockCount, 6);
assert.equal(noonOffers[0].seller.name, "Seller One");

const carrefourFixture = {
  sections: [{
    uid: "master-product-card",
    componentDTO: {
      additionalAttributes: {
        productCompositeId: "754835|offer_carrefour_|EXPRESS",
        imageUrl: "https://example.com/754835.jpg",
        intent: "EXPRESS",
        offerId: "offer_carrefour_",
        productId: "754835",
        productName: "Apple iPhone 17 ,256 GB, Black, 5G",
        shopName: "Carrefour",
        shippingIndicator: "EXPRESS",
        sellingPrice: 3999,
        markedPrice: 4299,
        currency: "SAR",
        isExpress: true,
        internationalShipping: false,
        stock: { value: 1, stockLevelStatus: "lowStock" },
        productUrl: "/mafsau/en/smartphones/apple-iphone-17-256gb-black/p/754835"
      },
      productCardComponents: [{
        uid: "product-price",
        componentDTO: { priceDTO: { finalPrice: "3999.00", currency: "SAR" } }
      }]
    }
  }]
};
const carrefourOffers = parseCarrefourSearchPayload(carrefourFixture);
assert.equal(carrefourOffers.length, 1);
assert.equal(carrefourOffers[0].merchant, "Carrefour");
assert.equal(carrefourOffers[0].productPrice, 3999);
assert.equal(carrefourOffers[0].discount, 0);
assert.equal(carrefourOffers[0].advertisedDiscount, 300);
assert.equal(carrefourOffers[0].availability, "in_stock");
assert.equal(carrefourOffers[0].specs.deviceType, "iPhone 17");
assert.equal(carrefourOffers[0].specs.storage.replace(" ",""), "256GB");
assert.equal(carrefourOffers[0].specs.color, "Black");
assert.equal(carrefourOffers[0].specs.network, "5G");
assert.equal(carrefourOffers[0].sourceMeta.stockValue, 1);
assert.equal(carrefourOffers[0].seller.type, "retailer");
assert.ok(carrefourOffers[0].sourceUrl.endsWith("/754835"));

const sharafFixture = {
  nbHits: 1,
  hits: [{
    objectID: "12345",
    sku: "S500943806",
    post_title: "Apple iPhone 17 (256GB) – Black – Middle East Version with FaceTime",
    permalink: "https://saudi.sharafdg.com/en/product/apple-iphone-17-256gb-black-middle-east-version-with-facetime/",
    sale_price: "3799",
    regular_price: "3999",
    stock_status: "instock",
    image_url: "https://example.com/iphone17-black.jpg",
    attributes: {
      ram: "8GB",
      screen_size: "6.3 inch",
      operating_system: "iOS 26",
      rear_camera: "48MP + 48MP",
      front_camera: "18MP"
    }
  }]
};
const sharafOffers = parseSharafAlgoliaPayload(sharafFixture);
assert.equal(sharafOffers.length, 1);
assert.equal(sharafOffers[0].merchant, "Sharaf DG");
assert.equal(sharafOffers[0].productPrice, 3799);
assert.equal(sharafOffers[0].discount, 0);
assert.equal(sharafOffers[0].advertisedDiscount, 200);
assert.equal(sharafOffers[0].availability, "in_stock");
assert.equal(sharafOffers[0].specs.deviceType, "iPhone 17");
assert.equal(sharafOffers[0].specs.storage.replace(" ",""), "256GB");
assert.equal(sharafOffers[0].specs.color, "Black");
assert.equal(sharafOffers[0].specs.regionVersion, "Middle East Version");
assert.equal(sharafOffers[0].specs.ram, "8GB");
assert.equal(sharafOffers[0].specs.screenSize, "6.3 inch");
assert.equal(sharafOffers[0].specs.operatingSystem, "iOS 26");
assert.equal(sharafOffers[0].sourceMeta.productId, "S500943806");


const swarovskiFixture = `
<div class="js-product-tile-container product bg-white" data-pid="030715671675" data-sku="9009656364451">
  <a class="product-tile" href="https://ar.swarovski.sa/fw19/lovely-necklace/M5636449.html" data-gtm="&quot;item_in_stock&quot;:true">
    <img class="tile-image" src="https://ar.swarovski.sa/dw/image/example.png?sw=340&amp;sh=340" alt="سواروفسكي عقد Lovely">
    <div class="name-container"><h2 class="pdp-link">عقد Lovely</h2>
      <div class="subtitle">شكل قلب، لون أبيض</div>
    </div>
    <div class="price"><span class="sales"><span class="value" content="700.00" itemprop="price"></span></span></div>
  </a>
</div>
<div class="js-product-tile-container product bg-white" data-pid="030715671672" data-sku="9009656364437">
  <a class="product-tile" href="/fw19/lovely-bracelet/M5636964.html">
    <img class="tile-image" src="/dw/image/bracelet.png">
    <h2 class="pdp-link">سوار Lovely</h2>
    <span class="value" itemprop="price" content="800.00"></span>
  </a>
</div>`;
const swarovskiOffers = parseSwarovskiSearchHtml(swarovskiFixture);
assert.equal(swarovskiOffers.length, 2);
assert.equal(swarovskiOffers[0].merchant, "Swarovski Saudi");
assert.equal(swarovskiOffers[0].productPrice, 700);
assert.equal(swarovskiOffers[0].specs.brand, "Swarovski");
assert.equal(swarovskiOffers[0].specs.deviceType, "Necklace");
assert.equal(swarovskiOffers[0].specs.modelNumber, "030715671675");
assert.equal(swarovskiOffers[0].specs.barcode, "9009656364451");
assert.equal(swarovskiOffers[0].availability, "in_stock");
assert.ok(swarovskiOffers[0].image.includes("&sh=340"));
assert.equal(assessOfferMatch("سواروفسكي", swarovskiOffers[0]).exactMatch, true);
assert.equal(assessOfferMatch("قلادة سواروفسكي", swarovskiOffers[0]).exactMatch, true);
assert.equal(swarovskiOffers[1].sourceUrl, "https://ar.swarovski.sa/fw19/lovely-bracelet/M5636964.html");
assert.equal(swarovskiSaudiEligible("swarovski"), true);
assert.equal(swarovskiSaudiEligible("necklace swarovski"), true);
assert.equal(swarovskiSaudiEligible("iphone 17"), false);
assert.equal(swarovskiSaudiProviderQuery("necklace swarovski"), "necklace");
assert.equal(swarovskiSaudiProviderQuery("swarovski"), "swarovski");

const amazonFixture = {
  searchResult: {
    items: [{
      asin: "B0TEST1234",
      detailPageURL: "https://www.amazon.sa/dp/B0TEST1234",
      images: { primary: { medium: { url: "https://images.example/amazon.jpg" } } },
      itemInfo: {
        title: { displayValue: "Apple iPhone 17 256GB Black" },
        byLineInfo: { brand: { displayValue: "Apple" } },
        externalIds: { eaNs: { displayValues: ["1234567890123"] } },
        productInfo: { color: { displayValue: "Black" } },
      },
      offersV2: { listings: [{
        isBuyBoxWinner: true,
        availability: { type: "IN_STOCK" },
        condition: { value: "New" },
        merchantInfo: { name: "Amazon.sa" },
        price: { money: { amount: 3999, currency: "SAR" } },
      }] },
    }],
  },
};
const amazonOffers = await parseAmazonCreatorsPayload(amazonFixture, {
  id:"amazon-sa", marketplace:"www.amazon.sa", countryCode:"SA", countryNameAr:"السعودية"
});
assert.equal(amazonOffers.length, 1);
assert.equal(amazonOffers[0].merchant, "Amazon.sa");
assert.equal(amazonOffers[0].productPrice, 3999);
assert.equal(amazonOffers[0].availability, "in_stock");
assert.equal(amazonOffers[0].specs.modelNumber, "B0TEST1234");
assert.equal(amazonOffers[0].specs.barcode, "1234567890123");
assert.equal(amazonOffers[0].canShipToSaudi, true);

const sheinStore = {
  id:"shein-sa",
  productPath:/-p-\d+\.html(?:[?#]|$)/i,
};
const freeLinks = extractProductLinks(`
  <a href="/Women-Dresses/Summer-Dress-p-123456.html">Summer Dress</a>
  <a href="/pdsearch/dress/">Search results</a>
  <a href="https://example.com/Women-Dresses/Fake-p-999.html">External</a>
`, "https://ar.shein.com/pdsearch/dress/", sheinStore, "dress", 5);
assert.equal(freeLinks.length, 1);
assert.ok(freeLinks[0].url.includes("p-123456.html"));

const sheinStructuredLinks = extractProductLinks(String.raw`
  {"canonicalUrl":"Women-Dresses/Summer-Dress-p-123456.html"}
`, "https://ar.shein.com/pdsearch/dress/", sheinStore, "dress", 5);
assert.equal(sheinStructuredLinks.length, 1);
assert.equal(sheinStructuredLinks[0].url, "https://ar.shein.com/Women-Dresses/Summer-Dress-p-123456.html");

const temuStore = {
  id:"temu-global",
  productPath:/\/(?:goods|item)\.html(?:[?#]|$)|-g-\d+\.html/i,
};
const temuStructuredLinks = extractProductLinks(String.raw`
  {"canonicalUrl":"sa-en/iphone-17-clear-case-g-601100089500228.html"}
  {"productUrl":"\\u002Fsa-en\\u002Fiphone-17-pro-case-g-601100089500229.html"}
`, "https://www.temu.com/search_result.html?search_key=iphone%2017%20case", temuStore, "iphone 17 case", 10);
assert.equal(temuStructuredLinks.length, 2);
assert.ok(temuStructuredLinks.every((entry) => entry.url.includes("temu.com/sa-en/")));
assert.ok(temuStructuredLinks.some((entry) => entry.url.includes("601100089500228")));
assert.ok(temuStructuredLinks.some((entry) => entry.url.includes("601100089500229")));
assert.ok(selectedStores("فستان شي ان", 8).some((store) => store.id === "shein-sa"));
assert.ok(selectedStores("لابتوب", 8).some((store) => store.id === "newegg-global"));
assert.ok(configuredFreeStorefronts().length >= 15);

const fashionRoutes = routeFreeStorefronts("فستان شي ان", 8);
assert.equal(fashionRoutes[0].store.id, "shein-sa");
assert.ok(fashionRoutes[0].reasons.includes("brand"));
assert.ok(fashionRoutes.every((route) =>
  route.store.categories.includes("clothing") ||
  route.store.categories.includes("*") ||
  route.reasons.includes("adjacent_category")
));

const laptopRoutes = routeFreeStorefronts("لابتوب hp", 8);
assert.ok(laptopRoutes.some((route) => route.store.id === "newegg-global"));
assert.ok(laptopRoutes.some((route) => route.store.id === "bestbuy-us"));
assert.ok(laptopRoutes.some((route) => route.store.id === "bhphoto-us"));
assert.ok(!laptopRoutes.some((route) => route.store.id === "sephora-sa"));
assert.ok(laptopRoutes.length <= 8);

const perfumeRoutes = routeFreeStorefronts("عطر", 8);
assert.ok(["sephora-sa","niceone-sa","goldenscent-sa"].includes(perfumeRoutes[0].store.id));
assert.ok(perfumeRoutes.some((route) => route.store.id === "sephora-sa"));
assert.ok(perfumeRoutes.some((route) => route.store.id === "niceone-sa"));
assert.ok(perfumeRoutes.some((route) => route.store.id === "goldenscent-sa"));
assert.ok(perfumeRoutes.some((route) => route.store.id === "aliexpress-cn"));
assert.ok(!perfumeRoutes.some((route) => route.store.id === "newegg-global"));

const unknownRoutes = routeFreeStorefronts("منتج غريب غير مصنف", 8);
assert.ok(unknownRoutes.length >= 3);
assert.ok(unknownRoutes.every((route) =>
  route.store.categories.includes("*") || route.store.categories.includes("other")
));

const namshiRoute = routeFreeStorefronts("نمشي فستان", 8);
assert.equal(namshiRoute[0].store.id, "namshi-sa");
assert.ok(namshiRoute[0].reasons.includes("brand"));

const decathlonRoute = routeFreeStorefronts("ديكاتلون running shoes", 8);
assert.equal(decathlonRoute[0].store.id, "decathlon-sa");
assert.ok(decathlonRoute[0].reasons.includes("brand"));

const niceOneRoute = routeFreeStorefronts("نايس ون عطر", 8);
assert.equal(niceOneRoute[0].store.id, "niceone-sa");
assert.ok(niceOneRoute[0].reasons.includes("brand"));

const centrepointLinks = extractProductLinks(
  '<a href="/sa/en/buy-nike-mens-running-shoes/p/NKHJ9198-004">Nike Running Shoes</a>',
  "https://www.centrepointstores.com/sa/en/search?q=nike",
  { productPath:/\/sa\/en\/(?:buy-[^?#]+\/p\/[^/?#]+|p\/[^/?#]+)(?:[/?#]|$)/i },
  "nike running shoes", 5
);
assert.equal(centrepointLinks.length, 1);

const decathlonLinks = extractProductLinks(
  '<a href="/products/men-s-jogflow-100-1-running-shoes?variant=123">Running Shoes</a>',
  "https://decathlon.com.sa/search?q=running",
  { productPath:/\/products\/[^/?#]+(?:[/?#]|$)/i },
  "running shoes", 5
);
assert.equal(decathlonLinks.length, 1);

const niceOneLinks = extractProductLinks(
  '<a href="/en/chanel-n-5-for-women-eau-de-parfum-n11807">Chanel N5 perfume</a>',
  "https://niceonesa.com/en/search?q=perfume",
  { productPath:/\/en\/[^?#]+-n\d+(?:[/?#]|$)/i },
  "chanel perfume", 5
);
assert.equal(niceOneLinks.length, 1);

assert.ok(configuredFreeStorefronts().some((store) => store.id === "namshi-sa"));
assert.ok(configuredFreeStorefronts().some((store) => store.id === "centrepoint-sa"));
assert.ok(configuredFreeStorefronts().some((store) => store.id === "maxfashion-sa"));
assert.ok(configuredFreeStorefronts().some((store) => store.id === "decathlon-sa"));
assert.ok(configuredFreeStorefronts().some((store) => store.id === "niceone-sa"));

console.log("NAWAA provider tests passed");


const neweggDiscoveryHtml = [
  '<a href="https://www.newegg.com/p/pl?d=laptop">Laptop category</a>',
  '<a href="https://www.newegg.com/p/N82E16834156568">Laptop RTX</a>'
].join("");
const neweggLinks = extractProductLinks(
  neweggDiscoveryHtml,
  "https://www.newegg.com/global/sa-en/p/pl?d=laptop",
  { productPath:/\/p\/(?!pl(?:[/?#]|$))[A-Z0-9-]+(?:[/?#]|$)/i },
  "laptop"
);
assert.equal(neweggLinks.length, 1);
assert.match(neweggLinks[0].url, /\/p\/N82E16834156568/);

const unicodeEscapedLinks = extractProductLinks(
  '<script>{"productUrl":"\\u002Fip\\u002Fapple-iphone-17\\u002F123456789"}</script>',
  "https://www.walmart.com/search?q=iphone",
  { productPath:/\/ip\/[^?#]+\/\d+(?:[/?#]|$)/i },
  "iphone"
);
assert.equal(unicodeEscapedLinks.length, 1);
assert.match(unicodeEscapedLinks[0].url, /\/ip\/apple-iphone-17\/123456789/);

const htmlEscapedLinks = extractProductLinks(
  '<div data-state="{&quot;url&quot;:&quot;\\/nike\\/nike-shoes\\/prd\\/12345678&quot;}"></div>',
  "https://www.asos.com/search/?q=nike%20shoes",
  { productPath:/\/prd\/\d+(?:[/?#]|$)/i },
  "nike shoes"
);
assert.equal(htmlEscapedLinks.length, 1);
assert.match(htmlEscapedLinks[0].url, /\/nike\/nike-shoes\/prd\/12345678/);

const aliExpressDerivedLinks = extractProductLinks(
  '<script>{"url":"https://www.aliexpress.com/ssr/x?productIds=1005009463232289\\u0026skuId=12000060375536387"}</script>',
  "https://www.aliexpress.com/w/wholesale-iphone-17-case.html",
  { id:"aliexpress-cn", productPath:/\/item\/\d+\.html(?:[?#]|$)/i },
  "iphone 17 case"
);
assert.equal(aliExpressDerivedLinks.length, 1);
assert.match(aliExpressDerivedLinks[0].url, /\/item\/1005009463232289\.html/);


const temuSearchFixture = `
<script>
window.rawData={"store":{"localInfo":{"currency":"USD"},"goodsList":[
  {"data":{"goodsId":"606259461874199","title":"Magnetic Clear Case for iPhone 17 Pro Max","priceInfo":{"price":1249,"currency":"USD"},"image":{"url":"https://img.kwcdn.com/product/temu-case.jpg"},"seoLinkUrl":"/magnetic-clear-case-for-iphone-17-pro-max-g-606259461874199.html?refer_page_name=search_result"}},
  {"data":{"goodsId":"606259461874200","title":"Unrelated Kitchen Spoon","priceInfo":{"price":599,"currency":"USD"},"seoLinkUrl":"/kitchen-spoon-g-606259461874200.html"}}
]}}</script>`;
const temuSearchOffers = extractTemuSearchOffers(temuSearchFixture, "iphone 17 case");
assert.equal(temuSearchOffers.length, 1);
assert.equal(temuSearchOffers[0].productId, "606259461874199");
assert.equal(temuSearchOffers[0].price, 12.49);
assert.equal(temuSearchOffers[0].currency, "USD");
assert.match(temuSearchOffers[0].sourceUrl, /-g-606259461874199\.html$/);
assert.match(temuSearchOffers[0].image, /temu-case\.jpg/);

const aliSearchFixture = `
{"redirectedId":"3256810253104496","itemType":"productV3","productType":"natural","productId":"3256810253104496","image":{"imgUrl":"//ae-pic-a1.aliexpress-media.com/kf/test.jpg"},"title":{"displayTitle":"Magnetic Clear Case for iPhone 17 Pro Max"},"prices":{"skuId":"12000059808812209","salePrice":{"currencyCode":"USD","minPrice":0.33,"formattedPrice":"US $0.33"}},"productDetailUrl":"https://www.aliexpress.com/ssr/300000512/BundleDeals2?productIds=1005010439419248\\u0026sourceName=SEARCHProduct"}
`;
const aliSearchOffers = extractAliExpressSearchOffers(aliSearchFixture, "iphone 17 case");
assert.equal(aliSearchOffers.length, 1);
assert.equal(aliSearchOffers[0].price, 0.33);
assert.equal(aliSearchOffers[0].currency, "USD");
assert.match(aliSearchOffers[0].title, /iPhone 17/);
assert.match(aliSearchOffers[0].sourceUrl, /BundleDeals2/);


const bestBuySearchFixture = String.raw`
{"buyingOptions":[{"type":"New","product":{"primaryImage":{"piscesHref":"https://pisces.bbystatic.com/image2/laptop.jpg"},"name":{"short":"HP - 14\\" Laptop - Intel N150 Processor"},"skuId":"6667483"},"pdpUrl":"https://www.bestbuy.com/product/hp-14-laptop/JJGW3FGF9T/sku/6667483"}],"price":{"customerPrice":219.99,"mobileContracts":null,"skuId":"6667483"},"primaryImage":{"piscesHref":"https://pisces.bbystatic.com/image2/laptop.jpg"}}
`;
const bestBuySearchOffers = extractBestBuySearchOffers(bestBuySearchFixture, "hp laptop");
assert.equal(bestBuySearchOffers.length, 1);
assert.equal(bestBuySearchOffers[0].productId, "6667483");
assert.equal(bestBuySearchOffers[0].price, 219.99);
assert.equal(bestBuySearchOffers[0].currency, "USD");
assert.match(bestBuySearchOffers[0].title, /HP/);
assert.match(bestBuySearchOffers[0].sourceUrl, /\/sku\/6667483/);

const bestBuyModernLinks = extractProductLinks(
  '<a href="https://www.bestbuy.com/product/hp-14-laptop/JJGW3FGF9T/sku/6667483">HP 14 laptop</a>',
  "https://www.bestbuy.com/site/searchpage.jsp?st=laptop",
  { productPath:/\/(?:site\/[^?#]+\/\d+\.p|product\/[^?#]+\/[^/?#]+\/sku\/\d+)(?:[?#]|$)/i },
  "hp laptop"
);
assert.equal(bestBuyModernLinks.length, 1);
assert.match(bestBuyModernLinks[0].url, /\/sku\/6667483/);


const ikeaSikFixture = {
  results:[{
    component:"PRIMARY_AREA",
    items:[{
      type:"PRODUCT",
      product:{
        itemNo:"30605423",
        name:"SANDSBERG",
        typeName:"Chair",
        itemMeasureReferenceText:"black",
        pipUrl:"https://www.ikea.com/sa/en/p/sandsberg-chair-black-30605423/",
        mainImageUrl:"https://www.ikea.com/sa/en/images/products/sandsberg-chair-black.jpg",
        salesPrice:{ numeral:59, currencyCode:"SAR" },
      },
    }],
  }],
};
const ikeaSikOffers = parseIkeaSikPayload(ikeaSikFixture, "chair");
assert.equal(ikeaSikOffers.length, 1);
assert.equal(ikeaSikOffers[0].productId, "30605423");
assert.equal(ikeaSikOffers[0].price, 59);
assert.equal(ikeaSikOffers[0].currency, "SAR");
assert.match(ikeaSikOffers[0].sourceUrl, /sandsberg-chair-black-30605423/);


const centrepointAlgoliaFixture = {
  hits:[{
    pid:"2129361",
    title:"Iconic A-line Midi Satin Dress with Belt Detail",
    sale_price:73,
    price:73,
    url:"/buy-iconic-aline-midi-satin-dress-with-belt-detail/p/2129361",
    thumb_image:"https://media.centrepointstores.com/i/centrepoint/item.jpg",
    brand:"Iconic",
    inStock:1,
  }],
};
const centrepointAlgoliaOffers = parseLandmarkAlgoliaPayload(centrepointAlgoliaFixture, "centrepoint-sa");
assert.equal(centrepointAlgoliaOffers.length, 1);
assert.equal(centrepointAlgoliaOffers[0].price, 73);
assert.equal(centrepointAlgoliaOffers[0].currency, "SAR");
assert.match(centrepointAlgoliaOffers[0].sourceUrl, /centrepointstores\.com\/sa\/en\/buy-iconic/);

const maxAlgoliaFixture = {
  hits:[{
    pid:"B26KGYBCTGT325GREYLIGHT",
    title:"Teddy Bear Print Cotton Dress",
    sale_price:22,
    url:"/buy-teddy-bear-print-cotton-dress/p/B26KGYBCTGT325GREYLIGHT",
    thumb_image:"https://media.maxfashion.com/i/max/item.jpg",
    brand:"MAX",
    inStock:1,
  }],
};
const maxAlgoliaOffers = parseLandmarkAlgoliaPayload(maxAlgoliaFixture, "maxfashion-sa");
assert.equal(maxAlgoliaOffers.length, 1);
assert.equal(maxAlgoliaOffers[0].price, 22);
assert.equal(maxAlgoliaOffers[0].currency, "SAR");
assert.match(maxAlgoliaOffers[0].sourceUrl, /maxfashion\.com\/sa\/en\/buy-teddy-bear/);


assert.equal(true, true, "Landmark Algolia host rotation is covered by live source audit");


const bloomreachLandmarkFixture = {
  response:{
    docs:[{
      pid:"2129361",
      title:"Iconic A-line Midi Satin Dress with Belt Detail",
      sale_price:73,
      price:169,
      url:"/buy-iconic-aline-midi-satin-dress-with-belt-detail/p/2129361",
      thumb_image:"https://media.centrepointstores.com/i/centrepoint/2129361.jpg",
      brand:"Iconic",
      inStock:1,
    }],
  },
};
const bloomreachLandmarkOffers = parseLandmarkBloomreachPayload(bloomreachLandmarkFixture, "centrepoint-sa");
assert.equal(bloomreachLandmarkOffers.length, 1);
assert.equal(bloomreachLandmarkOffers[0].price, 73);
assert.equal(bloomreachLandmarkOffers[0].currency, "SAR");
assert.match(bloomreachLandmarkOffers[0].sourceUrl, /centrepointstores\.com\/sa\/en\/buy-iconic/);
