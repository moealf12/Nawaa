// Background-only concurrency limiter. Not a persistent job queue.
export class MerchantBudget {
  constructor({limit=1,maxQueued=32}={}) {
    this.limit=limit;this.maxQueued=maxQueued;this.stores=new Map();
  }
  get(store) {
    if(!/^[a-z0-9_-]{1,80}$/i.test(store))throw new Error("invalid_store");
    if(!this.stores.has(store))this.stores.set(store,{active:0,queue:[]});
    return this.stores.get(store);
  }
  enqueue(store,operation) {
    if(typeof operation!=="function")return Promise.reject(new TypeError("invalid_operation"));
    const state=this.get(store);
    if(state.queue.length>=this.maxQueued)return Promise.reject(new Error("queue_capacity_exceeded"));
    return new Promise((resolve,reject)=>{
      state.queue.push({operation,resolve,reject});
      this.drain(store);
    });
  }
  drain(store) {
    const state=this.get(store);
    while(state.active<this.limit&&state.queue.length) {
      const next=state.queue.shift();
      state.active++;
      Promise.resolve().then(next.operation).then(next.resolve,next.reject)
        .finally(()=>{state.active--;this.drain(store);});
    }
  }
  status(store) {
    const state=this.get(store);
    return {active:state.active,queued:state.queue.length};
  }
}
