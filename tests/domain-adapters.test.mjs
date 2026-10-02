import assert from "node:assert/strict";
import test from "node:test";
import { extractDomainProduct, findDomainAdapter } from "../server/domain-adapters.mjs";
import { extractionCandidates } from "../server/url-resolver.mjs";

test("domain adapter registry matches SHEIN, Centrepoint, and Max Fashion", () => {
  assert.equal(findDomainAdapter("https://www.shein.com/product-p-1.html")?.id, "shein");
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
