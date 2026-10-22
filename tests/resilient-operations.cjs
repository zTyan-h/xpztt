'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture({hotel='habblet',store=new Map()}={}){
  const ctx={current:()=>true,parts:new Set(),protocols:{},ac:new AbortController()};
  let now=10000,onPacket;const sent=[];
  class TestDate extends Date{static now(){return now;}}
  const sandbox=vm.createContext({window:{_constructor:ctx},TextEncoder,TextDecoder,AbortController,Date:TestDate});
  const load=file=>vm.runInContext(fs.readFileSync(require('./source-path.cjs')(file),'utf8'),sandbox,{filename:file});
  load('protocol-habblet.js');load('protocol-habblive.js');
  ctx.hotel={id:hotel,name:hotel,storagePrefix:hotel+':',protocol:ctx.protocols[hotel]};load('core.js');load('runtime.js');
  ctx.extendRuntime=prototype=>{for(const name of Object.getOwnPropertyNames(prototype))if(name!=='constructor')Object.defineProperty(ctx.Runtime.prototype,name,Object.getOwnPropertyDescriptor(prototype,name));};
  load('storage.js');load('configurations.js');load('operations.js');load('tasks.js');load('shapes.js');
  Object.assign(ctx.Runtime.prototype,{async initProjects(){},observeCatalogRequest(){},learnCatalogIndex(){},learnCatalog(){},catalog(){return this.testCatalog||{};}});
  const env={setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto,localStorage:{getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value)},_constructorBridge:{socket:{version:1,onConnection:()=>()=>{},onReceive:()=>()=>{},onSend:()=>()=>{},send(buffer){sent.push(buffer);onPacket?.(buffer);}}}};
  const runtime=new ctx.Runtime(env),C=ctx.Core;
  runtime.ws={id:7,readyState:1};runtime.sleep=async ms=>{now+=ms;};runtime.options.timeout=1;
  runtime.refreshInventory=async()=>{runtime.inventoryFresh=true;return runtime.inventory;};
  const response=(p,roomId=p.itemId+100)=>({roomId,spriteId:p.spriteId,x:p.x,y:p.y,rot:p.rot??0,z:String(p.height??0),state:'0'});
  const place=()=>{runtime.exchange=async(kind,match,buffer,signal)=>{
    runtime.check(signal);runtime.send(buffer);assert.equal(kind,'placed');
    const [itemId,x,y,rot]=new C.Reader(buffer,6).str().split(' ').map(Number);
    const job=runtime.activeOperationJob,item=job.items.find(entry=>entry.plan.itemId===itemId);
    const reply=response({...item.plan,x,y,rot});assert.equal(match(reply),true);return reply;
  };};
  return {runtime,C,ctx,sent,store,env,response,place,onSend:callback=>{onPacket=callback;},ids:()=>sent.map(buffer=>C.decode(buffer)[0].id)};
}
const item=(itemId,spriteId=13,x=2,height=0)=>({itemId,spriteId,x,y:15,rot:4,height,extraData:''});
const owned=(itemId,spriteId=13)=>({itemId,spriteId,type:'s'});

test('Compra registra catálogo/LTD e continua; só confirma unidades recebidas após o registro em disco',async()=>{
  const {runtime,C,onSend,store}=fixture();await runtime.ready;
  runtime.inventory=[];runtime.inventoryFresh=true;
  const catalog={14:{limited:true},15:{offerId:150,pageId:1}};
  onSend(buffer=>{
    if(C.decode(buffer)[0].id!==3492)return;
    const saved=JSON.parse(store.get('habblet:constructor_operations_v1'));
    assert.equal(saved.jobs[0].items[2].uncertain,true);
    runtime.inventory.push(owned(80,15),owned(81,15));
  });
  const result=await runtime.buy([{spriteId:13,count:1},{spriteId:14,count:1},{spriteId:15,count:2}],catalog,{delay:0});
  assert.equal(result.report.done,2);assert.equal(result.report.pending,2);
  const job=runtime.operationStatus().jobs[0];
  assert.deepEqual(Array.from(job.items,entry=>entry.category),['catalog','unavailable','']);
  assert.equal(job.items[2].status,'done');
});

