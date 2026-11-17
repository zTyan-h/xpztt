import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,parseProject,changeModel,changeWallHeight,putItem,removeItem,canPlace,finishDrag,areaPlacements,finishArea,MAX_PROJECT_BYTES,MAX_ITEMS} from '../src/project.js';
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

test('wall height survives reload and limits both wall sides, including photos',()=>{
 const wallEntry={...entry,key:'wall:12',type:'wall'};
 const project=changeWallHeight(createProject(),10.2);
 const photo={...item,key:wallEntry.key,z:8,photo:'0123456789abcdef',wall:{side:'left',position:1,height:8}};
 const placed=finishDrag(project,photo,wallEntry,false);
 const moved=putItem(placed,{...photo,z:10.2,wall:{...photo.wall,side:'right',height:10.2}},wallEntry);
 assert.deepEqual(parseProject(JSON.stringify(moved)),moved);
 assert.throws(()=>changeWallHeight(moved,9,()=> 'a foto'),/Mova a foto para baixo/);
 assert.throws(()=>putItem(moved,{...photo,z:10.3,wall:{...photo.wall,height:10.3}},wallEntry),/Posição de parede/);
 assert.equal(finishDrag(moved,{...photo,wall:{...photo.wall,height:11}},wallEntry,false),moved);
 assert.equal(changeWallHeight(placed,8).items[0].wall.height,8);
});

test('old projects keep the default wall height and malformed settings are rejected',()=>{
 for(const version of [1,2]){
  const legacy={...createProject(),version};delete legacy.wallHeight;
  assert.equal(parseProject(JSON.stringify(legacy)).wallHeight,6.6);
 }
 for(const wallHeight of [3.5,32.1,8.22,NaN,null,'8']){
  assert.throws(()=>changeWallHeight(createProject(),wallHeight),/altura de parede/);
 }
});

test('area uses a stable grid, skips voids and does not place partial footprints',()=>{
 const {model}=changeModel(createProject(),'12000\n00x00\n23456');
 const start={x:0,y:0},end={x:4,y:2};
 const expected=[{x:0,y:0,z:1},{x:2,y:0,z:0},{x:0,y:1,z:0},{x:0,y:2,z:2},{x:2,y:2,z:4}];
 assert.deepEqual(areaPlacements(model,entry,item,start,end),expected);
 assert.deepEqual(areaPlacements(model,entry,item,end,start),expected);
 assert.deepEqual(areaPlacements(model,entry,{...item,direction:90},start,end),[
  {x:0,y:0,z:1},{x:1,y:0,z:2},{x:3,y:0,z:0},{x:4,y:0,z:0},
 ]);
 assert.deepEqual(areaPlacements(model,entry,item,start,{x:2,y:1}),[{x:0,y:0,z:1},{x:0,y:1,z:0}]);
 assert.deepEqual(areaPlacements(model,entry,item,start,{x:5,y:1}),[]);
});

test('area appends independent copies atomically and respects cancellation and capacity',()=>{
 const project=putItem(createProject(),{...item,id:12,x:0,y:0},entry);
 const start={x:0,y:0},end={x:3,y:0};
 assert.equal(finishArea(project,entry,item,start,end,true),project);
 assert.equal(finishArea(project,entry,item,start,null,false),project);
 const next=finishArea(project,entry,item,start,end,false);
 assert.deepEqual(next.items.map(value=>value.id),[12,13,14]);
 assert.deepEqual(next.items.map(value=>value.x),[0,0,2]);
 assert.equal(project.items.length,1);
 assert.notEqual(next.items[1].colors,next.items[2].colors);
 assert.deepEqual(parseProject(JSON.stringify(next)),next);
 const almostFull={...project,items:Array.from({length:MAX_ITEMS-1},(_,index)=>({...item,id:index+1}))};
 assert.throws(()=>finishArea(almostFull,entry,item,start,end,false),/Restam 1 vagas/);
 assert.equal(almostFull.items.length,MAX_ITEMS-1);
});
