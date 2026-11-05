import asyncio,json,time
from playwright.async_api import async_playwright
URLS=['https://www.newegg.com/p/pl?d=ssd','https://www.newegg.com/logitech-920-010548/p/N82E16823126688']
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True)
  context=await browser.new_context(locale='en-US')
  try:
   for url in URLS:
    page=await context.new_page()
    t=time.monotonic()
    try:
     response=await page.goto(url,wait_until='domcontentloaded',timeout=20000)
     await page.wait_for_timeout(1800)
     title=await page.title()
     body=await page.content()
     cards=await page.locator('.item-cell').count()
     product=await page.locator('[itemtype*="Product"],script[type="application/ld+json"]').count()
     blocked=bool(response and response.status in (403,429)) or 'just a moment' in title.lower() or 'captcha' in title.lower()
     print('UEE_NEWEGG_BROWSER '+json.dumps(dict(url=url,http=response.status if response else None,title=title,htmlBytes=len(body.encode()),productEvidenceNodes=product,listingCards=cards,blocked=blocked,elapsedMs=round((time.monotonic()-t)*1000))),flush=True)
    except Exception as exc:print('UEE_NEWEGG_BROWSER '+json.dumps(dict(url=url,error=str(exc),elapsedMs=round((time.monotonic()-t)*1000))),flush=True)
    finally:await page.close()
  finally:await browser.close()
asyncio.run(main())
