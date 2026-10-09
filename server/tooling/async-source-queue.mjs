// In-process per-merchant concurrency limiter for development/background tasks.
// Unlike pg-boss, this is not durable and never claims persistence.
export function createSourceQueue({concurrency=2,maxWaiting=40}={}) {
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>16)throw new RangeError("invalid_concurrency");
  if(!Number.isInteger(maxWaiting)||maxWaiting<0||maxWaiting>1000)throw new RangeError("invalid_max_waiting");
  const pending=[];let active=0,closed=false;
  const pump=()=>{
    while(!closed&&active<concurrency&&pending.length) {
      const task=pending.shift();active++;
      Promise.resolve().then(task.work).then(task.resolve,task.reject).finally(()=>{active--;pump();});
    }
  };
  return {
    submit(work){
      if(closed)return Promise.reject(new Error("queue_closed"));
      if(typeof work!=="function")return Promise.reject(new TypeError("work_must_be_function"));
      if(pending.length>=maxWaiting && active>=concurrency)return Promise.reject(new Error("queue_overloaded"));
      return new Promise((resolve,reject)=>{pending.push({work,resolve,reject});pump();});
    },
    status(){return {active,waiting:pending.length,closed};},
    close(){
      closed=true;
      while(pending.length)pending.shift().reject(new Error("queue_closed"));
    },
  };
}
