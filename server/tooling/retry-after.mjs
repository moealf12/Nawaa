// Delay parser for background crawling. Limits retries and respects 429 headers.
export function parseRetryAfter(value,now=Date.now()) {
 if(value===undefined||value===null)return null;
 const raw=String(value).trim();
 if(raw==='')return null;
 if(/^\d+$/.test(raw))return Math.min(Number(raw)*1000,3600000);
 const until=Date.parse(raw);
 if(!Number.isFinite(until))return null;
 return Math.max(0,Math.min(3600000,until-now));
}
export function retryBudget({attempts=0,maxAttempts=3,status,retryAfter}={}) {
 if(attempts>=maxAttempts)return {retry:false,delayMs:0};
 if(![429,500,502,503,504].includes(status))return {retry:false,delayMs:0};
 const delay=parseRetryAfter(retryAfter);
 return {retry:true,delayMs:delay??Math.min(60000,1000*2**attempts)};
}
