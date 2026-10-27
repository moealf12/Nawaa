import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractProductLinks,
  extractSamsungSearchOffers,
  routeFreeStorefronts,
} from '../server/providers/free-storefronts.mjs';

const q='galaxy s25';
const url='https://www.samsung.com/sa_en/search/?searchvalue=galaxy%20s25';
const store=routeFreeStorefronts(q, Infinity, {stable:true}).find(x=>x.store.id==='samsung-sa')?.store;
assert.ok(store,'Samsung SA must be a routable source for the fixture query');

const expected='https://www.samsung.com/sa_en/smartphones/galaxy-s25/buy/';
const wrong=[
  ['https://www.samsung.com/sa_en/smartphones/galaxy-s26-ultra/buy/','Galaxy S26 Ultra'],
  ['https://www.samsung.com/sa_en/smartphones/galaxy-z-fold8/buy/','Galaxy Z Fold8'],
  ['https://www.samsung.com/sa_en/smartphones/galaxy-s25-ultra/buy/','Galaxy S25 Ultra'],
  ['https://www.samsung.com/sa_en/smartphones/galaxy-s25-fe/buy/','Galaxy S25 FE'],
];
const a=(href,label)=>'<a href="'+href+'">'+label+'</a>';
const searchHtml=(rows)=>rows.map(([href,label])=>a(href,label)).join('\n');

test('RED: exact S25 request rejects unrelated Samsung PDPs before bounded PDP resolution',()=>{
  const html=searchHtml([...wrong,[expected,'Galaxy S25']]);
  const found=extractProductLinks(html,url,store,q,3);
  assert.deepEqual(found.map(x=>x.url),[expected],
    'S26/Fold8/S25 Ultra/FE must not exhaust the 3-PDP validation budget for base S25');
});

test('RED: url model is authoritative when anchor mislabels another Samsung model',()=>{
  const html=searchHtml([
    [wrong[0][0],'Galaxy S25'], // misleading anchor label
    [expected,'Galaxy S25'],
  ]);
  const found=extractProductLinks(html,url,store,q);
  assert.deepEqual(found.map(x=>x.url),[expected]);
});

test('RED: exact Galaxy S25 Ultra and base S25 are distinct requested configurations',()=>{
  const found=extractProductLinks(searchHtml([
    [expected,'Galaxy S25'],
    [wrong[2][0],'Galaxy S25 Ultra'],
  ]),url,store,'galaxy s25 ultra');
  assert.deepEqual(found.map(x=>x.url),[wrong[2][0]]);
});

test('positive control: broad Galaxy-family discovery still finds other Samsung models',()=>{
  const found=extractProductLinks(searchHtml(wrong),url,store,'galaxy');
  assert.ok(found.some(x=>x.url===wrong[0][0]));
  assert.ok(found.some(x=>x.url===wrong[1][0]));
});

test('RED: mixed Arabic-English Galaxy S25 preserves exact model selection',()=>{
  const found=extractProductLinks(searchHtml([...wrong,[expected,'Galaxy S25']]),url,store,'سامسونج جالاكسي s25',3);
  assert.deepEqual(found.map(x=>x.url),[expected]);
});

const samsungRow=(href,model,title,price='3999')=>'<li class="aisearch__item">'+
  '<a class="aisearch-product__name" href="'+href+'" data-modelcode="'+model+'" aria-label="'+title+'">'+title+'</a>'+
  '<span data-modelprice="'+price+'"></span></li>';
test('RED: priced Samsung search cards must not override shopper model intent',()=>{
  const items='<ul>'+[
    samsungRow('/sa_en/smartphones/galaxy-s26-ultra/buy/','SM-S948B','Galaxy S26 Ultra'),
    samsungRow('/sa_en/smartphones/galaxy-s25/buy/','SM-S931B','Galaxy S25'),
  ].join('\n')+'</ul>';
  const found=extractSamsungSearchOffers(items,q);
  assert.equal(found.length,1);
  assert.equal(found[0].title,'Galaxy S25');
  assert.equal(found[0].sourceUrl,expected);
  assert.equal(found[0].price,3999);
});

test('negative controls: foreign-host links and unsupported model-only navigation do not establish a Samsung PDP',()=>{
  const links=extractProductLinks(searchHtml([
    ['https://unrelated.example/sa_en/smartphones/galaxy-s25/buy/','Galaxy S25'],
    ['https://www.samsung.com/sa_en/about-us/','Galaxy S25'],
  ]),url,store,q);
  assert.deepEqual(links,[]);
});
