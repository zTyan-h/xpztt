'use strict';
// Benchmark local: transporte/IndexedDB simulados, sem rede nem espera do jogo.
// Mede a preparação completa e até 32 colocações de cada plano, sem extrapolar.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {performance}=require('node:perf_hooks');
async function measure(size,converted=false,sample=Math.min(size,32)){
  const metrics={size,kind:converted?'converted':'original',sample,serializations:0,serializedChars:0,writes:0,writtenChars:0,progressEvents:0,operationEvents:0,packets:0,placements:0};
  const ctx={current:()=>true,parts:new Set(),protocols:{},ac:new AbortController()};
  const json={parse:JSON.parse,stringify(...args){const raw=JSON.stringify(...args);metrics.serializations++;metrics.serializedChars+=raw?.length||0;return raw;}};
  let clock=10000;class Clock extends Date{static now(){return clock;}}
  const sandbox=vm.createContext({window:{_constructor:ctx},TextEncoder,TextDecoder,AbortController,Date:Clock,JSON:json});
  const resolve=require('./source-path.cjs');
  const load=file=>vm.runInContext(fs.readFileSync(resolve(file),'utf8'),sandbox,{filename:file});
  load('protocol-habblet.js');load('protocol-habblive.js');ctx.hotel={id:'habblive',name:'Habblive',storagePrefix:'hl:',protocol:ctx.protocols.habblive};
  load('core.js');load('runtime.js');ctx.extendRuntime=prototype=>{for(const name of Object.getOwnPropertyNames(prototype))if(name!=='constructor')Object.defineProperty(ctx.Runtime.prototype,name,Object.getOwnPropertyDescriptor(prototype,name));};
  for(const file of ['storage','configurations','operations','tasks','shapes','conversion'])load(file+'.js');
  Object.assign(ctx.Runtime.prototype,{async initProjects(){},observeCatalogRequest(){},learnCatalogIndex(){},learnCatalog(){},catalog(){return {};}});
  const store=new Map(),records=new Map(),C=ctx.Core;
  const env={setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto,localStorage:{getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value)},_constructorBridge:{socket:{version:1,onConnection:()=>()=>{},onReceive:()=>()=>{},onSend:()=>()=>{},send(buffer){
    metrics.packets++;if(C.decode(buffer)[0].id!==2761)return;
    const [itemId,x,y,rot]=new C.Reader(buffer,6).str().split(' ').map(Number),sid=13+(itemId-1)%4;
    metrics.placements++;runtime.feed(C.encode(1362,[['i',itemId+10000],['i',sid],['i',x],['i',y],['i',rot],['s',String((itemId-1)%5)],['s','1.0'],['i',0],['i',0],['s','0']]),runtime.ws);
  }}}};
  const runtime=new ctx.Runtime(env);await runtime.ready;runtime.ws={id:7,readyState:1};runtime.sleep=async delay=>{clock+=delay;};runtime.inventoryFresh=true;
  runtime.database={close(){}};runtime.databaseValue=async(mode,operation)=>{
    const writes=[],store={get:key=>{const request={result:records.get(key)};queueMicrotask(()=>request.onsuccess?.());return request;},put:(value,key)=>{writes.push([key,value]);return {result:key};},delete:key=>{writes.push([key,undefined]);return {};}};
    const request=operation(store);await Promise.resolve();
    if(mode==='readwrite')for(const [key,value] of writes){metrics.writes++;metrics.writtenChars+=value?.length||0;if(value===undefined)records.delete(key);else records.set(key,value);}
    return request.result;
  };
  runtime.on('progress',()=>{metrics.progressEvents++;if(runtime.operationSummary)runtime.operationSummary();else runtime.operationStatus();});
  runtime.on('operations',()=>{metrics.operationEvents++;});
  const source={name:'Fixture',id:'fixture-project',revision:1,originHotel:'habblet',layout:Array.from({length:size},(_,index)=>({spriteId:13+index%4,relX:index%100,relY:Math.floor(index/100),z:String(index%5),rot:0,extraData:'0'}))};
  const start=performance.now();let project=source;
  if(converted){
    ctx.hotels={habblive:{},habblet:{}};const byId=new Map(),byClassname=new Map();
    for(let sid=13;sid<17;sid++){const item={id:sid,classname:'fixture'+sid,xdim:1,ydim:1};byId.set(sid,[item]);byClassname.set(item.classname,[item]);}
    ctx.loadFurniture=async()=>({floor:{byId,byClassname}});project=await ctx.convertProject(source,'habblive');
  }
  metrics.convertMs=+(performance.now()-start).toFixed(2);
  runtime.inventory=Array.from({length:size},(_,index)=>({itemId:index+1,spriteId:13+index%4,type:'s'}));
  const plan=C.planProject(project,{x:0,y:0},runtime.inventory),progress=runtime.operationProgress.bind(runtime);
  runtime.operationProgress=job=>{const report=progress(job);if(report.done>=sample&&runtime.controller)runtime.cancel();return report;};
  const begin=runtime.beginBuildOperationItem.bind(runtime);
  runtime.beginBuildOperationItem=async(...args)=>{if(metrics.prepareMs===undefined)metrics.prepareMs=+(performance.now()-start).toFixed(2);return begin(...args);};
  try{await runtime.execute(plan,{delay:0,projectId:'fixture-project',label:'Fixture'});}catch(error){if(runtime.progress.phase!=='stopped')throw error;}
  metrics.elapsedMs=+(performance.now()-start).toFixed(2);
  metrics.confirmed=runtime.operationJournal.jobs[0].items.filter(item=>item.status==='done').length;
  runtime.dispose();return metrics;
}
if(require.main===module)(async()=>{
  for(const size of process.argv.slice(2).map(Number).filter(Number.isInteger).length?process.argv.slice(2).map(Number):[120,500,5000])for(const converted of [false,true]){
    process.stdout.write(JSON.stringify(await measure(size,converted))+'\n');
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={measure};
