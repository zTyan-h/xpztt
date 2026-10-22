'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ctx={current:()=>true,parts:new Set(),protocols:{},ac:new AbortController()};
let now=10000;
class TestDate extends Date{static now(){return now;}}
const sandbox=vm.createContext({window:{_constructor:ctx},TextEncoder,TextDecoder,AbortController,Date:TestDate});
const load=file=>vm.runInContext(fs.readFileSync(require('./source-path.cjs')(file),'utf8'),sandbox,{filename:file});
load('protocol-habblet.js');ctx.hotel={id:'habblet',protocol:ctx.protocols.habblet};
load('core.js');load('runtime.js');
ctx.extendRuntime=prototype=>{for(const name of Object.getOwnPropertyNames(prototype))if(name!=='constructor')Object.defineProperty(ctx.Runtime.prototype,name,Object.getOwnPropertyDescriptor(prototype,name));};
load('configurations.js');load('tasks.js');
Object.assign(ctx.Runtime.prototype,{async initStorage(){},async initProjects(){},observeCatalogRequest(){},learnCatalogIndex(){},learnCatalog(){}});
const C=ctx.Core,RID=366536175;
const stateReply=(state,roomId=RID)=>C.encode(2547,[['s',String(roomId)],['i',0],['s',String(state)]]);
const floorReply=(opcode,rot,state,roomId=RID,x=2,y=15)=>C.encode(opcode,[['i',roomId],['i',13],['i',x],['i',y],['i',rot],['s','0.0'],['s','1.0'],['i',1],['i',0],['s',String(state)]]);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
  const sent=[],delays=[];let onSend,native;
  const socket={version:1,onConnection:()=>()=>{},onReceive:()=>()=>{},onSend:callback=>{onSend=callback;return ()=>{};},send(data,options){sent.push(data);onSend({connectionId:7,status:'sent',source:options.source,data});native?.(data);}};
  const runtime=new ctx.Runtime({_constructorBridge:{socket},setTimeout,clearTimeout});runtime.ws={id:7,readyState:1};
  runtime.sleep=async delay=>{delays.push(delay);now+=delay;};
  return {runtime,sent,delays,respond:callback=>{native=callback;},feed:buffer=>runtime.feed(buffer,runtime.ws)};
}
function pending(runtime,state='3',rot=4,currentRot=2){
  return runtime.trackConfiguration({spriteId:13,x:2,y:15,rot,extraData:state},{roomId:RID,x:2,y:15,rot:currentRot,state:'0'},0);
}

test('Do Flash ao devagar, conclui cada altura antes da próxima e não libera por móvel',async()=>{
  for(const delay of [25,100,180,450,900]){
    const {runtime,sent,respond,feed}=fixture();await runtime.ready;
    const plan=[2,0,1,2,1,0].map((height,index)=>({itemId:55+index,spriteId:13,x:2+index,y:15,rot:4,height,extraData:'',releaseHeight:true}));
    const before=JSON.stringify(plan);
    runtime.inventory=plan.map(item=>({itemId:item.itemId,spriteId:13,type:'s'}));runtime.inventoryFresh=true;
    respond(buffer=>{
      if(C.decode(buffer)[0].id!==1258)return;
      const [itemId,x,y,rot]=new C.Reader(buffer,6).str().split(' ').map(Number);
      feed(floorReply(1534,rot,'0',itemId+100,x,y));
    });
    const result=await runtime.execute(plan,{delay,flash:delay<180});
    const sequence=sent.map(buffer=>{
      const id=C.decode(buffer)[0].id,r=new C.Reader(buffer,6);
      return id===1314?r.str():Number(r.str().split(' ')[0]);
    });
    assert.deepEqual(sequence,[':up',':up 0',56,60,':up 1',57,59,':up 2',55,58,':up']);
    assert.equal(result.confirmed,6);assert.equal(JSON.stringify(plan),before);
  }
});

test('Antes do empilhamento automático libera a altura, sem reset intermediário nos grupos',async()=>{
  const {runtime,sent,respond,feed}=fixture();await runtime.ready;
  const plan=[2,1,null,3,3].map((height,index)=>({itemId:55+index,spriteId:13,x:2+index,y:15,rot:4,height,extraData:'',releaseHeight:true}));
  runtime.inventory=plan.map(item=>({itemId:item.itemId,spriteId:13,type:'s'}));runtime.inventoryFresh=true;
  respond(buffer=>{
    if(C.decode(buffer)[0].id!==1258)return;
    const [itemId,x,y,rot]=new C.Reader(buffer,6).str().split(' ').map(Number);
    feed(floorReply(1534,rot,'0',itemId+100,x,y));
  });
  await runtime.execute(plan,{delay:25,flash:true});
  assert.deepEqual(sent.map(buffer=>{
    const id=C.decode(buffer)[0].id,r=new C.Reader(buffer,6);
    return id===1314?r.str():Number(r.str().split(' ')[0]);
  }),[':up',':up 1',56,':up 2',55,':up',57,':up 3',58,59,':up']);
});

