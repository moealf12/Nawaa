// Evidence contract shared by crawler ingestion and legacy persistence.
// A database write does not constitute a merchant price observation.
const OBSERVED_AT_PATTERN=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

export function validatedObservedAt(value,{now=Date.now()}={}){
  const raw=value instanceof Date ? value.toISOString() : value;
  if(typeof raw!=='string'||!OBSERVED_AT_PATTERN.test(raw))throw new Error('invalid_observed_at');
  const millis=Date.parse(raw);
  if(!Number.isFinite(millis)||millis>now)throw new Error('invalid_observed_at');
  return new Date(millis);
}

export function validatedPriceEvidence(offer,{now=Date.now()}={}){
  const value=Number(offer?.productPrice);
  const currency=String(offer?.currency||'').trim().toUpperCase();
  if(!Number.isFinite(value)||value<=0||!/^[A-Z]{3}$/.test(currency))throw new Error('invalid_price_evidence');
  const observation=validatedObservedAt(offer?.observedAt,{now});
  const original=offer?.originalCurrency;
  if(original!==undefined&&original!==null&&original!==''){
    const sourceCurrency=String(original).trim().toUpperCase();
    if(!/^[A-Z]{3}$/.test(sourceCurrency))throw new Error('invalid_price_evidence');
    if(sourceCurrency!==currency){
      const amount=offer?.originalProductPrice;
      const fx=offer?.fx;
      if(currency!=='SAR'||typeof amount!=='number'||!Number.isFinite(amount)||amount<=0||
        typeof fx?.rate!=='number'||!Number.isFinite(fx.rate)||fx.rate<=0||
        typeof fx?.source!=='string'||!fx.source.trim()||
        typeof fx?.observedAt!=='string'||!OBSERVED_AT_PATTERN.test(fx.observedAt)||
        !Number.isFinite(Date.parse(fx.observedAt))||Date.parse(fx.observedAt)>now)
        throw new Error('invalid_price_evidence');
      // The existing converter uses originalCurrency -> SAR with two-decimal rounding.
      // FX quote recency cannot refresh a separate merchant observation.
      const converted=Math.round(amount*fx.rate*100)/100;
      if(!Number.isFinite(converted)||Math.abs(converted-value)>0.011)
        throw new Error('invalid_price_evidence');
    }
  }
  return {observedAt:observation,currency,price:value};
}
