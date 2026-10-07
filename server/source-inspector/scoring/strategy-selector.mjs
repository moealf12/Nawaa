import { rankStrategies } from "./extraction-score.mjs";
export function selectExtractionStrategies(candidates=[]){const ranked=rankStrategies(candidates.filter(x=>x?.available!==false));return {ranked,primary:ranked[0]?{id:ranked[0].id,score:ranked[0].score}:null,fallback:ranked[1]?{id:ranked[1].id,score:ranked[1].score}:null};}
