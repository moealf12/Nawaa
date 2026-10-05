export function selectSearchStreamResult(latestSnapshot,latestWithOffers){
  if(!latestWithOffers)return latestSnapshot||null;
  if(!latestSnapshot)return latestWithOffers;
  return {...latestSnapshot,offers:latestWithOffers.offers};
}
