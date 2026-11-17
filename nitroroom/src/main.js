import './ui/workspace.css';
import './style.css';
import {workspaceMarkup,setActive,toggleWorkspacePanel} from './ui/workspace.mjs';
import {createFeedback} from './ui/feedback.mjs';
import {createProject,parseProject,changeModel,changeWallHeight,putItem,removeItem,canPlace,finishDrag,areaPlacements,finishArea,floorFootprint,MAX_PROJECT_BYTES,MAX_ITEMS,WALL_HEIGHT_MIN,WALL_HEIGHT_MAX} from './project.js';
import {searchCatalog} from './catalog.js';
import {fitPhotoFrame,PHOTO_SIZE} from './photo-frame.js';
import {createAutoSave,restoreProject,PROJECT_KEY,SESSION_KEY} from './auto-save.js';

const $=id=>document.getElementById(id);
function readList(key){try{const v=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(v)?v.filter(x=>typeof x==='string').slice(0,2000):[];}catch{return [];}}
let favorites=readList('wired:favorites'),recent=readList('wired:recent');
const local={getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)};
const restored=restoreProject({local,session:{getItem:key=>sessionStorage.getItem(key)},parseProject,createProject});
let project=restored.project,migrateSession=restored.recovered;
let photos=[],cameraOn=false,preview,entries=[],entryMap=new Map(),catalogReady=false,selectedId=null,selectedCatalog=null,errors=[],page=0,filtered=[],catalogEpoch=0,selectionEpoch=0,renderEpoch=0,drag=null,armedMove=null,loading=false;
const undo=[],redo=[],infoCache=new Map(),thumbCache=new Map(),thumbJobs=[];
let thumbWorkers=0,thumbStore,thumbWrites=0,pruning,suppressCatalogClickUntil=0;
let fillTool=null;

