// Disposable-only quotation workflow; no production schema or route activation.
import pg from "pg";
import {randomUUID,randomBytes,createHash,timingSafeEqual} from "node:crypto";
import {jsonResponse} from "./provider-utils.mjs";
const T="nawaa_ci_quote_requests",SELECT="id,request_payload,status,quote_revision,price_halalas,eta_days,terms,valid_until,created_at,decided_at";
let pool,boot;
const hash=s=>createHash("sha256").update(s).digest("hex");
export function quoteWorkflowEnabled(){
  if(process.env.NODE_ENV!=="test"||process.env.NAWAA_QUOTE_TEST_ENABLED!=="1"||
    !process.env.NAWAA_TEST_DATABASE_URL||
    String(process.env.NAWAA_QUOTE_TEST_ADMIN_TOKEN||"").length<32)return false;
  try{const u=new URL(process.env.NAWAA_TEST_DATABASE_URL);
    return u.protocol==="postgresql:"&&u.hostname==="127.0.0.1"&&u.pathname==="/omega_ci";
  }catch{return false}
}
async function database(){
  if(!quoteWorkflowEnabled())throw Error("quote_workflow_disabled");
  pool||=new pg.Pool({connectionString:process.env.NAWAA_TEST_DATABASE_URL,ssl:false,max:4});
  boot||=pool.query("CREATE TABLE IF NOT EXISTS "+T+"("+
    "id uuid PRIMARY KEY,token_hash text NOT NULL,request_payload jsonb NOT NULL,"+
    "status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','quoted','accepted','declined')),"+
    "quote_revision integer NOT NULL DEFAULT 0 CHECK(quote_revision>=0),"+
    "price_halalas integer CHECK(price_halalas>0),"+
    "eta_days integer CHECK(eta_days>=0 AND eta_days<=90),terms text,"+
    "valid_until timestamptz,decided_at timestamptz,"+
    "created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())"
  ).catch(e=>{boot=null;throw e});
  await boot;return pool;
}
function send(res,status,data,origin){
  res.setHeader("cache-control","no-store");
  res.setHeader("x-content-type-options","nosniff");
  return jsonResponse(res,status,data,origin||"*");
}
function tokenOf(req){
  return /^Bearer ([A-Za-z0-9_-]{8,128})$/.exec(String(req.headers.authorization||""))?.[1]||"";
}
function adminAuthorized(req){
  const provided=tokenOf(req),secret=String(process.env.NAWAA_QUOTE_TEST_ADMIN_TOKEN||"");
  return Boolean(provided&&secret)&&timingSafeEqual(
    createHash("sha256").update(provided).digest(),
    createHash("sha256").update(secret).digest());
}
async function bodyOf(req){
  let n=0;const chunks=[];
  for await(const part of req){
    n+=part.length;if(n>8192){const e=Error("too_large");e.status=413;throw e}
    chunks.push(part);
  }
  try{const result=JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}");
    if(!result||typeof result!=="object"||Array.isArray(result))throw Error();
    return result;
  }catch{const e=Error("invalid_json");e.status=400;throw e}
}
function field(x,max){return typeof x==="string"&&x.trim().length<=max?x.trim():null}
function incomingRequest(x){
  const productName=field(x.productName,200);
  const model=x.model===undefined||x.model===null?null:field(x.model,120);
  const sourceUrl=x.sourceUrl===undefined||x.sourceUrl===null?null:field(x.sourceUrl,1000);
  if(!productName||productName.length<3||x.model!=null&&model===null||
    x.sourceUrl!=null&&sourceUrl===null)return null;
  if(sourceUrl){try{const u=new URL(sourceUrl);
    if(u.protocol!=="https:"||u.username||u.password)return null;
  }catch{return null}}
  return {productName,model,sourceUrl};
}
function incomingQuote(x){
  const s=String(x.priceSAR);
  if(!/^[0-9]{1,7}(\.[0-9]{1,2})?$/.test(s))return null;
  const price=Math.round(Number(s)*100),eta=x.etaDays,seconds=x.validForSeconds;
  const terms=field(x.terms,1000);
  if(price<1||price>999999999||!Number.isInteger(eta)||eta<0||eta>90||
    !Number.isInteger(seconds)||seconds<60||seconds>2592000||!terms)return null;
  return {price,eta,seconds,terms};
}
function view(row){
  const expired=row.status==="quoted"&&row.valid_until&&new Date(row.valid_until)<=new Date();
  return {id:row.id,request:row.request_payload,status:expired?"expired":row.status,
    revision:row.quote_revision,priceSAR:row.price_halalas===null?null:row.price_halalas/100,
    etaDays:row.eta_days,terms:row.terms,
    validUntil:row.valid_until?new Date(row.valid_until).toISOString():null,
    createdAt:new Date(row.created_at).toISOString(),
    decidedAt:row.decided_at?new Date(row.decided_at).toISOString():null};
}
export async function handleQuoteWorkflow(req,res,url,origin){
  if(!quoteWorkflowEnabled())return send(res,404,{error:"not_found"},origin);
  try{
    if(url.pathname==="/api/quotes"&&req.method==="POST"){
      const data=incomingRequest(await bodyOf(req));
      if(!data)return send(res,422,{error:"invalid_quote_request"},origin);
      const id=randomUUID(),token=randomBytes(32).toString("base64url");
      await (await database()).query("INSERT INTO "+T+
        "(id,token_hash,request_payload) VALUES($1,$2,$3::jsonb)",
        [id,hash(token),JSON.stringify(data)]);
      return send(res,201,{id,token,status:"requested"},origin);
    }
    if(url.pathname==="/api/quote-admin/requests"&&req.method==="GET"){
      if(!adminAuthorized(req))return send(res,401,{error:"unauthorized"},origin);
      const rows=(await (await database()).query("SELECT "+SELECT+" FROM "+T+
        " ORDER BY created_at DESC,id DESC LIMIT 50")).rows;
      return send(res,200,{requests:rows.map(view)},origin);
    }
    const admin=/^\/api\/quote-admin\/([0-9a-f-]{36})\/quote$/.exec(url.pathname);
    if(admin&&req.method==="POST"){
      if(!adminAuthorized(req))return send(res,401,{error:"unauthorized"},origin);
      const x=incomingQuote(await bodyOf(req));
      if(!x)return send(res,422,{error:"invalid_quote"},origin);
      const rows=(await (await database()).query("UPDATE "+T+
        " SET status='quoted',quote_revision=quote_revision+1,price_halalas=$2,"+
        "eta_days=$3,terms=$4,valid_until=now()+($5 * interval '1 second'),"+
        "updated_at=now(),decided_at=null WHERE id=$1 AND status IN ('requested','quoted')"+
        " RETURNING "+SELECT,[admin[1],x.price,x.eta,x.terms,x.seconds])).rows;
      return rows.length?send(res,200,view(rows[0]),origin):
        send(res,409,{error:"quote_not_mutable"},origin);
    }
    const customer=/^\/api\/quotes\/([0-9a-f-]{36})(\/decision)?$/.exec(url.pathname);
    if(customer&&(req.method==="GET"&&!customer[2]||
                   req.method==="POST"&&Boolean(customer[2]))){
      const token=tokenOf(req);
      if(!token)return send(res,404,{error:"not_found"},origin);
      const digest=hash(token),db=await database();
      if(req.method==="GET"){
        const rows=(await db.query("SELECT "+SELECT+" FROM "+T+
          " WHERE id=$1 AND token_hash=$2",[customer[1],digest])).rows;
        return rows.length?send(res,200,view(rows[0]),origin):
          send(res,404,{error:"not_found"},origin);
      }
      const data=await bodyOf(req);
      if(!["accepted","declined"].includes(data.decision)||
         !Number.isInteger(data.revision)||data.revision<0)
        return send(res,422,{error:"invalid_decision"},origin);
      const exists=(await db.query("SELECT id FROM "+T+
        " WHERE id=$1 AND token_hash=$2",[customer[1],digest])).rows;
      if(!exists.length)return send(res,404,{error:"not_found"},origin);
      const rows=(await db.query("UPDATE "+T+
        " SET status=$3,decided_at=now(),updated_at=now()"+
        " WHERE id=$1 AND token_hash=$2 AND status='quoted'"+
        " AND quote_revision=$4 AND valid_until>now() RETURNING "+SELECT,
        [customer[1],digest,data.decision,data.revision])).rows;
      return rows.length?send(res,200,view(rows[0]),origin):
        send(res,409,{error:"quote_expired_or_changed"},origin);
    }
    return send(res,404,{error:"not_found"},origin);
  }catch(error){
    if(error.status===413)return send(res,413,{error:"payload_too_large"},origin);
    if(error.status===400)return send(res,400,{error:"invalid_json"},origin);
    return send(res,503,{error:"quote_service_unavailable"},origin);
  }
}
