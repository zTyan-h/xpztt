'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(hotel='habblive'){
  const ctx={current:()=>true,parts:new Set(),protocols:{},ac:new AbortController()},store=new Map();
  const sandbox=vm.createContext({window:{_constructor:ctx},TextEncoder,TextDecoder,AbortController});
  for(const name of ['protocol-habblive','protocol-habblet'])vm.runInContext(fs.readFileSync(require('./source-path.cjs')(name+'.js'),'utf8'),sandbox);
  ctx.hotel={id:hotel,name:hotel,storagePrefix:hotel+':',protocol:ctx.protocols[hotel]};
  for(const name of ['core','runtime'])vm.runInContext(fs.readFileSync(require('./source-path.cjs')(name+'.js'),'utf8'),sandbox);
  ctx.extendRuntime=prototype=>{for(const name of Object.getOwnPropertyNames(prototype))if(name!=='constructor')Object.defineProperty(ctx.Runtime.prototype,name,Object.getOwnPropertyDescriptor(prototype,name));};
  for(const name of ['storage','catalog','configurations'])vm.runInContext(fs.readFileSync(require('./source-path.cjs')(name+'.js'),'utf8'),sandbox);
  Object.assign(ctx.Runtime.prototype,{async initProjects(){},catalog(){return this.storage('hl_module_shop_db',{});}});
  const runtime=new ctx.Runtime({setTimeout,clearTimeout,localStorage:{getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value)},_constructorBridge:{socket:{version:1,onConnection:()=>()=>{},onReceive:()=>()=>{},onSend:()=>()=>{}}}});
  runtime.ws={id:1,readyState:1};runtime.sleep=async()=>{};
  const page=id=>({pageId:id,catalogType:'NORMAL',offers:[],limitedSpriteIds:[],total:0});
  return {runtime,C:ctx.Core,page};
}
test('Pré-requisitos distinguem conexão, índice, pedido e concorrência sem enviar pacotes',async()=>{
  const {runtime}=fixture();await runtime.ready;
  assert.equal(runtime.catalogReadiness().code,'index');await assert.rejects(runtime.scanCatalog(),/lista de páginas/);
  runtime.ws.readyState=3;assert.equal(runtime.catalogReadiness().code,'connection');
  runtime.ws.readyState=1;runtime.catalogIndex=[{id:1}];assert.equal(runtime.catalogReadiness().code,'request');
  runtime.catalogRequest={opcode:100};assert.equal(runtime.catalogReadiness().ready,true);
  runtime.busy=true;assert.equal(runtime.catalogReadiness().code,'busy');runtime.dispose();
});
test('Aprendizado conserva campos observados e ignora candidatos expirados',async()=>{
  const {runtime,C,page}=fixture();await runtime.ready;
  runtime.protocol={...runtime.protocol,readCatalogPage:()=>page(12)};
  runtime.observeCatalogRequest(C.encode(300,[['i',12],['i',47],['s','NORMAL']]),runtime.ws);
  runtime.learnCatalog({id:400,buffer:new ArrayBuffer(0)});
  assert.equal(runtime.catalogRequest.offerId,47);
  const r=new C.Reader(runtime.protocol.catalogRequest(C,300,88,runtime.catalogRequest),6);
  assert.equal(r.i32(),88);assert.equal(r.i32(),47);assert.equal(r.str(),'NORMAL');
  runtime.catalogRequest=null;runtime.catalogCandidates.set(12,{opcode:301,offerId:0,type:'NORMAL',ws:runtime.ws,time:Date.now()-10001});
  runtime.learnCatalog({id:400,buffer:new ArrayBuffer(0)});assert.equal(runtime.catalogRequest,null);runtime.dispose();
});
test('Captura parcial retoma apenas páginas pendentes e limita tentativas a três',async()=>{
  const {runtime,C}=fixture();await runtime.ready;runtime.catalogIndex=[{id:1},{id:2}];runtime.catalogRequest={opcode:300};
  let attempts=[];
  runtime.exchange=async(kind,match,buffer)=>{const id=new C.Reader(buffer,6).i32();attempts.push(id);if(id===2)throw Error('Timeout');runtime.catalogCapture.pages.add(id);return {pageId:id,catalogType:'NORMAL'};};
  const first=await runtime.scanCatalog();assert.equal(first.confirmed,1);assert.deepEqual(attempts,[1,2,2,2]);
  attempts=[];runtime.exchange=async(kind,match,buffer)=>{const id=new C.Reader(buffer,6).i32();attempts.push(id);runtime.catalogCapture.pages.add(id);};
  const second=await runtime.scanCatalog();assert.deepEqual(attempts,[2]);assert.equal(second.confirmed,2);runtime.dispose();
});
test('Resposta interpretada só confirma página após persistência e descarta fila de outra conexão',async()=>{
  const {runtime,page}=fixture();await runtime.ready;runtime.startCatalogCapture();
  runtime.protocol={...runtime.protocol,readCatalogPage:()=>({...page(8),offers:[{spriteId:13,offerId:7,pageId:8}]})};
  let release;runtime.saveCatalog=()=>new Promise(resolve=>{release=resolve;});let confirmed=0;runtime.dispatch=()=>confirmed++;
  runtime.learnCatalog({id:400,buffer:new ArrayBuffer(0)});await Promise.resolve();
  assert.equal(confirmed,0);assert.equal(runtime.catalogPageDiagnostics.get(8).persisted,false);
  runtime.adopt({id:2,readyState:1});release();await runtime.catalogWriteQueue;
  assert.equal(confirmed,0);assert.equal(runtime.catalogCapture.pages.size,0);assert.equal(runtime.catalogRequest,null);runtime.dispose();
});
test('Falha de interpretação conhecida e falha de persistência têm diagnósticos distintos',async()=>{
  const {runtime,page}=fixture('habblet');await runtime.ready;runtime.startCatalogCapture();
  runtime.protocol={...runtime.protocol,readCatalogPage:()=>{throw Error('Formato inválido');}};
  runtime.learnCatalog({id:804,buffer:new ArrayBuffer(0)});assert.match(runtime.catalogCaptureStatus().diagnostics.join(' '),/não interpretada/);
  runtime.protocol={...runtime.protocol,readCatalogPage:()=>({...page(8),offers:[{spriteId:13,offerId:7,pageId:8}]})};runtime.saveCatalog=async()=>{throw Error('Disco cheio');};
  runtime.learnCatalog({id:804,buffer:new ArrayBuffer(0)});await runtime.catalogWriteQueue;
  assert.match(runtime.catalogPageDiagnostics.get(8).error,/Disco cheio/);assert.equal(runtime.catalogCapture.pages.has(8),false);runtime.dispose();
});
