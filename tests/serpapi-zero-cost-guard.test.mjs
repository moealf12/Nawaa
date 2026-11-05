import test from "node:test";
import assert from "node:assert/strict";
import {
  certifySerpApiZeroPaidAccount,
  checkSerpApiFreeAccount,
} from "../server/serpapi-free-plan-guard.mjs";
import {createGoogleShoppingResultsClient} from "../server/google-shopping-results.mjs";

const free={
  account_status:"Active",plan_id:"free",plan_name:"Free Plan",
  plan_monthly_price:0,searches_per_month:250,
  account_rate_limit_per_hour:50,
  plan_searches_left:210,this_hour_searches:15,
};

test("zero cost: only positively attested $0 Free plan can acquire results",()=>{
  assert.equal(certifySerpApiZeroPaidAccount(free).allowed,true);
  for(const bad of [
    {...free,plan_id:"starter",plan_name:"Starter",plan_monthly_price:25},
    {...free,plan_id:"free",plan_name:"Free Plan",plan_monthly_price:1},
    {...free,plan_id:"developer",plan_name:"Developer Plan",plan_monthly_price:0},
    {...free,plan_id:"free",plan_name:"Free Plan",plan_monthly_price:null},
    {...free,searches_per_month:1000},
    {...free,account_rate_limit_per_hour:200},
    {...free,plan_searches_left:null},
    {...free,this_hour_searches:null},
    null,
  ])assert.equal(certifySerpApiZeroPaidAccount(bad).allowed,false,
    String(bad?.plan_name||"invalid"));
});

test("zero cost: reserves at least 50 monthly and 10 hourly searches on the Free plan",()=>{
  assert.equal(certifySerpApiZeroPaidAccount({...free,plan_searches_left:50}).allowed,false);
  assert.equal(certifySerpApiZeroPaidAccount({...free,plan_searches_left:51}).allowed,true);
  assert.equal(certifySerpApiZeroPaidAccount({...free,this_hour_searches:40}).allowed,false);
  assert.equal(certifySerpApiZeroPaidAccount({...free,this_hour_searches:39}).allowed,true);
});

test("zero cost: live Account API is free and no private account response is returned",async()=>{
  let requests=0;
  const result=await checkSerpApiFreeAccount({
    apiKey:"test_private_key_do_not_store_456",
    fetchImpl:async(url,opts)=>{
      requests++;
      const u=new URL(url);
      assert.equal(u.origin,"https://serpapi.com");
      assert.equal(u.pathname,"/account.json");
      assert.equal(u.searchParams.get("api_key"),"test_private_key_do_not_store_456");
      assert.equal(opts.redirect,"error");
      return new Response(JSON.stringify({...free,account_email:"secret@example.com",
        api_key:"test_private_key_do_not_store_456"}),{
        headers:{"content-type":"application/json"}});
    }
  });
  assert.equal(requests,1);
  assert.deepEqual(result,{allowed:true,reason:"FREE_ACCOUNT_WITH_RESERVED_QUOTA"});
  assert.doesNotMatch(JSON.stringify(result),/secret@|test_private_key/);
});

test("zero cost: account endpoint failure, invalid JSON and too-large responses deny upstream",async()=>{
  for(const fail of [
    ()=>new Response("too many",{status:429,headers:{"content-type":"application/json"}}),
    ()=>new Response("{}",{headers:{"content-type":"text/html"}}),
    ()=>new Response("garbage",{headers:{"content-type":"application/json"}}),
    ()=>new Response("x".repeat(16500),{headers:{"content-type":"application/json"}}),
  ]){
    const r=await checkSerpApiFreeAccount({
      apiKey:"test_private_key_do_not_store_456",
      fetchImpl:async()=>fail(),
    });
    assert.equal(r.allowed,false);
  }
});

test("zero cost: paid or ambiguous account means ZERO Shopping search requests",async()=>{
  let accountCalls=0,shoppingCalls=0;
  const c=createGoogleShoppingResultsClient({
    enabled:true,
    apiKey:"test_private_key_do_not_store_456",
    freeAccountCheck:async()=>{
      accountCalls++;
      return {allowed:false,reason:"NOT_VERIFIED_ZERO_DOLLAR_FREE_PLAN"};
    },
    fetchImpl:async()=>{shoppingCalls++;throw Error("SPEND_BLOCKED");}
  });
  const r=await c.run("iPhone 17 Pro");
  assert.equal(r.status,503);
  assert.equal(r.body.error,"GOOGLE_SHOPPING_ZERO_COST_GUARD");
  assert.equal(accountCalls,1);
  assert.equal(shoppingCalls,0);
  assert.equal(c.status().calls,0);
});

test("zero cost: verifier crashes are denied without upstream Shopping request",async()=>{
  let calls=0;
  const c=createGoogleShoppingResultsClient({
    enabled:true,
    apiKey:"test_private_key_do_not_store_456",
    freeAccountCheck:async()=>{throw Error("ACCOUNT_UNAVAILABLE");},
    fetchImpl:async()=>{calls++;throw Error("SHOULD_NOT_FETCH");}
  });
  const r=await c.run("Galaxy S26");
  assert.equal(r.status,503);
  assert.equal(calls,0);
  assert.equal(r.body.reason,"ACCOUNT_VERIFICATION_UNAVAILABLE");
});
