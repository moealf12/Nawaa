// Reserve finalization budget without removing any planned Amazon pages.
// Missing or late source pages remain partial evidence, never out-of-stock.
export function amazonBatchBudgetWithinRequest(requestDeadlineMs,{
  reserveMs=3000,hardMaxMs=10000,
}={}){
  const total=Number(requestDeadlineMs),reserve=Number(reserveMs),cap=Number(hardMaxMs);
  if(!Number.isFinite(total)||total<=0||!Number.isFinite(reserve)||reserve<0||
     !Number.isFinite(cap)||cap<50)throw Error("INVALID_AMAZON_REQUEST_BUDGET");
  return Math.max(50,Math.min(Math.floor(cap),Math.floor(total-reserve)));
}
