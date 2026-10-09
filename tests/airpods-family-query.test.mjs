import test from "node:test";
import assert from "node:assert/strict";
import {filterQueryOffers,queryMatchReasons} from "../src/search-query.mjs";

const item=(title)=>({title,sourceUrl:"https://store.example/"+title.toLowerCase().replace(/[^a-z0-9]+/g,"-")+"/p",productPrice:500,currency:"SAR"});

test("generic AirPods query retains genuine AirPods generations and Pro models",()=>{
 const offers=[item("Apple AirPods 4 White"),item("Apple AirPods Pro 2 Wireless Earphones"),item("Apple AirPods 3 Charging Case")];
 const result=filterQueryOffers("airpods",offers);
 assert.equal(result.offers.length,2);
 assert.deepEqual(result.offers.map(o=>o.title),offers.slice(0,2).map(o=>o.title));
 assert.deepEqual(queryMatchReasons("airpods",offers[0]),[]);
});

test("explicit AirPods generation still blocks wrong-generation offers",()=>{
 const right=item("Apple AirPods 4 White");
 const wrong=item("Apple AirPods 3 Wireless Earphones");
 const result=filterQueryOffers("airpods 4",[right,wrong]);
 assert.deepEqual(result.offers.map(o=>o.title),[right.title]);
 assert.ok(queryMatchReasons("airpods 4",wrong).includes("model_conflict"));
});

test("generic AirPods searches do not surface cases or chargers",()=>{
 const accessory=item("Protective Silicone Case for Apple AirPods 4");
 const kept=filterQueryOffers("airpods",[accessory]).offers;
 assert.deepEqual(kept,[]);
});
