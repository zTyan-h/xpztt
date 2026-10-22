// Constructor — protocolo Habblet observado; recursos pendentes não são habilitados.
(function () {
  'use strict';
  const ctx=window._constructor;
  if(!ctx?.current())return;
  const OP=Object.freeze({ROOM_RESET:758,OBJECTS:1778,UPDATE:3776,STATE_UPDATE:2547,USE:99,ROTATE:248,CHAT:1314,INV_REQ:3150,INV_RES:994,PLACE:1258,WALL:1258,CONFIRM:1534,BUY:3492,CATALOG_INDEX:1032,CATALOG_PAGE:804,CATALOG_REQ:412,INV_REMOVE:159});
  const command=(C,text)=>C.encode(OP.CHAT,[['s',text],['i',52]]);
  const placementState=(C,p)=>{
    if(p.extraData==null||String(p.extraData).trim()==='')return undefined;
    try{return String(C.int(p.extraData,0));}
    catch{throw Error(`O estado do móvel ${p.spriteId} não pode ser aplicado no Habblet.`);}
  };
  ctx.protocols.habblet=Object.freeze({
    opcodes:OP,
    capabilities:Object.freeze({inventory:true,catalog:true,buy:true,build:true,capture:true,configuration:true,colors:false}),
    configurationMinDelay:0,
    stopOnUnconfirmedConfiguration:true,
    groupBuildHeights:true,
    prepareBuildPlan:(C,plan)=>{
      const ordered=[],group=[];
      const flush=()=>{group.sort((a,b)=>a.height-b.height);ordered.push(...group);group.length=0;};
      for(const item of plan){
        // Altura automática pode depender do móvel anterior; mantém essa barreira.
        if(item.wall||item.height==null){flush();ordered.push(item);}
        else group.push({...item,height:C.number(item.height,-1000,1000),releaseHeight:false});
      }
      flush();return ordered;
    },
    // As amostras conferem com estes formatos de leitura compartilhados.
    readInventory:(C,buffer)=>C.readInventory(buffer),
    readRoom:(C,buffer)=>{
      try{return C.readRoom(buffer);}
      catch{return C.readRoom(buffer,{highScoreHeaders:true});} // Placar com título/limite/rótulos observado no 1778.
    },
    readFloorConfirmation:(C,buffer)=>C.readFloorConfirmation(buffer),
    // 3776 inclui o objeto completo; não usa o formato de UPDATE do Habblive.
    readUpdates:(C,buffer)=>[C.readFloorConfirmation(buffer)],
    readStateUpdate:(C,buffer)=>{
      const r=new C.Reader(buffer,6),roomId=C.int(r.str(),1),data=r.stuff();
      if(r.p!==r.v.byteLength)throw Error('Atualização de estado do Habblet inválida.');
      return {roomId,...data};
    },
    readCatalogPage:(C,buffer)=>C.readCatalogPage(buffer,{extras:['','0']}),
    inventoryRequest:C=>C.encode(OP.INV_REQ),
    // O protocolo continua sendo o de chat; não há eventos de digitação.
    buildSetting:(C,buffer)=>{
      if(new DataView(buffer).getUint16(4)!==OP.CHAT)return null;
      const match=/^:(up)(?:\s+(.+))?$/i.exec(new C.Reader(buffer,6).str().trim());
      return match?{mode:match[1].toLowerCase(),value:match[2]??''}:null;
    },
    startBuild:C=>[command(C,':up')],
    height:(C,value)=>command(C,value===null?':up':`:up ${C.number(value,-1000,1000)}`),
    expectedState:placementState,
    preparePlacement:(C,p)=>{
      placementState(C,p);C.int(p.rot??0,0,7);
      return [];
    },
    resetBuild:(C,settings)=>!settings||settings.has('up')&&settings.get('up')!==''?[command(C,':up')]:[],
    use:(C,item)=>C.encode(OP.USE,[['i',item.roomId],['i',0]]),
    rotate:(C,item)=>C.encode(OP.ROTATE,[['i',item.roomId],['i',C.int(item.x,-10000,10000)],['i',C.int(item.y,-10000,10000)],['i',C.int(item.expectedRotation,0,7)]]),
    placeFloor:(C,p)=>C.encode(OP.PLACE,[['s',`${p.itemId} ${p.x} ${p.y} ${p.rot??0}`]]),
    // Diferente do Habblive: ID e posição ficam na mesma string.
    placeWall:(C,p)=>C.encode(OP.WALL,[['s',`${p.itemId} :w=${p.wx},${p.wy} l=${p.lx},${p.ly} ${p.dir} `]]),
    buy:(C,offer,pageId,quantity)=>C.encode(OP.BUY,[['i',offer.pageId??pageId],['i',offer.offerId],['s',''],['i',quantity]]),
    catalogRequest:(C,opcode,pageId,request={})=>C.encode(OP.CATALOG_REQ,[['i',pageId],['i',request.offerId??-1],['s',request.type??'NORMAL']])
  });
  ctx.parts.add('protocol-habblet.js');
})();
