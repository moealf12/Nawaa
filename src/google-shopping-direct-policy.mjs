// Google Shopping direct-acquisition gate (isolated research only).
// The Jarir/Noon pipeline cannot execute an automated Google search unless
// Google's CURRENT robots policy admits that exact path + query.
// No provider/SSE, browser evasion, paid API, or customer-visible product data.
const GOOGLE_ORIGIN="https://www.google.com";

export function googleShoppingDirectCandidates(query) {
  if(typeof query!=="string")return [];
  const q=query.normalize("NFC").trim().replace(/\s+/gu," ");
  if(Array.from(q).length<2||Array.from(q).length>140)return [];
  if(/^(https?:\/\/|www\.)/i.test(q)||
     /[\u0000-\u001f\u007f-\u009f\u202a-\u202e]/u.test(q))return [];
  const normal=new URL(GOOGLE_ORIGIN+"/search");
  normal.searchParams.set("tbm","shop");normal.searchParams.set("q",q);
  normal.searchParams.set("gl","sa");normal.searchParams.set("hl","ar");
  const shopping=new URL(GOOGLE_ORIGIN+"/shopping/search");
  shopping.searchParams.set("q",q);shopping.searchParams.set("gl","sa");
  shopping.searchParams.set("hl","ar");
  const mode=new URL(GOOGLE_ORIGIN+"/shopping");
  mode.searchParams.set("udm","28");mode.searchParams.set("q",q);
  return Object.freeze([
    {kind:"search_tbm_shop",url:normal.href,searchQuery:true},
    {kind:"shopping_search",url:shopping.href,searchQuery:true},
    {kind:"shopping_udm_query",url:mode.href,searchQuery:true},
  ]);
}

function escapeRegExp(value){
  return value.replace(/[|\\{}()[\]^$+?.]/g,"\\$&");
}
function rulePattern(path){
  if(typeof path!=="string")return null;
  const end=path.endsWith("$");
  const p=end?path.slice(0,-1):path;
  return new RegExp("^"+p.split("*").map(escapeRegExp).join(".*")+(end?"$":""));
}

// Interpret only the ordinary crawler "User-agent: *" group. Do not assume a
// Googlebot / AdsBot exemption applies to NAWAA's transparent user agent.
export function parseGoogleRobotsCommonRules(text){
  if(typeof text!=="string"||text.length<10||text.length>512_000)return null;
  const groups=[];let group=null;let sawDirective=false;
  for(const line of text.split(/\r?\n/)){
    const noComment=line.split("#",1)[0].trim();
    const pos=noComment.indexOf(":");if(pos<0)continue;
    const key=noComment.slice(0,pos).trim().toLowerCase();
    const value=noComment.slice(pos+1).trim();
    if(key==="user-agent"){
      if(!group||sawDirective){
        group={agents:[],rules:[]};groups.push(group);sawDirective=false;
      }
      group.agents.push(value.toLowerCase());
    }else if(key==="allow"||key==="disallow"){
      sawDirective=true;
      if(group&&value)group.rules.push({type:key,path:value});
    }else if(key==="sitemap"){
      // Sitemap does not terminate a group.
    }else if(group){
      sawDirective=true;
    }
  }
  const common=groups.filter(g=>g.agents.includes("*"));
  if(!common.length)return null;
  return common.flatMap(g=>g.rules);
}

export function googleRobotsAdmission(text,rawUrl){
  let u;
  try{
    u=new URL(rawUrl);
  }catch{return {allowed:false,reason:"INVALID_URL"};}
  if(u.origin!==GOOGLE_ORIGIN||u.username||u.password)
    return {allowed:false,reason:"NON_GOOGLE_ORIGIN"};
  const rules=parseGoogleRobotsCommonRules(text);
  if(!rules)return {allowed:false,reason:"ROBOTS_NOT_ATTESTED"};
  const path=u.pathname+u.search;
  const matches=rules.filter(r=>rulePattern(r.path)?.test(path))
    .map(r=>({...r,specificity:r.path.replace(/[*$]/g,"").length}));
  matches.sort((a,b)=>b.specificity-a.specificity||
    Number(b.type==="allow")-Number(a.type==="allow"));
  const match=matches[0]||null;
  return {
    allowed:match?match.type==="allow":true,
    reason:!match?"NO_MATCHING_DISALLOW":
      match.type==="allow"?"ROBOTS_EXPLICIT_ALLOW":"ROBOTS_DISALLOW",
    matchedRule:match?{type:match.type,path:match.path}:null,
  };
}

export function evaluateGoogleShoppingDirectPaths(robotsText,query) {
  const candidates=googleShoppingDirectCandidates(query);
  const evaluated=candidates.map(c=>({
    kind:c.kind,searchQuery:true,
    url:c.url,
    admission:googleRobotsAdmission(robotsText,c.url),
  }));
  const admitted=evaluated.filter(c=>c.admission.allowed);
  return Object.freeze({
    status:!candidates.length?"INVALID_QUERY":
      !parseGoogleRobotsCommonRules(robotsText)?"ROBOTS_UNAVAILABLE":
      admitted.length?"SEARCH_PATH_ADMITTED":"DIRECT_SEARCH_ROBOTS_BLOCKED",
    allowedSearchPaths:admitted.length,
    totalSearchPaths:evaluated.length,
    paths:evaluated,
    publishableProducts:0,
    verifiedPrices:0,
  });
}

export const GOOGLE_ALLOWED_NON_SEARCH_LANDING=
  GOOGLE_ORIGIN+"/shopping?udm=28";
