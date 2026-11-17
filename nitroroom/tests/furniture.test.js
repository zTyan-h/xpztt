import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,parseProject,changeModel,putItem,removeItem,canPlace,finishDrag,MAX_PROJECT_BYTES} from '../src/project.js';
const entry={key:'floor:13',type:'floor',width:2,height:1,available:true};
const item={id:1,key:entry.key,x:1,y:1,z:0,direction:0,state:0,colors:['#ff0022']};
test('v1 migrates and v2 keeps furniture/colors without shared references',()=>{
 const legacy={...createProject(),version:1};delete legacy.items;
 assert.deepEqual(parseProject(JSON.stringify(legacy)).items,[]);
 const p=putItem(createProject(),item,entry);const loaded=parseProject(JSON.stringify(p));
 assert.deepEqual(loaded,p);loaded.items[0].colors[0]='#ffffff';assert.equal(p.items[0].colors[0],'#FF0022');
});
test('missing catalog references survive import and unknown fields are dropped',()=>{
 const p=putItem(createProject(),{...item,key:'floor:99999999'},entry);
 const loaded=parseProject(JSON.stringify({...p,secret:true}));assert.equal(loaded.items[0].key,'floor:99999999');assert.equal(loaded.secret,undefined);
});
test('invalid items cannot enter a project',()=>{
 for(const patch of [{id:-1},{x:NaN},{direction:13},{colors:['red']},{key:'../secret'},{z:-2}])assert.throws(()=>putItem(createProject(),{...item,...patch},entry));
 const p=putItem(createProject(),item,entry);assert.throws(()=>parseProject(JSON.stringify({...p,items:[item,item]})));
 assert.throws(()=>parseProject(' '.repeat(MAX_PROJECT_BYTES+1)));
});
test('placement validates rotated footprints, blocked tiles and wall limits',()=>{
 const p=changeModel(createProject(),'000\n0x0\n000');
 assert.equal(canPlace(p.model,{...item,x:0,y:0},entry),true);
 assert.equal(canPlace(p.model,{...item,x:0,y:0,direction:90},entry),true);
 assert.equal(canPlace(p.model,{...item,x:0,y:1},entry),false);
 assert.equal(canPlace(p.model,{...item,x:2,y:0},entry),false);
 assert.equal(canPlace(p.model,{...item,wall:{side:'left',position:5,height:1}}, {...entry,type:'wall'}),false);
});
test('cancelled/invalid drops preserve original project; valid drop is one edit',()=>{
 const p=putItem(createProject(),item,entry);
 assert.equal(finishDrag(p,{...item,x:3},entry,true),p);
 assert.equal(finishDrag(p,{...item,x:90},entry,false),p);
 const moved=finishDrag(p,{...item,x:3},entry,false);assert.equal(moved.items[0].x,3);assert.equal(p.items[0].x,1);
 assert.equal(removeItem(moved,1).items.length,0);
});
