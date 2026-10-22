'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const crypto=require('node:crypto').webcrypto;
const clone=value=>JSON.parse(JSON.stringify(value));
const KEY='constructor_projects_v2',CATALOG='hl_module_shop_db',NOW=1792566000000;
const layout=(...sprites)=>(sprites.length?sprites:[13]).map((spriteId,index)=>({spriteId,relX:index,relY:0,z:'0',rot:0,extraData:'0',color1:null,color2:null}));
const project=extra=>({id:'original_1',revision:1,originHotel:'habblet',layout:layout(),...extra});
const bundle=original=>({version:2,original:original||{},converted:{},references:{}});

function setup(files=['core.js','projects.js','conversion.js'],firebaseConfig={projectId:'test-project',apiKey:'test-public-api-key',databaseURL:'https://test-project-default-rtdb.firebaseio.com'}){
  const records=new Map(),metrics={parses:0,normalizations:0,catalogs:0};
  class Runtime{
    constructor(value=bundle()){
      this.hotel={id:'habblet',storagePrefix:'test:'};this.savedData=new Map();this.events=[];
      this.env={localStorage:{getItem:key=>records.get(key)??null,setItem:(key,raw)=>records.set(key,raw)}};
      this.env.localStorage.setItem(this.storageKey(KEY),JSON.stringify(value));
    }
    storageKey(key){return this.hotel.storagePrefix+key;}
    storage(key,fallback){const raw=this.env.localStorage.getItem(this.storageKey(key));return raw===null?fallback:JSON.parse(raw);}
    async persist(key,value){
      if(this.failWrite)throw Error('Falha simulada de persistência.');
      const raw=JSON.stringify(value);
      if(this.database)this.savedData.set(key,raw);else this.env.localStorage.setItem(this.storageKey(key),raw);
    }
    emit(event,value){this.events.push({event,value});}
  }
  const ctx={current:()=>true,parts:new Set(),hotels:{habblet:{},habblive:{}},ac:new AbortController(),firebaseConfig,platform:{baseUrl:'https://constructor.example',request:async()=>{throw Error('Transporte não simulado.');}},extendRuntime(prototype){
    for(const name of Object.getOwnPropertyNames(prototype))if(name!=='constructor')Object.defineProperty(Runtime.prototype,name,Object.getOwnPropertyDescriptor(prototype,name));
  }};
  class Clock extends Date{static now(){return NOW;}}
  const json={parse(raw){metrics.parses++;return JSON.parse(raw);},stringify:JSON.stringify};
  const sandbox=vm.createContext({window:{_constructor:ctx},crypto,Date:Clock,JSON:json,DOMException,TextEncoder,TextDecoder,AbortController,AbortSignal,URL,URLSearchParams});
  for(const file of files)vm.runInContext(fs.readFileSync(require('./source-path.cjs')(file),'utf8'),sandbox,{filename:file});
  for(const [name,metric] of [['normalizeProjects','normalizations'],['normalizeCatalog','catalogs']]){
    const normalize=ctx.Core[name];ctx.Core[name]=value=>{metrics[metric]++;return normalize(value);};
  }
  return {ctx,Runtime,metrics,records};
}

test('Normalização e JSON preservam somente createdAt numérico válido, inclusive zero',()=>{
  const {ctx}=setup();
  for(const createdAt of [0,NOW,8640000000000000]){
    const valid=ctx.Core.normalizeProjects({room:project({createdAt})});
    assert.equal(clone(valid).room.createdAt,createdAt);
  }
  for(const createdAt of [undefined,null,'1792566000000',true,NaN,Infinity,-1,0.5,8640000000000001]){
    const valid=ctx.Core.normalizeProjects({room:project({createdAt})});
    assert.equal(Object.hasOwn(valid.room,'createdAt'),false);
  }
  const special=ctx.Core.normalizeProjects(JSON.parse('{"__proto__":{"layout":[],"createdAt":0}}'));
  assert.equal(special.__proto__.createdAt,0);assert.equal(Object.getPrototypeOf(special),null);
});

