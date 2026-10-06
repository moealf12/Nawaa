export async function probeHtml(url, { fetchImpl = fetch, timeoutMs = 6000 } = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9,ar-SA;q=0.8",
        "user-agent": "Mozilla/5.0 (compatible; NAWAA-SourceInspector/1.0)",
      },
    });
    const contentType = response.headers?.get?.("content-type") || "";
    const html = response.ok ? await response.text() : "";
    return {
      strategy: "html",
      ok: response.ok,
      status: response.status,
      finalUrl: response.url || url,
      contentType,
      latencyMs: Date.now() - started,
      bytes: Buffer.byteLength(html || "", "utf8"),
      html,
      headers: Object.fromEntries(response.headers?.entries?.() || []),
      error: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      strategy: "html",
      ok: false,
      status: null,
      finalUrl: url,
      contentType: "",
      latencyMs: Date.now() - started,
      bytes: 0,
      html: "",
      headers: {},
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}
