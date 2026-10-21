import assert from "node:assert/strict";
import test from "node:test";
import { extractDomainProduct, findDomainAdapter } from "../server/domain-adapters.mjs";
import { extractionCandidates } from "../server/url-resolver.mjs";

test("domain adapter registry matches SHEIN, Temu, Centrepoint, and Max Fashion", () => {
  assert.equal(findDomainAdapter("https://www.shein.com/product-p-1.html")?.id, "shein");
  assert.equal(findDomainAdapter("https://www.temu.com/test-product-g-601099999999999.html")?.id, "temu");
  assert.equal(findDomainAdapter("https://www.centrepointstores.com.sa/p/123")?.id, "centrepoint");
  assert.equal(findDomainAdapter("https://www.maxfashion.com.sa/p/456")?.id, "maxfashion");
  assert.equal(findDomainAdapter("https://example.com/p"), null);
});

test("SHEIN adapter extracts product data from embedded JSON", () => {
  const html = `<html><body><script type="application/json">{
    "goods": {
      "goods_name": "Test Dress",
      "salePrice": {"amount": 129, "currency": "SAR"},
      "goods_img": "https://img.example.com/dress.jpg",
      "brandName": "SHEIN",
      "goods_id": "98765",
      "stockStatus": "in_stock"
    }
  }</script></body></html>`;

  const result = extractDomainProduct("https://www.shein.com/product-p-98765.html", html);
  assert.equal(result?.adapterId, "shein");
  assert.equal(result?.product?.name, "Test Dress");
  assert.equal(result?.product?.offers?.price, 129);
  assert.equal(result?.product?.offers?.priceCurrency, "SAR");
  assert.equal(result?.product?.sku, "98765");
});

test("resolver exposes domain adapter as a candidate", () => {
  const html = `<script type="application/json">{
    "product": {
      "productName": "Centrepoint Test Product",
      "price": {"value": 89, "currencyCode": "SAR"},
      "imageUrl": "https://img.example.com/cp.jpg",
      "brandName": "Test Brand",
      "productId": "CP-1",
      "availability": "available"
    }
  }</script>`;

  const candidates = extractionCandidates(html, "https://www.centrepointstores.com.sa/p/cp-1");
  const adapted = candidates.find((entry) => entry.strategy === "domain_adapter");
  assert.equal(adapted?.adapterId, "centrepoint");
  assert.equal(adapted?.product?.offers?.price, 89);
});


test("SHEIN adapter reads assigned gbRawData payloads and normalizes SR to SAR", () => {
  const html = `<script>
    window.gbRawData = {
      "goods": {
        "goods_name": "Live-style SHEIN Product",
        "salePrice": {"amount": "49.00", "currency": "SR"},
        "goods_img": "https://img.example.com/item.jpg",
        "goods_sn": "sr260306010176658381094",
        "stockStatus": "available"
      }
    };
  </script>`;

  const result = extractDomainProduct("https://m.shein.com/ar-en/item-p-416403066.html", html);
  assert.equal(result?.adapterId, "shein");
  assert.equal(result?.product?.offers?.price, 49);
  assert.equal(result?.product?.offers?.priceCurrency, "SAR");
  assert.equal(result?.product?.sku, "sr260306010176658381094");
  assert.equal(result?.product?.offers?.availability, "instock");
});


test("Temu adapter reads window.rawData and prioritizes URL product id", () => {
  const html = `<script>
    window.rawData = {
      "recommendations": [{
        "goodsName": "Wrong Recommendation",
        "salePrice": {"amount": "8.99", "currency": "USD"},
        "goodsId": "111"
      }],
      "goods": {
        "goodsName": "Magnetic iPhone 17 Case",
        "salePrice": {"amount": "12.49", "currency": "USD"},
        "goodsImage": "https://img.example.com/temu.jpg",
        "goodsId": "606259461874199",
        "stockStatus": "in_stock"
      }
    };
  </script>`;

  const result = extractDomainProduct("https://www.temu.com/magnetic-case-g-606259461874199.html", html);
  assert.equal(result?.adapterId, "temu");
  assert.equal(result?.product?.name, "Magnetic iPhone 17 Case");
  assert.equal(result?.product?.offers?.price, 12.49);
  assert.equal(result?.product?.offers?.priceCurrency, "USD");
  assert.equal(result?.product?.sku, "606259461874199");
});

test("Landmark adapters support priceData objects and unavailable stock correctly", () => {
  const html = `<script type="application/json">{
    "product": {
      "productName": "Landmark Product",
      "priceData": {"formattedValue": "SAR 79.00", "currencyIso": "SAR"},
      "productImage": {"url": "https://img.example.com/lm.jpg"},
      "brandName": "Test Brand",
      "code": "LM-1",
      "stockStatus": "unavailable"
    }
  }</script>`;

  const result = extractDomainProduct("https://www.maxfashion.com.sa/p/lm-1", html);
  assert.equal(result?.adapterId, "maxfashion");
  assert.equal(result?.product?.offers?.price, 79);
  assert.equal(result?.product?.offers?.priceCurrency, "SAR");
  assert.equal(result?.product?.offers?.availability, "outofstock");
});