test('Captura nova usa relógio atual e migração legada não fabrica datas',async()=>{
  const {Runtime}=setup(),runtime=new Runtime();
  runtime.requireCapability=()=>{};runtime.run=(label,task)=>task();runtime.update=()=>{};
  runtime.wait=()=>({promise:Promise.resolve({layout:layout()})});
  await runtime.capture('Captured');
  assert.equal(runtime.projects().Captured.createdAt,NOW);
  const legacy=new Runtime();
  legacy.env.localStorage.setItem(legacy.storageKey(KEY),'null');
  legacy.env.localStorage.setItem(legacy.storageKey('hl_module_rooms'),JSON.stringify({Legacy:{layout:layout()},Dated:{layout:layout(),createdAt:42}}));
  await legacy.initProjects();
  assert.equal(Object.hasOwn(legacy.projects().Legacy,'createdAt'),false);
  assert.equal(legacy.projects().Dated.createdAt,42);
});

test('Importação conserva data fornecida; renomear e atualizar conservam a data original',async()=>{
  const {Runtime}=setup(),runtime=new Runtime();
  await runtime.saveProjects({Imported:{layout:layout(),createdAt:42},Legacy:{layout:layout()}});
  await runtime.renameProject('Imported','Renamed');
  await runtime.saveProjects({Renamed:{layout:layout(14),createdAt:NOW},Legacy:{layout:layout(14),createdAt:NOW}});
  assert.equal(runtime.projects().Renamed.createdAt,42);
  assert.equal(Object.hasOwn(runtime.projects().Legacy,'createdAt'),false);
  assert.equal(runtime.projects().Renamed.revision,3);
});

test('Bundle reutiliza parse/normalização por raw e mantém snapshots imutáveis entre escritas',async()=>{
  const {Runtime,metrics}=setup(),runtime=new Runtime(bundle({Room:project({createdAt:42})}));
  const first=runtime.projectBundle(),parses=metrics.parses,normalizations=metrics.normalizations;
  assert.equal(runtime.projectBundle(),first);assert.equal(runtime.projects(),first.original);
  assert.equal(metrics.parses,parses);assert.equal(metrics.normalizations,normalizations);
  assert.ok(Object.isFrozen(first.original.Room.layout[0]));
  assert.throws(()=>{first.original.Room.layout[0].spriteId=99;},TypeError);
  await runtime.renameProject('Room','Changed');
  assert.equal(first.original.Room.revision,1);assert.equal(Object.hasOwn(first.original,'Changed'),false);
  const second=runtime.projectBundle();assert.notEqual(second,first);assert.equal(second.original.Changed.createdAt,42);
});

test('Escrita falha não contamina o cache nem impede a próxima mutação',async()=>{
  const {Runtime}=setup(),runtime=new Runtime(bundle({Room:project()})),before=runtime.projectBundle();
  runtime.failWrite=true;
  await assert.rejects(runtime.renameProject('Room','Failed'),/Falha simulada/);
  assert.equal(runtime.projectBundle(),before);assert.equal(Object.hasOwn(before.original,'Failed'),false);
  runtime.failWrite=false;await runtime.renameProject('Room','Worked');
  assert.equal(runtime.projects().Worked.id,'original_1');
});

test('Cache invalida após outra aba e usa savedData quando há banco',async()=>{
  const {Runtime}=setup(),runtime=new Runtime(bundle({Old:project()}));
  const first=runtime.projectBundle();
  runtime.env.localStorage.setItem(runtime.storageKey(KEY),JSON.stringify(bundle({External:project({createdAt:43})})));
  assert.notEqual(runtime.projectBundle(),first);assert.equal(runtime.projects().External.createdAt,43);
  runtime.database={};runtime.savedData.set(KEY,JSON.stringify(bundle({Database:project({createdAt:44})})));
  const database=runtime.projectBundle();assert.equal(database.original.Database.createdAt,44);
  runtime.env.localStorage.setItem(runtime.storageKey(KEY),'invalid local data');
  assert.equal(runtime.projectBundle(),database);
  await runtime.renameProject('Database','Updated');assert.equal(runtime.projects().Updated.createdAt,44);
});

test('Catálogo conserva identidade por conteúdo e invalida após persistência',async()=>{
  const {Runtime,metrics}=setup(),runtime=new Runtime();
  await runtime.persist(CATALOG,{13:{offerId:1,pageId:2}});
  const first=runtime.catalog(),normalizations=metrics.catalogs,parses=metrics.parses;
  assert.equal(runtime.catalog(),first);assert.equal(metrics.catalogs,normalizations);assert.equal(metrics.parses,parses);
  assert.ok(Object.isFrozen(first[13]));assert.throws(()=>{first[13].offerId=3;},TypeError);
  await runtime.persist(CATALOG,{13:{offerId:3,pageId:2}});
  assert.notEqual(runtime.catalog(),first);assert.equal(runtime.catalog()[13].offerId,3);assert.equal(first[13].offerId,1);
});

