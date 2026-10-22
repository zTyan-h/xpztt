'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const clone=value=>JSON.parse(JSON.stringify(value));
class Runtime{
  constructor(){
    const project=id=>({id,revision:1,originHotel:'habblet',layout:[{spriteId:13,relX:0,relY:0,z:'0',rot:0,extraData:'',color1:null,color2:null}],summary:{13:1}});
    this.bundle={version:2,original:{first:project('original_1'),second:project('original_2')},converted:{received:{...project('converted_1'),conversion:{sourceHotel:'habblive',targetHotel:'habblet',sourceId:'source_1',sourceRevision:1,pending:[],warnings:[],localModified:false}}},references:{converted_1:{id:'source_1',name:'source'}}};
    this.hotel={id:'habblet'};this.events=[];
  }
  storage(){return clone(this.bundle);}
  async persist(key,value){assert.equal(key,'constructor_projects_v2');this.bundle=clone(value);}
  emit(event){this.events.push(event);}
}
const ctx={current:()=>true,parts:new Set(),extendRuntime(prototype){
  for(const name of Object.getOwnPropertyNames(prototype))if(name!=='constructor')Object.defineProperty(Runtime.prototype,name,Object.getOwnPropertyDescriptor(prototype,name));
}};
const sandbox=vm.createContext({window:{_constructor:ctx},DOMException});
for(const file of ['core.js','projects.js'])vm.runInContext(fs.readFileSync(require('./source-path.cjs')(file),'utf8'),sandbox,{filename:file});

test('Renomear preserva identidade, móveis, ordem e outros projetos',async()=>{
  const runtime=new Runtime(),before=clone(runtime.bundle);
  assert.equal(await runtime.renameProject('first','  New name  ','original','original_1'),'New name');
  assert.deepEqual(Object.keys(runtime.bundle.original),['New name','second']);
  assert.deepEqual(runtime.bundle.original['New name'],{...before.original.first,revision:2});
  assert.deepEqual(runtime.bundle.original.second,before.original.second);
  assert.deepEqual(runtime.bundle.converted,before.converted);
  assert.deepEqual(runtime.events,['projects']);
});

test('Renomear convertido mantém referências e protege a edição local',async()=>{
  const runtime=new Runtime(),before=clone(runtime.bundle);
  await runtime.renameProject('received','Local name','converted','converted_1');
  const renamed=runtime.bundle.converted['Local name'];
  assert.equal(renamed.id,'converted_1');assert.equal(renamed.conversion.localModified,true);
  assert.deepEqual(runtime.bundle.references,before.references);
  assert.deepEqual(runtime.bundle.original,before.original);
});

test('Nome ocupado ou identificação antiga não sobrescreve dados',async()=>{
  const runtime=new Runtime(),before=clone(runtime.bundle);
  await assert.rejects(runtime.renameProject('first','second'),/nome já existe/i);
  await assert.rejects(runtime.renameProject('first','new','original','stale_id'),/projeto mudou/i);
  assert.deepEqual(runtime.bundle,before);
});

test('Nomes vazios e longos são rejeitados; cancelar com mesmo nome não muda revisão',async()=>{
  const runtime=new Runtime();
  assert.throws(()=>runtime.renameProject('first','   '),/120 caracteres/);
  assert.throws(()=>runtime.renameProject('first','a'.repeat(121)),/120 caracteres/);
  await runtime.renameProject('first','first');
  assert.equal(runtime.bundle.original.first.revision,1);
});

test('Nomes especiais continuam seguros no armazenamento',async()=>{
  const runtime=new Runtime();
  await runtime.renameProject('first','__proto__');
  assert.equal(runtime.projects().__proto__.id,'original_1');
  assert.equal(Object.getPrototypeOf(runtime.projects()),null);
});

test('Renomeações concorrentes passam pela fila e preservam ambas',async()=>{
  const runtime=new Runtime();
  await Promise.all([runtime.renameProject('first','A'),runtime.renameProject('second','B')]);
  assert.deepEqual(Object.keys(runtime.bundle.original),['A','B']);
});
