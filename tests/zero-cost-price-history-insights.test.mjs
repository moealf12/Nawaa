import test from "node:test";
import assert from "node:assert/strict";
import {summarizePriceHistory} from "../server/tooling/price-history-insights.mjs";
const point=(price,day,currency="SAR")=>({price,currency,observedAt:"2026-10-"+day+"T12:00:00.000Z"});
test("read-only history sees latest drop across unchanged repeat observations",()=>{
 const rows=[point(429,"10"),point(429,"09"),point(479,"08"),point(499,"07")];
 const result=summarizePriceHistory(rows);
 assert.equal(result.status,"ok");
 assert.equal(result.sampleSize,4);
 assert.equal(result.latestObservedPrice,429);
 assert.equal(result.lastDifferentPrice,479);
 assert.equal(result.absoluteChange,-50);
 assert.equal(result.percentageChange,-10.44);
 assert.equal(result.direction,"decrease");
 assert.equal(result.sampleMinPrice,429);
 assert.equal(result.sampleMaxPrice,499);
 assert.equal(result.sampleNewLow,true);
 assert.equal(result.significantMove,true);
});
test("newest reading follows observation time not delivery order",()=>{
 const summary=summarizePriceHistory([point(499,"07"),point(429,"10"),point(479,"09")]);
 assert.equal(summary.latestObservedPrice,429);
 assert.equal(summary.lastDifferentPrice,479);
 assert.equal(summary.sampleNewLow,true);
});
test("one observation and repeated unchanged prices cannot invent a discount",()=>{
 const only=summarizePriceHistory([point(299,"10")]);
 assert.equal(only.hasChange,false);
 assert.equal(only.percentageChange,null);
 assert.equal(only.direction,"not_enough_change_evidence");
 const repeat=summarizePriceHistory([point(299,"10"),point(299,"09")]);
 assert.equal(repeat.hasChange,false);
 assert.equal(repeat.sampleNewLow,false);
});
test("increases and small moves are reported without false large-move alerts",()=>{
 const result=summarizePriceHistory([point(149,"10"),point(145,"09")]);
 assert.equal(result.direction,"increase");
 assert.equal(result.absoluteChange,4);
 assert.equal(result.percentageChange,2.76);
 assert.equal(result.sampleNewHigh,true);
 assert.equal(result.significantMove,false);
});
test("rejects currency mixing and invalid history rather than claiming savings",()=>{
 assert.equal(summarizePriceHistory([point(100,"10"),point(99,"09","USD")]).status,"mixed_currency");
 assert.equal(summarizePriceHistory([{price:1,currency:"SAR",observedAt:"invalid"}]).status,"invalid_history");
 assert.equal(summarizePriceHistory([{price:-1,currency:"SAR",observedAt:"2026-10-10"}]).status,"invalid_history");
 assert.equal(summarizePriceHistory([]).status,"no_observations");
 assert.throws(()=>summarizePriceHistory(null),/price_history_array_required/);
});