test('Datas inválidas existentes são omitidas do snapshot sem alterar o raw',()=>{
  const {Runtime}=setup(),runtime=new Runtime(bundle({Room:project({createdAt:'bad'})}));
  const before=runtime.env.localStorage.getItem(runtime.storageKey(KEY));
  assert.equal(Object.hasOwn(runtime.projects().Room,'createdAt'),false);
  assert.equal(runtime.env.localStorage.getItem(runtime.storageKey(KEY)),before);
});

function furniture(entries,metrics){
  const byId=new Map(),byClassname=new Map();
  for(const item of entries){
    if(!byId.has(item.id))byId.set(item.id,[]);byId.get(item.id).push(item);
    if(!byClassname.has(item.classname))byClassname.set(item.classname,[]);byClassname.get(item.classname).push(item);
  }
  if(metrics)for(const [map,key] of [[byId,'origins'],[byClassname,'targets']]){
    const get=map.get.bind(map);map.get=id=>{metrics[key]++;return get(id);};
  }
  return {floor:{byId,byClassname}};
}
const furni=(id,classname,extra)=>({id,classname,xdim:1,ydim:1,...extra});

test('Equivalências são resolvidas uma vez por sprite e par de FurnitureData',async()=>{
  const {ctx}=setup(),counts={origins:0,targets:0};
  let from=furniture([furni(13,'chair'),furni(14,'table')],counts);
  let to=furniture([furni(113,'chair'),furni(114,'table')],counts);
  ctx.loadFurniture=async hotel=>hotel==='habblet'?from:to;
  const source={...project({createdAt:42}),name:'Room',layout:layout(13,13,14,13)};
  const first=await ctx.convertProject(source,'habblive');
  assert.equal(first.createdAt,42);assert.deepEqual(clone(first.layout).map(item=>item.spriteId),[113,113,114,113]);
  assert.deepEqual(counts,{origins:2,targets:2});
  await ctx.convertProject(source,'habblive');assert.deepEqual(counts,{origins:2,targets:2});
  to=furniture([furni(213,'chair'),furni(214,'table')],counts);
  assert.equal((await ctx.convertProject(source,'habblive')).layout[0].spriteId,213);
  assert.deepEqual(counts,{origins:4,targets:4});
  from=furniture([furni(13,'table'),furni(14,'table')],counts);
  assert.equal((await ctx.convertProject(source,'habblive')).layout[0].spriteId,214);
  assert.deepEqual(counts,{origins:6,targets:6});
});

test('Deduplicação canônica, ambiguidades, pendências e dimensões permanecem explícitas',async()=>{
  const {ctx}=setup();
  const origin=[furni(13,'chair'),{ydim:1,xdim:1,classname:'chair',id:13},furni(14,'ambiguous'),furni(14,'other'),furni(15,'missing'),furni(16,'target-ambiguous')];
  const target=[furni(113,'chair',{xdim:2}),furni(116,'target-ambiguous'),furni(216,'target-ambiguous')];
  ctx.loadFurniture=async hotel=>hotel==='habblet'?furniture(origin):furniture(target);
  const result=await ctx.convertProject({...project(),name:'Room',layout:layout(13,13,14,15,16,99,99)},'habblive');
  assert.deepEqual(clone(result.conversion),{sourceHotel:'habblet',targetHotel:'habblive',total:7,compatible:2,pending:[{reason:'ambiguous',spriteId:14,classname:null,count:1},{reason:'missing',spriteId:15,classname:'missing',count:1},{reason:'ambiguous',spriteId:16,classname:'target-ambiguous',count:1},{reason:'unknown',spriteId:99,classname:null,count:2}],warnings:[{classname:'chair',reason:'dimensions'}]});
  assert.equal(Object.hasOwn(result,'createdAt'),false);
});

