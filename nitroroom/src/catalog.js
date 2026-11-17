export function searchCatalog(entries,{query='',type='',view='',available=false,favorites=[],recent=[]}={}) {
  const term=query.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const favoriteSet=new Set(favorites),recentSet=new Set(recent);
  let found=entries.filter(entry=>(!available||entry.available)&&(!type||entry.type===type)&&
    (view!=='wired'||entry.wired)&&(view!=='colorable'||entry.colorable)&&
    (view!=='favorites'||favoriteSet.has(entry.key))&&(view!=='recent'||recentSet.has(entry.key))&&
    (!term||(entry.searchText??`${entry.name} ${entry.description} ${entry.classname} ${entry.typeId}`.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()).includes(term)));
  if(view==='recent'){const order=new Map(recent.map((key,index)=>[key,index]));found=found.sort((a,b)=>order.get(a.key)-order.get(b.key));}
  return found;
}
