const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function createSourceReliabilityEngine({
  now = Date.now,
  transportPriorSuccess = 8,
  transportPriorFailure = 2,
  yieldPriorSuccess = 3,
  yieldPriorFailure = 3,
  cooldownAfter = 3,
  cooldownBaseMs = 120000,
  maxCooldownMs = 1800000,
} = {}) {
  const stats = new Map();

  function get(id) {
    if (!stats.has(id)) {
      stats.set(id, {
        id,
        attempts: 0,
        transportSuccesses: 0,
        transportFailures: 0,
        productiveSearches: 0,
        emptySearches: 0,
        offers: 0,
        consecutiveFailures: 0,
        latencyEwmaMs: null,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        cooldownUntil: 0,
      });
    }
    return stats.get(id);
  }

  function view(id) {
    const state = get(id);
    const transport = (state.transportSuccesses + transportPriorSuccess) /
      (state.transportSuccesses + state.transportFailures + transportPriorSuccess + transportPriorFailure);
    const yieldRate = (state.productiveSearches + yieldPriorSuccess) /
      (state.productiveSearches + state.emptySearches + yieldPriorSuccess + yieldPriorFailure);
    const coolingDown = state.cooldownUntil > now();

    // Transport failures matter more than an empty but valid search.
    const reliability = clamp((transport * 0.78) + (yieldRate * 0.22), 0, 1);
    const confidence = clamp(state.attempts / 12, 0, 1);
    const reliabilityAdjustment = Math.round((reliability - 0.7) * 36 * confidence);
    const latencyPenalty = state.latencyEwmaMs === null ? 0 :
      state.latencyEwmaMs > 7000 ? -8 :
      state.latencyEwmaMs > 4500 ? -5 :
      state.latencyEwmaMs > 2500 ? -2 : 0;

    return {
      id,
      attempts: state.attempts,
      transportSuccessRate: Number(transport.toFixed(4)),
      productiveRate: Number(yieldRate.toFixed(4)),
      reliability: Number(reliability.toFixed(4)),
      confidence: Number(confidence.toFixed(4)),
      consecutiveFailures: state.consecutiveFailures,
      latencyEwmaMs: state.latencyEwmaMs === null ? null : Math.round(state.latencyEwmaMs),
      coolingDown,
      cooldownUntil: coolingDown ? new Date(state.cooldownUntil).toISOString() : null,
      adjustment: reliabilityAdjustment + latencyPenalty + (coolingDown ? -40 : 0),
      lastAttemptAt: state.lastAttemptAt,
      lastSuccessAt: state.lastSuccessAt,
      lastFailureAt: state.lastFailureAt,
      offers: state.offers,
    };
  }

  function record(id, {
    transportOk = true,
    offers = 0,
    latencyMs = null,
    relevant = true,
  } = {}) {
    if (!id) return null;
    const state = get(id);
    const at = now();
    state.attempts += 1;
    state.lastAttemptAt = new Date(at).toISOString();

    if (Number.isFinite(latencyMs) && latencyMs >= 0) {
      state.latencyEwmaMs = state.latencyEwmaMs === null
        ? latencyMs
        : (state.latencyEwmaMs * 0.72) + (latencyMs * 0.28);
    }

    if (transportOk) {
      state.transportSuccesses += 1;
      state.consecutiveFailures = 0;
      state.lastSuccessAt = state.lastAttemptAt;
      state.cooldownUntil = 0;
      if (relevant) {
        if (Number(offers) > 0) state.productiveSearches += 1;
        else state.emptySearches += 1;
      }
      state.offers += Math.max(0, Number(offers) || 0);
    } else {
      state.transportFailures += 1;
      state.consecutiveFailures += 1;
      state.lastFailureAt = state.lastAttemptAt;
      if (state.consecutiveFailures >= cooldownAfter) {
        const exponent = Math.max(0, state.consecutiveFailures - cooldownAfter);
        const cooldown = Math.min(maxCooldownMs, cooldownBaseMs * (2 ** exponent));
        state.cooldownUntil = Math.max(state.cooldownUntil, at + cooldown);
      }
    }
    return view(id);
  }

  function adjustment(id) {
    return view(id).adjustment;
  }

  // Routing score combines observed availability, yield and latency. It is
  // intentionally conservative until enough observations exist.
  function routingScore(id) {
    const current = view(id);
    const latency = current.latencyEwmaMs ?? 1800;
    const latencyFactor = 1 / (1 + Math.max(0, latency) / 1800);
    const evidence = 0.35 + (current.confidence * 0.65);
    const yieldFactor = 0.45 + (current.productiveRate * 0.55);
    return Number((current.reliability * yieldFactor * latencyFactor * evidence).toFixed(6));
  }

  function rank(ids = []) {
    return [...ids].sort((a,b) => routingScore(b) - routingScore(a) || a.localeCompare(b));
  }

  function shouldSkip(id, { explicit = false } = {}) {
    const current = view(id);
    // Explicit user intent always gets one chance, even during cooldown.
    return current.coolingDown && !explicit;
  }

  function snapshot(ids = null) {
    const keys = ids ? [...ids] : [...stats.keys()];
    return keys.map((id) => view(id)).sort((a,b) =>
      b.reliability - a.reliability || b.attempts - a.attempts || a.id.localeCompare(b.id)
    );
  }

  function reset(id = null) {
    if (id) stats.delete(id);
    else stats.clear();
  }

  return { record, view, adjustment, routingScore, rank, shouldSkip, snapshot, reset };
}

export const sourceReliability = createSourceReliabilityEngine();
