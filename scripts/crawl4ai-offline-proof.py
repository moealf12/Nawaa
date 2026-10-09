"""Isolated and free Crawl4AI proof: local HTML fixture, never a live merchant."""
import asyncio
import json
import resource
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread

HTML = b"""<!DOCTYPE html><html><head><title>NAWAA offline fixture</title></head>
<body><h1>Offline source discovery verification</h1>
<article class="offer"><h2 class="title">Chair Alpha fixture</h2><span class="price">399 SAR</span></article>
<article class="offer"><h2 class="title">Chair Beta fixture</h2><span class="price">549 SAR</span></article>
</body></html>"""

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(HTML)
    def log_message(self, *args):
        pass

async def main(url):
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode, JsonCssExtractionStrategy
    schema = {
        "name":"nawaa-offline-fixture","baseSelector":"article.offer",
        "fields":[
            {"name":"title","selector":"h2.title","type":"text"},
            {"name":"price","selector":".price","type":"text"}
        ]
    }
    config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS, word_count_threshold=0,
        extraction_strategy=JsonCssExtractionStrategy(schema),
    )
    async with AsyncWebCrawler(config=BrowserConfig(headless=True)) as crawler:
        result = await crawler.arun(url=url,config=config)
        assert result.success, str(result.error_message)
        offers=json.loads(result.extracted_content or "[]")
        assert len(offers)==2,offers
        assert offers[0]["title"]=="Chair Alpha fixture",offers
        assert offers[0]["price"]=="399 SAR",offers
        markdown=str(result.markdown)
        assert "Chair Alpha" in markdown,markdown[:300]
        memory_kb=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        print(json.dumps({"ok":True,"engine":"Crawl4AI","count":len(offers),
                          "memory_kb_maxrss":memory_kb,"remote_merchants":0,
                          "used_paid_api":False}))

if __name__=="__main__":
    server=HTTPServer(("127.0.0.1",0),Handler)
    t=Thread(target=server.serve_forever,daemon=True)
    t.start()
    try:
        asyncio.run(main(f"http://127.0.0.1:{server.server_port}/"))
    finally:
        server.shutdown()
