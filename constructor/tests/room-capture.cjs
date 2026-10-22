'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const sourcePath=require('./source-path.cjs');
function fixture(hotel='habblet'){
 const ctx={current:()=>true,parts:new Set(),protocols:{},ac:new AbortController()},box=vm.createContext({window:{_constructor:ctx},TextEncoder,TextDecoder,AbortController});
 const load=name=>vm.runInContext(fs.readFileSync(sourcePath(name+'.js'),'utf8'),box);
 load('protocol-habblet');load('protocol-habblive');ctx.hotel={id:hotel,name:hotel,protocol:ctx.protocols[hotel],storagePrefix:hotel+':'};load('core');load('runtime');
 ctx.extendRuntime=prototype=>{for(const name of Object.getOwnPropertyNames(prototype))if(name!=='constructor')Object.defineProperty(ctx.Runtime.prototype,name,Object.getOwnPropertyDescriptor(prototype,name));};
 for(const name of ['storage','projects','configurations'])load(name);
 Object.assign(ctx.Runtime.prototype,{async initProjects(){},learnCatalogIndex(){},learnCatalog(){}});
 const store=new Map(),runtime=new ctx.Runtime({setTimeout,clearTimeout,localStorage:{getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value)},_constructorBridge:{socket:{version:1,onConnection:()=>()=>{},onReceive:()=>()=>{},onSend:()=>()=>{}}}});
 runtime.ws={id:7,readyState:1};let saved;runtime.saveProject=async(name,layout)=>{saved={name,layout};};
 return {ctx,box,runtime,C:ctx.Core,saved:()=>saved};
}
function room(C,{opcode=1778,extended=false,unknown=false,trailing=false}={}){
 const fields=[['i',0],['i',2]],item=(id,x)=>[['i',id],['i',13],['i',x],['i',5],['i',4],['s','8.0'],['s','1.0'],['i',0]],tail=[['i',-1],['i',1],['i',7]];
 fields.push(...item(100,3),['i',unknown?8:6],['s','1']);
 if(extended)fields.push(['s','Placar'],['i',999],['s','Usuário(s)'],['s','Duração']);
 fields.push(['i',1],['i',0],['i',0],...tail,...item(101,4),['i',0],['s','0'],...tail);
 if(trailing)fields.push(['i',999]);return C.encode(opcode,fields);
}
test('Habblet lê placar com cabeçalhos e preserva os móveis seguintes',async()=>{
 const {ctx,C,runtime}=fixture();await runtime.ready;
 const layout=ctx.protocols.habblet.readRoom(C,room(C,{extended:true}));
 assert.equal(layout.length,2);assert.equal(layout[0].extraData,'1');assert.equal(layout[1].roomId,101);assert.equal(layout[1].relX,1);assert.equal(layout[1].z,'8.0');runtime.dispose();
});
test('Formato padrão permanece nos dois hotéis; extensão não é aplicada ao Habblive',async()=>{
 for(const hotel of ['habblet','habblive']){const {ctx,C,runtime}=fixture(hotel);await runtime.ready;assert.equal(ctx.protocols[hotel].readRoom(C,room(C)).length,2);assert.throws(()=>ctx.protocols[hotel].readRoom(C,room(C,{trailing:true})));if(hotel==='habblive')assert.throws(()=>ctx.protocols[hotel].readRoom(C,room(C,{extended:true})));runtime.dispose();}
});
test('Captura completa salva o quarto com placar, sem descartar móveis',async()=>{
 const {C,runtime,saved}=fixture();await runtime.ready;const capture=runtime.capture('Teste');runtime.feed(room(C,{extended:true}),runtime.ws);await capture;assert.equal(saved().layout.length,2);assert.equal(saved().name,'Teste');assert.equal(runtime.waiters.size,0);runtime.dispose();
});
test('Pacote de móveis inválido encerra a captura com erro imediato e não salva parcial',async()=>{
 const {C,runtime,saved}=fixture();await runtime.ready;const notices=[];runtime.on('notice',notice=>notices.push(notice));const capture=runtime.capture('Teste');const rejected=assert.rejects(capture,error=>error.code==='ROOM_CAPTURE_INVALID'&&/1778/.test(error.message));runtime.feed(room(C,{unknown:true}),runtime.ws);await rejected;assert.equal(saved(),undefined);assert.equal(runtime.busy,false);assert.equal(runtime.waiters.size,0);assert.ok(notices.some(notice=>notice.type==='error'));runtime.dispose();
});
test('Handler real de captura reabre a interface em falha e libera estado de espera',async()=>{
 const source=fs.readFileSync(sourcePath('ui.js'),'utf8'),start=source.indexOf("  $('capture').onclick=()=>attempt(async()=>{"),handler=source.slice(start,source.indexOf("  $('mount').onclick",start));
 let work,hidden=0,shown=0;const button={},state={copyWaiting:false};
 const box=vm.createContext({$:id=>id==='capture'?button:{value:'Teste'},attempt:fn=>{work=fn();},requireOriginalProjectHotel(){},supports:()=>true,runtime:{busy:false,projects:()=>({}),capture:async()=>{throw Error('Formato inválido');},progress:{}},state,disposed:false,ctx:{ui:{hide(){hidden++;},show(){shown++;}}},progress(){}});
 vm.runInContext(handler,box);button.onclick();await assert.rejects(work,/Formato inválido/);assert.equal(hidden,1);assert.equal(shown,1);assert.equal(state.copyWaiting,false);
});
