// R04-P49: bounded, chunk-safe framing for diagnostic stdout.
// Node stream chunks are NOT log-line boundaries. Truncating a partial line
// silently destroys the generation ID and corrupts trace lineage.
export function createBoundedLogFrameParser(onLine,{
  maxLineChars=262144,onDrop=()=>{},
}={}){
  if(typeof onLine!=="function"||typeof onDrop!=="function"||
     !Number.isSafeInteger(maxLineChars)||maxLineChars<1024||maxLineChars>1048576)
    throw Error("INVALID_LIVE_LOG_FRAME_CONFIG");
  let pending="",discarding=false;
  return {
    push(chunk){
      const input=String(chunk??"");
      let pos=0;
      while(pos<input.length){
        const end=input.indexOf("\n",pos);
        const piece=input.slice(pos,end===-1?input.length:end);
        if(!discarding){
          if(pending.length+piece.length>maxLineChars){
            pending="";discarding=true;onDrop();
          }else{
            pending+=piece;
            if(end!==-1){onLine(pending);pending="";}
          }
        }
        if(end===-1)break;
        pos=end+1;discarding=false;pending="";
      }
    },
    // A trailing unterminated fragment does not count as a complete event.
    incomplete(){return discarding||pending.length>0;},
    pendingChars(){return pending.length;},
  };
}
