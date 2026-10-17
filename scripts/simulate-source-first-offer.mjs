import http from 'node:http';
import {firstOfferMilestones} from '../src/search-first-offer-metrics.mjs';
const cfg=JSON.parse(process.env.NAWAA_SCENARIO);
process.env.PORT='0';
process.env.DATABASE_URL='';process.env.MEILI_HOST='';
process.env.MEILI_MASTER_KEY='';process.env.NODE_ENV='test';
process.env.NOON_ENABLED='false';process.env.CARREFOUR_ENABLED='false';
process.env.EBAY_ENABLED='false';process.env.SEARCH_STREAM_DEADLINE_MS='2300';
let canceledUpstream=0, outstanding=0;
function pause(ms,signal){
  if(signal?.aborted)return Promise.reject(signal.reason||Error('aborted'));
  if(!ms)return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const finish=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve()};
    const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);canceledUpstream++;reject(signal.reason||Error('aborted'))};
    const timer=setTimeout(finish,ms);
    signal?.addEventListener('abort',abort,{once:true});
  });
}
const products={
  console:'Sony PlayStation 5 Console 1TB',
  iphone:'Apple iPhone 17 256GB Black',
};
function forQuery(url){return /iphone|ايفون|آيفون/i.test(url)?'iphone':'console'}
globalThis.fetch=async(input,options={})=>{
  const u=new URL(String(input));
  const signal=options.signal;
  const isExtra=u.hostname==='search.unbxd.io';
  const isJarir=u.hostname==='ac.cnstrc.com';
  if(!isExtra&&!isJarir)return new Response('',{status:200,headers:{'content-type':'text/html'}});
  const type=forQuery(isExtra?u.searchParams.get('q')||'':decodeURIComponent(u.pathname));
  const isIphone=type==='iphone';
  let wait=isExtra?(cfg.extraDelay||0):(cfg.jarirDelay||0);
  if(cfg.concurrent)wait=isIphone?(isExtra?30:140):(isExtra?140:30);
  outstanding++;
  try{await pause(wait,signal)}finally{outstanding--}
  if(isExtra){
    if(cfg.extraStatus)return new Response('',{status:cfg.extraStatus});
    const title=cfg.concurrent?products[type]:(cfg.extraTitle===undefined?products[type]:cfg.extraTitle);
    return Response.json({response:{numberOfProducts:title?1:0,products:title?[{
      id:type+'-extra',name:title,currentPrice:isIphone?3999:2599,
      available:true,featureEnBrandName:isIphone?'Apple':'Sony',
      featureEnDeviceType:isIphone?'Phone':'Console',
    }]:[]}});
  }
  const title=cfg.concurrent?products[type]:(cfg.jarirTitle===undefined?products[type]:cfg.jarirTitle);
  return Response.json({response:{results:title?[{
    value:title,data:{id:type+'-jarir',url:type+'-test.html',price:isIphone?3799:2399,
      image_url:'https://www.jarir.com/mock-product.jpg'}
  }]:[]}});
};
function request(port,query,{cancel=false}={}){
  return new Promise((resolve,reject)=>{
    const metrics={firstValid:null,firstExact:null,firstValidMs:null,firstExactMs:null,
      firstPartial:null,last:null,done:false,errors:[],snapshots:0,canceled:false};
    const start=performance.now();let buffer='',finished=false;
    const finish=()=>{
      if(finished)return;finished=true;
      resolve({...metrics,elapsedMs:Math.round(performance.now()-start),
        canceledUpstream,outstanding,
        finalSources:[...new Set((metrics.last?.offers||[]).map(o=>o.providerMarket))],
        finalCount:metrics.last?.offers?.length||0});
    };
    const req=http.get({host:'127.0.0.1',port,path:'/api/search/stream?q='+encodeURIComponent(query)},res=>{
      if(res.statusCode!==200){reject(Error('HTTP_'+res.statusCode));return}
      res.on('data',chunk=>{
        buffer+=String(chunk);if(buffer.length>3e6){req.destroy();reject(Error('sse_buffer_limit'));return}
        let i;while((i=buffer.indexOf('\n\n'))>=0){
          const line=buffer.slice(0,i);buffer=buffer.slice(i+2);
          const tag=line.match(/^event: (.+)$/m)?.[1];
          const payload=line.match(/^data: (.+)$/m)?.[1];
          if(tag==='snapshot'&&payload){
            const snap=JSON.parse(payload);metrics.snapshots++;metrics.last=snap;
            const milestones=firstOfferMilestones(snap.offers);
            const t=Math.round(performance.now()-start);
            if(!metrics.firstValid&&milestones.firstValid){
              metrics.firstValid={source:milestones.firstValid.providerMarket,merchant:milestones.firstValid.merchant,
                exact:milestones.firstValid.exactMatch,price:milestones.firstValid.productPrice,
                title:milestones.firstValid.title};
              metrics.firstValidMs=t;metrics.firstPartial=snap.coverage?.partial;
            }
            if(!metrics.firstExact&&milestones.firstExact){
              metrics.firstExact={source:milestones.firstExact.providerMarket,merchant:milestones.firstExact.merchant,
                price:milestones.firstExact.productPrice,title:milestones.firstExact.title};
              metrics.firstExactMs=t;
            }
            if(cancel&&metrics.firstValid&&!metrics.canceled){
              metrics.canceled=true;req.destroy();setTimeout(finish,130);return;
            }
          }
          if(tag==='done')metrics.done=true;
          if(tag==='error')metrics.errors.push('sse_error');
        }
      });
      res.on('end',finish);
      res.on('error',error=>{if(!cancel)reject(error)});
    });
    req.on('error',error=>{if(!cancel)reject(error)});
    setTimeout(()=>{if(!finished){req.destroy();reject(Error('client_timeout'))}},7000).unref();
  });
}
const oldListen=http.Server.prototype.listen;
http.Server.prototype.listen=function(...args){
  this.once('listening',async()=>{
    const server=this,port=server.address().port;
    try{
      const result=cfg.concurrent?
        await Promise.all([request(port,'ايفون 17'),request(port,'PS5')]):
        await request(port,'PS5',{cancel:Boolean(cfg.cancel)});
      console.log('SOURCE_SIMULATION '+JSON.stringify({scenario:cfg.name,result}));
    }catch(error){console.log('SIMULATION_ERROR '+error.stack);process.exitCode=1}
    finally{server.close(()=>process.exit(process.exitCode||0))}
  });
  return oldListen.apply(this,args);
};
await import('../server/server.mjs');
