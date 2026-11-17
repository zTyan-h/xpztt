export const MAX_PROJECT_BYTES = 2_000_000;
export function createProject() {
  return {format:'wired-local',version:2,name:'Meu primeiro quarto',model:Array(8).fill('00000000').join('\n'),items:[]};
}
export function changeModel(project,value) {
  const model=value.replace(/\r\n?/g,'\n').trim().toLowerCase();const rows=model.split('\n');
  if(!model||rows.length>64||rows[0].length>64||rows.some(row=>row.length!==rows[0].length||!/^[0-9a-wx]+$/.test(row)))throw new Error('Use um mapa retangular de até 64 × 64, com alturas de 0 a w e x para vazio.');
  if(!/[0-9a-w]/.test(model))throw new Error('O quarto precisa ter pelo menos um piso.');
  return {...project,model};
}
function normalizeItem(value) {
  if(!value||!Number.isSafeInteger(value.id)||value.id<1||!/^\b(floor|wall):\d+$/.test(value.key)||
    ![value.x,value.y,value.z].every(Number.isFinite)||value.x<0||value.y<0||value.x>=64||value.y>=64||value.z<0||value.z>100||
    !Number.isInteger(value.direction)||value.direction<0||value.direction>=360||value.direction%45||!Number.isInteger(value.state)||value.state<0||value.state>1_000_000||
    !Array.isArray(value.colors)||value.colors.length>2||value.colors.some(color=>typeof color!=='string'||!/^#[0-9a-f]{6}$/i.test(color)))throw new Error('O projeto contém um mobi inválido.');
  const item={id:value.id,key:value.key,x:value.x,y:value.y,z:value.z,direction:value.direction,state:value.state,colors:value.colors.map(color=>color.toUpperCase())};
  if(value.wall!==undefined){const wall=value.wall;if(!wall||!['left','right'].includes(wall.side)||![wall.position,wall.height].every(Number.isFinite)||wall.position<0||wall.position>64||wall.height<0||wall.height>3)throw new Error('Posição de parede inválida.');item.wall={side:wall.side,position:wall.position,height:wall.height};}
  return item;
}
export function parseProject(text) {
  if(text.length>MAX_PROJECT_BYTES)throw new Error('O projeto excede o limite de 2 MB.');
  const data=JSON.parse(text);
  if(!data||data.format!=='wired-local'||![1,2].includes(data.version)||typeof data.name!=='string'||!data.name.trim()||data.name.length>100||typeof data.model!=='string')throw new Error('Arquivo de projeto WIRED inválido.');
  const items=data.version===1?[]:data.items;
  if(!Array.isArray(items)||items.length>2000)throw new Error('O projeto permite até 2.000 mobis.');
  const normalized=items.map(normalizeItem);
  if(new Set(normalized.map(item=>item.id)).size!==normalized.length)throw new Error('O projeto contém IDs de mobis repetidos.');
  return changeModel({format:'wired-local',version:2,name:data.name.trim(),items:normalized},data.model);
}
export function canPlace(model,item,entry) {
  const rows=model.split('\n');if(!entry||!entry.available)return false;
  if(entry.type==='wall')return !!item.wall&&['left','right'].includes(item.wall.side)&&item.wall.position>=0&&item.wall.position<(item.wall.side==='left'?rows.length:rows[0].length)&&item.wall.height>=0&&item.wall.height<=3;
  if(!Number.isInteger(item.x)||!Number.isInteger(item.y))return false;
  const swapped=item.direction%180===90;const width=Math.max(1,swapped?entry.height:entry.width);const height=Math.max(1,swapped?entry.width:entry.height);
  for(let y=item.y;y<item.y+height;y++)for(let x=item.x;x<item.x+width;x++)if(!rows[y]?.[x]||rows[y][x]==='x')return false;
  return true;
}
export function putItem(project,value,entry) {
  const item=normalizeItem(value);if(entry&&!canPlace(project.model,item,entry))throw new Error('O mobi não cabe nesse destino.');
  const exists=project.items.some(other=>other.id===item.id);
  if(!exists&&project.items.length>=2000)throw new Error('Limite de 2.000 mobis atingido.');
  return {...project,items:exists?project.items.map(other=>other.id===item.id?item:other):[...project.items,item]};
}
export function removeItem(project,id){return {...project,items:project.items.filter(item=>item.id!==id)};}
export function finishDrag(project,item,entry,cancelled){return cancelled||!item||!canPlace(project.model,item,entry)?project:putItem(project,item,entry);}
