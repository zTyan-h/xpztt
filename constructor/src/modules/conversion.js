// Constructor — equivalências de chão, sem alterar o protocolo conectado.
(function () {
  'use strict';
  const ctx=window._constructor;
  if(!ctx?.current())return;
  const C=ctx.Core;
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  const identity=item=>JSON.stringify(canonical(item));
  const unique=items=>[...new Map((items||[]).map(item=>[identity(item),item])).values()];
  const equivalences=new WeakMap();
  function equivalence(from,to,spriteId){
    let targets=equivalences.get(from);if(!targets){targets=new WeakMap();equivalences.set(from,targets);}
    let sprites=targets.get(to);if(!sprites){sprites=new Map();targets.set(to,sprites);}
    if(sprites.has(spriteId))return sprites.get(spriteId);
    const origin=unique(from.floor.byId.get(spriteId)),classname=origin.length===1?origin[0].classname:null;
    const candidates=classname?unique(to.floor.byClassname.get(classname)):[];
    const reason=!origin.length?'unknown':origin.length!==1?'ambiguous':!candidates.length?'missing':candidates.length!==1?'ambiguous':null;
    const target=reason?null:candidates[0],dimensions=!reason&&(origin[0].xdim!==target.xdim||origin[0].ydim!==target.ydim);
    const result={classname,reason,target,dimensions};sprites.set(spriteId,result);return result;
  }
  ctx.convertProject=async function(source,targetHotel){
    if(!Object.hasOwn(ctx.hotels,source.originHotel)||!Object.hasOwn(ctx.hotels,targetHotel)||source.originHotel===targetHotel)throw Error('Hotéis inválidos para conversão.');
    const project=C.normalizeProjects({[source.name]:source})[source.name];
    const [from,to]=await Promise.all([ctx.loadFurniture(source.originHotel),ctx.loadFurniture(targetHotel)]);
    const layout=[],pending=new Map(),warnings=new Map();
    for(const item of project.layout){
      const {classname,reason,target,dimensions}=equivalence(from,to,item.spriteId);
      if(reason){
        const key=item.spriteId+':'+reason;
        if(!pending.has(key))pending.set(key,{reason,spriteId:item.spriteId,classname,count:0});
        pending.get(key).count++;continue;
      }
      if(dimensions)warnings.set(classname,{classname,reason:'dimensions'});
      const converted={...item,spriteId:target.id};
      delete converted.limited;
      layout.push(converted);
    }
    return {layout,...(C.validCreatedAt(project.createdAt)?{createdAt:project.createdAt}:{}),conversion:{sourceHotel:source.originHotel,targetHotel,total:project.layout.length,compatible:layout.length,pending:[...pending.values()],warnings:[...warnings.values()]}};
  };
  ctx.extendRuntime(class {
    async receiveProject(source,senderUid,guard=()=>{}){
      if(typeof source?.name!=='string'||!/^[a-zA-Z0-9_-]{8,160}$/.test(source.id)||!Number.isSafeInteger(source.revision)||source.revision<1)throw Error('Identificação do projeto recebido inválida.');
      const converted=await ctx.convertProject(source,this.hotel.id);
      this.checkProjectLifecycle();guard();
      return this.projectMutation(bundle=>{
        guard();
        const copies=Object.entries(bundle.converted).filter(([,p])=>p.conversion.sourceUid===senderUid&&p.conversion.sourceId===source.id).sort((a,b)=>b[1].conversion.sourceRevision-a[1].conversion.sourceRevision);
        if(copies.some(([,p])=>p.conversion.sourceRevision>=source.revision))return false;
        const existing=copies.find(([,p])=>!p.conversion.localModified);
        let name=existing?.[0]||source.name,index=2;
        if(!existing)while(Object.hasOwn(bundle.converted,name))name=source.name.slice(0,108)+' ('+(index++)+')';
        const old=existing?.[1],id=old?.id||crypto.randomUUID();
        const valid=C.normalizeProjects({[name]:converted})[name];
        bundle.converted[name]={...valid,id,revision:(old?.revision||0)+1,originHotel:this.hotel.id,conversion:{...converted.conversion,sourceUid:senderUid,sourceId:source.id,sourceRevision:source.revision}};
        if(old&&C.validCreatedAt(old.createdAt))bundle.converted[name].createdAt=old.createdAt;
        const original=C.normalizeProjects({[source.name]:source})[source.name];
        bundle.references[id]={name:source.name,id:source.id,originHotel:source.originHotel,revision:source.revision,layout:original.layout,...(C.validCreatedAt(original.createdAt)?{createdAt:original.createdAt}:{})};
        return true;
      });
    }
  }.prototype);
  ctx.parts.add('conversion.js');
})();