test('Compra sem chegada infere saldo mas bloqueia repetição após retry e recarga; chegada tardia concilia',async()=>{
  const first=fixture();await first.runtime.ready;
  const catalog={13:{offerId:130,pageId:1}};first.runtime.testCatalog=catalog;
  const result=await first.runtime.buy([{spriteId:13,count:2}],catalog,{delay:0,projectId:'project-1'});
  assert.equal(first.ids().filter(id=>id===3492).length,1);
  let pending=first.runtime.operationStatus().jobs[0].items[0];
  assert.equal(pending.category,'balance');assert.equal(pending.uncertain,true);
  await first.runtime.retryOperation(result.jobId,{delay:0});assert.equal(first.ids().filter(id=>id===3492).length,1);
  const second=fixture({store:first.store});await second.runtime.ready;second.runtime.testCatalog=catalog;
  await second.runtime.retryOperation(result.jobId,{delay:0});assert.equal(second.ids().includes(3492),false);
  second.runtime.inventory=[owned(80),owned(81)];
  await second.runtime.retryOperation(result.jobId,{delay:0});
  pending=second.runtime.operationStatus().jobs[0].items[0];assert.equal(pending.status,'done');assert.equal(pending.confirmed,2);
  assert.equal(second.ids().includes(3492),false);
});

test('Chegada parcial preserva quantidade e não compra outra vez o saldo desconhecido',async()=>{
  const {runtime,C,onSend,ids}=fixture();await runtime.ready;
  runtime.testCatalog={13:{offerId:130,pageId:1}};
  onSend(buffer=>{if(C.decode(buffer)[0].id===3492)runtime.inventory.push(owned(80));});
  const result=await runtime.buy([{spriteId:13,count:3}],runtime.testCatalog,{delay:0});
  assert.equal(result.report.done,1);assert.equal(result.report.pending,2);
  await runtime.retryOperation(result.jobId,{delay:0});assert.equal(ids().filter(id=>id===3492).length,1);
  runtime.inventory.push(owned(81),owned(82));await runtime.retryOperation(result.jobId,{delay:0});
  assert.equal(runtime.operationStatus().report.done,3);
});

test('Compra recusa explícita tem três tentativas manuais, continua outros itens e permite ignorar falha',async()=>{
  const {runtime,C,onSend}=fixture();await runtime.ready;
  runtime.testCatalog={13:{offerId:130,pageId:1},14:{offerId:140,pageId:1}};
  let rejected=false;
  onSend(buffer=>{if(C.decode(buffer)[0].id!==3492)return;const r=new C.Reader(buffer,6);r.i32();if(r.i32()===130)rejected=true;else runtime.inventory.push(owned(90,14));});
  runtime.refreshInventory=async()=>{if(rejected){rejected=false;throw Object.assign(Error('Saldo insuficiente.'),{code:'INSUFFICIENT_FUNDS',definitive:true});}runtime.inventoryFresh=true;return runtime.inventory;};
  const result=await runtime.buy([{spriteId:13,count:1},{spriteId:14,count:1}],runtime.testCatalog,{delay:0});
  assert.equal(result.report.done,1);assert.equal(result.report.pending,1);
  await runtime.retryOperation(result.jobId,{delay:0});await runtime.retryOperation(result.jobId,{delay:0});
  let job=runtime.operationStatus().jobs[0];assert.equal(job.items[0].status,'failed');assert.equal(job.items[0].attempts,3);
  await runtime.retryOperation(result.jobId,{delay:0});job=runtime.operationStatus().jobs[0];assert.equal(job.items[0].attempts,3);
  await runtime.ignoreOperationItem(job.id,job.items[0].id);assert.equal(runtime.operationStatus().jobs[0].items[0].status,'ignored');
});

