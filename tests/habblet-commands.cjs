'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ctx={current:()=>true,parts:new Set(),protocols:{},ac:new AbortController()};
const sandbox=vm.createContext({window:{_constructor:ctx},TextEncoder,TextDecoder,AbortController});
const load=file=>vm.runInContext(fs.readFileSync(require('./source-path.cjs')(file),'utf8'),sandbox,{filename:file});
load('protocol-habblet.js');load('protocol-habblive.js');
ctx.hotel={id:'habblet',protocol:ctx.protocols.habblet};
load('core.js');load('runtime.js');
ctx.extendRuntime=prototype=>{
  for(const name of Object.getOwnPropertyNames(prototype))if(name!=='constructor')Object.defineProperty(ctx.Runtime.prototype,name,Object.getOwnPropertyDescriptor(prototype,name));
};
load('configurations.js');load('tasks.js');
Object.assign(ctx.Runtime.prototype,{async initStorage(){},async initProjects(){},observeCatalogRequest(){},learnCatalogIndex(){},learnCatalog(){}});
const C=ctx.Core,protocol=ctx.protocols.habblet;
const text=buffer=>new C.Reader(buffer,6).str();
function fixture(hotel='habblet'){
  const sent=[];let onSend;
  const socket={version:1,onConnection:()=>()=>{},onReceive:()=>()=>{},onSend:callback=>{onSend=callback;return ()=>{};},send(data,options){sent.push({data,options});onSend({connectionId:7,status:'sent',source:options.source,data});}};
  ctx.hotel={id:hotel,protocol:ctx.protocols[hotel]};
  const runtime=new ctx.Runtime({_constructorBridge:{socket},setTimeout,clearTimeout});
  Object.assign(runtime,{ws:{id:7,readyState:1},building:true,buildRoomEpoch:0,buildSettings:hotel==='habblet'?new Map():null});
  return {runtime,sent,external:data=>onSend({connectionId:7,status:'sent',source:'game',data})};
}

test('Pacotes de comando conferem byte a byte com a captura e não enviam digitação',()=>{
  const {runtime,sent}=fixture();
  runtime.send(protocol.height(C,1));
  runtime.send(protocol.use(C,{roomId:366536175}));
  runtime.send(protocol.rotate(C,{roomId:366558131,x:2,y:15,expectedRotation:4}));
  assert.deepEqual(sent.map(({data})=>Buffer.from(data).toString('hex')),[
    '0000000d052200053a7570203100000034',
    '0000000a006315d8e5ef00000000',
    '0000001200f815d93bb3000000020000000f00000004'
  ]);
  assert.deepEqual(sent.map(({data})=>C.decode(data)[0].id),[1314,99,248]);
  assert.ok(sent.every(({options})=>options.source==='constructor'));
});

test('120 móveis na mesma altura mantêm 120 colocações e só três comandos de altura',()=>{
  const {runtime,sent}=fixture();
  for(const buffer of protocol.startBuild(C))runtime.send(buffer);
  for(let itemId=1;itemId<=120;itemId++){
    const item={itemId,x:itemId,y:1,rot:2,extraData:''};
    for(const buffer of protocol.preparePlacement(C,item))runtime.send(buffer);
    runtime.send(protocol.height(C,0));runtime.send(protocol.placeFloor(C,item));
  }
  runtime.building=false;runtime.resetBuildModes();
  const commands=sent.filter(({data})=>C.decode(data)[0].id===1314).map(({data})=>text(data));
  assert.deepEqual(commands,[':up',':up 0',':up']);
  assert.equal(sent.filter(({data})=>C.decode(data)[0].id===1258).length,120);
});

test('Valores diferentes continuam sendo enviados; intervenção manual atualiza o cache',()=>{
  const {runtime,sent,external}=fixture();
  runtime.send(protocol.height(C,1));runtime.send(protocol.height(C,1));
  assert.equal(sent.length,1);
  external(protocol.height(C,2));runtime.send(protocol.height(C,1));
  assert.equal(sent.length,2);assert.equal(text(sent[1].data),':up 1');
  runtime.send(protocol.height(C,3));assert.equal(text(sent[2].data),':up 3');
  external(C.encode(1314,[['s',':UP 4'],['i',52]]));runtime.send(protocol.height(C,3));
  assert.equal(sent.length,4);
});

