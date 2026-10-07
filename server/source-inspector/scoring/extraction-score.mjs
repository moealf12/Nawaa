const WEIGHTS = {
  correctness: 0.25,
  completeness: 0.18,
  stability: 0.15,
  speed: 0.12,
  repeatability: 0.1,
  maintainability: 0.1,
  resourceCost: 0.1,
};

function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

export function scoreExtractionStrategy(metrics = {}) {
  const normalized = {
    correctness: clamp01(metrics.correctness),
    completeness: clamp01(metrics.completeness),
    stability: clamp01(metrics.stability),
    speed: clamp01(metrics.speed),
    repeatability: clamp01(metrics.repeatability),
    maintainability: clamp01(metrics.maintainability),
    resourceCost: clamp01(metrics.resourceCost),
  };
  const raw = Object.entries(WEIGHTS).reduce((sum, [key, weight]) => sum + normalized[key] * weight, 0);
  return {
    score: Math.round(raw * 10000) / 100,
    normalized,
  };
}

export function rankStrategies(strategies = []) {
  return [...strategies]
    .map((strategy) => ({ ...strategy, ...scoreExtractionStrategy(strategy.metrics || {}) }))
    .sort((a,b) => b.score - a.score);
}
