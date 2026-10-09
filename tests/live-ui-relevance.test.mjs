import assert from "node:assert/strict";
import test from "node:test";
import {filterQueryOffers,queryMatchReasons} from "../src/search-query.mjs";

const item=(title)=>({title,sourceUrl:"https://merchant.example/p/"+encodeURIComponent(title),productPrice:120,currency:"SAR"});
test("real website: perfume search excludes books, felt-tip pens and toys",()=>{
 const rows=[item("Carioca Perfume Felt-tip Marker, 12 Pieces"),item("My Song Is Perfume: An Anthology of Poetry"),
  item("Perfume - The Story of a Murderer (Book)"),item("Yummiland Perfume Roller Assorted Doll"),
  item("Roberto Cavalli Paradiso Eau de Parfum for Women")];
 const output=filterQueryOffers("perfume",rows).offers.map(x=>x.title);
 assert.deepEqual(output,["Roberto Cavalli Paradiso Eau de Parfum for Women"]);
 assert.ok(queryMatchReasons("perfume",rows[0]).includes("category_conflict"));
});
test("real website: stroller search excludes chronicles and tricycles",()=>{
 const rows=[item("At The North of Bearcamp Water: Chronicles of a Stroller in New England (Book)"),
  item("Step2 Stroller Tricycle Pink"),item("Neobreez Compact Stroller Black")];
 assert.deepEqual(filterQueryOffers("stroller",rows).offers.map(x=>x.title),["Neobreez Compact Stroller Black"]);
});
test("real website: chair search excludes chair pads but keeps actual furniture",()=>{
 const rows=[item("Dupioni Chair Pad 40x40"),item("Memory Foam Chair Cushion"),item("Elegant Wooden Dining Chair")];
 assert.deepEqual(filterQueryOffers("chair",rows).offers.map(x=>x.title),["Elegant Wooden Dining Chair"]);
});
test("specific accessory and book queries remain independent from broad-category guard",()=>{
 assert.equal(queryMatchReasons("chair pad",item("Dupioni Chair Pad 40x40")).includes("category_conflict"),false);
 assert.equal(queryMatchReasons("perfume book",item("Perfume - The Story of a Murderer (Book)")).includes("category_conflict"),false);
});