test('Oferta malformada e erro inesperado de composição não bloqueiam o restante da compra',async()=>{
  const {runtime,C,onSend}=fixture();await runtime.ready;
  const original=runtime.protocol;
  runtime.protocol={...original,buy:(core,offer,...args)=>{if(offer.offerId===140)throw Error('Erro inesperado.');return original.buy(core,offer,...args);}};
  onSend(buffer=>{if(C.decode(buffer)[0].id===3492)runtime.inventory.push(owned(90,15));});
  const result=await runtime.buy([{spriteId:13,count:1},{spriteId:14,count:1},{spriteId:15,count:1}],{13:{offerId:'ruim'},14:{offerId:140,pageId:1},15:{offerId:150,pageId:1}},{delay:0});
  const job=runtime.operationStatus().jobs[0];assert.equal(result.report.done,1);
  assert.deepEqual(Array.from(job.items,entry=>entry.category),['catalog','unexpected','']);
});

test('Montagem parcial preserva coordenadas, progresso e não repete confirmados ao retomar',async()=>{
  const {runtime,place,C,sent}=fixture();await runtime.ready;place();
  runtime.inventory=[owned(55),owned(57,15)];runtime.inventoryFresh=true;
  const plan=[item(55),item(null,14,3),item(57,15,4)];
  const result=await runtime.execute(plan,{delay:0,projectId:'project-1'});
  assert.equal(result.report.done,2);assert.equal(result.report.pending,1);
  let job=runtime.operationStatus().jobs[0];assert.equal(job.items[1].category,'missing');assert.equal(job.items[1].plan.x,3);
  runtime.inventory.push(owned(58,14));await runtime.retryOperation(job.id,{delay:0});
  assert.equal(runtime.operationStatus().report.done,3);
  await runtime.execute(plan,{delay:0,projectId:'project-1'});
  assert.deepEqual(sent.filter(buffer=>C.decode(buffer)[0].id===1258).map(buffer=>new C.Reader(buffer,6).str()),['55 2 15 4','57 4 15 4','58 3 15 4']);
});

test('Timeout de colocação adia somente dependentes, continua independente e bloqueia reenvio incerto',async()=>{
  const {runtime,place,ids}=fixture();await runtime.ready;place();
  runtime.inventory=[owned(55),owned(56),owned(57)];runtime.inventoryFresh=true;
  const normal=runtime.exchange;
  runtime.exchange=async(...args)=>{if(runtime.activeOperationJob.items.find(entry=>entry.status==='running')?.plan.itemId===55){runtime.send(args[2]);throw Object.assign(Error('Sem resposta.'),{code:'RESPONSE_TIMEOUT'});}return normal(...args);};
  const result=await runtime.execute([item(55),{...item(56,13,2,null),dependsOn:[0]},item(57,13,4)],{delay:0});
  assert.equal(result.report.done,1);assert.equal(result.report.pending,2);
  let job=runtime.operationStatus().jobs[0];assert.equal(job.items[0].uncertain,true);assert.equal(job.items[1].category,'dependency');
  await runtime.retryOperation(job.id,{delay:0});assert.equal(ids().filter(id=>id===1258).length,2);
  runtime.observeOperationPlacement({roomId:155,spriteId:13,x:2,y:15,rot:4,z:'0',state:'0'});
  await runtime.operationObservationTask;
  assert.equal(runtime.operationStatus().jobs[0].items[0].status,'done');
  runtime.exchange=normal;await runtime.retryOperation(job.id,{delay:0});
  assert.equal(runtime.operationStatus().report.done,3);assert.equal(ids().filter(id=>id===1258).length,3);
});

test('Falha de ajuste preserva colocação e continua móveis independentes, retry nunca recoloca',async()=>{
  const {runtime,place,ids}=fixture();await runtime.ready;place();
  runtime.inventory=[owned(55),owned(56)];runtime.inventoryFresh=true;
  const actual=runtime.configureItem;
  runtime.configureItem=async configuration=>{if(configuration.spriteId===13&&configuration.roomId===155){configuration.statePending=true;configuration.stateUncertain=true;runtime.pendingConfigurations.set(155,configuration);throw Object.assign(Error('Ajuste incerto.'),{code:'CONFIGURATION_UNCONFIRMED'});}return true;};
  const result=await runtime.execute([{...item(55),extraData:'1'},item(56,13,3)],{delay:0});
  assert.equal(result.report.done,1);assert.equal(result.report.pending,1);assert.equal(ids().filter(id=>id===1258).length,2);
  const job=runtime.operationStatus().jobs[0];assert.equal(job.items[0].stage,'configure');assert.equal(job.items[0].placementConfirmed,true);
  runtime.configureItem=async configuration=>{configuration.statePending=false;configuration.stateUncertain=false;configuration.rotationPending=false;configuration.colorsPending=false;return true;};
  await runtime.retryOperation(job.id,{delay:0});assert.equal(runtime.operationStatus().report.done,2);assert.equal(ids().filter(id=>id===1258).length,2);
  runtime.configureItem=actual;
});

