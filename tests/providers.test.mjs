import assert from "node:assert/strict";
import { assessOfferMatch, dedupeNormalizedOffers } from "../server/match.mjs";
import { normalizeCondition, parseMoney } from "../server/provider-utils.mjs";
import { parseJarirConstructorPayload, parseJarirSearchHtml } from "../server/providers/jarir.mjs";
import { parseNoonCatalogPayload } from "../server/providers/noon.mjs";
import { parseCarrefourSearchPayload } from "../server/providers/carrefour.mjs";
import { parseSharafAlgoliaPayload } from "../server/providers/sharafdg.mjs";
import { parseSwarovskiSearchHtml, swarovskiSaudiEligible, swarovskiSaudiProviderQuery } from "../server/providers/swarovski.mjs";

assert.equal(normalizeCondition("Brand New"), "new");
assert.equal(normalizeCondition("Open Box"), "open_box");
assert.equal(parseMoney("$1,299.99"), 1299.99);

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

console.log("NAWAA provider tests passed");