test('Pacotes de usar móvel não são descartados pelo cache de altura',()=>{
  const {runtime,sent}=fixture(),buffer=protocol.use(C,{roomId:366536175});
  runtime.send(buffer);runtime.send(buffer);assert.equal(sent.length,2);
});

test('Limpeza sem ajustes de estado/rotação não ativa modo de teste',()=>{
  const {runtime,sent}=fixture();
  for(const buffer of protocol.startBuild(C))runtime.send(buffer);
  runtime.building=false;runtime.resetBuildModes();
  assert.deepEqual(sent.map(({data})=>text(data)),[':up']);
});

test('Falha no transporte não grava ajuste como enviado',()=>{
  const {runtime}=fixture();
  runtime.transport.send=()=>{throw Error('falhou');};
  assert.throws(()=>runtime.send(protocol.height(C,1)),/falhou/);
  assert.equal(runtime.buildSettings.has('up'),false);
});

test('Transporte continua aceitando views binárias',()=>{
  const {runtime,sent}=fixture(),view=new Uint8Array(protocol.height(C,1));
  runtime.send(view);runtime.send(view);
  assert.equal(sent.length,1);assert.equal(sent[0].data,view);
});

test('Execução isolada inicia e descarta o cache sem suprimir colocações',async()=>{
  const {runtime,sent}=fixture();await runtime.ready;
  Object.assign(runtime,{building:false,buildRoomEpoch:null,buildSettings:null,inventoryFresh:true});
  const plan=Array.from({length:12},(_,index)=>({itemId:index+1,spriteId:13,x:index,y:1,rot:2,height:0,extraData:''}));
  runtime.inventory=plan.map(item=>({itemId:item.itemId,spriteId:13,type:'s'}));
  runtime.sleep=async()=>{};
  let placed=0;
  runtime.exchange=async(kind,match,buffer,signal)=>{
    runtime.check(signal);runtime.send(buffer);
    assert.equal(kind,'placed');
    const item=plan[placed++],response={roomId:placed,spriteId:13,x:item.x,y:item.y,rot:2,state:'0'};
    assert.equal(match(response),true);return response;
  };
  const result=await runtime.execute(plan,{delay:0});
  assert.equal(result.confirmed,12);assert.equal(runtime.buildSettings,null);
  assert.equal(sent.filter(({data})=>C.decode(data)[0].id===1314).length,3);
  assert.equal(sent.filter(({data})=>C.decode(data)[0].id===1258).length,12);
});

test('Troca de sala bloqueia a limpeza na sessão seguinte',()=>{
  const {runtime,sent}=fixture();runtime.send(protocol.height(C,1));
  runtime.roomEpoch=1;runtime.resetBuildModes();assert.equal(sent.length,1);
});

test('Habblive mantém seus envios e não usa o cache do Habblet',()=>{
  const {runtime,sent}=fixture('habblive'),buffer=ctx.protocols.habblive.height(C,1);
  runtime.send(buffer);runtime.send(buffer);assert.equal(sent.length,2);
  assert.ok(sent.every(({data})=>C.decode(data)[0].id===1678));
});

test('Agrupamento é estável, numérico e não altera o plano original',()=>{
  const plan=[2,'1.00',0,1,2].map((height,index)=>({itemId:index+1,height,releaseHeight:true}));
  const before=JSON.stringify(plan),ordered=protocol.prepareBuildPlan(C,plan);
  assert.deepEqual(Array.from(ordered,item=>item.itemId),[3,2,4,1,5]);
  assert.ok(ordered.every(item=>item.releaseHeight===false));
  assert.equal(JSON.stringify(plan),before);
  assert.equal(ctx.protocols.habblive.prepareBuildPlan,undefined);
  assert.throws(()=>protocol.prepareBuildPlan(C,[{height:'inválida'}]));
});

test('Altura automática e parede preservam dependências entre trechos de alturas explícitas',()=>{
  const plan=[{height:2},{height:1},{height:null},{height:4},{height:3},{wall:true},{height:6},{height:5}].map((item,index)=>({...item,itemId:index+1}));
  const ordered=protocol.prepareBuildPlan(C,plan);
  assert.deepEqual(Array.from(ordered,item=>item.itemId),[2,1,3,5,4,6,8,7]);
  assert.equal(ordered[2],plan[2]);assert.equal(ordered[5],plan[5]);
});