test('Recarga retoma sem confirmação de quarto e preserva concluídos; falha de persistência impede envio',async()=>{
  const first=fixture();await first.runtime.ready;first.place();first.runtime.inventory=[owned(55)];first.runtime.inventoryFresh=true;
  const result=await first.runtime.execute([item(55),item(null,14,3)],{delay:0});
  const second=fixture({store:first.store});await second.runtime.ready;second.place();second.runtime.inventory=[owned(56,14)];second.runtime.inventoryFresh=true;
  await second.runtime.retryOperation(result.jobId,{delay:0});assert.equal(second.ids().filter(id=>id===1258).length,1);
  const fail=fixture();await fail.runtime.ready;fail.runtime.inventory=[owned(55)];fail.runtime.inventoryFresh=true;
  fail.env.localStorage.setItem=()=>{throw Error('Sem espaço.');};
  await assert.rejects(fail.runtime.execute([item(55)],{delay:0}),/salvar o progresso/);assert.equal(fail.sent.length,0);
});

test('Trava de operação rejeita concorrência e cancelamento preserva o registro incerto',async()=>{
  const {runtime,onSend,C}=fixture();await runtime.ready;
  runtime.inventoryFresh=true;const catalog={13:{offerId:130,pageId:1}};
  onSend(buffer=>{if(C.decode(buffer)[0].id===3492)runtime.cancel();});
  const work=runtime.buy([{spriteId:13,count:1}],catalog,{delay:0});
  await assert.rejects(runtime.buy([{spriteId:14,count:1}],{},{}),/Aguarde/);
  await assert.rejects(work,/cancelada/);
  const pending=runtime.operationStatus().jobs[0].items[0];assert.equal(pending.status,'pending');assert.equal(pending.uncertain,true);
});

test('Planejamento parcial mantém todos os espaços e propriedades do projeto',async()=>{
  const {ctx,runtime}=fixture();await runtime.ready;
  const project={layout:[{spriteId:13,relX:0,relY:0,z:'0',rot:2,extraData:'1'},{spriteId:14,relX:3,relY:2,z:'1.5',rot:4,color1:'AABBCC'}]};
  const plan=ctx.Core.planProject(project,{x:10,y:20},[owned(55)]);
  assert.equal(plan[1].itemId,null);assert.equal(plan[1].x,13);assert.equal(plan[1].y,22);assert.equal(plan[1].height,1.5);assert.equal(plan[1].rot,4);assert.equal(plan[1].color1,'AABBCC');
});

test('Cancelar durante a persistência impede envio com custo',async()=>{
  const {runtime,ids}=fixture();await runtime.ready;
  const persist=runtime.persist.bind(runtime);
  runtime.persist=async(key,value)=>{await persist(key,value);if(value.jobs?.some(job=>job.items.some(entry=>entry.status==='running'&&entry.uncertain)))runtime.cancel();};
  await assert.rejects(runtime.buy([{spriteId:13,count:1}],{13:{offerId:130,pageId:1}},{delay:0}),/cancelada/);
  assert.equal(ids().includes(3492),false);
  assert.equal(runtime.operationStatus().jobs[0].items[0].uncertain,false);
});

