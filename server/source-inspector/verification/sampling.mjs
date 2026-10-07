export function nextSampleSize({tested=0,consistent=true}={}){if(tested<5)return 5;if(consistent&&tested>=10)return null;if(tested<10)return 10;if(tested<20)return 20;if(tested<50)return 50;return consistent?null:100;}
export function samplingDecision(input={}){const next=nextSampleSize(input);return {complete:next==null,nextSampleSize:next};}
