#!/usr/bin/env node
// Read-only sitemap evidence. No index writes, inventory assertions, proxy,
// payment, third-party credentials, 403/429 retries, or discovery crawls.
import {readFile,mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import {parsePublicSitemapXml} from "../src/public-sitemap-evidence.mjs";
import {reconcilePublicSitemap} from "../src/source-request-routing.mjs";

const parseArgs=(args)=>{
  const parsed={};
  for(let i=0;i<args.length;i+=2){
    if(!["--sources","--output"].includes(args[i])||!args[i+1])
      throw Error("INVALID_SITEMAP_ARGUMENTS");
    parsed[args[i]]=args[i+1];
  }
  return parsed;
};
const acceptableHost=host=>Boolean(host) && !/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host) &&
  !/^\d+\.\d+\.\d+\.\d+$/.test(host) && !host.includes(":");
const safeSource=source=>{
  if(!source||!/^[a-z0-9-]{2,80}$/.test(String(source.id||"")))return null;
  if(!Array.isArray(source.baselineUrls)||source.baselineUrls.length>10_000)return null;
  try{
    const url=new URL(source.sitemapUrl);
    if(url.protocol!=="https:"||url.username||url.password||url.port&&url.port!=="443"||
      !acceptableHost(url.hostname)||url.pathname.length>250)return null;
    const merchantHost=String(source.merchantHost||"").toLowerCase();
    if(merchantHost!==url.hostname.toLowerCase())return null;
    if(!/\.xml(?:\.gz)?$/i.test(url.pathname))return null;
    // Compressed sitemap not supported by this controlled text-only pilot.
    if(/\.gz$/i.test(url.pathname))return null;
    return {id:source.id,sitemapUrl:url.href,merchantHost,
      baselineUrls:source.baselineUrls.filter(x=>{
        try{const u=new URL(x);return u.protocol==="https:"&&u.hostname.toLowerCase()===merchantHost}
        catch{return false}
      })};
  }catch{return null}
};
async function limitedText(response,max=2_000_000) {
  if(Number(response.headers.get("content-length"))>max)throw Error("SITEMAP_TOO_LARGE");
  if(!response.body)return "";
  const reader=response.body.getReader();const chunks=[];let total=0;
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      total+=value.byteLength;
      if(total>max)throw Error("SITEMAP_TOO_LARGE");
      chunks.push(value);
    }
  }finally{if(total>max)await reader.cancel().catch(()=>{})}
  return new TextDecoder().decode(Buffer.concat(chunks.map(x=>Buffer.from(x))));
}
export async function pollSitemapSource(source,{fetchImpl=globalThis.fetch}={}){
  const valid=safeSource(source);
  if(!valid)return {id:String(source?.id||"invalid").slice(0,80),status:"INVALID_SOURCE_CONFIG",complete:false,missing:[]};
  try{
    const response=await fetchImpl(valid.sitemapUrl,{
      method:"GET",redirect:"manual",headers:{accept:"application/xml,text/xml;q=0.9,*/*;q=0.1",
        "user-agent":"NAWAA-PublicSitemapCheck/1.0 (+https://github.com/moealf12/Nawaa)"},
      signal:AbortSignal.timeout(12_000),
    });
    if(response.status===403||response.status===429)
      return {id:valid.id,status:"SOURCE_ACCESS_DENIED_OR_LIMITED",httpStatus:response.status,complete:false,missing:[]};
    if(response.status!==200)
      return {id:valid.id,status:"SITEMAP_NOT_AVAILABLE",httpStatus:response.status,complete:false,missing:[]};
    const body=await limitedText(response);
    const parsed=parsePublicSitemapXml(body,{merchantHost:valid.merchantHost});
    if(!parsed.complete)
      return {id:valid.id,status:parsed.reason,complete:false,missing:[]};
    const evidence=reconcilePublicSitemap({indexedUrls:valid.baselineUrls,
      observedUrls:parsed.urls,sitemapObserved:true});
    return {id:valid.id,status:"OBSERVED",complete:evidence.complete,
      sitemapUrls:parsed.urls.length,baselineUrls:valid.baselineUrls.length,
      missing:evidence.missing,
      productAvailability:"unknown",indexMutated:false};
  }catch(error){
    return {id:valid.id,status:"SITEMAP_REQUEST_FAILED",complete:false,missing:[],
      failureClass:error?.message==="SITEMAP_TOO_LARGE"?"SIZE_LIMIT":"NETWORK_OR_FORMAT_FAILURE"};
  }
}
export async function pollConfiguredSitemaps(config,{fetchImpl=globalThis.fetch}={}){
  if(!Array.isArray(config)||config.length>8)throw Error("INVALID_SITEMAP_CONFIGURATION");
  // Sequential and bounded to avoid creating a burst against sources.
  const reports=[];
  for(const source of config)reports.push(await pollSitemapSource(source,{fetchImpl}));
  return {schemaVersion:"nawaa.public-sitemap-evidence.v1",
    observedAt:new Date().toISOString(),reports,sourceCount:config.length,
    indexMutated:false};
}
async function main(){
  const args=parseArgs(process.argv.slice(2));
  const raw=args["--sources"]?await readFile(args["--sources"],"utf8"):
    process.env.NAWAA_PUBLIC_SITEMAP_SOURCES_JSON||"[]";
  const config=JSON.parse(raw);
  const report=await pollConfiguredSitemaps(config);
  const target=path.resolve(args["--output"]||"public-sitemap-evidence.json");
  await mkdir(path.dirname(target),{recursive:true});
  await writeFile(target,JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({output:target,sourceCount:report.sourceCount,
    statusSummary:report.reports.map(x=>({id:x.id,status:x.status,missing:x.missing.length}))}));
}
if(process.argv[1]&&import.meta.url===new URL("file://"+path.resolve(process.argv[1])).href)
  main().catch(error=>{console.error(error?.message||"SITEMAP_ERROR");process.exitCode=1});
