'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const ctx={current:()=>true,parts:new Set(),protocols:{},extendRuntime(prototype){
  for(const name of Object.getOwnPropertyNames(prototype))if(name!=='constructor')Object.defineProperty(Runtime.prototype,name,Object.getOwnPropertyDescriptor(prototype,name));
}};
class Runtime{}
const sandbox=vm.createContext({window:{_constructor:ctx},TextEncoder,TextDecoder});
const load=file=>vm.runInContext(fs.readFileSync(require('./source-path.cjs')(file),'utf8'),sandbox,{filename:file});
load('protocol-habblet.js');load('protocol-habblive.js');
ctx.hotel={protocol:ctx.protocols.habblet};
load('core.js');load('shapes.js');load('configurations.js');
const C=ctx.Core,habblet=ctx.protocols.habblet;
const plan=extraData=>C.planProject(C.normalizeProjects({room:{layout:[{spriteId:13,relX:0,relY:0,z:'0',rot:2,extraData}]}}).room,{x:1,y:1},[{itemId:55,spriteId:13,type:'s'}])[0];
const commands=item=>[...habblet.preparePlacement(C,item)].map(buffer=>new C.Reader(buffer,6).str());
const tracked=(protocol,item,state)=>{
  const runtime=new Runtime();
  Object.assign(runtime,{protocol,roomEpoch:1,configurationReport:{placed:0},pendingConfigurations:new Map(),supports:()=>false,publishConfiguration(){}});
  return runtime.trackConfiguration(item,{roomId:1,state,x:item.x,y:item.y,rot:item.rot},1);
};

for(const state of ['', '  ', null, undefined])test('Habblet aceita estado ausente/vazio do projeto: '+JSON.stringify(state),()=>{
  const item=plan(state);
  assert.equal(item.x,1);assert.equal(item.y,1);
  const result=commands(item);
  assert.equal(result.length,0);
});

test('Validação não envia comandos de chat para estado',()=>{
  assert.equal(commands(plan('3')).length,0);
  assert.equal(commands(plan('')).length,0);
});

test('Estado zero e estado numérico continuam explícitos',()=>{
  assert.equal(habblet.expectedState(C,plan('0')),'0');
  assert.equal(habblet.expectedState(C,plan(' 2 ')),'2');
  assert.equal(tracked(habblet,plan(' 2 '),'2').statePending,false);
  assert.equal(tracked(habblet,plan('2'),'3').statePending,true);
});

test('Planos de formas sem estado não exigem ajuste de estado',()=>{
  const item={spriteId:13,rot:0};
  assert.equal(commands(item).length,0);
  assert.equal(tracked(habblet,item,'0').statePending,false);
});

test('Estado vazio no Habblet não cria pendência falsa ao confirmar zero',()=>{
  const item=plan('');
  const result=tracked(habblet,item,'0');
  assert.equal(result.expectedState,undefined);
  assert.equal(result.statePending,false);
  assert.equal(item.extraData,'','Não alterar o estado salvo no projeto');
});

test('Habblive mantém a interpretação anterior dos estados',()=>{
  const result=tracked(ctx.protocols.habblive,plan(''),'0');
  assert.equal(result.expectedState,'');assert.equal(result.statePending,true);
});

test('Estado inválido aponta o móvel e não solicita números genéricos',()=>{
  assert.throws(()=>commands(plan('texto')),/estado.*13.*Habblet/i);
});

test('Campos numéricos obrigatórios continuam rejeitando vazio',()=>{
  assert.throws(()=>C.int('',-10000,10000),/Preencha/);
});
