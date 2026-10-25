import test from 'node:test';
import assert from 'node:assert/strict';
import {collectFirstOfferEvents,sampleSummary} from '../scripts/measure-production-first-offer.mjs';

const offer={title:'HP Laptop 16GB',productPrice:2999,currency:'SAR',merchant:'Jarir',
  sourceUrl:'https://www.jarir.com/sa-en/hp.html',
  observedAt:'2026-10-26T00:00:00.000Z',exactMatch:true};
const stream=chunks=>new Response(new ReadableStream({
  start(controller){for(const chunk of chunks)controller.enqueue(new TextEncoder().encode(chunk));controller.close()}
}),{status:200,headers:{'content-type':'text/event-stream'}});

test('SSE timing parser handles split chunks, invalid offers and exact milestones',async()=>{
  const invalid={...offer,sourceUrl:'javascript:invalid'};
  const payload=['event: meta\ndata: {}\n\n',
    'event: snapshot\ndata: '+JSON.stringify({offers:[invalid]})+'\n\n',
    'event: snapshot\ndata: '+JSON.stringify({offers:[{...offer,exactMatch:false}]})+'\n\n',
    'event: snapshot\ndata: '+JSON.stringify({offers:[offer]})+'\n\n',
    'event: done\ndata: {}\n\n'].join('');
  let clock=100;
  const result=await collectFirstOfferEvents(stream([payload.slice(0,25),payload.slice(25)]),
    {start:90,now:()=>clock+=10});
  assert.equal(result.status,200);
  assert.equal(result.snapshots,3);
  assert.equal(result.firstValidMs,30);
  assert.equal(result.firstExactMs,30);
  assert.equal(result.finished,true);
  assert.equal(result.errorEvents,0);
});

test('empty finished stream must be a no-offer observation, not zero-millisecond success',async()=>{
  const result=await collectFirstOfferEvents(stream([
    'event: snapshot\ndata: {"offers":[]}\n\n','event: done\ndata: {}\n\n'
  ]),{start:0,now:()=>400});
  assert.equal(result.firstValidMs,null);
  assert.equal(result.finished,true);
  assert.equal(sampleSummary([result]).withoutValidOffer,1);
});

test('malformed SSE JSON cannot be counted as a successful offer',async()=>{
  const result=await collectFirstOfferEvents(stream(['event: snapshot\ndata: {invalid}\n\n']),
    {start:0,now:()=>900});
  assert.equal(result.firstValidMs,null);
  assert.ok(result.error);
});

test('small sample never certifies a production P95, including missing offers and errors',()=>{
  const rows=[{firstValidMs:3200},{firstValidMs:1500},{firstValidMs:null,error:'timeout'},
    {firstValidMs:2100},{firstValidMs:1800}];
  const out=sampleSummary(rows);
  assert.deepEqual({
    attempts:out.attempts,validFound:out.validFound,withoutValidOffer:out.withoutValidOffer,
    median:out.medianObservedMs,min:out.minObservedMs,max:out.maxObservedMs,
    above:out.observedAboveTarget,p95:out.p95Ms,certified:out.p95Certified
  },{attempts:5,validFound:4,withoutValidOffer:1,median:1800,min:1500,
    max:3200,above:3,p95:null,certified:false});
});

test('valid response with no offers remains unverified for SLO',()=>{
  const out=sampleSummary([{firstValidMs:null,finished:true}]);
  assert.equal(out.validFound,0);assert.equal(out.p95Ms,null);assert.equal(out.p95Certified,false);
});
