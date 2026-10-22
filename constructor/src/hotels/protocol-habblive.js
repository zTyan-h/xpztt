// Constructor — protocolo e comandos exclusivos do Habblive.
(function () {
  'use strict';
  const ctx=window._constructor;
  if(!ctx?.current())return;
  const OP=Object.freeze({OBJECTS:3893,BUY:3655,PLACE:2761,WALL:150,INV_REQ:25,INV_RES:623,CONFIRM:1362,UPDATE:2178,ERROR:1162,CHAT:1678,USE:1755,COLOR:6008});
  ctx.protocols.habblive=Object.freeze({
    opcodes:OP,
    capabilities:Object.freeze({inventory:true,catalog:true,buy:true,build:true,capture:true,configuration:true,colors:true}),
    readInventory:(C,buffer)=>C.readInventory(buffer),
    readFloorConfirmation:(C,buffer)=>C.readFloorConfirmation(buffer),
    readRoom:(C,buffer)=>C.readRoom(buffer),
    readUpdates:(C,buffer)=>C.readUpdates(buffer),
    readCatalogPage:(C,buffer)=>C.readCatalogPage(buffer),
    inventoryRequest:C=>C.encode(OP.INV_REQ),
    placeFloor:(C,p)=>C.encode(OP.PLACE,[['s',`${p.itemId} ${p.x} ${p.y} ${p.rot??0}`]]),
    placeWall:(C,p)=>C.encode(OP.WALL,[['i',p.itemId],['s',`:w=${p.wx},${p.wy} l=${p.lx},${p.ly} ${p.dir}`]]),
    height:(C,value)=>C.encode(OP.CHAT,[['s',value===null?':setz off':`:setz ${Number(value).toFixed(4)}`],['i',0]]),
    use:(C,item)=>C.encode(OP.USE,[['i',item.roomId],['i',0]]),
    color:(C,item)=>C.encode(OP.COLOR,[['i',item.roomId],['i',2],['s',item.color1],['s',item.color2],['i',0]]),
    buy:(C,offer,pageId,quantity)=>C.encode(OP.BUY,[['i',offer.pageId??pageId],['i',offer.offerId],['s',''],['i',quantity]]),
    catalogRequest:(C,opcode,pageId,request={})=>C.encode(opcode,[['i',pageId],['i',request.offerId??-1],['s',request.type??'NORMAL']])
  });
  ctx.parts.add('protocol-habblive.js');
})();
