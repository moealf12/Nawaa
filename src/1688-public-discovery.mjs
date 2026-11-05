// 1688 staged public-page diagnostics. Never publishes merchant offers.
// Fail closed when robots rules are unavailable or ambiguous.
const ROBOT = "NAWAA-PublicSourceIndexer";
function regexForRobots(pattern) {
  const end = pattern.endsWith("$");
  const value = end ? pattern.slice(0, -1) : pattern;
  const escaped = value.split("*").map(t => t.replace(/[|\\{}()[\]^$+?.]/g, "\\$&")).join(".*");
  return new RegExp("^" + escaped + (end ? "$" : ""));
}
export function robotsDecision(rawText, rawUrl, agent = ROBOT) {
  if (typeof rawText !== "string" || rawText.length > 250_000) return {allowed:false,reason:"ROBOTS_UNAVAILABLE"};
  let pathname;
  try { const u = new URL(rawUrl); pathname = u.pathname + u.search; }
  catch { return {allowed:false,reason:"INVALID_SEARCH_URL"}; }
  const groups = [];
  let group = null, directivesStarted = false;
  for (const line of rawText.split(/\r?\n/)) {
    const parsed = line.split("#")[0].trim();
    if (!parsed) continue;
    const k = parsed.indexOf(":");
    if (k < 0) continue;
    const key = parsed.slice(0,k).trim().toLowerCase();
    const value = parsed.slice(k+1).trim();
    if (key === "user-agent") {
      if (!group || directivesStarted) {
        group = {agents:[],rules:[]}; groups.push(group); directivesStarted = false;
      }
      group.agents.push(value.toLowerCase());
    } else if (key === "allow" || key === "disallow") {
      if (!group) continue;
      directivesStarted = true;
      if (value) group.rules.push({type:key,path:value});
    } else if (group && key !== "sitemap") {
      directivesStarted = true;
    }
  }
  const a = agent.toLowerCase();
  const candidates = groups.flatMap(group => group.agents
    .filter(ua=>ua === "*" || (ua && a.includes(ua)))
    .map(ua=>({rank:ua === "*" ? 0 : ua.length, rules:group.rules})));
  if (!candidates.length) return {allowed:true,reason:"NO_MATCHING_DISALLOW"};
  const max = Math.max(...candidates.map(x=>x.rank));
  const selected = candidates.filter(x=>x.rank===max).flatMap(x=>x.rules);
  const matched = selected.filter(x => {
    try {return regexForRobots(x.path).test(pathname);}
    catch{return false;}
  }).sort((a,b)=>b.path.replace(/\*/g,"").length-a.path.replace(/\*/g,"").length ||
    Number(b.type==="allow")-Number(a.type==="allow"));
  const winner = matched[0];
  return winner ? {allowed:winner.type==="allow",reason:winner.type==="allow"?"ROBOTS_ALLOWED":"ROBOTS_DISALLOWED",rule:winner.path}
    : {allowed:true,reason:"NO_MATCHING_DISALLOW"};
}
export function inspect1688Html(html,{status,contentType,finalUrl,query}={}) {
  const s = String(html || "");
  const snippet = s.slice(0,1_048_576);
  const block = /captcha|verify your identity|security verification|访问异常|请登录|登录后|人机验证|安全验证|访问受限|拦截|请完成验证/i.test(snippet);
  const links = [...snippet.matchAll(/(?:https?:\\\/\\\/)?detail\.1688\.com\\\/offer\\\/(\d{6,20})\.html/g)]
    .map(x=>x[1]);
  const productIds = [...new Set(links)];
  const hasHtml = /^\s*(?:text\/html|application\/xhtml\+xml)/i.test(contentType||"");
  return {
    status, finalHost:(()=>{try{return new URL(finalUrl).hostname;}catch{return null;}})(),
    contentType:contentType||null, bytes:Buffer.byteLength(s),
    blockedReason:status===403?"HTTP_403_ACCESS_DENIED":status===429?"HTTP_429_RATE_LIMITED":
      status>=500?"HTTP_5XX_SOURCE_FAILURE":block?"CHALLENGE_OR_LOGIN_SHELL":null,
    candidateProductIdCount:productIds.length,
    priceVerifiedCount:0, itemPublishedCount:0, query:String(query||"").slice(0,100),
    state:status !== 200 ? "HTTP_NOT_OK" : block ? "ACCESS_OR_LOGIN_SHELL" :
      !hasHtml ? "UNEXPECTED_CONTENT_TYPE" :
      productIds.length ? "UNPRICED_PRODUCT_LINKS_OBSERVED" : "HTML_NO_PRODUCT_EVIDENCE",
  };
}
