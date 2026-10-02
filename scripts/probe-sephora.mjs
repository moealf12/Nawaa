const query = process.argv.slice(2).join(" ") || "dior perfume";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const encoded = encodeURIComponent(query);
const urls = [
  "https://www.sephora.me/sa-en/search?q=" + encoded,
  "https://www.sephora.me/sa-en/search/" + encoded,
  "https://www.sephora.sa/sa-en/search?q=" + encoded,
  "https://www.sephora.sa/sa-en/search/" + encoded,
];
for (const userAgent of [UA, GOOGLEBOT]) {
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers:{
          accept:"text/html,application/xhtml+xml",
          "accept-language":"en-SA,en;q=0.9,ar-SA;q=0.8",
          "cache-control":"no-cache",
          pragma:"no-cache",
          "sec-fetch-dest":"document",
          "sec-fetch-mode":"navigate",
          "upgrade-insecure-requests":"1",
          "user-agent":userAgent,
        },
        redirect:"follow",
        signal:AbortSignal.timeout(15000),
      });
      const html = await response.text();
      const marker = html.match(/data-cnstrc-item-id=["']([^"']+)/i)?.[1] || html.match(/\\?"productId\\?"\s*:\s*\\?"([^"\\]+)/i)?.[1] || null;
      const price = html.match(/\\?"c_price\\?"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i)?.[1] || null;
      console.log(JSON.stringify({
        userAgent:userAgent === GOOGLEBOT ? "googlebot" : "chrome",
        requested:url,status:response.status,finalUrl:response.url,
        bytes:Buffer.byteLength(html),contentType:response.headers.get("content-type"),
        productMarker:marker,priceMarker:price,
        akamai:/akam\/|reference #|access denied|bot manager/i.test(html),
      }, null, 2));
    } catch (error) {
      console.log(JSON.stringify({requested:url,error:error instanceof Error?error.message:String(error)},null,2));
    }
  }
}
