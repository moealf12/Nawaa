import {SpanStatusCode} from "@opentelemetry/api";
import {BasicTracerProvider,SimpleSpanProcessor,ConsoleSpanExporter} from "@opentelemetry/sdk-trace-base";

// Local-only OpenTelemetry: zero SaaS, no network exporter and opt-in by default.
// Attribute allowlisting prevents leaking product URLs, prices or credentials.
const SAFE_KEYS=new Set(["source_id","strategy","outcome","job_type","duplicate"]);
const SAFE_NAME=/^nawaa\.[a-z0-9_.-]{1,70}$/;
function safeAttributes(attributes={}){
  const result={};
  for(const [key,value] of Object.entries(attributes)){
    if(!SAFE_KEYS.has(key))continue;
    if(typeof value==="boolean")result[key]=value;
    else if(typeof value==="string"&&/^[a-zA-Z0-9_.-]{1,80}$/.test(value))result[key]=value;
  }
  return result;
}
export function createLocalTelemetry({enabled=false,exporter}={}){
  if(!enabled)return {
    enabled:false,
    withSpan:async (_name,_attributes,fn)=>fn(),
    shutdown:async()=>{},
  };
  const output=exporter||new ConsoleSpanExporter();
  const provider=new BasicTracerProvider({
    spanProcessors:[new SimpleSpanProcessor(output)],
  });
  const tracer=provider.getTracer("nawaa-zero-cost-background");
  return {
    enabled:true,
    withSpan:async (name,attributes,fn)=>{
      if(!SAFE_NAME.test(String(name)))throw new Error("invalid_span_name");
      if(typeof fn!=="function")throw new TypeError("span_callback_required");
      const span=tracer.startSpan(name,{attributes:safeAttributes(attributes)});
      try {
        const result=await fn();
        span.setAttribute("outcome","success");
        return result;
      }catch(error){
        span.setAttribute("outcome","failed");
        span.setStatus({code:SpanStatusCode.ERROR});
        // Do not record raw exception messages: they may contain URLs or tokens.
        throw error;
      }finally{span.end();}
    },
    shutdown:()=>provider.shutdown(),
  };
}
