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