test('IN 2547 da captura é lido integralmente e estados são associados ao ID correto',()=>{
  const buffer=stateReply('3');
  assert.equal(Buffer.from(buffer).toString('hex'),'0000001409f3000933363635333631373500000000000133');
  const result=ctx.protocols.habblet.readStateUpdate(C,buffer);
  assert.equal(result.roomId,RID);assert.equal(result.state,'3');
  assert.throws(()=>ctx.protocols.habblet.readStateUpdate(C,buffer.slice(0,-1)),/incomplet/);
});

test('Giro e cada toggle aguardam confirmação; outra ação não sobrescreve o ajuste ativo',async()=>{
  const {runtime,sent,delays,feed}=fixture(),item=pending(runtime),signal=new AbortController().signal;
  const work=runtime.configureItem(item,signal,{delay:25,flash:true});
  await assert.rejects(runtime.configureItem(item,signal,{delay:25}),/Aguarde a confirmação/);
  await flush();assert.deepEqual(sent.map(b=>C.decode(b)[0].id),[248]);
  feed(floorReply(3776,4,'0'));await flush();assert.deepEqual(sent.map(b=>C.decode(b)[0].id),[248,99]);
  feed(stateReply('1',RID+1));await flush();assert.equal(sent.length,2);
  feed(stateReply('1'));await flush();assert.equal(sent.length,3);
  feed(stateReply('2'));await flush();assert.equal(sent.length,4);
  feed(stateReply('3'));assert.equal(await work,true);
  assert.deepEqual(delays,[25,25,25,25]);assert.equal(runtime.configurationActive,null);
  assert.equal(runtime.pendingConfigurations.size,0);
});

test('Intervalos do Flash ao devagar são respeitados sem mínimo fixo de 200 ms',async()=>{
  for(const delay of [25,100,180,450,900]){
    const {runtime,sent,delays,respond,feed}=fixture(),item=pending(runtime,'1',4,4);
    respond(buffer=>{assert.equal(C.decode(buffer)[0].id,99);feed(stateReply('1'));});
    assert.equal(await runtime.configureItem(item,new AbortController().signal,{delay,flash:delay<180}),true);
    assert.deepEqual(delays,[delay]);assert.equal(sent.length,1);
  }
});

test('Estado inalcançável vira pendência ao completar o ciclo, sem recolocar ou usar chat',async()=>{
  const {runtime,sent,respond,feed}=fixture(),item=pending(runtime,'9',4,4);let state=0;
  respond(buffer=>{assert.equal(C.decode(buffer)[0].id,99);state=(state+1)%4;feed(stateReply(state));});
  assert.equal(await runtime.configureItem(item,new AbortController().signal,{delay:25}),false);
  assert.equal(sent.length,4);assert.equal(item.statePending,true);assert.match(item.stateReason,/repetiu um estado/);
});

test('Mover o móvel durante a espera impede giro com as coordenadas antigas',async()=>{
  const {runtime,sent}=fixture(),item=pending(runtime,'0');
  runtime.sleep=async()=>runtime.observeConfiguration({roomId:RID,x:3,y:15,rot:2});
  assert.equal(await runtime.configureItem(item,new AbortController().signal,{delay:25}),false);
  assert.equal(sent.length,0);assert.match(item.rotationReason,/mudou de posição/);
  assert.equal(runtime.configurationStatus().report.rotationPending,1);
});

test('Timeout de toggle não dispara repetição sem atualização do estado real',async()=>{
  const {runtime,sent,respond,feed}=fixture(),item=pending(runtime,'3',4,4);runtime.options.timeout=1;
  await assert.rejects(runtime.configureItem(item,new AbortController().signal,{delay:25}),/não foi confirmado/);
  assert.equal(sent.length,1);assert.equal(item.stateUncertain,true);
  await assert.rejects(runtime.retryPending({delay:25}),/não foi confirmado/);assert.equal(sent.length,1);
  feed(stateReply('2'));assert.equal(item.stateUncertain,false);
  respond(()=>feed(stateReply('3')));
  await runtime.retryPending({delay:25});assert.equal(sent.length,2);assert.equal(runtime.pendingConfigurations.size,0);
});

test('Construção completa usa o ID confirmado: colocar, girar e ajustar estado em sequência',async()=>{
  const {runtime,sent,respond,feed}=fixture();await runtime.ready;
  runtime.inventory=[{itemId:55,spriteId:13,type:'s'}];runtime.inventoryFresh=true;
  let state=0,rotation=2;
  respond(buffer=>{
    const {id}=C.decode(buffer)[0],r=new C.Reader(buffer,6);
    if(id===1258){assert.equal(r.str(),'55 2 15 4');feed(floorReply(1534,rotation,state));}
    if(id===248){assert.equal(r.i32(),RID);r.i32();r.i32();rotation=r.i32();feed(floorReply(3776,rotation,state));}
    if(id===99){assert.equal(r.i32(),RID);state++;feed(stateReply(state));}
  });
  const result=await runtime.execute([{itemId:55,spriteId:13,x:2,y:15,rot:4,height:0,extraData:'3',releaseHeight:true}],{delay:25});
  assert.equal(result.confirmed,1);assert.equal(result.configuration.pending.length,0);
  assert.deepEqual(sent.map(b=>C.decode(b)[0].id),[1314,1314,1258,248,99,99,99,1314]);
  assert.equal(runtime.inventory.length,0);assert.equal(runtime.buildSettings,null);
});