test('Limite de histórico nunca remove uma compra ignorada com resultado desconhecido',async()=>{
  const {runtime}=fixture();await runtime.ready;
  runtime.operationJournal.jobs=Array.from({length:20},(_,index)=>({id:'job'+index,key:'old'+index,kind:'buy',items:[{id:'item'+index,spriteId:13,stage:'buy',status:'ignored',quantity:1,confirmed:0,uncertain:true,inFlight:{quantity:1,beforeIds:[]}}]}));
  await assert.rejects(runtime.buy([{spriteId:14,count:1}],{},{}),/operações anteriores/);
  assert.equal(runtime.operationJournal.jobs.length,20);assert.equal(runtime.operationJournal.jobs[0].items[0].uncertain,true);
});

test('Nova sala permite montagem nova e compra posterior repõe unidades consumidas',async()=>{
  const {runtime,place,ids,C,onSend}=fixture();await runtime.ready;place();
  runtime.inventory=[owned(55)];runtime.inventoryFresh=true;
  const plan=[item(55)];await runtime.execute(plan,{delay:0,projectId:'project'});
  runtime.resetConfigurationRoom();runtime.inventory=[owned(56)];runtime.inventoryFresh=true;
  await runtime.execute(plan,{delay:0,projectId:'project'});assert.equal(ids().filter(id=>id===1258).length,2);
  const catalog={13:{offerId:130,pageId:1}};let next=90;
  onSend(buffer=>{if(C.decode(buffer)[0].id===3492)runtime.inventory.push(owned(next++));});
  await runtime.buy([{spriteId:13,count:1}],catalog,{delay:0,projectId:'project'});
  await runtime.buy([{spriteId:13,count:1}],catalog,{delay:0,projectId:'project'});assert.equal(ids().filter(id=>id===3492).length,1);
  runtime.inventory=[];await runtime.buy([{spriteId:13,count:1}],catalog,{delay:0,projectId:'project'});assert.equal(ids().filter(id=>id===3492).length,2);
});

test('LTD conhecido no projeto continua protegido mesmo sem o flag no pedido/catalogo',async()=>{
  const {runtime,ids}=fixture();await runtime.ready;
  runtime.projects=bucket=>bucket==='original'?{quarto:{layout:[{spriteId:13,limited:true}]}}:{};
  const result=await runtime.buy([{spriteId:13,count:1}],{13:{offerId:130,pageId:1}},{delay:0});
  assert.equal(result.report.pending,1);assert.equal(ids().includes(3492),false);
  assert.equal(runtime.operationStatus().jobs[0].items[0].category,'unavailable');
});

test('Formas também planejam unidades ausentes sem deslocar os próximos móveis',async()=>{
  const {ctx,runtime}=fixture();await runtime.ready;
  const plan=ctx.Core.planShape({shape:'lineX',len:2,x:10,y:20,groups:[{sid:13,count:2}],heightMode:'fixed',height:2},[owned(55)]);
  assert.equal(plan.length,4);assert.equal(plan[0].itemId,55);assert.equal(plan[1].itemId,null);assert.equal(plan[2].x,11);assert.equal(plan[2].height,2);
});

test('Persistência em blocos regrava só o trecho alterado e reconstitui o diário',async()=>{
  const {runtime}=fixture();await runtime.ready;
  const records=new Map(),writes=[];
  const attach=target=>{
    target.database={};target.databaseValue=async(mode,operation)=>{
      const pending=[],store={get:key=>{const request={result:records.get(key)};queueMicrotask(()=>request.onsuccess?.());return request;},put:(value,key)=>{pending.push([key,value]);return {result:key};},delete:key=>{pending.push([key,undefined]);return {};}};
      const result=operation(store);await Promise.resolve();
      if(mode==='readwrite'){for(const [key,value] of pending)if(value===undefined)records.delete(key);else records.set(key,value);writes.push(pending);}
      return result.result;
    };
  };
  attach(runtime);
  const plans=Array.from({length:130},(_,index)=>item(null,13,index));
  const job=await runtime.operationJob('build',plans,{});
  assert.equal(writes[0].length,3); // dois blocos + índice na mesma transação
  job.items[129].status='done';job.items[129].confirmed=1;
  await runtime.saveOperations();assert.equal(writes[1].length,2);
  const second=fixture();await second.runtime.ready;attach(second.runtime);
  second.runtime.savedData.set('constructor_operations_v1',records.get('constructor_operations_v1'));
  await second.runtime.initOperations();
  assert.equal(second.runtime.operationStatus().jobs[0].items.length,130);assert.equal(second.runtime.operationStatus().report.done,1);
  // Diário legado completo no IndexedDB: todos os blocos precisam existir fisicamente.
  records.clear();records.set('constructor_operations_v1',JSON.stringify(runtime.operationJournal));
  const legacy=fixture();await legacy.runtime.ready;attach(legacy.runtime);legacy.runtime.savedData.set('constructor_operations_v1',records.get('constructor_operations_v1'));await legacy.runtime.initOperations();
  const migrated=legacy.runtime.operationJournal.jobs[0];migrated.items[0].reason='Atualizado';await legacy.runtime.saveOperations(migrated,migrated.items[0]);
  assert.equal(writes.at(-1).length,3);
  const restored=fixture();await restored.runtime.ready;attach(restored.runtime);restored.runtime.savedData.set('constructor_operations_v1',records.get('constructor_operations_v1'));await restored.runtime.initOperations();assert.equal(restored.runtime.operationStatus().jobs[0].items.length,130);
});

