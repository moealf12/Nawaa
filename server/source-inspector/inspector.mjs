import { probeHtml } from "./probes/html.mjs";
import { probeJsonLd } from "./probes/jsonld.mjs";
import { probeEmbeddedState } from "./probes/embedded-state.mjs";
import { probeJsonCandidates } from "./probes/json.mjs";
import { probeFeedHints } from "./probes/feed.mjs";
import { probeSitemap } from "./probes/sitemap.mjs";
import { detectCapabilities } from "./discovery/capabilities.mjs";
import { discoverPagination } from "./discovery/pagination.mjs";
import { detectPageModel } from "./discovery/page-model.mjs";
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
  const embeddedState = probeEmbeddedState(htmlProbe.html);
  const jsonXhr = probeJsonCandidates(htmlProbe.html, htmlProbe.finalUrl || source.url);
  const feed = probeFeedHints(htmlProbe.finalUrl || source.url, htmlProbe.html);
  const discoveredPagination = discoverPagination(htmlProbe.html, htmlProbe.finalUrl || source.url);
  const pageModel = detectPageModel(htmlProbe.html);
  const pagination = discoveredPagination.ok ? discoveredPagination : {...pageModel,count:pageModel.ok?1:0,candidates:[]};
  const sitemap = await probeSitemap(htmlProbe.finalUrl || source.url, options);

  const candidates = rankStrategies([
    {
      id: "json-xhr", available: jsonXhr.ok,
      metrics:{correctness:.9,completeness:.85,stability:.82,speed:.95,repeatability:.88,maintainability:.85,resourceCost:1}, evidence:jsonXhr,
    },
    {
      id: "embedded-state", available: embeddedState.ok,
      metrics:{correctness:.86,completeness:.8,stability:.78,speed:.98,repeatability:.9,maintainability:.8,resourceCost:1}, evidence:{count:embeddedState.count},
    },
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
      embeddedState: { ok:embeddedState.ok, count:embeddedState.count },
      jsonXhr,
      feed,
      sitemap,
      pagination,
    },
    strategies: candidates,
    selectedStrategy: best ? { id:best.id, score:best.score } : null,
    deepProbeRequired: !best || best.score < 85,
    certification,
  };
}
