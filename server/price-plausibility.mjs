// Conservative confidence gate for unmistakably high-value *new devices*.
// Never infer a selling price; uncertain offers must be re-verified at the PDP.
const ACCESSORY=/\b(?:case|cover|screen\s*protector|film|protector|cable|charger|charging|adapter|strap|skin|holder|stand|mount|sleeve|replacement|accessory|compatible)\b/i;

export function pricePlausibility(title, priceSAR) {
  const titleText=String(title||"");
  const price=Number(priceSAR);
  if(!Number.isFinite(price) || price<=0) return {ok:false,reason:"invalid_price"};
  if(ACCESSORY.test(titleText)) return {ok:true,reason:null};
  const ranges=[
    [/\bairpods\s+max\b/i,250],
    [/\bapple\s+airpods\b/i,25],
    [/\b(?:iphone\s+(?:1[1-9]|2\d)|galaxy\s+s(?:2[1-9]|3\d))\b/i,350],
    [/\b(?:macbook|laptop|notebook|omnibook)\b/i,160],
    [/\b(?:playstation\s*5|ps5\s*console)\b/i,250],
  ];
  const rule=ranges.find(([pattern])=>pattern.test(titleText));
  if(rule && price<rule[1]) return {ok:false,reason:"implausibly_low_high_value_device",minimumSar:rule[1]};
  return {ok:true,reason:null};
}