test('Trava entre abas impede duas filas no mesmo hotel e relê o diário mais recente',async()=>{
  const one=fixture(),two=fixture({store:one.store});await Promise.all([one.runtime.ready,two.runtime.ready]);
  const active=new Set(),locks={async request(name,options,work){if(active.has(name))return work(null);active.add(name);try{return await work({name});}finally{active.delete(name);}}};
  one.env.navigator=two.env.navigator={locks};
  let release;const hold=new Promise(resolve=>{release=resolve;});
  one.runtime.refreshInventory=async()=>{await hold;one.runtime.inventoryFresh=true;return [];};
  const work=one.runtime.buy([{spriteId:13,count:1}],{},{delay:0});
  await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(two.runtime.buy([{spriteId:14,count:1}],{},{}),/outra aba/);
  release();await work;
  await two.runtime.buy([{spriteId:14,count:1}],{},{delay:0});
  assert.equal(two.runtime.operationStatus().jobs.length,2);
});

test('Habblive usa sua compra/colocação e continua móveis ausentes sem misturar pacotes',async()=>{
  const {runtime,place,C,onSend,ids}=fixture({hotel:'habblive'});await runtime.ready;place();
  runtime.inventory=[owned(55)];runtime.inventoryFresh=true;
  let result=await runtime.execute([{...item(55),extraData:'0'},{...item(null,14,3),extraData:'0'}],{delay:0});
  assert.equal(result.report.done,1);assert.equal(result.report.pending,1);assert.equal(ids().includes(2761),true);assert.equal(ids().includes(1258),false);
  onSend(buffer=>{if(C.decode(buffer)[0].id===3655)runtime.inventory.push(owned(90,14));});
  result=await runtime.buy([{spriteId:14,count:1}],{14:{offerId:140,pageId:1}},{delay:0});
  assert.equal(result.report.done,1);assert.equal(ids().includes(3655),true);assert.equal(ids().includes(3492),false);
});

test('Envio de parede não vira concluído sem confirmação confiável nem é reenviado',async()=>{
  const {runtime,ids}=fixture();await runtime.ready;
  runtime.inventory=[{itemId:55,spriteId:13,type:'i'}];runtime.inventoryFresh=true;
  const result=await runtime.execute([{...item(55),wall:true,wx:1,wy:2,lx:0,ly:16,dir:'r'}],{delay:0});
  assert.equal(result.report.done,0);assert.equal(result.report.pending,1);
  await runtime.retryOperation(result.jobId,{delay:0});assert.equal(ids().filter(id=>id===1258).length,1);
});

