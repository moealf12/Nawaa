import test from "node:test";
import assert from "node:assert/strict";
import { createSourceReliabilityEngine } from "../server/source-reliability.mjs";

test("source reliability starts conservative and gains confidence from observations", () => {
  let clock = 1_000_000;
  const engine = createSourceReliabilityEngine({ now:() => clock });
  const initial = engine.view("store-a");
  assert.equal(initial.attempts, 0);
  assert.equal(initial.adjustment, 0);
  assert.equal(initial.coolingDown, false);

  for (let i = 0; i < 8; i++) {
    clock += 1000;
    engine.record("store-a", { transportOk:true, offers:3, latencyMs:800, relevant:true });
  }
  const healthy = engine.view("store-a");
  assert.equal(healthy.attempts, 8);
  assert.ok(healthy.reliability > initial.reliability);
  assert.ok(healthy.adjustment > 0);
  assert.equal(healthy.offers, 24);
});

test("three consecutive transport failures trigger a bounded cooldown", () => {
  let clock = 5_000_000;
  const engine = createSourceReliabilityEngine({
    now:() => clock,
    cooldownAfter:3,
    cooldownBaseMs:120000,
    maxCooldownMs:600000,
  });

  for (let i = 0; i < 3; i++) {
    engine.record("store-b", { transportOk:false, latencyMs:5000 });
    clock += 1000;
  }
  const degraded = engine.view("store-b");
  assert.equal(degraded.consecutiveFailures, 3);
  assert.equal(degraded.coolingDown, true);
  assert.equal(engine.shouldSkip("store-b"), true);
  assert.equal(engine.shouldSkip("store-b", { explicit:true }), false);
  assert.ok(degraded.adjustment < 0);

  engine.record("store-b", { transportOk:true, offers:1, latencyMs:900 });
  assert.equal(engine.view("store-b").coolingDown, false);
  assert.equal(engine.view("store-b").consecutiveFailures, 0);
});

test("valid empty searches affect yield but are not transport failures", () => {
  const engine = createSourceReliabilityEngine();
  engine.record("store-c", { transportOk:true, offers:0, latencyMs:700, relevant:true });
  engine.record("store-c", { transportOk:true, offers:0, latencyMs:800, relevant:true });
  const state = engine.view("store-c");
  assert.equal(state.consecutiveFailures, 0);
  assert.equal(state.coolingDown, false);
  assert.ok(state.transportSuccessRate > 0.8);
  assert.ok(state.productiveRate < 0.5);
});

test("latency contributes a bounded ranking penalty without marking a source down", () => {
  const fast = createSourceReliabilityEngine();
  const slow = createSourceReliabilityEngine();
  for (let i = 0; i < 8; i++) {
    fast.record("source", { transportOk:true, offers:1, latencyMs:700 });
    slow.record("source", { transportOk:true, offers:1, latencyMs:8000 });
  }
  assert.equal(fast.view("source").consecutiveFailures, 0);
  assert.equal(slow.view("source").consecutiveFailures, 0);
  assert.ok(fast.adjustment("source") > slow.adjustment("source"));
});
