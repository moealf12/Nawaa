import test from "node:test";
import assert from "node:assert/strict";
import {provisionalLabel} from "../scripts/verify-r04-live-ranking.mjs";

// Independently defined item-identity cases. These are deterministic adjudication
// regression examples, not live merchant inventory or prices.
const scenarios=[
  ["Sony PlayStation 5 Digital Edition Console with included Vertical Stand",3],
  ["PlayStation 5 Digital Edition Console, 825GB with extra DualSense Controller",3],
  ["Sony PS5 Digital Edition Console with DualSense controller bundle",3],
  ["Sony PlayStation 5 Digital Edition Console",3],
  ["PS5 Slim Digital Edition Horizontal Standfüße Halterung, PS5 Slim ohne Laufwerk",0],
  ["PS5 Disc Drive for Digital Edition",0],
  ["PS5 Digital Edition Console Stand Bracket",0],
  ["PS5 Stand for Digital Edition Console",0],
];
for(const [title,expected] of scenarios){
  test("R04 console identity adjudication: "+title,()=>{
    const grade=provisionalLabel("ps5",{title}).grade;
    assert.equal(grade,expected,"principal console versus independently sold accessory");
  });
}
test("R04 grade independent from model-reported confidence/price/rank",()=>{
  const title="Sony PlayStation 5 Digital Edition Console with included Vertical Stand";
  const a=provisionalLabel("ps5",{title,matchConfidence:0,exactMatch:false,productPrice:1});
  const b=provisionalLabel("ps5",{title,matchConfidence:1,exactMatch:true,productPrice:99999});
  assert.deepEqual(a,b);
});
