import { probeHtml } from "./probes/html.mjs";
import { probeJsonLd } from "./probes/jsonld.mjs";
import { detectCapabilities } from "./discovery/capabilities.mjs";
import { rankStrategies } from "./scoring/extraction-score.mjs";
import { evaluateCertification } from "./certification/rules.mjs";

function urlInfo(input) {
  const url = new URL(input);
  if (!["http:","https:"].includes(url.protocol)) throw new Error("Only HTTP(S) store URLs are supported");
  return { url:url.toString(), origin:url.origin, host:url.hostname };
}

export async function inspectSource(storeUrl, options = {}) {
  const source = urlInfo(storeUrl);
  const htmlProbe = await probeHtml(source.url, options);
  const capabilities = detectCapabilities({
    html: htmlProbe.html,
    url: htmlProbe.finalUrl,
    headers: htmlProbe.headers,
  });
  const jsonLd = probeJsonLd(htmlProbe.html);

  const candidates = rankStrategies([
    {
      id: "jsonld",
      available: jsonLd.ok,
      metrics: {
        correctness: jsonLd.pricedProducts ? 0.95 : 0.35,
        completeness: jsonLd.coverage,
        stability: 0.9,
        speed: 0.95,
        repeatability: 0.85,
        maintainability: 0.95,
        resourceCost: 1,
      },
      evidence: jsonLd,
    },
    {
      id: "html",
      available: htmlProbe.ok,
      metrics: {
        correctness: capabilities.productHint ? 0.7 : 0.45,
        completeness: capabilities.productHint ? 0.7 : 0.35,
        stability: 0.7,
        speed: htmlProbe.latencyMs < 1500 ? 0.95 : htmlProbe.latencyMs < 4000 ? 0.75 : 0.5,
        repeatability: 0.75,
        maintainability: 0.65,
        resourceCost: 0.9,
      },
      evidence: {
        status: htmlProbe.status,
        bytes: htmlProbe.bytes,
        latencyMs: htmlProbe.latencyMs,
        finalUrl: htmlProbe.finalUrl,
      },
    },
  ].filter((candidate) => candidate.available));

  const best = candidates[0] || null;
  const certification = evaluateCertification({
    reachable: htmlProbe.ok,
    strategyScore: best?.score || 0,
  });

  return {
    source,
    observedAt: new Date().toISOString(),
    phase: "FAST_PROBE",
    capabilities,
    probes: {
      html: {
        ok: htmlProbe.ok,
        status: htmlProbe.status,
        latencyMs: htmlProbe.latencyMs,
        bytes: htmlProbe.bytes,
        finalUrl: htmlProbe.finalUrl,
        error: htmlProbe.error,
      },
      jsonLd,
    },
    strategies: candidates,
    selectedStrategy: best ? { id:best.id, score:best.score } : null,
    deepProbeRequired: !best || best.score < 85,
    certification,
  };
}
