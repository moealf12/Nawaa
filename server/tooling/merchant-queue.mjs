import PQueue from "p-queue";
// Memory-only rate and concurrency guard for non-customer background work.
export function createMerchantQueue({concurrency=2,intervalCap=10,interval=60000,maxWaiting=100}={}){
 for(const n of [concurrency,intervalCap,interval,maxWaiting])if(!Number.isInteger(n)||n<1)throw new RangeError("invalid_queue_limits");
 if(concurrency>16||intervalCap>500||maxWaiting>1000)throw new RangeError("queue_limit_too_high");
 const queue=new PQueue({concurrency,intervalCap,interval,carryoverConcurrencyCount:true});
 let closed=false;
 return {
  submit(fn,{signal}={}){
   if(closed)return Promise.reject(new Error("queue_closed"));
   if(typeof fn!=="function")return Promise.reject(new TypeError("work_must_be_function"));
   if(queue.size>=maxWaiting)return Promise.reject(new Error("queue_overloaded"));
   return queue.add(fn,{signal});
  },
  status(){return {active:queue.pending,waiting:queue.size,closed};},
  async drain(){await queue.onIdle();},
  close(){closed=true;queue.clear();},
 };
}