test('Recusa de colocação tem limite de tentativas e não impede outro móvel',async()=>{
  const {runtime,place}=fixture();await runtime.ready;place();
  runtime.inventory=[owned(55),owned(56)];runtime.inventoryFresh=true;const normal=runtime.exchange;
  runtime.exchange=async(...args)=>{if(runtime.activeOperationJob.items.find(entry=>entry.status==='running')?.plan.itemId===55){runtime.send(args[2]);throw Object.assign(Error('Colocação recusada.'),{code:'PLACEMENT_REJECTED'});}return normal(...args);};
  const result=await runtime.execute([item(55),item(56,13,3)],{delay:0});
  assert.equal(result.report.done,1);assert.equal(result.report.pending,1);
  await runtime.retryOperation(result.jobId,{delay:0});await runtime.retryOperation(result.jobId,{delay:0});
  const failed=runtime.operationStatus().jobs[0].items[0];assert.equal(failed.status,'failed');assert.equal(failed.attempts,3);assert.equal(failed.uncertain,false);
});

test('Após recarga, snapshot do mesmo ID permite retomar somente configuração',async()=>{
  const first=fixture();await first.runtime.ready;first.place();first.runtime.inventory=[owned(55)];first.runtime.inventoryFresh=true;
  first.runtime.configureItem=async configuration=>{configuration.statePending=true;configuration.stateUncertain=true;throw Object.assign(Error('Ajuste incerto.'),{code:'CONFIGURATION_UNCONFIRMED'});};
  const result=await first.runtime.execute([{...item(55),extraData:'1'}],{delay:0});
  const second=fixture({store:first.store});await second.runtime.ready;
  second.runtime.lastOperationRoom=[{roomId:155,spriteId:13,x:2,y:15,rot:4,z:'0',extraData:'0'}];
  second.runtime.configureItem=async configuration=>{configuration.statePending=false;configuration.stateUncertain=false;configuration.rotationPending=false;configuration.colorsPending=false;return true;};
  await second.runtime.retryOperation(result.jobId,{delay:0});
  assert.equal(second.runtime.operationStatus().report.done,1);assert.equal(second.ids().includes(1258),false);
});

test('Tentativa legada de ajustes respeita o limite e o estado ignorado do diário',async()=>{
  const {runtime,place}=fixture();await runtime.ready;place();runtime.inventory=[owned(55)];runtime.inventoryFresh=true;
  runtime.configureItem=async()=>{throw Object.assign(Error('Ajuste recusado.'),{code:'CONFIGURATION_REJECTED'});};
  await runtime.execute([{...item(55),extraData:'1'}],{delay:0});
  await runtime.retryPending({delay:0});await runtime.retryPending({delay:0});
  let job=runtime.operationStatus().jobs[0];assert.equal(job.items[0].status,'failed');assert.equal(job.items[0].attempts,3);
  await assert.rejects(runtime.retryPending({delay:0}),/limite de tentativas/);
  await runtime.ignoreOperationItem(job.id,job.items[0].id);
  assert.equal(runtime.configurationStatus().canRetry,false);
  await assert.rejects(runtime.retryPending({delay:0}),/ignoradas/);
});

test('Confirmação tardia de colocação ignorada concilia sem desfazer o descarte nem ajustar o móvel',async()=>{
  const {runtime}=fixture();await runtime.ready;runtime.inventory=[owned(55)];runtime.inventoryFresh=true;
  runtime.exchange=async(kind,match,buffer)=>{runtime.send(buffer);throw Object.assign(Error('Sem resposta.'),{code:'RESPONSE_TIMEOUT'});};
  const result=await runtime.execute([item(55)],{delay:0});
  const job=runtime.operationStatus().jobs[0];await runtime.ignoreOperationItem(result.jobId,job.items[0].id);
  runtime.observeOperationPlacement({roomId:155,spriteId:13,x:2,y:15,rot:4,z:'0',state:'0'});await runtime.operationObservationTask;
  const ignored=runtime.operationStatus().jobs[0].items[0];assert.equal(ignored.status,'ignored');assert.equal(ignored.uncertain,false);assert.equal(runtime.pendingConfigurations.size,0);
});

