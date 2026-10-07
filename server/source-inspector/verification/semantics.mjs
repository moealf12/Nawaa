const INSTALLMENT=/(?:\bper\s*month\b|\/\s*month\b|\bmonthly\b|\binstallments?\b|قسط|شهري)/i;
const STARTING=/\b(?:starting\s*(?:at|from)|from)\b|ابتداء(?:ً|ا)?\s*من/i;
const MEMBER=/\bmember|members?|عضو|أعضاء/i;
const TRADE=/trade[- ]?in|استبدال/i;
export function classifyPrice({label="",text=""}={}){const s=`${label} ${text}`;if(INSTALLMENT.test(s))return "installment";if(TRADE.test(s))return "trade-in";if(MEMBER.test(s))return "member";if(STARTING.test(s))return "starting-from";if(/sale|discount|offer|خصم|عرض/i.test(s))return "sale";return "regular";}
export function validateSemanticPrice(input={}){const model=classifyPrice(input);return {model,validProductPrice:!["installment","trade-in"].includes(model)};}
