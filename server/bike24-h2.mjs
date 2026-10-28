// First-request, strict ALPN h2 compatibility probe for BIKE24 Garmin PDPs.
// Uses native Node TLS, not browser fingerprint impersonation or an alternate IP.
// This is intentionally never an automatic response to HTTP 403/429.
import tls from "node:tls";
import http2 from "node:http2";
import {NAWAA_INDEXER_USER_AGENT} from "../src/source-http-profile.mjs";

export const BIKE24_H2_PROBE_ENV = "NAWAA_BIKE24_HTTP2_PROBE";

export function isBike24H2ProbeUrl(raw) {
  try {
    const url=new URL(raw);
    return url.protocol==="https:" && url.hostname==="www.bike24.com" &&
      (!url.port||url.port==="443") && !url.username && !url.password &&
      /^\/p\d{5,11}\.html$/.test(url.pathname);
  }catch{return false;}
}

export function bike24H2RequestHeaders(raw) {
  if(!isBike24H2ProbeUrl(raw))throw Error("BIKE24_HTTP2_PRODUCT_ONLY");
  const url=new URL(raw);
  return {
    ":method":"GET",
    ":path":url.pathname+url.search,
    "accept":"text/html,application/xhtml+xml;q=0.9",
    "accept-language":"en-GB,en;q=0.9,de;q=0.4",
    "user-agent":NAWAA_INDEXER_USER_AGENT,
  };
}

export async function fetchBike24HtmlOverH2(target,{signal}={}) {
  const url=target?.parsed;
  if(!url || !isBike24H2ProbeUrl(url.href) ||
     typeof target.address!=="string" || ![4,6].includes(target.family))
    throw Error("BIKE24_HTTP2_PIN_REQUIRED");
  signal?.throwIfAborted();
  const hostname=url.hostname;
  const timeoutMs=12000,maxBytes=8_000_000;
  return new Promise((resolve,reject)=>{
    let session,request,socket,complete=false,seenHeaders=false,size=0;
    const parts=[];
    const timer=setTimeout(()=>finish(new Error("BIKE24_HTTP2_TIMEOUT")),timeoutMs);
    const abort=()=>finish(signal?.reason instanceof Error?signal.reason:new Error("BIKE24_HTTP2_ABORTED"));
    const clear=()=>{clearTimeout(timer);signal?.removeEventListener("abort",abort);};
    const finish=(error,value)=>{
      if(complete)return;
      complete=true;
      clear();
      try{if(error)session?.destroy();else session?.close();}catch{}
      if(error)reject(error);else resolve(value);
    };
    signal?.addEventListener("abort",abort,{once:true});
    try {
      session=http2.connect(url.origin,{
        createConnection:()=>{
          socket=tls.connect({
            host:target.address,port:443,family:target.family,
            servername:hostname,ALPNProtocols:["h2"],
            rejectUnauthorized:true,minVersion:"TLSv1.2",
          });
          socket.once("secureConnect",()=>{
            if(socket.alpnProtocol!=="h2")finish(Error("BIKE24_HTTP2_ALPN_NOT_NEGOTIATED"));
          });
          return socket;
        },
      });
      session.on("error",finish);
      request=session.request(bike24H2RequestHeaders(url.href),{endStream:true});
      request.on("response",headers=>{
        seenHeaders=true;
        const status=Number(headers[":status"]);
        if(!Number.isInteger(status)||status<200||status>=300)
          return finish(Object.assign(Error("Product page returned "+status),{status}));
        const type=String(headers["content-type"]||"").toLowerCase();
        if(!type.includes("text/html")&&!type.includes("application/xhtml+xml"))
          return finish(Error("URL is not an HTML product page"));
      });
      request.on("data",chunk=>{
        if(complete)return;
        size+=chunk.length;
        if(size>maxBytes)return finish(Error("Product page is too large"));
        parts.push(chunk);
      });
      request.on("end",()=>{
        if(!seenHeaders)return finish(Error("BIKE24_HTTP2_NO_RESPONSE"));
        finish(null,{finalUrl:url.href,html:Buffer.concat(parts,size).toString("utf8"),
          protocol:"h2",sourceTransport:"node:http2",dnsPinned:true});
      });
      request.on("error",finish);
    }catch(error){finish(error);}
  });
}
