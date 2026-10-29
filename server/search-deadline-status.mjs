// Report observed request-budget overruns even when timer callbacks were
// delayed by a saturated Node event loop. This is an integrity/status guard,
// not a substitute for cancellation or a hard wall-clock execution guarantee.
export function observedDeadlineExceeded(previouslyExceeded, deadlineAt, now=Date.now()){
  return Boolean(previouslyExceeded) ||
    (Number.isFinite(deadlineAt) && Number.isFinite(now) && now >= deadlineAt);
}
