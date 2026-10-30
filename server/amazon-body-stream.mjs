// Bounded same-source HTML stream reader. Never log body contents, URLs, or
// customer data. Amazon only; other source readers retain existing behavior.
export async function readAmazonHtmlStream(response,{
  signal, maxBytes=5_000_000, idleTimeoutMs=3500,
  abortOnIdle=()=>{}, now=()=>performance.now(),
}={}){
  if(!response?.body||typeof response.body.getReader!=="function"){
    const text=await response.text();
    if(Buffer.byteLength(text,"utf8")>maxBytes){
      const error=new Error("search response too large");
      error.failureClass="RESPONSE_TOO_LARGE";throw error;
    }
    return {text,progress:{bytesReceived:Buffer.byteLength(text,"utf8"),
      chunksReceived:1,firstByteMs:null,maxIdleGapMs:null,idleTimeoutTriggered:false}};
  }
  signal?.throwIfAborted();
  const reader=response.body.getReader();
  const decoder=new TextDecoder("utf-8");
  let total=0,chunks=0,firstByteMs=null,maxIdleGapMs=0,idleTriggered=false;
  const started=now();
  let lastProgress=started,timer=null,onAbort,finished=false,completed=false;
  const snapshot=()=>({
    bytesReceived:total,chunksReceived:chunks,firstByteMs,
    maxIdleGapMs:Math.max(0,Math.round(Math.max(maxIdleGapMs,now()-lastProgress))),
    idleTimeoutTriggered:idleTriggered,
  });
  const cancelled=new Promise(resolve=>{
    onAbort=()=>resolve({aborted:true,reason:signal?.reason||new Error("source_cancelled")});
    signal?.addEventListener("abort",onAbort,{once:true});
    if(signal?.aborted)onAbort();
  });
  // Do not rely on the caller's abort callback to terminate a stalled stream.
  let resolveIdle;
  const idleCancelled=new Promise(resolve=>{resolveIdle=resolve;});
  const timeoutError=()=>{
    const error=new Error("amazon_body_idle_timeout");
    error.name="TimeoutError";
    error.failureClass="BODY_IDLE_TIMEOUT";
    return error;
  };
  const resetIdle=()=>{
    if(timer!==null)clearTimeout(timer);
    timer=setTimeout(()=>{
      if(finished||signal?.aborted)return;
      idleTriggered=true;
      // Abort the same original request; no alternate route or extra page.
      const reason=timeoutError();
      try{abortOnIdle(reason);}catch{}
      resolveIdle({aborted:true,reason});
    },idleTimeoutMs);
  };
  const pieces=[];
  try{
    resetIdle();
    while(true){
      const read=Promise.resolve().then(()=>reader.read())
        .then(value=>({value}),error=>({error}));
      const settled=await Promise.race([read,cancelled,idleCancelled]);
      if(settled.aborted)throw settled.reason;
      if(settled.error)throw settled.error;
      if(settled.value.done)break;
      const chunk=settled.value.value;
      const size=chunk?.byteLength??0;
      const at=now();
      // An empty chunk is not progress and must not reset the idle clock.
      if(size===0)continue;
      maxIdleGapMs=Math.max(maxIdleGapMs,at-lastProgress);
      lastProgress=at;
      if(chunks===0)firstByteMs=Math.round(at-started);
      chunks++;
      total+=size;
      if(total>maxBytes){
        const error=new Error("search response too large");
        error.failureClass="RESPONSE_TOO_LARGE";
        throw error;
      }
      pieces.push(decoder.decode(chunk,{stream:true}));
      resetIdle();
    }
    pieces.push(decoder.decode());
    finished=true;completed=true;
    return {text:pieces.join(""),progress:snapshot()};
  }catch(error){
    // Bind safe, aggregate-only progress to the error for existing telemetry.
    if(error&&typeof error==="object")error.bodyProgress=snapshot();
    throw error;
  }finally{
    finished=true;
    if(timer!==null)clearTimeout(timer);
    signal?.removeEventListener("abort",onAbort);
    // Never await cancellation: a non-compliant stream must not hang cleanup.
    if(!completed){
      try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}
    }
    try{reader.releaseLock();}catch{}
  }
}