test('Sem ACK do giro, não envia estado nem repete o giro antes de atualização real',async()=>{
  const {runtime,sent,respond,feed}=fixture(),item=pending(runtime);runtime.options.timeout=1;
  await assert.rejects(runtime.configureItem(item,new AbortController().signal,{delay:25}),/não foi confirmado/);
  assert.deepEqual(sent.map(b=>C.decode(b)[0].id),[248]);
  await assert.rejects(runtime.retryPending({delay:25}),/não foi confirmado/);assert.equal(sent.length,1);
  feed(floorReply(3776,4,'0'));let state=0;
  respond(buffer=>{assert.equal(C.decode(buffer)[0].id,99);feed(stateReply(++state));});
  await runtime.retryPending({delay:25});assert.equal(item.statePending,false);assert.equal(sent.length,4);
});

test('Movimento no mesmo lote da colocação não é perdido nem movido de volta',async()=>{
  const {runtime,sent,respond,feed}=fixture();await runtime.ready;runtime.options.timeout=1;
  runtime.inventory=[{itemId:55,spriteId:13,type:'s'}];runtime.inventoryFresh=true;
  respond(buffer=>{
    if(C.decode(buffer)[0].id!==1258)return;
    const packets=[floorReply(1534,2,'0'),floorReply(3776,2,'0',RID,3)],joined=new Uint8Array(packets.reduce((n,b)=>n+b.byteLength,0));
    let at=0;for(const packet of packets){joined.set(new Uint8Array(packet),at);at+=packet.byteLength;}
    feed(joined.buffer);
  });
  const result=await runtime.execute([{itemId:55,spriteId:13,x:2,y:15,rot:4,height:0,extraData:'0'}],{delay:25});
  assert.equal(sent.filter(b=>C.decode(b)[0].id===248).length,0);
  assert.equal(result.configuration.pending[0].currentX,3);assert.match(result.configuration.pending[0].rotationReason,/mudou de posição/);
  assert.equal(runtime.placementObservation,null);
});

test('Flash mantém o intervalo entre último ajuste nativo e próxima colocação',async()=>{
  for(const delay of [25,100]){
    const {runtime,respond,feed}=fixture();await runtime.ready;const events=[];let placed=0;
    runtime.inventory=[55,56].map(itemId=>({itemId,spriteId:13,type:'s'}));runtime.inventoryFresh=true;
    respond(buffer=>{
      const {id}=C.decode(buffer)[0];events.push({id,time:now});
      if(id===1258){const [,x,y,rot]=new C.Reader(buffer,6).str().split(' ').map(Number);feed(floorReply(1534,rot,'0',RID+placed++,x,y));}
      if(id===99)feed(stateReply('1'));
    });
    await runtime.execute([{itemId:55,spriteId:13,x:2,y:15,rot:4,height:0,extraData:'1'},{itemId:56,spriteId:13,x:3,y:15,rot:4,height:0,extraData:''}],{delay,flash:true});
    const toggle=events.find(e=>e.id===99),nextPlacement=events.filter(e=>e.id===1258)[1];
    assert.equal(nextPlacement.time-toggle.time,delay);
  }
});

test('Construção interrompe no primeiro ajuste sem ACK e mantém o móvel seguinte no inventário',async()=>{
  const {runtime,sent,respond,feed}=fixture();await runtime.ready;runtime.options.timeout=1;
  runtime.inventory=[55,56].map(itemId=>({itemId,spriteId:13,type:'s'}));runtime.inventoryFresh=true;
  respond(buffer=>{if(C.decode(buffer)[0].id===1258)feed(floorReply(1534,4,'0'));});
  const plan=[55,56].map((itemId,index)=>({itemId,spriteId:13,x:2+index,y:15,rot:4,height:0,extraData:'1'}));
  await assert.rejects(runtime.execute(plan,{delay:25}),/não foi confirmado/);
  assert.equal(sent.filter(b=>C.decode(b)[0].id===1258).length,1);
  assert.equal(sent.filter(b=>C.decode(b)[0].id===99).length,1);
  assert.equal(runtime.inventory.length,1);assert.equal(runtime.inventory[0].itemId,56);
});

test('Cancelar uma espera remove o waiter e resposta tardia não inicia outra ação',async()=>{
  const {runtime,sent,feed}=fixture(),item=pending(runtime,'1',4,4),controller=new AbortController();
  const work=runtime.configureItem(item,controller.signal,{delay:25});await flush();assert.equal(sent.length,1);
  controller.abort(Error('cancelou'));await assert.rejects(work,/cancelou/);
  assert.equal(runtime.waiters.size,0);assert.equal(runtime.configurationActive,null);
  feed(stateReply('1'));await flush();assert.equal(sent.length,1);assert.equal(item.statePending,false);
});
