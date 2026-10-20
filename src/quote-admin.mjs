// Disposable-only quotation administration UI. Authorization is enforced by the server.
// No token is embedded in source, stored in browser storage or included in URLs.
const $ = (id) => document.getElementById(id);
const state = {token:"",rows:[],selected:null,nextCursor:null,cursor:null,page:1,busy:false};
const words = {requested:"بانتظار التسعير",quoted:"تم التسعير",expired:"انتهت الصلاحية",
  accepted:"مقبول",declined:"مرفوض"};
function message(value,kind="info"){
  const node=$("adminMessage");
  node.textContent=value;
  node.className="notice"+(kind==="error"?" error":kind==="success"?" success":"");
}
function label(value){return value===null||value===undefined||value===""?"غير محدد":String(value)}
function el(tag,text,className){
  const node=document.createElement(tag);
  if(text!==undefined)node.textContent=String(text);
  if(className)node.className=className;
  return node;
}
function authLost(){
  state.token="";state.rows=[];state.selected=null;
  $("adminWorkspace").classList.add("hidden");
  $("adminLogout").classList.add("hidden");
  $("adminToken").value="";
  $("adminToken").focus();
  message("انتهت صلاحية جلسة الإدارة أو رمز الدخول غير صحيح.","error");
}
async function request(path,opts={}){
  if(!state.token)throw Error("unauthorized");
  let response;
  try{
    response=await fetch(path,{...opts,headers:{authorization:"Bearer "+state.token,
      ...(opts.body?{"content-type":"application/json"}:{})},cache:"no-store"});
  }catch{throw Error("network_failure")}
  if(response.status===401||response.status===403){authLost();throw Error("unauthorized")}
  let result;
  try{result=await response.json()}catch{throw Error("invalid_response")}
  if(!response.ok)throw Error(String(result.error||"request_failed"));
  return result;
}
function showEvidence(row){
  state.selected=row;
  $("adminEmpty").classList.add("hidden");
  $("adminDetails").classList.remove("hidden");
  const evidence=$("adminEvidence");evidence.replaceChildren();
  const info=[
    ["رقم الطلب",row.id],["المنتج",row.request?.productName],
    ["الموديل",row.request?.model],["المصدر",row.request?.sourceUrl],
    ["الحالة",words[row.status]||row.status],["إصدار العرض",row.revision],
    ["السعر الحالي",row.priceSAR===null?"لم يسعر بعد":row.priceSAR+" ر.س"],
    ["التوصيل",row.etaDays===null?"غير محدد":row.etaDays+" يوم"],
    ["انتهاء العرض",row.validUntil?new Date(row.validUntil).toLocaleString("ar-SA"):"غير محدد"],
    ["تاريخ الطلب",row.createdAt?new Date(row.createdAt).toLocaleString("ar-SA"):"غير محدد"]
  ];
  for(const [name,value] of info){
    evidence.append(el("dt",name),el("dd",label(value)));
  }
  $("adminPrice").value=row.priceSAR===null?"":String(row.priceSAR);
  $("adminEta").value=row.etaDays===null?"5":String(row.etaDays);
  $("adminTerms").value=row.terms||"";
  const terminal=["accepted","declined"].includes(row.status);
  for(const input of $("adminQuoteForm").querySelectorAll("input,textarea,select,button")){
    input.disabled=terminal;
  }
  $("adminPublish").textContent=terminal?"تم إنهاء الطلب":"حفظ وإرسال التسعيرة";
  renderRows();
}
function renderRows(){
  const list=$("adminRequests");list.replaceChildren();
  for(const row of state.rows){
    const button=el("button",undefined,"request");
    button.type="button";
    button.dataset.requestId=row.id;
    button.setAttribute("aria-pressed",String(state.selected?.id===row.id));
    button.append(el("strong",label(row.request?.productName)));
    button.append(el("small",label(row.request?.model)+" • "+label(row.createdAt)));
    button.append(el("span",words[row.status]||row.status,"status"));
    button.addEventListener("click",()=>showEvidence(row));
    list.append(button);
  }
  if(!state.rows.length)list.append(el("p","لا توجد طلبات مطابقة في هذه الصفحة.","muted"));
  $("adminOlder").disabled=!state.nextCursor;
  $("adminPageLabel").textContent="صفحة "+state.page+" — "+state.rows.length+" طلب";
}
async function loadRequests(){
  if(state.busy||!state.token)return;
  state.busy=true;$("adminRefresh").disabled=true;$("adminOlder").disabled=true;
  message("يجري استرجاع الطلبات من قاعدة البيانات...");
  try{
    const params=new URLSearchParams({limit:"15",status:$("adminStatus").value});
    if(state.cursor)params.set("cursor",state.cursor);
    const result=await request("/api/quote-admin/requests?"+params.toString());
    if(!Array.isArray(result.requests))throw Error("invalid_response");
    state.rows=result.requests;
    state.nextCursor=result.nextCursor||null;
    $("adminWorkspace").classList.remove("hidden");
    $("adminLogout").classList.remove("hidden");
    const selected=state.rows.find(row=>row.id===state.selected?.id);
    if(selected)showEvidence(selected);
    else{state.selected=null;$("adminDetails").classList.add("hidden");$("adminEmpty").classList.remove("hidden")}
    renderRows();
    message("تم تحديث الطلبات من الخدمة الفعلية.","success");
  }catch(error){
    if(error.message!=="unauthorized")message("تعذر تحميل الطلبات: "+error.message,"error");
  }finally{state.busy=false;$("adminRefresh").disabled=false;
    $("adminOlder").disabled=!state.nextCursor}
}
$("adminLoginForm").addEventListener("submit",async(event)=>{
  event.preventDefault();
  const token=$("adminToken").value.trim();
  if(token.length<32){message("رمز الإدارة غير صالح.","error");return}
  state.token=token;$("adminToken").value="";
  state.cursor=null;state.page=1;await loadRequests();
});
$("adminLogout").addEventListener("click",()=>{
  state.token="";state.rows=[];state.selected=null;state.cursor=null;state.nextCursor=null;
  $("adminWorkspace").classList.add("hidden");$("adminLogout").classList.add("hidden");
  $("adminToken").value="";
  message("تم تسجيل الخروج. لم يُحفظ رمز الإدارة.");$("adminToken").focus();
});
$("adminRefresh").addEventListener("click",()=>{state.cursor=null;state.page=1;loadRequests()});
$("adminStatus").addEventListener("change",()=>{state.cursor=null;state.page=1;loadRequests()});
$("adminOlder").addEventListener("click",()=>{
  if(!state.nextCursor)return;
  state.cursor=state.nextCursor;state.page+=1;loadRequests();
});
$("adminQuoteForm").addEventListener("submit",async(event)=>{
  event.preventDefault();
  if(state.busy||!state.selected||["accepted","declined"].includes(state.selected.status))return;
  const row=state.selected;
  const priceSAR=$("adminPrice").value.trim();
  const etaDays=Number($("adminEta").value);
  const terms=$("adminTerms").value.trim();
  const validForSeconds=Number($("adminExpiry").value);
  if(!/^[0-9]{1,7}(\.[0-9]{1,2})?$/.test(priceSAR)||Number(priceSAR)<=0||
    !Number.isInteger(etaDays)||etaDays<0||etaDays>90||
    terms.length===0||terms.length>1000||
    !Number.isInteger(validForSeconds)||validForSeconds<60){
    message("تحقق من السعر والمدة والشروط قبل الإرسال.","error");return;
  }
  state.busy=true;$("adminPublish").disabled=true;
  message("يجري حفظ التسعيرة بشكل ذري...");
  try{
    const result=await request("/api/quote-admin/"+encodeURIComponent(row.id)+"/quote",{
      method:"POST",body:JSON.stringify({priceSAR,etaDays,terms,validForSeconds,
        expectedRevision:row.revision})});
    $("adminStatus").value="all";state.cursor=null;state.page=1;
    state.selected=result;
    state.busy=false;
    await loadRequests();
    message("تم اعتماد تسعيرة الطلب وإتاحتها للعميل.","success");
  }catch(error){
    if(error.message!=="unauthorized")
      message(error.message==="quote_not_mutable"?"الطلب تغيّر أو انتهى. حدّث القائمة قبل التسعير.":"فشل الحفظ: "+error.message,"error");
  }finally{state.busy=false;$("adminPublish").disabled=false}
});
