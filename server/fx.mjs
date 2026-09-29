const cache = new Map();
const TTL_MS = 60 * 60 * 1000;

export async function rateToSAR(currency) {
  const code = String(currency || "").toUpperCase();
  if (!code) return null;
  if (code === "SAR") return { rate: 1, observedAt: new Date().toISOString(), source: "identity" };

  const cached = cache.get(code);
  if (cached && Date.now() - cached.cachedAt < TTL_MS) return cached.value;

  const response = await fetch(`https://api.frankfurter.dev/v2/rate/${encodeURIComponent(code)}/sar`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`FX ${code}->SAR failed: ${response.status}`);
  const data = await response.json();
  const rate = Number(data.rate);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`Invalid FX rate for ${code}`);

  const value = {
    rate,
    observedAt: data.date ? `${data.date}T00:00:00Z` : new Date().toISOString(),
    source: "Frankfurter",
  };
  cache.set(code, { cachedAt: Date.now(), value });
  return value;
}

export async function moneyToSAR(amount, currency) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return null;
  const fx = await rateToSAR(currency);
  return {
    value: Math.round(numeric * fx.rate * 100) / 100,
    rate: fx.rate,
    source: fx.source,
    observedAt: fx.observedAt,
  };
}