test("SHEIN adapter prioritizes the page product over recommendation payloads", () => {
  const html = `<script type="application/json">{
    "recommendations": [
      {
        "goods_name": "Recommended Item",
        "salePrice": {"amount": 20, "currency": "SAR"},
        "goods_img": "https://img.example.com/reco.jpg",
        "goods_sn": "RECO-SKU",
        "goods_id": "111"
      }
    ],
    "goods": {
      "goods_name": "Actual Page Product",
      "salePrice": {"amount": 49, "currency": "SAR"},
      "goods_img": "https://img.example.com/page.jpg",
      "goods_sn": "PAGE-SKU",
      "goods_id": "416403066"
    }
  }</script>`;

  const result = extractDomainProduct("https://m.shein.com/ar-en/item-p-416403066.html", html);
  assert.equal(result?.product?.name, "Actual Page Product");
  assert.equal(result?.product?.sku, "PAGE-SKU");
  assert.equal(result?.product?.offers?.price, 49);
});


test("Newegg adapter extracts assigned product payload", () => {
  const html = `<script>window.__INITIAL_STATE__={"product":{"Description":"Gaming Laptop","FinalPrice":"1299.99","CurrencyCode":"USD","ItemNumber":"9SIA123","ImageUrl":"https://c1.neweggimages.com/a.jpg","inStock":true}}</script>`;
  const result = extractDomainProduct("https://www.newegg.com/p/9SIA123", html);
  assert.equal(result?.adapterId, "newegg");
  assert.equal(result?.product?.name, "Gaming Laptop");
  assert.equal(result?.product?.offers?.price, 1299.99);
  assert.equal(result?.product?.offers?.priceCurrency, "USD");
});


test("Newegg adapter extracts visible product title and price HTML", () => {
  const html = `
    <meta property="og:image" content="https://c1.neweggimages.com/a.jpg">
    <h1 class="product-title">Acer Aspire Go 15</h1>
    <li class="price-current"><strong>849</strong><sup>.99</sup></li>
  `;
  const result = extractDomainProduct("https://www.newegg.com/p/N82E16834360412", html);
  assert.equal(result?.adapterId, "newegg");
  assert.equal(result?.product?.name, "Acer Aspire Go 15");
  assert.equal(result?.product?.offers?.price, 849.99);
  assert.equal(result?.product?.offers?.priceCurrency, "USD");
});


test("ASOS adapter extracts stockPriceResponse payload", () => {
  const html = `
    <meta property="og:title" content="Nike P-6000 trainers">
    <meta property="og:image" content="https://images.asos-media.com/a.jpg">
    <script>
      window.asos = window.asos || {};
      window.asos.pdp = window.asos.pdp || {};
      window.asos.pdp.config = window.asos.pdp.config || {};
      window.asos.pdp.config.stockPriceResponse = '[{\"productId\":206633512,\"productPrice\":{\"current\":{\"value\":80,\"text\":\"£80.00\"},\"currency\":\"GBP\"}}]';
    </script>
  `;
  const result = extractDomainProduct("https://www.asos.com/nike/item/prd/206633512", html);
  assert.equal(result?.adapterId, "asos");
  assert.equal(result?.product?.name, "Nike P-6000 trainers");
  assert.equal(result?.product?.offers?.price, 80);
  assert.equal(result?.product?.offers?.priceCurrency, "GBP");
});


test("v21.23 RED: Virgin PDP price must be anchored to the sold product, not header promotion", () => {
  const url="https://app.virginmegastore.ae/en/gaming/playstation-hardware-accessories/playstation-accessories/sony-playstation-disc-drive-for-ps5-add-on-/p/1033214";
  // SYNTHETIC STRUCTURAL REPRODUCTION of real merchant price mismatch,
  // source PDP actually advertises AED 339 while candidate recorded AED 2.
  // Does not claim to be the exact raw merchant HTML captured by the runner.
  const html=\`<html><head><meta property="og:title" content="Sony PlayStation Disc Drive for PS5 (Add-On)"></head>
    <body><header><a href="/offers">AED 2 members' rewards</a></header>
    <main><h1>Sony PlayStation Disc Drive for PS5 (Add-On)</h1>
      <div class="product-price"><span>AED 339</span></div><button>Add to cart</button>
    </main><section class="similar-products">Other Item AED 45</section></body></html>\`;
  const actual=extractDomainProduct(url,html);
  assert.equal(actual?.adapterId,"virginmegastore");
  assert.equal(actual?.product?.offers?.price,339,
    "header and cross-sells must not supply the product price");
  assert.equal(actual?.product?.offers?.priceCurrency,"AED");
  assert.equal(actual?.product?.sku,"1033214");
  const candidate=extractionCandidates(html,url).find(x=>x.strategy==="domain_adapter");
  assert.equal(candidate?.product?.offers?.price,339);
});

test("v21.23 Virgin verified sale and missing PDP price avoid unsafe header selection",()=>{
  const url="https://app.virginmegastore.ae/en/item/p/1105698";
  const sale='<header>Accessory AED 2</header><h1>Complete PS5 Slim Console</h1>'+
    '<div class="product-current-price">AED 2,299</div><del>AED 2,499</del>'+
    '<footer>Similar products AED 12</footer>';
  assert.equal(extractDomainProduct(url,sale)?.product?.offers?.price,2299);
  const uncertain='<header>Rewards AED 2</header><h1>Complete PS5 Slim Console</h1>'+
    '<div>No verified purchase price on this page</div>';
  assert.equal(extractDomainProduct(url,uncertain),null,
    "unknown PDP price must remain unknown rather than borrowing nav price");
});