test('Recebimento preserva data no convertido e referência, sem repetir revisão já recebida',async()=>{
  const {ctx,Runtime}=setup(),runtime=new Runtime();runtime.hotel.id='habblive';
  const from=furniture([furni(13,'chair')]),to=furniture([furni(113,'chair')]);
  ctx.loadFurniture=async hotel=>hotel==='habblet'?from:to;
  const source={...project({createdAt:42}),name:'Source'};
  assert.equal(await runtime.receiveProject(source,'sender_1'),true);
  const received=runtime.projects('converted').Source;
  assert.equal(received.createdAt,42);assert.equal(runtime.projectBundle().references[received.id].createdAt,42);
  assert.equal(await runtime.receiveProject(source,'sender_1'),false);
  const revision={...source,revision:2};delete revision.createdAt;
  assert.equal(await runtime.receiveProject(revision,'sender_1'),true);
  assert.equal(runtime.projects('converted').Source.createdAt,42);
  const before=runtime.projectBundle();
  await runtime.renameProject('Source','Local','converted');
  assert.equal(runtime.projects('converted').Local.createdAt,42);assert.equal(before.converted.Source.createdAt,42);
});

test('Payload Firebase conserva createdAt válido e omite legado, com transporte simulado',async()=>{
  const {Runtime}=setup(['core.js','projects.js','firebase.js']);
  const runtime=new Runtime(bundle({Dated:project({createdAt:42}),Legacy:project({id:'original_2'}),Invalid:project({id:'original_3',createdAt:'bad'})}));
  const relay=runtime.relay(),patches=[];
  relay.linked=async()=>({linkId:'link',peerUid:'receiver_1',peerHotel:'habblive'});
  relay.identity={uid:'sender_1'};relay.now=async()=>NOW;relay.cleanup=async()=>{};
  relay.request=async(path,method,body)=>{patches.push(body);return {value:null};};
  for(const name of ['Dated','Legacy','Invalid'])await runtime.sendProject(name);
  const payloads=patches.map(patch=>JSON.parse(Object.entries(patch).find(([key])=>key.startsWith('payloads/'))[1].body));
  assert.equal(payloads[0].createdAt,42);assert.equal(Object.hasOwn(payloads[1],'createdAt'),false);assert.equal(Object.hasOwn(payloads[2],'createdAt'),false);
});

test('Firebase sem configuração preserva projetos locais e não inicia transporte',async()=>{
  const {ctx,Runtime}=setup(['core.js','projects.js','firebase.js'],{}),runtime=new Runtime(bundle({Local:project()}));let requests=0;
  ctx.platform.request=async()=>{requests++;throw Error('Não deve executar.');};
  assert.equal(runtime.projectLinkStatus().linked,false);assert.equal(runtime.projects().Local.id,'original_1');
  await assert.rejects(runtime.createProjectLink(),/Configure o Firebase no Worker/);assert.equal(requests,0);
});

test('Firebase usa plataforma do Worker, mantém ETag, refresh e namespace de identidade',async()=>{
  const {ctx,Runtime,records}=setup(['core.js','projects.js','firebase.js']),runtime=new Runtime(),calls=[];
  ctx.platform.request=async(input,init)=>{
    const url=new URL(input);calls.push({url,init});
    assert.equal(url.origin,'https://constructor.example');
    if(url.pathname==='/firebase/auth/signup')return Response.json({localId:'test_user_1',idToken:'token-one',refreshToken:'refresh-one',expiresIn:'3600'});
    if(url.pathname==='/firebase/auth/refresh')return Response.json({user_id:'test_user_1',id_token:'token-two',refresh_token:'refresh-two',expires_in:'3600'});
    if(url.searchParams.get('auth')==='token-one')return Response.json({error:'expired'},{status:401});
    return Response.json({hostUid:'test_user_1'},{headers:{ETag:'"version-2"'}});
  };
  const result=await runtime.relay().request('invites/'+'a'.repeat(32),'GET',undefined,{etag:true});
  assert.equal(result.etag,'"version-2"');assert.equal(calls.length,4);
  assert.equal(calls[1].url.pathname,'/firebase/rtdb/constructor/v1/invites/'+'a'.repeat(32)+'.json');
  assert.equal(calls[1].init.headers['X-Firebase-ETag'],'true');
  assert.equal(calls[2].init.body,'grant_type=refresh_token&refresh_token=refresh-one');
  assert.equal(JSON.parse(records.get('constructor:test-project:auth')).token,'token-two');
});
