// Constructor — extraído da Oficina 1.5.1.
(function () {
  'use strict';
  const ctx = window._constructor;
  if (!ctx?.current()) return;
ctx.Core = (() => {
  'use strict';
  const OP = ctx.hotel?.protocol?.opcodes || Object.freeze({});
  const LIMIT = 5000;
  function number(v, min=-100000, max=100000, integer=false) {
    if(v===null || v==='' || typeof v==='boolean') throw Error('Preencha os números necessários.');
    const n=Number(v); if(!Number.isFinite(n)||n<min||n>max||(integer&&!Number.isInteger(n))) throw Error('Há um número fora do limite permitido.'); return n;
  }
  const int=(v,min=-2147483648,max=2147483647)=>number(v,min,max,true);
  function encode(op, fields=[]) {
    int(op,0,32767);
    const parts=fields.map(([type,v])=>{
      if(type==='s'){const b=new TextEncoder().encode(String(v));if(b.length>32767)throw Error('Texto muito longo.');return {type,b,size:b.length+2};}
      if(type!=='i'&&type!=='b')throw Error('Campo de pacote inválido.'); return {type,v:int(v,type==='b'?0:-2147483648,type==='b'?255:2147483647),size:type==='i'?4:1};
    });
    const buf=new ArrayBuffer(6+parts.reduce((n,p)=>n+p.size,0)),d=new DataView(buf);d.setInt32(0,buf.byteLength-4);d.setInt16(4,op);let at=6;
    for(const p of parts){if(p.type==='s'){d.setInt16(at,p.b.length);new Uint8Array(buf).set(p.b,at+2);}else if(p.type==='i')d.setInt32(at,p.v);else d.setUint8(at,p.v);at+=p.size;}return buf;
  }
  function decode(buffer) {
    const d=new DataView(buffer),out=[];let p=0;if(d.byteLength>16*1024*1024)throw Error('Mensagem grande demais.');
    while(p<d.byteLength){if(p+6>d.byteLength)throw Error('Pacote incompleto.');const len=d.getInt32(p);if(len<2||p+4+len>d.byteLength)throw Error('Pacote incompleto.');out.push({id:d.getUint16(p+4),buffer:buffer.slice(p,p+4+len)});p+=len+4;}return out;
  }
  class Reader {
    constructor(b,p=0){this.v=new DataView(b);this.p=p;}
    need(n){if(this.p+n>this.v.byteLength)throw Error('Dados incompletos do jogo.');}
    i32(){this.need(4);const v=this.v.getInt32(this.p);this.p+=4;return v;}
    i16(){this.need(2);const v=this.v.getInt16(this.p);this.p+=2;return v;}
    u8(){this.need(1);return this.v.getUint8(this.p++);}
    str(){const n=this.i16();if(n<0)throw Error('Texto inválido.');this.need(n);const s=new TextDecoder().decode(new Uint8Array(this.v.buffer,this.p,n));this.p+=n;return s;}
    count(max=100000){return int(this.i32(),0,max);}
    stuff({highScoreHeaders=false}={}){
      const raw=this.i32(),type=raw&255;let state='0',color1=null,color2=null;
      switch(type){
        case 0:state=this.str();break;
        case 1:for(let n=this.count();n>0;n--){this.str();this.str();}break;
        case 2:{const arr=[];for(let n=this.count();n>0;n--)arr.push(this.str());state=arr[0]??'0';if(arr.length>=5){color1=arr[3];color2=arr[4];}break;}
        case 3:state=this.str();this.i32();break;
        case 4:break;
        case 5:for(let n=this.count();n>0;n--)this.i32();break;
        case 6:state=this.str();if(highScoreHeaders){this.str();this.i32();this.str();this.str();}this.i32();this.i32();for(let n=this.count();n>0;n--){this.i32();for(let m=this.count();m>0;m--)this.str();}break;
        case 7:state=this.str();this.i32();this.i32();break;
        default:throw Error('Tipo de dados do móvel não reconhecido.');
      }
      const limited=!!(raw&256);
      if(limited){this.i32();this.i32();}return {state,color1,color2,...(limited?{limited:true}:{})};
    }
  }
  function readInventory(b){
    const r=new Reader(b,6),total=r.count(10000),index=r.i32(),count=r.count(100000);int(total,1,10000);int(index,0,total-1);const items=[];
    for(let i=0;i<count;i++){
      const itemId=r.i32(),type=r.str().toLowerCase();r.i32();const spriteId=r.i32();r.i32();const stuff=r.stuff();r.u8();r.u8();r.u8();r.u8();r.i32();r.u8();r.i32();if(type==='s'){r.str();r.i32();}
      if(itemId!==0&&spriteId>0)items.push({itemId,spriteId,type,...(stuff.limited?{limited:true}:{})});
    }return {total,index,items};
  }
  function readFloorConfirmation(b){const r=new Reader(b,6),roomId=r.i32(),spriteId=r.i32(),x=r.i32(),y=r.i32(),rot=r.i32(),z=r.str(),stack=r.str();r.i32();return {roomId,spriteId,x,y,rot,z,stack,...r.stuff()};}
  function readRoom(b,{highScoreHeaders=false}={}){
    const r=new Reader(b,6);for(let n=r.count();n>0;n--){r.i32();r.str();}const items=[];
    for(let n=r.count(LIMIT);n>0;n--){const roomId=r.i32(),spriteId=r.i32(),x=r.i32(),y=r.i32(),rot=r.i32(),z=r.str();r.str();r.i32();const stuff=r.stuff({highScoreHeaders});r.i32();r.i32();r.i32();if(spriteId>0)items.push({roomId,spriteId,x,y,z,rot,extraData:stuff.state,color1:stuff.color1,color2:stuff.color2,...(stuff.limited?{limited:true}:{})});}
    if(r.p!==r.v.byteLength)throw Error('A lista de móveis do quarto contém dados não reconhecidos.');
    const minX=items.length?Math.min(...items.map(i=>i.x)):0,minY=items.length?Math.min(...items.map(i=>i.y)):0;
    return items.map(({x,y,...i})=>({...i,x,y,relX:x-minX,relY:y-minY}));
  }
  function readUpdates(b){
    const parse=batch=>{const r=new Reader(b,6),first=r.i32(),out=[];if(batch){int(first,0,5000);for(let n=first;n>0;n--){const roomId=r.i32();out.push({roomId,...r.stuff()});}}else out.push({roomId:first,...r.stuff()});if(r.p!==r.v.byteLength)throw Error('Formato de atualização inválido.');return out;};
    try{return parse(false);}catch{return parse(true);}
  }
  function normalizeProjects(v){
    if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Os projetos salvos têm um formato inválido.');const out=Object.create(null);
    for(const [name,project] of Object.entries(v)){
      if(!name.trim()||name.length>120||!Array.isArray(project?.layout)||project.layout.length>LIMIT)throw Error('Há um projeto inválido. Os dados originais foram preservados.');
      const summary=Object.create(null),layout=project.layout.map(i=>{
        const spriteId=int(i.spriteId,1),relX=int(i.relX,-10000,10000),relY=int(i.relY,-10000,10000),z=String(number(i.z??0,-1000,1000)),rot=int(i.rot??0,0,7);
        summary[spriteId]=(summary[spriteId]||0)+1;
        for(const c of [i.color1,i.color2])if(c!=null&&!/^[0-9a-fA-F]{6}$/.test(c))throw Error('Há uma cor inválida no projeto.');
        return {spriteId,relX,relY,z,rot,extraData:String(i.extraData??'0'),color1:i.color1??null,color2:i.color2??null,...(i.limited===true?{limited:true}:{})};
      });out[name]={layout,summary,...(validCreatedAt(project.createdAt)?{createdAt:project.createdAt}:{})};
    }return out;
  }
  function validCreatedAt(value){return Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000;}
  function readCatalogPage(buffer,{extras=['']}={}) {
    const r=new Reader(buffer,6),boolean=()=>{const v=r.u8();if(v>1)throw Error('Booleano inválido.');return v===1;};
    const pageId=int(r.i32(),0),catalogType=r.str(),layout=r.str();
    if(!['NORMAL','BUILDERS_CLUB'].includes(catalogType)||!layout||layout.length>120||!/^[a-zA-Z0-9_-]+$/.test(layout))throw Error('Não é uma página de catálogo reconhecida.');
    for(let n=r.count(300);n>0;n--)r.str();
    for(let n=r.count(1000);n>0;n--)r.str();
    const total=r.count(2000),offers=[],limitedSpriteIds=new Set();
    for(let i=0;i<total;i++) {
      const offerId=int(r.i32(),0),label=r.str(),rent=boolean(),credits=int(r.i32(),0),points=int(r.i32(),0),currency=int(r.i32(),0);boolean();
      const products=[];
      for(let n=r.count(1000);n>0;n--) {
        const type=r.str();if(!['s','i','e','b'].includes(type))throw Error('Produto desconhecido.');
        if(type==='b'){r.str();products.push({type});continue;}
        const spriteId=int(r.i32(),0),extra=r.str(),count=int(r.i32(),1,1000000),limited=boolean();
        if(limited){int(r.i32(),0);int(r.i32(),0);if(type==='s'&&spriteId>0)limitedSpriteIds.add(spriteId);}
        products.push({type,spriteId,extra,count,limited});
      }
      const clubLevel=int(r.i32(),0,100),bundleAllowed=boolean(),isPet=boolean();r.str();
      if(catalogType==='NORMAL'&&!rent&&!isPet&&products.length===1){const product=products[0];
        if(product.type==='s'&&product.spriteId>0&&product.count===1&&!product.limited&&extras.includes(product.extra))
          offers.push({spriteId:product.spriteId,offerId,pageId,type:product.type,bundleAllowed,credits,points,currency,clubLevel,label});
      }
    }
    r.i32();boolean();
    if(r.p<r.v.byteLength)for(let n=r.count(100);n>0;n--){r.i32();r.str();r.str();const type=int(r.i32(),0,2);if(type===1)r.i32();else r.str();r.i32();}
    if(r.p!==r.v.byteLength)throw Error('Página incompleta ou formato diferente.');
    return {pageId,catalogType,offers,total,limitedSpriteIds:[...limitedSpriteIds]};
  }
  function normalizeCatalog(v){
    if(!v||typeof v!=='object'||Array.isArray(v))throw Error('O catálogo deve ser um objeto JSON.');const out=Object.create(null);
    for(const [sid,i] of Object.entries(v)){int(sid,1);if(!i||typeof i!=='object')throw Error('Catálogo inválido.');if(i.limited===true){out[sid]={limited:true};continue;}out[sid]={offerId:int(i.offerId,0),pageId:i.pageId===undefined?undefined:int(i.pageId,0),...(i.bundleAllowed===undefined?{}:{bundleAllowed:i.bundleAllowed===true}),...(i.type===undefined?{}:{type:String(i.type)}),...(i.credits===undefined?{}:{credits:int(i.credits,0)}),...(i.points===undefined?{}:{points:int(i.points,0)}),...(i.currency===undefined?{}:{currency:int(i.currency,0)}),...(i.clubLevel===undefined?{}:{clubLevel:int(i.clubLevel,0,100)})};}
    return out;
  }
  function missingItems(layout,inv){const needed=new Map(),have=new Map();for(const i of layout)needed.set(i.spriteId,(needed.get(i.spriteId)||0)+1);for(const i of inv)have.set(i.spriteId,(have.get(i.spriteId)||0)+1);return [...needed].filter(([sid,n])=>n>(have.get(sid)||0)).map(([spriteId,n])=>({spriteId,count:n-(have.get(spriteId)||0)}));}
  function purchaseItems(layout,inv,catalog={},knownLimited=[]){
    const limited=new Set([...knownLimited,...[...layout,...inv].filter(i=>i.limited===true&&i.type!=='i').map(i=>Number(i.spriteId))]);
    const missing=missingItems(layout,inv),buyable=[],excluded=[];
    for(const item of missing)(limited.has(Number(item.spriteId))||catalog[item.spriteId]?.limited===true?excluded:buyable).push(item);
    return {buyable,excluded};
  }
  function validatePositions(arr){if(!Array.isArray(arr)||!arr.length||arr.length>LIMIT)throw Error('A forma precisa ter entre 1 e 5.000 posições.');return arr.map(i=>({...i,x:int(i.x,-10000,10000),y:int(i.y,-10000,10000)}));}
  return {OP,LIMIT,number,int,encode,decode,Reader,readInventory,readFloorConfirmation,readRoom,readUpdates,readCatalogPage,normalizeProjects,normalizeCatalog,validCreatedAt,missingItems,purchaseItems,validatePositions};
})();



  ctx.parts.add('core.js');
})();
