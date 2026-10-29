"""Bounded, unmodified Chromium diagnostic for Amazon.de (no stealth or retries)."""
import json
import sys
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright, Error as PlaywrightError
from amazon_de_search_probe import parse_search_html

def main():
    query = "iPhone 17"
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            page = browser.new_page(locale="de-DE")
            response = page.goto("https://www.amazon.de/s?" + urlencode({"k": query}),
                                 wait_until="domcontentloaded", timeout=15000)
            content = page.content()
            parsed = parse_search_html(content)
            print(json.dumps({
                "http_status": response.status if response else None,
                "classification": parsed["status"],
                "cards": len(parsed["offers"]),
                "priced_cards": sum(x["price_eur"] is not None for x in parsed["offers"]),
                "publishable": False
            }))
        finally:
            browser.close()

if __name__ == "__main__":
    try:
        main()
    except (PlaywrightError, TimeoutError) as error:
        print(json.dumps({"classification": "BROWSER_ACCESS_FAILED", "error_type": type(error).__name__, "cards": 0, "publishable": False}))
        sys.exit(0) # source access may fail; do not confuse with parser tests
