export const sourceQueries={
 'jarir':['iPhone 17 256GB','HP laptop'],'extra':['iPhone 17 256GB','HP laptop'],
 'sharafdg-sa':['iPhone 17 256GB','Samsung Galaxy S25'],'swarovski-sa':['pendant','bracelet'],
 'shein-sa':['dress','shirt'],'ikea-sa':['chair','table'],'adidas-sa':['Samba','Ultraboost'],'nike-sa':['shoes','shirt'],
 'sephora-sa':['perfume','lipstick'],'namshi-sa':['shoes','shirt'],'centrepoint-sa':['dress','shirt'],
 'maxfashion-sa':['dress','shirt'],'decathlon-sa':['shoes','backpack'],'niceone-sa':['perfume','lipstick'],
 'ebay':['iPhone 17 256GB','Canon camera'],'newegg-us':['SSD','laptop'],'bhphoto':['Canon camera','Sony camera'],
 'walmart-us':['laptop','coffee'],'bestbuy-us':['laptop','headphones'],'etsy-global':['necklace','ring'],
 'iherb-sa':['vitamin','magnesium'],'asos-global':['dress','shirt'],'farfetch-sa':['shoes','bag'],
 'aliexpress-cn':['charger','cable'],'temu-global':['charger','cable'],
 'shopify:native-union':['charger','cable'],'shopify:spigen-us':['iPhone 17 case','charger'],
 'shopify:death-wish-coffee':['coffee','espresso'],'shopify:tentree':['shirt','hoodie'],
};
export function buildAuditMatrix(sourceIds=Object.keys(sourceQueries)) {
 if(!Array.isArray(sourceIds) || !sourceIds.length || new Set(sourceIds).size!==sourceIds.length || sourceIds.some(id=>!Object.hasOwn(sourceQueries,id))) throw Error('invalid_sources');
 const matrix=[];
 for(let round=1;round<=3;round++) for(const [sourceId,positive] of Object.entries(sourceQueries)) {
  if(!sourceIds.includes(sourceId)) continue;
  for(const query of positive) matrix.push({round,sourceId,query,expected:'results'});
  matrix.push({round,sourceId,query:'nawaa-unfindable-943271-20261003',expected:'empty'});
 }
 return matrix;
}
const key=r=>JSON.stringify([r.round,r.sourceId,r.query,r.expected]);
function passed(r,revision) {
 if(r?.schemaVersion!=='nawaa.source-audit.v1' || r.source?.id!==r.sourceId || r.revision!==revision || r.executionEnvironment!=='render-service-worker' || r.cachePolicy!=='direct-provider-request' || !Array.isArray(r.errorCodes) || r.errorCodes.length) return false;
 if(!Number.isFinite(Date.parse(r.observedAt)) || !Number.isInteger(r.durationMs) || r.durationMs<0 || !Array.isArray(r.samples) || !Array.isArray(r.rejections)) return false;
 const c=r.counts;
 if(!c || !['raw','accepted','rejected','duplicates'].every(key=>Number.isInteger(c[key])&&c[key]>=0) || c.raw!==c.accepted+c.rejected+c.duplicates) return false;
 if(r.expected==='empty') return r.status==='NEGATIVE_CONTROL_PASS' && c.raw===0 && c.accepted===0 && c.rejected===0 && c.duplicates===0;
 const p=r.pageVerification;
 return r.status==='VERIFIED_SAMPLE' && c.accepted>0 && c.rejected===0 && r.rejections.length===0 && p && ['attempted','verified','failed'].every(key=>Number.isInteger(p[key])&&p[key]>=0) && p.attempted>0 && p.attempted===Math.min(3,c.accepted) && p.attempted===r.samples.length && p.verified===p.attempted && p.failed===0;
}
export function summarizeAuditMatrix(matrix,records,revision) {
 const groups=new Map();const statusCounts={};
 for(const r of records) {const k=key(r);groups.set(k,[...(groups.get(k)||[]),r]);const status=r.status || 'MALFORMED';statusCounts[status]=(statusCounts[status]||0)+1;}
 const sources=[...new Set(matrix.map(x=>x.sourceId))].map(sourceId=>{
  const entries=matrix.filter(x=>x.sourceId===sourceId);let completed=0,successful=0;
  const statuses={};
  for(const entry of entries) {
   const matches=groups.get(key(entry)) || [];if(matches.length) completed++;
   if(matches.length===1 && passed(matches[0],revision)) successful++;
   for(const r of matches) statuses[r.status || 'MALFORMED']=(statuses[r.status || 'MALFORMED']||0)+1;
  }
  return {sourceId,planned:entries.length,completed,successful,verified:entries.length===9 && successful===9,statuses};
 });
 return {schemaVersion:'nawaa.source-matrix.v1',revision,planned:matrix.length,completed:sources.reduce((n,s)=>n+s.completed,0),verifiedSources:sources.filter(s=>s.verified).length,statusCounts,sources};
}
