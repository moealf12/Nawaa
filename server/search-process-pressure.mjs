// Lightweight, process-wide pressure evidence for slow search diagnostics.
// No external dependency. Values include ALL concurrent work in this process,
// so they must not be treated as CPU attributed exclusively to one request.
import { performance } from "node:perf_hooks";

const nonNegative = value => Number.isFinite(value) ? Math.max(0,value) : 0;

export function normalizeProcessPressure(cpuDelta, eventLoopDelta) {
  const cpuMicroseconds =
    nonNegative(Number(cpuDelta?.user)) + nonNegative(Number(cpuDelta?.system));
  const utilization=Number(eventLoopDelta?.utilization);
  return {
    processCpuMs:Math.round(cpuMicroseconds/1000),
    eventLoopUtilizationPct:Number.isFinite(utilization)
      ?Math.round(Math.min(1,Math.max(0,utilization))*100)
      :null,
  };
}

export function beginProcessPressure() {
  return {cpu:process.cpuUsage(),eventLoop:performance.eventLoopUtilization()};
}

export function endProcessPressure(snapshot) {
  return normalizeProcessPressure(
    process.cpuUsage(snapshot.cpu),
    performance.eventLoopUtilization(snapshot.eventLoop)
  );
}

/**
 * Compare two explicit process snapshots without including later activity.
 * CPU and event-loop utilization are process-wide across concurrent requests.
 * The result is descriptive, not CPU attribution to a particular request.
 */
export function processPressureBetween(start, end) {
  const cpuDelta={
    user:Math.max(0, end.cpu.user-start.cpu.user),
    system:Math.max(0, end.cpu.system-start.cpu.system),
  };
  const loopDelta=performance.eventLoopUtilization(end.eventLoop,start.eventLoop);
  return normalizeProcessPressure(cpuDelta,loopDelta);
}
