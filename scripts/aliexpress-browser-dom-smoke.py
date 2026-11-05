#!/usr/bin/env python3
"""Prove Chromium executes JS before the AliExpress DOM evidence parser runs.

Local deterministic fixture; merchant acquisition is separately LIVE and has
no mock data. No network, login, CAPTCHA handling or customer publication.
"""
import asyncio
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import sys

spec = spec_from_file_location(
    "aliexpress_browser_smoke",
    Path(__file__).resolve().with_name("aliexpress-browser-dom-live.py")
)
probe = module_from_spec(spec)
sys.modules[spec.name] = probe
spec.loader.exec_module(probe)


async def main():
    from playwright.async_api import async_playwright
    item_id = "1005012743543835"
    url = "https://ar.aliexpress.com/item/" + item_id + ".html"
    source = """
    <html>
      <head>
        <link rel="canonical" href="https://ar.aliexpress.com/item/1005012743543835.html">
      </head>
      <body><main><h1>Test Product</h1></main>
      <script>
        const price=document.createElement('meta');
        price.setAttribute('property','product:price:amount');
        price.setAttribute('content','29.75');
        document.head.appendChild(price);
        const curr=document.createElement('meta');
        curr.setAttribute('property','product:price:currency');
        curr.setAttribute('content','SAR');
        document.head.appendChild(curr);
      </script>
      </body>
    </html>
    """
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        try:
            page = await browser.new_page(java_script_enabled=True)
            await page.set_content(source, wait_until="load")
            rendered = await page.content()
            result = probe.classify_rendered_dom(rendered, url, item_id)
            assert result["state"] == "BROWSER_PDP_PRICE_CANDIDATE_NOT_BUYBOX_VERIFIED"
            assert result["dom"]["priceCandidate"]["priceOriginal"] == "29.75"
            assert result["dom"]["priceCandidate"]["currency"] == "SAR"
            assert result["customerPublishable"] is False
            assert result["pdpPriceVerified"] is False
            print("NAWAA_ALIEXPRESS_CHROMIUM_JAVASCRIPT_SMOKE PASS")
            await page.close()
        finally:
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
