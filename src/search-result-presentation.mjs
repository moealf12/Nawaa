// Shared R04 customer presentation partition. Both the browser and the
// production audit MUST use this same function: a strict primary match can be
// absent while alternatives and accessories remain visible. This computes
// presentation ONLY; it never changes a merchant offer, source identity, price,
// freshness, admission, or search response.
import {parseSearchIntent,categoryLabel} from "./search-query.mjs";
import {buildDiscoverySections} from "./search-core.mjs";
import {buildIntentAwareResultLanes} from "./search-result-intelligence.mjs";

export function buildSearchPresentationSections(query,groups=[],{
  classificationQuery=query,
}={}){
  const intent=parseSearchIntent(query);
  const classified=buildIntentAwareResultLanes(classificationQuery,groups);
  const directGroups=classified.primaryGroups.filter(group=>
    group.bestOffer?.condition===(intent.condition||"new"));
  const discoverySections=buildDiscoverySections(query,directGroups);

  // Preserve exact title-evidenced principal products when a generic
  // accessory/category regex disagrees with the actual sold subject.
  // Never promote a separate accessory to the principal lane.
  if(intent.category){
    const allocated=new Set(discoverySections.flatMap(section=>section.groups).map(g=>g.key));
    const disputed=directGroups.filter(group=>!allocated.has(group.key)&&
      group.bestOffer?.exactMatch===true&&
      (group.bestOffer?.matchConfidence||0)>=0.9);
    if(disputed.length){
      let primarySection=discoverySections.find(section=>section.key===intent.category);
      if(!primarySection){
        primarySection={key:intent.category,label:categoryLabel(intent.category),groups:[]};
        discoverySections.push(primarySection);
      }
      const allowed=new Set([...primarySection.groups,...disputed].map(g=>g.key));
      primarySection.groups=directGroups.filter(g=>allowed.has(g.key));
    }
  }

  const exactGroups=discoverySections.flatMap(section=>section.groups);
  const selectorGroupKeys=new Set(exactGroups.map(group=>group.key));
  const primarySet=new Set(classified.primaryGroups);
  const unplacedDirect=groups.filter(group=>
    primarySet.has(group)&&!selectorGroupKeys.has(group.key));
  const secondarySections=classified.secondarySections
    .map(section=>({...section,groups:[...section.groups]}));
  if(unplacedDirect.length){
    const alternatives=secondarySections.find(section=>section.key==="alternative");
    if(alternatives)alternatives.groups.push(...unplacedDirect);
    else secondarySections.unshift({
      key:"alternative",label:"منتجات مشابهة وبدائل",groups:unplacedDirect,
    });
  }
  const relatedGroups=secondarySections.flatMap(section=>section.groups);
  return {intent,classified,discoverySections,exactGroups,secondarySections,
    relatedGroups,unplacedDirect,
    inputGroups:groups.length,
    partitionedGroups:exactGroups.length+relatedGroups.length};
}