const app=document.querySelector('#app');
app.innerHTML=workspaceMarkup({
 catalogBody:`<div id="items-panel" class="nr-library">
  <div class="ws-panel-head"><label class="ws-sr" for="search">Buscar mobis por nome, descrição, ID ou classname</label>
   <input id="search" type="search" placeholder="Buscar mobis" autocomplete="off">
   <div class="nr-filters"><select id="filter-type" aria-label="Tipo de mobi"><option value="">Piso e parede</option><option value="floor">Piso</option><option value="wall">Parede</option></select><select id="filter-view" aria-label="Coleção"><option value="">Todos</option><option value="wired">Wired</option><option value="colorable">Coloríveis</option><option value="favorites">Favoritos</option><option value="recent">Recentes</option></select></div>
   <label class="nr-check"><input type="checkbox" id="available" checked> Somente disponíveis</label>
   <div class="nr-catalog-count"><span id="catalog-result">Preparando índice local…</span><span id="catalog-total"></span></div>
  </div>
  <div id="catalog-grid" class="ws-catalog-grid ws-scroll" aria-label="Resultados do catálogo"></div>
  <div class="nr-pagination"><button id="previous" aria-label="Página anterior">←</button><span id="page-label"></span><button id="next" aria-label="Próxima página">→</button></div>
 </div>
 <div id="photos-panel" class="nr-library" hidden>
  <div class="ws-panel-head"><label for="photo-frame">Moldura da foto</label><select id="photo-frame"></select>
   <p class="ws-meta">Arraste a foto até a parede. Clique duas vezes para ampliar.</p><span id="photo-total" class="ws-sr"></span>
  </div>
  <div id="photo-grid" class="ws-catalog-grid ws-scroll" aria-label="Fotos salvas"></div>
 </div>`,
 roomOptions:'<button id="room-settings">Quarto</button><button id="retry" hidden>Verificar assets</button>',
 viewportBody:`<div id="canvas-host">
  <div id="camera-overlay" class="ws-photo-guide" hidden>
   <div id="photo-frame-box" class="ws-photo-frame nr-frame" role="group" tabindex="0" aria-label="Enquadramento de ${PHOTO_SIZE} por ${PHOTO_SIZE} pixels" aria-describedby="photo-frame-help">
    <button id="shoot" class="ws-primary nr-frame-shoot">Tirar foto</button>
   </div>
   <span id="photo-frame-help" class="ws-sr">Arraste a moldura ou use as setas para movê-la.</span>
   <div class="nr-photo-actions"><button id="photo-reset">Centralizar</button><button id="camera-close">Fechar câmera</button></div>
  </div></div>
  <div id="empty" class="nr-empty"><h2 id="preview-heading">Preparando seu quarto</h2><p id="preview-message">Inicializando a renderização local.</p><ul id="missing"></ul></div>
  `,
})+`
<input id="file" type="file" accept=".json,application/json" hidden>
<dialog id="room-dialog"><form id="room-form" method="dialog"><div class="panel-title">Configurar quarto<button id="room-close" type="button" aria-label="Fechar">×</button></div><label for="name">Nome do projeto</label><input id="name" maxlength="100"><label for="wall-height">Altura da parede</label><input id="wall-height" type="number" min="${WALL_HEIGHT_MIN}" max="${WALL_HEIGHT_MAX}" step="0.1" required><div class="section-heading"><h2>Mapa de alturas</h2><span id="dimensions"></span></div><p class="help">Use 0–9 e a–w para alturas, x para vazio. Até 64 × 64.</p><label class="sr-only" for="model">Mapa do quarto</label><textarea id="model" spellcheck="false" wrap="off"></textarea><button id="apply" type="submit" class="primary">Aplicar alterações</button></form></dialog>
<dialog id="photo-dialog"><form method="dialog"><div class="panel-title">Foto<button aria-label="Fechar">×</button></div><img id="photo-view" alt="Foto do quarto" width="320" height="320"></form></dialog>
<div id="drag-label" hidden></div>`;
const workspace=app.firstElementChild;
const host=$('canvas-host');
const photoFrameBox=$('photo-frame-box');
let photoFrame=null,frameGesture=null,takingPhoto=false;
const feedback=createFeedback({notice:$('notice'),flash:$('flash'),storageKey:'wired:sound'});
const dialogError=document.createElement('p');
dialogError.id='room-error';dialogError.setAttribute('role','alert');
$('apply').before(dialogError);
function message(text,error=false,sound=error?'error':null){
 const modalError=$('room-error');
 if(error&&$('room-dialog').open&&modalError)modalError.textContent=text;
 else feedback.report(text,error?'error':'success');
 if(sound&&navigator.userActivation?.hasBeenActive)feedback.play(sound);
}
function syncSound(){
 $('sound').textContent=feedback.enabled?'Som ligado':'Som desligado';
 $('sound').setAttribute('aria-pressed',String(feedback.enabled));
}
$('sound').onclick=()=>{feedback.toggle();syncSound();};
syncSound();
for(const panel of ['catalog','inspector']){
 workspace.querySelector(`[data-action="toggle-${panel}"]`).onclick=()=>{
  cancelDrag();toggleWorkspacePanel(workspace,panel);if(panel==='inspector')renderObjects();feedback.play('tool');
 };
}
function showInspector(showObjects,sound=false){
 setActive(workspace,'#selection-tab,#objects-tab',$(showObjects?'objects-tab':'selection-tab'));
 $('selection').hidden=showObjects;
 workspace.querySelector('[data-objects]').hidden=!showObjects;
 if(showObjects)renderObjects();
 if(sound)feedback.play('tool');
}
$('selection-tab').onclick=()=>showInspector(false,true);
$('objects-tab').onclick=()=>showInspector(true,true);
const normalizeSearch=value=>value.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const objectPanel=workspace.querySelector('[data-objects]');
let objectRows=new Map(),objectListKey,highlightedId=null;
function syncSelection(){
 preview?.selectItem(selectedId);
 if(highlightedId===selectedId)return;
 objectRows.get(highlightedId)?.setAttribute('aria-pressed','false');
 objectRows.get(selectedId)?.setAttribute('aria-pressed','true');
 highlightedId=selectedId;
}
function renderObjects(){
 if(objectPanel.hidden||$('ws-inspector-panel').hidden)return;
 const query=normalizeSearch($('ws-object-search').value.trim());
 const key=[query,project.items,entryMap,errors];
 if(objectListKey&&key.every((value,index)=>value===objectListKey[index]))return;
 objectListKey=key;objectRows=new Map();highlightedId=selectedId;
 const failure=new Map(errors.map(error=>[error.id,error.message]));
 const rows=[];
 for(const item of project.items){
  const label=entryMap.get(item.key)?.name||`Mobi ${item.key}`;
  if(query&&!normalizeSearch(label).includes(query))continue;
  const row=document.createElement('button');row.className='ws-object';
  row.setAttribute('aria-pressed',String(item.id===selectedId));
  const name=document.createElement('span');name.textContent=label;
  const coords=document.createElement('span');coords.textContent=item.wall?'Parede':`${item.x}, ${item.y}`;
  row.append(name,coords);
  row.title=failure.get(item.id)||`${label} · altura ${item.z}`;
  if(failure.has(item.id))row.classList.add('object-error');
  row.onclick=()=>selectObject(item.id);rows.push(row);objectRows.set(item.id,row);
 }
 if(!rows.length){
  const empty=document.createElement('p');empty.className='ws-empty';
  empty.textContent=query?'Nenhum mobi encontrado.':'O quarto ainda está vazio.';rows.push(empty);
 }
 $('objects').replaceChildren(...rows);
}
$('ws-object-search').oninput=renderObjects;
function remember(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{message('Não foi possível guardar preferências neste navegador.',true);}}
function sync(){
 syncSelection();
 $('project-menu').querySelector('summary').title=project.name;
 const rows=project.model.split('\n');$('room-size').textContent=$('dimensions').textContent=`${rows[0].length} × ${rows.length}`;
 $('undo').disabled=!undo.length;$('redo').disabled=!redo.length;$('object-count').textContent=project.items.length;
 renderObjects();
}
async function renderProject(){
 if(!preview)return;
 const epoch=++renderEpoch;
 try{
  preview.setModel(project.model,project.wallHeight);
  if(!catalogReady)return;
  await preview.setItems(project.items,entryMap,next=>{
   if(epoch!==renderEpoch)return;
   if(next.length===errors.length&&next.every((failure,index)=>failure.id===errors[index].id&&failure.message===errors[index].message))return;
   errors=next;renderObjects();
   if(errors.length)message(`${errors.length} mobi(s) preservado(s), mas sem prévia: ${errors[0].message}`,true,null);
  });
 }catch(error){if(epoch===renderEpoch)message(error.message,true,null);}
}
let saveStatus;
function saveState(state){
 const previous=saveStatus;saveStatus=state;
 const status=$('project-status');
 status.textContent={draft:'Rascunho',pending:'Salvando…',saved:'Salvo automaticamente',error:'Falha ao salvar',conflict:'Projeto alterado em outra aba'}[state];
 status.dataset.saved=String(state==='saved');status.dataset.state=state;status.title=status.textContent;
 if(state==='saved'&&migrateSession){
  migrateSession=false;
  try{sessionStorage.removeItem(SESSION_KEY);}catch{/* O rascunho durável já foi gravado. */}
 }
 if(state!==previous&&(state==='error'||state==='conflict')){
  message(state==='error'?'Não foi possível salvar neste navegador. Use Projeto → Exportar JSON.':'Outra aba salvou este projeto. Exporte seu rascunho em Projeto → Exportar JSON.',true,null);
 }
}
const autoSave=createAutoSave({storage:local,key:PROJECT_KEY,onStatus:saveState});
function commit(next,sound='edit'){
 if(next===project||JSON.stringify(next)===JSON.stringify(project))return false;
 if(fillTool)cancelDrag();undo.push(project);if(undo.length>50)undo.shift();redo.length=0;project=next;
 autoSave.schedule(project);sync();renderProject();showSelection();if(sound)feedback.play(sound);return true;
}
function history(back){cancelDrag();const source=back?undo:redo,target=back?redo:undo;if(!source.length)return;target.push(project);project=source.pop();autoSave.schedule(project);if(!project.items.some(i=>i.id===selectedId))selectedId=null;sync();renderProject();showSelection();message(back?'Alteração desfeita.':'Alteração refeita.',false,'edit');}
$('undo').onclick=()=>history(true);$('redo').onclick=()=>history(false);
$('room-settings').onclick=()=>{
 cancelDrag();
 dialogError.textContent='';feedback.play('tool');
 $('name').value=project.name;$('model').value=project.model;$('wall-height').value=String(project.wallHeight);
 $('room-dialog').showModal();
};
$('room-close').onclick=()=>$('room-dialog').close();
$('room-form').onsubmit=event=>{
 event.preventDefault();
 dialogError.textContent='';
 try{
  const name=$('name').value.trim();if(!name)throw new Error('Dê um nome ao quarto.');
  const next=changeWallHeight(changeModel({...project,name},$('model').value),$('wall-height').valueAsNumber,item=>entryMap.get(item.key)?.name||`mobi #${item.id}`);
  const outside=next.model!==project.model&&next.items.some(item=>{
   const entry=entryMap.get(item.key);return entry?.available&&!canPlace(next.model,item,entry,next.wallHeight);
  });
  if(outside)throw new Error('Há um mobi fora do novo mapa. Mova ou exclua esse objeto antes de aplicar.');
  commit(next);$('room-dialog').close();message('Quarto atualizado.');
 }catch(error){message(error.message,true);}
};
function closeProjectMenu(){
 const menu=$('project-menu');menu.open=false;menu.querySelector('summary').focus();
}
$('save').onclick=()=>{
 closeProjectMenu();
 autoSave.schedule(project);
 let saved=autoSave.flush();
 if(!saved&&saveStatus==='conflict'&&confirm('Outra aba salvou uma versão diferente. Você pode cancelar e usar Projeto → Exportar JSON. Substituir a versão salva pelo rascunho desta aba?')){
  saved=autoSave.flush({overwrite:true});
 }
 if(saved)message('Quarto e mobis salvos neste navegador.',false,'success');
};
$('export').onclick=()=>{closeProjectMenu();const url=URL.createObjectURL(new Blob([JSON.stringify(project,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='quarto.nitroroom.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message('Projeto exportado com mobis, estados e cores.',false,'success');};
$('import').onclick=()=>{closeProjectMenu();$('file').click();};$('file').onchange=async()=>{try{const file=$('file').files[0];if(!file)return;if(file.size>MAX_PROJECT_BYTES)throw new Error('Limite de 2 MB por projeto.');const next=parseProject(await file.text());cancelDrag();selectedId=null;selectedCatalog=null;showInspector(false);if(!commit(next,'success')){sync();showSelection();}message('Projeto importado. Salve para manter este rascunho.');}catch(error){message(error.message,true);}finally{$('file').value='';}};
function readPackageInfo(name){
 const existing=infoCache.get(name);
 if(existing){infoCache.delete(name);infoCache.set(name,existing);return existing;}
 const task=(async()=>{
  const response=await fetch(`/catalog/info/${encodeURIComponent(name)}`,{cache:'no-cache',signal:AbortSignal.timeout(15_000)});
  if(!response.ok)throw new Error(`Metadados indisponíveis (${response.status}): ${name}.`);
  const data=await response.json();
  const nonemptyNumbers=values=>Array.isArray(values)&&values.length>0&&values.every(Number.isFinite);
  if(!nonemptyNumbers(data?.directions)||!nonemptyNumbers(data?.states)||![0,1,2].includes(data?.colorChannels)||
     typeof data?.revision!=='string'||!(/^[a-f0-9]{64}$/i).test(data.revision))throw new Error(`Metadados inválidos: ${name}.`);
  return data;
 })();
 infoCache.set(name,task);
 if(infoCache.size>512)infoCache.delete(infoCache.keys().next().value);
 void task.catch(()=>{if(infoCache.get(name)===task)infoCache.delete(name);});
 return task;
}
function info(entry){return preview?preview.prepare(entry):readPackageInfo(entry.packageName);}
function selectedItem(){return project.items.find(item=>item.id===selectedId);}
function selectObject(id){if(fillTool)cancelDrag();selectedId=id;selectedCatalog=null;showInspector(false);syncSelection();showSelection();}
function selectCatalog(entry){if(fillTool)cancelDrag();selectedId=null;selectedCatalog=entry;showInspector(false);syncSelection();showSelection();feedback.play('tool');}
function clearSelection(){armedMove=null;cancelDrag();selectedId=null;selectedCatalog=null;showSelection();syncSelection();}
function field(label,element){const wrapper=document.createElement('label');wrapper.className='inspector-field';wrapper.append(document.createTextNode(label),element);return wrapper;}
function action(label,fn,disabled=false){const button=document.createElement('button');button.textContent=label;button.disabled=disabled;button.onclick=()=>{try{const result=fn();if(result?.catch)result.catch(error=>message(error.message,true));}catch(error){message(error.message,true);}};return button;}
async function showSelection(){
 const epoch=++selectionEpoch,item=selectedItem(),entry=item?entryMap.get(item.key):selectedCatalog;const panel=$('selection');panel.replaceChildren();
 if(!entry&&!item){panel.innerHTML='<p class="help">Selecione um mobi no catálogo ou no quarto.</p>';return;}
 const title=document.createElement('div');title.className='nr-selection-title';
 const heading=document.createElement('h2');heading.textContent=entry?.name||`Mobi ${item.key}`;
 const clear=action('×',clearSelection);clear.setAttribute('aria-label','Limpar seleção');title.append(heading,clear);panel.append(title);
 const description=document.createElement('p');description.className='ws-meta';description.textContent=entry?`${entry.classname} · ${entry.type==='wall'?'Parede':'Piso'} · ${entry.typeId}`:'Asset ausente no catálogo local.';panel.append(description);
 if(item)panel.append(action('Excluir',()=>{selectedId=null;commit(removeItem(project,item.id));}));
 if(!entry?.available){const p=document.createElement('p');p.className='help';p.textContent='Pacote local ausente. O objeto continua salvo no projeto.';panel.append(p);return;}
 const loading=document.createElement('p');loading.className='help';loading.textContent='Lendo direções, estados e cores…';panel.append(loading);
 try{const meta=await info(entry);if(epoch!==selectionEpoch)return;loading.remove();
 if(item&&errors.some(error=>error.id===item.id))void renderProject();
 const dimensions=document.createElement('p');dimensions.className='help';dimensions.textContent=`${entry.width} × ${entry.height} pisos · ${meta.states.length} estado(s)`;panel.append(dimensions);
 if(!item){
  const controls=document.createElement('div');controls.className='ws-actions';
  controls.append(action('Adicionar ao quarto',()=>addAutomatically(entry,meta),!preview));
  if(entry.type==='floor'){
   const fill=action('Preencher área',()=>toggleFill(entry,meta),!preview);fill.id='fill-area';fill.className='ws-primary';
   fill.setAttribute('aria-pressed',String(fillTool?.entry.key===entry.key));controls.append(fill);
  }
  panel.append(controls);const hint=document.createElement('p');hint.className='help';hint.textContent='Ou arraste o mobi do catálogo até o destino.';panel.append(hint);return;
 }
 const actions=document.createElement('div');actions.className='ws-actions';
 const update=patch=>commit(putItem(project,{...selectedItem(),...patch},entry));
 const rotate=action('Girar (R)',()=>{
  const current=selectedItem();const values=meta.directions;
  if(update({direction:values[(values.indexOf(current.direction)+1)%values.length]}))message('Mobi girado.');
 },meta.directions.length<2);
 rotate.id='rotate-item';rotate.setAttribute('aria-keyshortcuts','R');
 actions.append(rotate,action('Mover',()=>{if(cameraOn)setCamera(false);armedMove=item.id;updateRoomMode();dropHint('Arraste o mobi no quarto · Escape cancela');feedback.play('tool');}),action('Mudar estado',()=>{const current=selectedItem();const values=meta.states;update({state:values[(values.indexOf(current.state)+1)%values.length]});},meta.states.length<2),action('Duplicar',()=>{const copy={...selectedItem(),id:nextId(),colors:[...selectedItem().colors]};commit(putItem(project,copy,entry));selectedId=copy.id;showSelection();syncSelection();}));panel.append(actions);
 const status=document.createElement('p');status.className='help';status.textContent=`Direção ${item.direction}° · estado ${item.state}`;panel.append(status);
 const height=document.createElement('input');height.type='number';height.min='0';height.max=String(item.wall?project.wallHeight:100);height.step='0.1';height.value=String(item.wall?item.wall.height:item.z);height.onchange=()=>{try{const value=height.valueAsNumber;const current=selectedItem();update(current.wall?{wall:{...current.wall,height:value},z:value}:{z:value});}catch(error){height.value=String(item.wall?item.wall.height:item.z);message(error.message,true);}};panel.append(field(item.wall?'Altura na parede':'Altura',height));
 for(let channel=0;channel<meta.colorChannels;channel++){const input=document.createElement('input');input.type='color';input.value=item.colors[channel]||'#ffffff';input.onchange=()=>{const current=selectedItem();const colors=Array.from({length:meta.colorChannels},(_,index)=>current.colors[index]||'#ffffff');colors[channel]=input.value;update({colors});};panel.append(field(meta.colorChannels===1?'Cor':`Cor ${channel+1}`,input));}
 const hint=document.createElement('p');hint.className='help';hint.textContent=item.wall?`Parede ${item.wall.side==='left'?'esquerda':'direita'} · posição ${item.wall.position.toFixed(2)}`:`Piso ${item.x}, ${item.y} · Ctrl + arraste para mover`;panel.append(hint);if(item.photo)panel.append(action('Ver foto',()=>openPhoto(item.photo)));
 }catch(error){if(epoch===selectionEpoch){loading.textContent=error.message;loading.classList.add('object-error');}}
}
function nextId(){return project.items.reduce((max,item)=>Math.max(max,item.id),0)+1;}
function rememberRecent(key){recent=[key,...recent.filter(value=>value!==key)].slice(0,100);remember('wired:recent',recent);}
function makeItem(entry,meta){return {id:nextId(),key:entry.key,x:0,y:0,z:0,direction:meta.directions[0]??0,state:meta.states[0]??0,colors:Array(meta.colorChannels).fill('#FFFFFF')};}
function addAutomatically(entry,meta){let item=makeItem(entry,meta);if(entry.type==='wall')item={...item,wall:{side:'left',position:0.5,height:1},z:1};else{const rows=project.model.split('\n');let found=false;for(let y=0;y<rows.length&&!found;y++)for(let x=0;x<rows[0].length&&!found;x++){const candidate={...item,x,y,z:parseInt(rows[y][x],36)};if(canPlace(project.model,candidate,entry)){item=candidate;found=true;}}if(!found)throw new Error('Não há piso válido para esse mobi.');}const next=putItem(project,item,entry);rememberRecent(entry.key);selectedId=item.id;selectedCatalog=null;commit(next);message('Mobi colocado.');}
function catalogState(){return {query:$('search').value,type:$('filter-type').value,view:$('filter-view').value,available:$('available').checked,favorites,recent};}
const observer=new IntersectionObserver(changes=>{for(const change of changes){if(!change.isIntersecting||!preview)continue;observer.unobserve(change.target);const entry=entryMap.get(change.target.dataset.key);thumbJobs.push({entry,img:change.target,epoch:catalogEpoch});}pumpThumbs();},{root:$('catalog-grid'),rootMargin:'80px'});
function pruneThumbnails(store){
 if(pruning)return pruning;
 pruning=(async()=>{
  const keys=await store.keys();
  await Promise.all(keys.slice(0,Math.max(0,keys.length-384)).map(key=>store.delete(key)));
 })().finally(()=>{pruning=undefined;});
 return pruning;
}
function openThumbnails(){
 return thumbStore??=(async()=>{
  if(!globalThis.caches)return null;
  const store=await caches.open('wired-thumbnails-v2');
  await pruneThumbnails(store).catch(()=>{});
  void caches.delete('wired-thumbnails-v1').catch(()=>{});
  return store;
 })().catch(()=>null);
}
async function thumbnail(entry){
 const {revision}=await readPackageInfo(entry.packageName);
 const key=`/__wired_thumbs/thumb-v2/${revision}/${encodeURIComponent(entry.key)}.png`;
 const cached=thumbCache.get(key);
 if(cached){thumbCache.delete(key);thumbCache.set(key,cached);return cached;}
 const store=await openThumbnails();
 let data;
 try{
  const hit=await store?.match(key);
  if(hit){
   const blob=await hit.blob();
   data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
  }
 }catch{/* A miniatura pode ser gerada sem Cache Storage. */}
 if(!data){
  data=await preview.thumbnail(entry);
  if(store)try{
   const blob=await (await fetch(data)).blob();
   await store.put(key,new Response(blob,{headers:{'Content-Type':'image/png'}}));
   if(++thumbWrites%16===0)await pruneThumbnails(store);
  }catch{/* A cópia em memória continua disponível. */}
 }
 thumbCache.set(key,data);if(thumbCache.size>200)thumbCache.delete(thumbCache.keys().next().value);
 return data;
}
function pumpThumbs(){while(preview&&thumbWorkers<2&&thumbJobs.length){const job=thumbJobs.shift();if(job.epoch!==catalogEpoch||!job.img.isConnected)continue;thumbWorkers++;thumbnail(job.entry).then(src=>{if(job.epoch===catalogEpoch&&job.img.isConnected){job.img.src=src;job.img.classList.add('loaded');}}).catch(error=>{if(job.img.isConnected){job.img.alt='Prévia indisponível';job.img.closest('.catalog-tile').title=error.message;job.img.closest('.catalog-tile').classList.add('thumbnail-error');}}).finally(()=>{thumbWorkers--;pumpThumbs();});}}
function renderCatalog(reset=false){if(reset)page=0;filtered=searchCatalog(entries,catalogState());const pages=Math.max(1,Math.ceil(filtered.length/60));page=Math.min(page,pages-1);catalogEpoch++;thumbJobs.length=0;observer.disconnect();const tiles=filtered.slice(page*60,(page+1)*60).map(entry=>{
 const tile=document.createElement('div');tile.className='catalog-tile'+(!entry.available?' unavailable':'');tile.title=entry.name+'\n'+entry.classname;
 const card=document.createElement('button');card.className='ws-card catalog-card';card.dataset.key=entry.key;card.setAttribute('aria-label',`${entry.name}, ${entry.type==='wall'?'parede':'piso'}${entry.available?'':', pacote ausente'}`);
 const img=document.createElement('img');img.alt='';img.dataset.key=entry.key;img.loading='lazy';img.decoding='async';img.draggable=false;card.append(img);const name=document.createElement('span');name.textContent=entry.name;card.append(name);card.onclick=()=>{if(performance.now()>=suppressCatalogClickUntil)selectCatalog(entry);};card.onpointerdown=event=>startCatalogDrag(event,entry);tile.append(card);
 const star=document.createElement('button');star.className='favorite';star.textContent=favorites.includes(entry.key)?'★':'☆';star.setAttribute('aria-label',`Favoritar ${entry.name}`);star.setAttribute('aria-pressed',String(favorites.includes(entry.key)));star.onclick=()=>{favorites=favorites.includes(entry.key)?favorites.filter(key=>key!==entry.key):[entry.key,...favorites].slice(0,2000);remember('wired:favorites',favorites);renderCatalog();};tile.append(star);
 if(!entry.available){const badge=document.createElement('span');badge.className='asset-badge';badge.textContent='Ausente';tile.append(badge);}else if(entry.colorable){const badge=document.createElement('span');badge.className='asset-badge colorable';badge.textContent='◉';badge.title='Colorível';tile.append(badge);}
 if(entry.available)observer.observe(img);return tile;});
 $('catalog-grid').replaceChildren(...tiles);$('catalog-result').textContent=`${filtered.length.toLocaleString('pt-BR')} resultado(s)`;$('page-label').textContent=`${page+1} / ${pages}`;$('previous').disabled=page===0;$('next').disabled=page+1>=pages;
 if(!tiles.length){const p=document.createElement('p');p.className='help catalog-empty';p.textContent='Nenhum mobi encontrado. Ajuste a busca ou os filtros.';$('catalog-grid').append(p);}}
let searchTimer;$('search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>renderCatalog(true),120);};for(const id of ['filter-type','filter-view','available'])$(id).onchange=()=>{renderCatalog(true);feedback.play('tool');};$('previous').onclick=()=>{page--;renderCatalog();$('catalog-grid').scrollTop=0;};$('next').onclick=()=>{page++;renderCatalog();$('catalog-grid').scrollTop=0;};
async function startCatalogDrag(event,entry){if(event.button!==0||!entry.available||!preview)return;beginDrag(event,entry,null);}
function beginDrag(event,entry,item,photo){cancelDrag();const transaction={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,entry,photo,meta:null,item:item?{...item,colors:[...item.colors],wall:item.wall?{...item.wall}:undefined}:null,active:false,ready:false,candidate:null,target:event.currentTarget};drag=transaction;try{event.currentTarget.setPointerCapture(event.pointerId);}catch{}
 info(entry).then(meta=>{if(drag!==transaction)return;transaction.meta=meta;transaction.item??={...makeItem(entry,meta),...(photo?{photo}:{})};transaction.ready=true;}).catch(error=>{if(drag===transaction){message(error.message,true);cancelDrag();}});}
// ---- Câmera e pasta de fotos ----
const FRAME_CLASSES=['external_image_wallitem_poster','external_image_wallitem_poster_small'];
function renderPhotoFrames(){const list=FRAME_CLASSES.map(name=>entries.find(entry=>entry.type==='wall'&&entry.classname===name)).filter(Boolean);const previous=$('photo-frame').value;$('photo-frame').replaceChildren(...list.map(entry=>{const option=document.createElement('option');option.value=entry.key;option.textContent=(entry.classname.endsWith('_small')?'Moldura pequena':'Moldura grande')+(entry.available?'':' (pacote ausente)');return option;}));if(list.some(entry=>entry.key===previous))$('photo-frame').value=previous;}
function showTab(name,sound=false){const photosTab=name==='photos';$('items-panel').hidden=photosTab;$('photos-panel').hidden=!photosTab;setActive(workspace,'#tab-items,#tab-photos',$(photosTab?'tab-photos':'tab-items'));if(sound)feedback.play('tool');}
$('tab-items').onclick=()=>showTab('items',true);$('tab-photos').onclick=()=>showTab('photos',true);
function openPhoto(id){$('photo-view').src=`/photos/${id}.png`;$('photo-dialog').showModal();}
function startPhotoDrag(event,photo){if(event.button!==0||!preview)return;const entry=entryMap.get($('photo-frame').value);if(!entry?.available){message('Não encontrei external_image_wallitem_poster.nitro em public/assets/packages.',true);return;}beginDrag(event,entry,null,photo.id);}
function renderPhotos(){$('photo-total').textContent=photos.length;$('photo-count').textContent=photos.length?` ${photos.length}`:'';
 const tiles=photos.map(photo=>{const tile=document.createElement('div');tile.className='catalog-tile photo-tile';tile.title='Arraste até a parede · duplo clique para ampliar';
  const card=document.createElement('button');card.className='ws-card catalog-card';card.setAttribute('aria-label','Foto do quarto');const img=document.createElement('img');img.alt='';img.src=`/photos/${photo.id}_small.png`;img.draggable=false;img.className='loaded';const label=document.createElement('span');label.textContent='Foto do quarto';card.append(img,label);card.onpointerdown=event=>startPhotoDrag(event,photo);card.ondblclick=()=>openPhoto(photo.id);tile.append(card);
  const remove=document.createElement('button');remove.className='favorite';remove.textContent='×';remove.title='Excluir foto';remove.setAttribute('aria-label','Excluir foto');remove.onclick=()=>deletePhoto(photo);tile.append(remove);return tile;});
 $('photo-grid').replaceChildren(...tiles);if(!tiles.length){const p=document.createElement('p');p.className='help catalog-empty';p.textContent='Nenhuma foto ainda. Abra a câmera e tire a primeira.';$('photo-grid').append(p);}}
async function loadPhotos(){try{const response=await fetch('/photos.json',{cache:'no-store'});if(!response.ok)throw new Error('Não foi possível abrir a pasta de fotos.');photos=(await response.json()).photos||[];renderPhotos();}catch(error){message(error.message,true,null);}}
async function deletePhoto(photo){const uses=project.items.filter(item=>item.photo===photo.id).length;if(!confirm(uses?`Esta foto está em ${uses} lugar(es) do quarto e ficará preta. Excluir mesmo assim?`:'Excluir esta foto da pasta?'))return;try{const response=await fetch(`/photos/${photo.id}`,{method:'DELETE'});if(!response.ok)throw new Error('Não foi possível excluir a foto.');photos=photos.filter(other=>other.id!==photo.id);renderPhotos();}catch(error){message(error.message,true);}}
function updateRoomMode(){
 $('pan-camera').setAttribute('aria-pressed',String(!cameraOn&&!fillTool&&armedMove===null));
 if(!preview)return;
 if(cameraOn){
  $('renderer-status').textContent=photoFrame
   ?`Foto · ${PHOTO_SIZE} × ${PHOTO_SIZE} px · Arraste a moldura`
   :`Foto · Amplie a área do quarto para pelo menos ${PHOTO_SIZE} × ${PHOTO_SIZE} px`;
 }else{
  $('renderer-status').textContent=fillTool?'Preencher área · Arraste entre dois cantos':armedMove!==null?'Mover · Arraste o mobi':'Câmera · Arraste para navegar';
 }
}
function updatePhotoFrame(frame=photoFrame){
 photoFrame=fitPhotoFrame(frame,host.clientWidth,host.clientHeight);
 photoFrameBox.hidden=!photoFrame;
 $('shoot').disabled=takingPhoto||!photoFrame;
 $('photo-reset').disabled=!photoFrame;
 if(photoFrame){
  const {x,y}=photoFrame;
  Object.assign(photoFrameBox.style,{left:`${x}px`,top:`${y}px`,width:`${PHOTO_SIZE}px`,height:`${PHOTO_SIZE}px`});
 }
 updateRoomMode();
}
function endFrameGesture(){
 const gesture=frameGesture;frameGesture=null;
 if(gesture&&photoFrameBox.hasPointerCapture(gesture.id))photoFrameBox.releasePointerCapture(gesture.id);
 photoFrameBox.classList.remove('nr-grabbing');
}
photoFrameBox.onpointerdown=event=>{
 if(event.button!==0||frameGesture||!photoFrame||event.target.closest('button'))return;
 event.preventDefault();event.stopPropagation();
 photoFrameBox.focus({preventScroll:true});
 cancelPan();
 frameGesture={id:event.pointerId,frame:photoFrame,x:event.clientX,y:event.clientY};
 photoFrameBox.setPointerCapture(event.pointerId);
 photoFrameBox.classList.add('nr-grabbing');
};
photoFrameBox.onpointermove=event=>{
 const gesture=frameGesture;if(!gesture||event.pointerId!==gesture.id)return;
 const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
 updatePhotoFrame({x:gesture.frame.x+dx,y:gesture.frame.y+dy});
};
for(const type of ['pointerup','pointercancel','lostpointercapture']){
 photoFrameBox.addEventListener(type,event=>{if(event.pointerId===frameGesture?.id)endFrameGesture();});
}
photoFrameBox.onkeydown=event=>{
 if(event.target!==photoFrameBox||!photoFrame||event.ctrlKey||event.metaKey||event.altKey)return;
 const direction={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
 if(!direction)return;
 event.preventDefault();
 const [x,y]=direction;
 updatePhotoFrame({x:photoFrame.x+x*8,y:photoFrame.y+y*8});
};
function setCamera(on,sound=false){
 cameraOn=on;$('camera-overlay').hidden=!on;$('camera').setAttribute('aria-pressed',String(on));
 if(on)updatePhotoFrame();else endFrameGesture();
 updateRoomMode();if(sound)feedback.play('tool');
}
$('photo-reset').onclick=()=>{endFrameGesture();updatePhotoFrame(null);feedback.play('tool');};
$('pan-camera').onclick=()=>{armedMove=null;cancelDrag();setCamera(false,true);};
$('camera').onclick=()=>{if(!preview)return;armedMove=null;cancelDrag();setCamera(!cameraOn,true);};$('camera-close').onclick=()=>setCamera(false,true);
$('shoot').onclick=async()=>{
 if(!preview||!cameraOn||takingPhoto)return;
 cancelDrag();endFrameGesture();updatePhotoFrame();
 if(!photoFrame)return;
 takingPhoto=true;$('shoot').disabled=true;
 try{
  const shot=preview.capturePhoto(photoFrame);feedback.photograph();
  const response=await fetch('/photos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(shot)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'Não foi possível salvar a foto.');
  photos.unshift(data);renderPhotos();showTab('photos');message('Foto salva na pasta Fotos.');
 }catch(error){message(error.message,true);}
 finally{takingPhoto=false;$('shoot').disabled=!photoFrame;}
};
let pan=null;
function updateZoom(scale){$('zoom-reset').textContent=`${Math.round(scale*100)}%`;}
function startPan(event,hitId){cancelPan();pan={pointerId:event.pointerId,x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,moved:false,hitId};try{host.setPointerCapture(event.pointerId);}catch{}}
function cancelPan(){if(!pan)return;try{host.releasePointerCapture(pan.pointerId);}catch{}pan=null;host.classList.remove('panning');}
host.onpointerdown=event=>{if(!preview||event.target.closest('.nr-photo-actions,#shoot')||frameGesture)return;
 if(event.button===1||event.button===2){event.preventDefault();if(!drag)startPan(event,null);return;}
 if(event.button!==0)return;
 if(drag)return;
 if(cameraOn){startPan(event,null);return;}
 if(fillTool){startFill(event);return;}
 const grab=event.ctrlKey||event.metaKey||armedMove!==null;
 if(!grab){startPan(event,preview.hitTest(event.clientX,event.clientY));return;}
 const id=armedMove??preview.hitTest(event.clientX,event.clientY);armedMove=null;updateRoomMode();
 if(id!==null&&id!==undefined){const item=project.items.find(item=>item.id===id);if(item){selectObject(id);const entry=entryMap.get(item.key);if(entry?.available)beginDrag(event,entry,item);}}else clearSelection();};
host.onpointermove=event=>{if(!pan||event.pointerId!==pan.pointerId||!preview)return;
 if(!pan.moved&&Math.hypot(event.clientX-pan.startX,event.clientY-pan.startY)<=4)return;
 pan.moved=true;host.classList.add('panning');preview.panBy?.(event.clientX-pan.x,event.clientY-pan.y);pan.x=event.clientX;pan.y=event.clientY;};
host.onpointerup=event=>{if(!pan||event.pointerId!==pan.pointerId)return;const done=pan;cancelPan();
 // A click without dragging still selects a mobi (or clears the selection on empty floor).
 if(!cameraOn&&!done.moved&&event.button===0){if(done.hitId!==null&&done.hitId!==undefined)selectObject(done.hitId);else clearSelection();}};
host.onpointercancel=event=>{if(pan?.pointerId===event.pointerId)cancelPan();};host.oncontextmenu=event=>event.preventDefault();host.ondblclick=event=>{if(!preview||fillTool||cameraOn)return;const id=preview.hitTest(event.clientX,event.clientY);const item=project.items.find(other=>other.id===id);if(item?.photo)openPhoto(item.photo);};
host.addEventListener('wheel',event=>{if(!preview)return;event.preventDefault();const lines=event.deltaMode===1?16:event.deltaMode===2?400:1;const factor=Math.min(2,Math.max(0.5,Math.exp(-event.deltaY*lines*0.0015)));preview.zoomBy(factor,event.clientX,event.clientY);refreshAreaProjection();},{passive:false});
$('zoom-in').onclick=()=>preview?.zoomBy(1.25);$('zoom-out').onclick=()=>preview?.zoomBy(0.8);$('zoom-reset').onclick=()=>preview?.resetView();$('zoom-fit').onclick=()=>preview?.fitAll();
function grabMode(event){host.classList.toggle('grab-mode',event.ctrlKey||event.metaKey);}
window.addEventListener('keydown',grabMode);window.addEventListener('keyup',grabMode);window.addEventListener('blur',()=>{host.classList.remove('grab-mode');cancelPan();endFrameGesture();});
let dragFrame=0,lastPointer;
function refreshAreaProjection(){
 if(!drag?.startTile||!lastPointer)return;
 drag.reprojectArea=true;
 if(!dragFrame)dragFrame=requestAnimationFrame(updateDrag);
}
function dropHint(text,invalid=false){
 const hint=$('drop-hint');hint.hidden=false;hint.textContent=text;hint.classList.toggle('invalid',invalid);
}
function toggleFill(entry,meta){
 const wasArmed=Boolean(fillTool);cancelDrag();
 if(wasArmed){feedback.play('tool');return;}
 if(!preview)return;
 if(cameraOn)setCamera(false);
 cancelPan();armedMove=null;
 const item=makeItem(entry,meta);
 fillTool={entry,item,...floorFootprint(item,entry)};
 host.classList.add('fill-mode');$('fill-area')?.setAttribute('aria-pressed','true');
 updateRoomMode();dropHint('Arraste entre dois cantos do piso · Escape cancela');feedback.play('tool');
}
function placementAt(event,type,emptyFloorZ){
 const rect=host.getBoundingClientRect();
 if(event.clientX<rect.left||event.clientX>=rect.right||event.clientY<rect.top||event.clientY>=rect.bottom)return null;
 return preview.getPlacement(event.clientX,event.clientY,type,emptyFloorZ);
}
function startFill(event){
 const startTile=placementAt(event,'floor');
 if(!startTile){dropHint('Comece em um piso válido',true);feedback.play('error');return;}
 cancelPan();
 drag={...fillTool,startTile,endTile:null,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,target:host,active:false};
 try{host.setPointerCapture(event.pointerId);}catch{}
}
function previewFill(current,event){
 const end=placementAt(event,'floor',current.startTile.z);
 const key=end?`${end.x},${end.y}`:null;
 if(key===current.areaKey&&!current.reprojectArea)return;
 if(key!==current.areaKey){
  current.areaKey=key;current.endTile=end;
  current.placements=areaPlacements(project.model,current.entry,current.item,current.startTile,end);
 }
 current.reprojectArea=false;
 const placements=current.placements;
 preview.markArea(placements,current.width,current.height);
 const remaining=MAX_ITEMS-project.items.length;
 if(placements.length>remaining)dropHint(`Restam ${remaining} vagas · selecione uma área menor`,true);
 else if(!placements.length)dropHint('Nenhuma cópia cabe nesta área',true);
 else dropHint(`Solte para colocar ${placements.length} ${placements.length===1?'cópia':'cópias'} · Escape cancela`);
}
function updateDrag(){dragFrame=0;const current=drag,event=lastPointer;if(!current||!event)return;if(Math.hypot(event.clientX-current.startX,event.clientY-current.startY)>5)current.active=true;if(!current.active)return;
 if(current.startTile){previewFill(current,event);return;}
 $('drag-label').hidden=false;$('drag-label').textContent=current.entry.name;$('drag-label').style.left=`${event.clientX+16}px`;$('drag-label').style.top=`${event.clientY+16}px`;document.body.classList.add('dragging');
 if(!current.ready)return;const placement=placementAt(event,current.entry.type);
 const candidate=placement?{...current.item,...placement,z:current.entry.type==='wall'?placement.z:(project.items.some(item=>item.id===current.item.id)?current.item.z:placement.z)}:null;
 if(candidate?.wall){const facing=candidate.wall.side==='left'?90:180;if(current.meta?.directions?.includes(facing))candidate.direction=facing;}
 current.candidate=candidate&&canPlace(project.model,candidate,current.entry,project.wallHeight)?candidate:null;
 const ghostKey=current.candidate?JSON.stringify([current.candidate.x,current.candidate.y,current.candidate.z,current.candidate.direction,current.candidate.wall]):null;
 if(ghostKey===current.ghostKey)return;
 current.ghostKey=ghostKey;
 dropHint(current.candidate?'Solte para posicionar · Escape cancela':'Escolha um destino válido',!current.candidate);
 preview.ghost(current.candidate,entryMap).catch(error=>{if(drag===current){message(error.message,true);cancelDrag();}});
}
window.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.pointerId)return;lastPointer=event;if(!dragFrame)dragFrame=requestAnimationFrame(updateDrag);});
function cancelDrag(){
 if(dragFrame)cancelAnimationFrame(dragFrame);
 dragFrame=0;const old=drag;drag=null;lastPointer=null;
 $('drag-label').hidden=true;$('drop-hint').hidden=true;document.body.classList.remove('dragging');
 if(fillTool){fillTool=null;host.classList.remove('fill-mode');$('fill-area')?.setAttribute('aria-pressed','false');preview?.markArea([]);}
 if(old){try{old.target.releasePointerCapture(old.pointerId);}catch{}if(!old.startTile)preview?.ghost(null,entryMap).catch(()=>{});}
 updateRoomMode();
}
window.addEventListener('pointerup',event=>{
 const current=drag;if(!current||event.pointerId!==current.pointerId)return;
 lastPointer=event;if(dragFrame)cancelAnimationFrame(dragFrame);
 let next=project;
 let failure;
 try{
  updateDrag();
  if(!current.active)return;
  suppressCatalogClickUntil=performance.now()+300;
  next=current.startTile?finishArea(project,current.entry,current.item,current.startTile,current.endTile,false):finishDrag(project,current.candidate,current.entry,false);
  if(next===project)failure=current.ready===false?'O pacote ainda está carregando. Tente novamente.':'Destino inválido. Nenhuma alteração aplicada.';
 }catch(error){failure=error.message;}finally{cancelDrag();}
 if(failure){message(failure,true);return;}
 if(next!==project){
  const count=next.items.length-project.items.length;
  selectedId=current.startTile?next.items.at(-1).id:current.candidate.id;selectedCatalog=null;
  rememberRecent(current.entry.key);showInspector(false);commit(next);
  message(count===0?'Mobi movido.':`${count} ${count===1?'mobi colocado':'mobis colocados'}.`);
 }
});
function cancelCapturedDrag(event){if(drag?.pointerId===event.pointerId)cancelDrag();}
window.addEventListener('pointercancel',cancelCapturedDrag);
window.addEventListener('lostpointercapture',cancelCapturedDrag);
window.addEventListener('blur',cancelDrag);
window.addEventListener('keydown',event=>{
 if(event.key==='Escape'){
  armedMove=null;cancelDrag();if(cameraOn&&!document.querySelector('dialog[open]'))setCamera(false);
  if($('project-menu').open)closeProjectMenu();
 }
 if(event.target.closest?.('input,textarea,select')||event.target.isContentEditable)return;
 const key=event.key.toLowerCase();
 if((event.ctrlKey||event.metaKey)&&key==='z'){event.preventDefault();history(!event.shiftKey);}
 if(key==='r'&&!event.repeat&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!drag&&!document.querySelector('dialog[open]')){
  const rotate=$('rotate-item');
  if(rotate&&!rotate.disabled){event.preventDefault();rotate.click();}
 }
 if(event.key==='Delete'&&selectedItem()){
  cancelDrag();const id=selectedId;selectedId=null;commit(removeItem(project,id));
 }
});
async function loadCatalog(){
 try{
  const response=await fetch('/catalog.json');
  if(!response.ok)throw new Error('Não foi possível abrir o índice de mobis.');
  const data=await response.json();
  entries=data.entries;
  for(const entry of entries)entry.searchText=normalizeSearch(`${entry.name} ${entry.description} ${entry.classname} ${entry.typeId}`);
  entryMap=new Map(entries.map(entry=>[entry.key,entry]));catalogReady=true;
  if(preview)void renderProject();
  renderPhotoFrames();$('catalog-total').textContent=entries.length.toLocaleString('pt-BR');renderCatalog(true);sync();
 }catch(error){$('catalog-result').textContent=error.message;message(error.message,true,null);}
}
async function loadPreview(){
 if(loading||preview)return;
 loading=true;$('retry').disabled=true;
 try{
  const [statusResponse,configResponse]=await Promise.all([
   fetch('/assets-status.json',{cache:'no-store'}),fetch('/assets/renderer-config.json'),
  ]);
  if(!statusResponse.ok)throw new Error('Não foi possível verificar os assets.');
  const status=await statusResponse.json();
  $('missing').replaceChildren(...status.missing.map(path=>{const li=document.createElement('li');li.textContent=path;return li;}));
  if(status.missing.length)throw new Error('Adicione os assets indicados para abrir o quarto.');
  if(!configResponse.ok)throw new Error('Configuração de assets ausente.');
  const config=await configResponse.json();
  const {mountNitroPreview}=await import('./nitro-preview.ts');
  preview=await mountNitroPreview(host,config,updateZoom,readPackageInfo);
  $('empty').hidden=true;updateRoomMode();$('retry').hidden=true;
  void renderProject();
  if(catalogReady)renderCatalog();
  syncSelection();updateZoom(preview.getZoom());showSelection();
 }catch(error){
  $('preview-heading').textContent='O quarto não iniciou';$('preview-message').textContent=error.message;
  $('renderer-status').textContent='Verifique assets e configuração';$('retry').hidden=false;
 }finally{loading=false;$('retry').disabled=false;}
}
$('retry').onclick=loadPreview;
const roomSizeObserver=new ResizeObserver(()=>{preview?.resize();refreshAreaProjection();if(cameraOn){endFrameGesture();updatePhotoFrame();}});
roomSizeObserver.observe(host);
document.addEventListener('visibilitychange',()=>{if(document.hidden)autoSave.flush();});
window.addEventListener('pagehide',event=>{autoSave.flush();if(!event.persisted){autoSave.dispose();cancelDrag();observer.disconnect();roomSizeObserver.disconnect();feedback.destroy();preview?.dispose();}});
sync();saveState(restored.hasSaved?'saved':'draft');showSelection();
if(migrateSession){autoSave.schedule(project);autoSave.flush();}
else if(restored.invalid&&!restored.hasSaved)message('Não foi possível abrir o rascunho anterior. Você pode importar uma cópia JSON.',true,null);
loadCatalog();loadPhotos();loadPreview();



