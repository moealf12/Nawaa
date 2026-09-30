// Same-origin API on Render; other entrypoints share the same live backend.
const nawaaApiOrigin = "https://nawaa-search-api.onrender.com";
window.NAWAA_API_BASE = ["localhost", "127.0.0.1", "nawaa-search-api.onrender.com"].includes(location.hostname)
  ? location.origin : nawaaApiOrigin;
// Search from older published entrypoints opens the canonical same-origin UI.
window.NAWAA_SEARCH_URL = location.hostname === "moealf12.github.io" || location.hostname.endsWith(".chatgpt.site")
  ? nawaaApiOrigin + "/search.html" : "./search.html";
window.NAWAA_QUOTE_URL = "https://nawaa-store-jeddah.moezz12.chatgpt.site/";
