export const MAX_PROJECT_BYTES = 2_000_000;
export const MAX_ITEMS = 2000;
export const WALL_HEIGHT_MIN = 3.6;
export const WALL_HEIGHT_MAX = 32;
export const WALL_HEIGHT_DEFAULT = 6.6;
export function createProject() {
  return {format:'wired-local',version:2,name:'Meu primeiro quarto',model:Array(8).fill('00000000').join('\n'),wallHeight:WALL_HEIGHT_DEFAULT,items:[]};
}
export function changeModel(project,value) {
  const model=value.replace(/\r\n?/g,'\n').trim().toLowerCase();const rows=model.split('\n');
  if(!model||rows.length>64||rows[0].length>64||rows.some(row=>row.length!==rows[0].length||!/^[0-9a-wx]+$/.test(row)))throw new Error('Use um mapa retangular de até 64 × 64, com alturas de 0 a w e x para vazio.');
  if(!/[0-9a-w]/.test(model))throw new Error('O quarto precisa ter pelo menos um piso.');
  return {...project,model};
}
export function changeWallHeight(project,wallHeight,itemName=item=>`mobi #${item.id}`) {
  if(!Number.isFinite(wallHeight)||wallHeight<WALL_HEIGHT_MIN||wallHeight>WALL_HEIGHT_MAX||Math.abs(wallHeight*10-Math.round(wallHeight*10))>1e-9) {
    throw new Error('Use uma altura de parede de 3,6 a 32, em passos de 0,1.');
  }
  const above=project.items.find(item=>item.wall&&item.wall.height>wallHeight);
  if(above)throw new Error(`Mova ${itemName(above)} para baixo antes de baixar a parede.`);
  return {...project,wallHeight};
}
function normalizeItem(value,wallHeight) {
  if(!value||!Number.isSafeInteger(value.id)||value.id<1||!/^\b(floor|wall):\d+$/.test(value.key)||
    ![value.x,value.y,value.z].every(Number.isFinite)||value.x<0||value.y<0||value.x>=64||value.y>=64||value.z<0||value.z>100||
    !Number.isInteger(value.direction)||value.direction<0||value.direction>=360||value.direction%45||!Number.isInteger(value.state)||value.state<0||value.state>1_000_000||
    !Array.isArray(value.colors)||value.colors.length>2||value.colors.some(color=>typeof color!=='string'||!/^#[0-9a-f]{6}$/i.test(color)))throw new Error('O projeto contém um mobi inválido.');
  const item={id:value.id,key:value.key,x:value.x,y:value.y,z:value.z,direction:value.direction,state:value.state,colors:value.colors.map(color=>color.toUpperCase())};
  if(value.photo!==undefined){if(typeof value.photo!=='string'||!/^[a-f0-9]{16}$/.test(value.photo))throw new Error('Foto inválida no projeto.');item.photo=value.photo;}
  if(value.wall!==undefined){const wall=value.wall;if(!wall||!['left','right'].includes(wall.side)||![wall.position,wall.height].every(Number.isFinite)||wall.position<0||wall.position>64||wall.height<0||wall.height>wallHeight)throw new Error('Posição de parede inválida.');item.wall={side:wall.side,position:wall.position,height:wall.height};}
  return item;
}
export function parseProject(text) {
  if(text.length>MAX_PROJECT_BYTES)throw new Error('O projeto excede o limite de 2 MB.');
  const data=JSON.parse(text);
  if(!data||data.format!=='wired-local'||![1,2].includes(data.version)||typeof data.name!=='string'||!data.name.trim()||data.name.length>100||typeof data.model!=='string')throw new Error('Arquivo de projeto WIRED inválido.');
  const items=data.version===1?[]:data.items;
  if(!Array.isArray(items)||items.length>MAX_ITEMS)throw new Error('O projeto permite até 2.000 mobis.');
  const base=changeWallHeight({format:'wired-local',version:2,name:data.name.trim(),items:[]},data.wallHeight===undefined?WALL_HEIGHT_DEFAULT:data.wallHeight);
  const normalized=items.map(item=>normalizeItem(item,base.wallHeight));
  if(new Set(normalized.map(item=>item.id)).size!==normalized.length)throw new Error('O projeto contém IDs de mobis repetidos.');
  return changeModel({...base,items:normalized},data.model);
}
export function canPlace(model,item,entry,wallHeight=WALL_HEIGHT_DEFAULT) {
  const rows=model.split('\n');if(!entry||!entry.available)return false;
  if(entry.type==='wall')return !!item.wall&&['left','right'].includes(item.wall.side)&&item.wall.position>=0&&item.wall.position<(item.wall.side==='left'?rows.length:rows[0].length)&&item.wall.height>=0&&item.wall.height<=wallHeight;
  if(!Number.isInteger(item.x)||!Number.isInteger(item.y))return false;
  const {width,height}=floorFootprint(item,entry);
  return fitsFloor(rows,item.x,item.y,width,height);
}
export function floorFootprint(item,entry) {
  const swapped=item.direction%180===90;
  return {width:Math.max(1,swapped?entry.height:entry.width),height:Math.max(1,swapped?entry.width:entry.height)};
}
function fitsFloor(rows,x,y,width,height) {
  for(let row=y;row<y+height;row++)for(let col=x;col<x+width;col++)if(!rows[row]?.[col]||rows[row][col]==='x')return false;
  return true;
}
export function putItem(project,value,entry) {
  const item=normalizeItem(value,project.wallHeight);if(entry&&!canPlace(project.model,item,entry,project.wallHeight))throw new Error('O mobi não cabe nesse destino.');
  const exists=project.items.some(other=>other.id===item.id);
  if(!exists&&project.items.length>=MAX_ITEMS)throw new Error('Limite de 2.000 mobis atingido.');
  return {...project,items:exists?project.items.map(other=>other.id===item.id?item:other):[...project.items,item]};
}
export function removeItem(project,id){return {...project,items:project.items.filter(item=>item.id!==id)};}
export function finishDrag(project,item,entry,cancelled){return cancelled||!item||!canPlace(project.model,item,entry,project.wallHeight)?project:putItem(project,item,entry);}

export function areaPlacements(model,entry,item,start,end) {
  if(!entry?.available||entry.type!=='floor'||!start||!end)return [];
  const rows=model.split('\n');
  for(const {x,y} of [start,end]) {
    if(!Number.isInteger(x)||!Number.isInteger(y)||!rows[y]?.[x])return [];
  }
  const {width,height}=floorFootprint(item,entry);
  const left=Math.min(start.x,end.x), right=Math.max(start.x,end.x);
  const top=Math.min(start.y,end.y), bottom=Math.max(start.y,end.y);
  const placements=[];
  for(let y=top;y+height-1<=bottom;y+=height) {
    for(let x=left;x+width-1<=right;x+=width) {
      if(fitsFloor(rows,x,y,width,height))placements.push({x,y,z:parseInt(rows[y][x],36)});
    }
  }
  return placements;
}

export function finishArea(project,entry,item,start,end,cancelled) {
  if(cancelled)return project;
  const placements=areaPlacements(project.model,entry,item,start,end);
  if(!placements.length)return project;
  const remaining=MAX_ITEMS-project.items.length;
  if(placements.length>remaining)throw new Error(`Restam ${remaining} vagas no quarto. Selecione uma área menor.`);
  let id=project.items.reduce((max,other)=>Math.max(max,other.id),0);
  const added=placements.map(placement=>normalizeItem({...item,...placement,id:++id},project.wallHeight));
  return {...project,items:[...project.items,...added]};
}
