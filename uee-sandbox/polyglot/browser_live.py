import asyncio,json,time
from playwright.async_api import async_playwright
URLS=['https://quotes.toscrape.com/js/','https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html']
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True)
  try:
   for url in URLS:
    start=time.monotonic()
    page=await browser.new_page(service_workers='block')
    try:
     response=await page.goto(url,wait_until='domcontentloaded',timeout=20000)
     await page.wait_for_timeout(1500)
     rendered=await page.content()
     result={'url':url,'http':response.status if response else None,'bytes':len(rendered),'quotes':await page.locator('.quote').count(),'ms':round((time.monotonic()-start)*1000)}
     print('UEE_BROWSER_LIVE '+json.dumps(result),flush=True)
     if not response or response.status!=200:raise RuntimeError('BROWSER_HTTP_FAILURE')
     if '/js/' in url and result['quotes']<1:raise RuntimeError('DYNAMIC_RENDER_NOT_PROVEN')
    finally:await page.close()
  finally:await browser.close()
asyncio.run(main())