test('Resumo leve, detalhes paginados e índices refletem alterações sem vazar referências',async()=>{
  const {runtime}=fixture();await runtime.ready;
  const job=await runtime.operationJob('build',Array.from({length:25},(_,index)=>item(null,13,index)),{});
  const summary=runtime.operationSummary();assert.equal(summary.jobs[0].items,undefined);assert.equal(summary.report.pending,25);
  const page=runtime.operationItems(job.id,{offset:12,limit:12});assert.equal(page.total,25);assert.equal(page.items.length,12);
  page.items[0].plan.x=999;assert.notEqual(job.items[12].plan.x,999);
  job.items[0].status='done';job.items[0].confirmed=1;await runtime.saveOperations(job,job.items[0]);
  assert.equal(runtime.operationSummary().report.done,1);assert.equal(runtime.operationItems(job.id,{status:'done'}).total,1);
  assert.equal(runtime.operationIndex(job).byId.get(job.items[3].id),job.items[3]);
  runtime.inventory=[owned(1)];assert.equal(runtime.operationInventoryIds().has(1),true);
  runtime.inventory=[owned(2)];assert.equal(runtime.operationInventoryIds().has(1),false);assert.equal(runtime.operationInventoryIds().has(2),true);
});
test('Som recebe evento somente na primeira confirmação persistida, sem repetição na retomada',async()=>{
  const {runtime,place,store}=fixture();await runtime.ready;place();runtime.inventory=[owned(55)];runtime.inventoryFresh=true;
  const events=[];runtime.on('placement-confirmed',event=>{
    const saved=JSON.parse(store.get('habblet:constructor_operations_v1'));assert.equal(saved.jobs[0].items[0].placementConfirmed,true);events.push(event);
  });
  const result=await runtime.execute([item(55)],{delay:0});
  const job=runtime.operationJournal.jobs[0],entry=job.items[0];
  await runtime.markPlacementConfirmed(job,entry,entry.response);await runtime.retryOperation(result.jobId,{delay:0});
  assert.equal(events.length,1);assert.equal(events[0].epoch,runtime.roomEpoch);assert.equal(events[0].connectionId,7);
});

test('Montar em outro quarto ou sessão inicia nova fila apesar das pendências anteriores',async()=>{
  for(const change of ['room','reload']){
    const first=fixture();await first.runtime.ready;first.runtime.inventoryFresh=true;
    const plan=[item(null)],old=await first.runtime.execute(plan,{delay:0,projectId:'same-project'});
    const next=change==='room'?first:fixture({store:first.store});await next.runtime.ready;
    if(change==='room')next.runtime.roomEpoch++;
    next.place();next.runtime.inventory=[owned(55)];next.runtime.inventoryFresh=true;
    const result=await next.runtime.execute(plan,{delay:0,projectId:'same-project'});
    assert.notEqual(result.jobId,old.jobId);assert.equal(result.report.done,1);
    assert.equal(next.runtime.operationJournal.jobs.find(job=>job.id===old.jobId).items[0].status,'pending');
    assert.equal(next.runtime.operationSummary().jobs.some(job=>job.requiresRoomConfirmation),false);
  }
});
test('Retomar envio incerto em outro quarto não aceita confirmação pertencente ao novo contexto',async()=>{
  const {runtime,response}=fixture();await runtime.ready;runtime.inventoryFresh=true;
  const job=await runtime.operationJob('build',[item(55)],{}),entry=job.items[0];entry.uncertain=true;await runtime.saveOperations(job,entry);
  runtime.roomEpoch++;await runtime.retryOperation(job.id,{delay:0});
  runtime.operationLockHeld=true;runtime.observeOperationPlacement(response(entry.plan));runtime.operationLockHeld=false;
  assert.equal(entry.uncertain,true);assert.equal(entry.placementConfirmed,undefined);
});
test('Unidades recolhidas voltam a poder montar o mesmo projeto em outro quarto',async()=>{
  const {runtime,place,ids}=fixture();await runtime.ready;place();runtime.inventory=[owned(55)];runtime.inventoryFresh=true;
  const plan=[item(55)];await runtime.execute(plan,{delay:0,projectId:'same-project'});
  runtime.roomEpoch++;runtime.inventory=[owned(55)];runtime.inventoryFresh=true;
  const result=await runtime.execute(plan,{delay:0,projectId:'same-project'});
  assert.equal(result.report.done,1);assert.equal(ids().filter(id=>id===1258).length,2);
});
