// Constructor — extraído da Oficina 1.5.1.
(function () {
  'use strict';
  const ctx = window._constructor;
  if (!ctx?.current()) return;
  const OficinaCore = ctx.Core;
ctx.mount = function(runtime,options) {
  'use strict';
  if(ctx.ui){ctx.ui.show();return ctx.ui.host;}
  const {demo=false}=options||{};
  const ac=new AbortController(),timers=new Set(),frames=new Set(),urls=new Set(),unsubscribers=[];
  let disposed=false,computeTimer,state=null,panel=null,shell=null,preview=null,menuCleanup=null,drag=null,resizing=null;
  const animations=new Set();
  let menuAnchor=null,launcherDragged=false,renameTarget=null,captureSuggestion='';
  let audioGesture=false,placementVoice=null,lastPlacementAt=-Infinity,audioNoticeUntil=0,placementGeneration='';const placementHeard=new Set();
  let uiFrame=null,executionError='',configurationPendingCount=0;const uiUpdates=new Map();
  let operationSnapshot={jobs:[],report:{},canRetry:false},operationJobId=null,operationPage=0,operationAction=false,operationOptionsKey='',operationPageKey='',operationPageData=null;
  let linkPollTimer=null,linkEpoch=0,linkPollDeadline=0,linkBusy=false,linkReturnFocus=null,initialProjectRefresh=false;
  let linkStatus=runtime.projectLinkStatus?.()||{linked:false,pending:false};
  const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
  const setTimeout=(fn,delay)=>{
    const id=window.setTimeout(()=>{timers.delete(id);if(!disposed)fn();},delay);
    timers.add(id);return id;
  };
  const clearTimeout=id=>{window.clearTimeout(id);timers.delete(id);};
  const requestAnimationFrame=fn=>{
    const id=window.requestAnimationFrame(time=>{frames.delete(id);if(!disposed)fn(time);});
    frames.add(id);return id;
  };
  function queueUi(kind,value=true){
    if(disposed)return;uiUpdates.set(kind,value);if(uiFrame!==null)return;
    uiFrame=requestAnimationFrame(()=>{
      uiFrame=null;const pending=new Map(uiUpdates);uiUpdates.clear();
      if(pending.has('connection'))connection();else if(pending.has('inventory'))updateInventory();
      if(pending.has('projects'))renderProjects();
      if(pending.has('catalog'))catalogStatus(pending.get('catalog')===true?runtime.catalogCaptureStatus?.():pending.get('catalog'));
      if(pending.has('configuration'))configuration(pending.get('configuration')===true?undefined:pending.get('configuration'));
      if(pending.has('buttons'))updateButtons();
      if(pending.has('operations'))operations(pending.get('operations')===true?undefined:pending.get('operations'));
      renderExecutionSummary();
    });
  }
  const subscribe=(name,fn)=>unsubscribers.push(runtime.on(name,fn));
  // Uma tentativa antiga pode ter falhado antes de registrar o disposer.
  document.getElementById('sang-constructor')?.remove();
  const C=OficinaCore,icons=ctx.icons,host=document.createElement('div');
  const supports=feature=>runtime.supports?.(feature)??demo;
  host.id='sang-constructor';
  host.dataset.constructorUi='1';
  host.style.cssText='position:fixed;right:22px;top:24px;z-index:2147483646;max-width:calc(100vw - 16px);';
  const root=host.attachShadow({mode:'open'});
  // Registra a limpeza antes de inserir ou renderizar qualquer conteúdo.
  ctx.ui={
    host,
    show(){if(disposed)return;host.hidden=false;shell?.classList.remove('minimized');if(panel)applyWidth();syncPreviewVisibility();if(state)refreshProjectsOnOpen();},
    hide(){if(!disposed){shell?.classList.add('minimized');releasePointers();closeProjectMenu();closeLinkDialog();closeRenameDialog();syncPreviewVisibility();}},
    dispose(){
      if(disposed)return;
      disposed=true;ac.abort();stopPlacementVoice();placementHeard.clear();uiUpdates.clear();stopLinkPolling();menuCleanup?.();preview?.destroy();
      for(const animation of animations)animation.cancel?.();
      animations.clear();
      releasePointers();
      for(const off of unsubscribers)off();
      for(const id of timers)window.clearTimeout(id);
      for(const id of frames)window.cancelAnimationFrame(id);
      for(const url of urls)URL.revokeObjectURL(url);
      timers.clear();frames.clear();urls.clear();
      if(state){
        state.dialogResolve?.(false);state.dialogResolve=null;
        if(state.audio)void state.audio.close().catch(()=>{});
      }
      host.remove();
    }
  };
  document.body.append(host);

  for (const type of ['keydown','keyup','keypress','input','change','beforeinput',
                      'pointerdown','pointerup','mousedown','mouseup','click','dblclick',
                      'wheel','paste','cut','copy','contextmenu']) {
    root.addEventListener(type, event => event.stopPropagation());
  }
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && root.querySelector('dialog[open]')) return;
    if (event.target.matches('input,textarea,select')) event.stopPropagation();
  });

  let pref={sound:true,placementSound:true,volume:0.22,delay:180,flash:false,flashDelay:100,strictConfiguration:false,theme:'light',width:1440};
  try{const saved=JSON.parse(localStorage.getItem('hl_oficina_preferences')||'{}');pref={...pref,...saved};}catch{}
  pref.width=[430,540,660,1100,1440].includes(pref.width)?pref.width:1440;
  pref.volume=Math.min(0.7,Math.max(0,Number(pref.volume)||0));
  pref.delay=Math.min(2000,Math.max(150,Number(pref.delay)||180));
  pref.sound=pref.sound!==false;pref.placementSound=pref.placementSound!==false;
  pref.flash=pref.flash===true;
  pref.strictConfiguration=pref.strictConfiguration===true;
  pref.theme=pref.theme==='dark'?'dark':'light';
  host.dataset.theme=pref.theme;
  pref.flashDelay=Number.isInteger(Number(pref.flashDelay))&&Number(pref.flashDelay)>=25&&Number(pref.flashDelay)<=2000?Number(pref.flashDelay):100;

  root.innerHTML=ctx.renderView({demo});

  const $=id=>root.getElementById(id);
  panel=root.querySelector('.panel');shell=root.querySelector('.shell');
  state={groups:[],names:new Map(),walls:new Set(),shape:'lineX',selected:null,plan:null,projects:Object.create(null),custom:[],audio:null,loading:false,toastTimer:null,dialogResolve:null,searchTimer:null,projectHotel:ctx.hotel?.id||'habblive',projectSelections:Object.create(null),projectRefreshing:false,projectSending:false};
  // Move os controles existentes: seus IDs e handlers continuam únicos.
  const projectsView=$('view-projects'),toolsView=$('view-build');
  const captureSection=$('capture').closest('section');
  const catalogSection=$('capture-catalog').closest('section');
  const catalogDetails=$('import-catalog').closest('details');
  const diagnostics=$('log').closest('details');
  const nodes={projects:$('projects'),detail:$('project-detail'),x:$('project-x').closest('label'),y:$('project-y').closest('label'),mount:$('mount'),buy:$('buy'),remove:$('delete-project'),export:$('export'),import:$('import-projects'),file:$('project-file')};
  const needs=$('needs');
  Object.values(nodes).forEach(node=>node.remove());
  needs.remove();
  captureSection.remove();catalogSection.remove();catalogDetails.remove();diagnostics.remove();
  toolsView.append(catalogSection,catalogDetails,diagnostics);
  catalogSection.classList.add('tool-catalog');
  projectsView.classList.add('workbench');
  const hotelButtons=prefix=>`<div class="hotel-switch" role="group" aria-label="Origem dos projetos"><button id="${prefix}-habblive" type="button" data-hotel="habblive" aria-pressed="false">Habblive</button><button id="${prefix}-converted" type="button" data-hotel="converted" aria-pressed="false">Convert</button><button id="${prefix}-habblet" type="button" data-hotel="habblet" aria-pressed="false">Habblet</button></div>`;
  projectsView.innerHTML=`<div id="capture-form-slot" class="capture-form-slot" hidden></div><div class="bench-mobile-select"><div class="bench-mobile-heading"><h2>Projetos</h2><div class="bench-header-actions"><button id="projects-refresh-mobile" class="icon" aria-label="Atualizar projetos" title="Atualizar projetos"></button><button id="menu-mobile" class="icon" aria-label="Opções dos projetos" aria-haspopup="menu" aria-expanded="false"></button></div></div>${hotelButtons('mobile-hotel')}<label>Projeto<select id="project-select" class="control" aria-label="Projeto selecionado"></select></label><button id="copy-mobile" class="button small">Copiar quarto</button><button id="menu-selected-mobile" class="icon project-menu-trigger" aria-label="Opções do projeto selecionado" aria-haspopup="menu" aria-expanded="false"></button></div>
    <div class="bench-grid"><aside class="bench-projects"><div class="heading"><h2>Meus projetos</h2><div class="bench-header-actions"><button id="projects-refresh" class="icon" aria-label="Atualizar projetos" title="Atualizar projetos"></button><button id="project-menu-toggle" class="icon" aria-label="Opções dos projetos" aria-haspopup="menu" aria-expanded="false"></button></div></div><p class="hotel-origin-label">Origem dos projetos</p>${hotelButtons('project-hotel')}<input id="project-search" class="control" type="search" placeholder="Buscar projeto" aria-label="Buscar projetos"><div id="project-list-slot"></div><div class="bench-project-actions"><button id="copy-open" class="button wide">Copiar quarto</button><p id="project-hotel-note" class="hint"></p></div></aside>
    <section class="bench-center" aria-label="Visualização do projeto"><div class="bench-preview-head"><strong id="project-title">Sua próxima construção</strong><p id="project-meta" class="bench-project-meta"></p></div><div id="room-preview" class="room-preview"><div id="project-empty" class="bench-empty"><strong>Um quarto, novas possibilidades</strong><span>Copie um quarto ou escolha um projeto salvo para visualizar sua próxima construção.</span></div></div><div class="bench-preview-actions" aria-label="Controles da prévia"><div class="bench-zoom"><button id="preview-zoom-out" class="icon" title="Diminuir zoom" aria-label="Diminuir zoom"></button><span>Zoom</span><button id="preview-zoom-in" class="icon" title="Aumentar zoom" aria-label="Aumentar zoom"></button></div><button id="preview-fit" class="icon" title="Enquadrar projeto" aria-label="Enquadrar projeto"></button></div><div class="bench-caption">Prévia de posições</div></section>
    <details id="bench-details" class="bench-details" open><summary>Preparar montagem</summary><aside class="bench-inspector"><h2>Preparar montagem</h2><section id="conversion-report" class="conversion-report" hidden><p id="conversion-direction" class="conversion-direction"></p><details id="conversion-details"><summary id="conversion-summary"></summary><ul id="conversion-pending" class="conversion-list"></ul><ul id="conversion-warnings" class="conversion-list"></ul></details></section><details class="inspector-inventory"><summary id="inspector-inventory-summary">Resumo do inventário</summary><h3 class="inventory-title">Inventário</h3><div id="bench-summary" class="bench-summary"><div class="bench-stat"><strong id="required-total">—</strong>necessários</div><div class="bench-stat"><strong id="available-total">—</strong> disponíveis</div><div class="bench-stat"><strong id="missing-total">—</strong> faltantes</div></div></details><button id="bench-refresh" class="button bench-refresh">Atualizar inventário</button><p id="bench-inventory-status" class="bench-status" aria-live="polite"></p><div id="project-detail-slot"></div><details class="bench-mount" id="project-origin-details"><summary id="origin-summary">Posição inicial · X 1 · Y 1</summary><div class="origin"><div id="origin-x"></div><div id="origin-y"></div></div></details><details id="bench-options" class="bench-options"><summary>Opções de montagem</summary><div class="content"><button id="bench-preferences" class="button quiet small">Ritmo e ajustes de montagem</button><button id="bench-tools" class="button quiet small">Formas e catálogo</button><section class="selection-card"><h3>Seleção na prévia</h3><div id="preview-selection" class="hint">Clique em um móvel para conferir sua posição.</div><div id="selection-candidates" class="selection-candidates"></div></section></div></details><div class="bench-mount-action"><p id="mount-help" class="hint" aria-live="polite"></p><div id="buy-slot"></div><div id="mount-slot"></div></div></aside></details></div>`;
  $('project-list-slot').append(nodes.projects);$('buy-slot').append(nodes.buy);buttonLabel(nodes.buy,'Comprar móveis','shopping-cart');
  const missingDetails=document.createElement('details');missingDetails.className='bench-missing';missingDetails.id='missing-details';
  const missingSummary=document.createElement('summary');missingSummary.id='missing-summary';missingSummary.textContent='Ver móveis faltantes';
  missingDetails.append(missingSummary,needs);nodes.detail.replaceChildren(missingDetails);$('project-detail-slot').append(nodes.detail);
  $('origin-x').append(nodes.x);$('origin-y').append(nodes.y);
  nodes.x.firstChild.textContent='X';nodes.y.firstChild.textContent='Y';
  buttonLabel(nodes.mount,'Montar projeto','play');nodes.mount.setAttribute('aria-describedby','mount-help');$('mount-slot').append(nodes.mount);
  const projectBucket=()=>state.projectHotel==='converted'?'converted':'original';
  const currentProjectHotel=()=>state.projectHotel==='converted'||state.projectHotel===(ctx.hotel?.id||'habblive');
  const originalProjectHotel=()=>currentProjectHotel()&&projectBucket()==='original';
  const hotelName=id=>ctx.hotels?.[id]?.name||(id==='habblet'?'Habblet':id==='habblive'?'Habblive':String(id||'Hotel'));
  const projectHotelName=()=>state.projectHotel==='converted'?'Convert':hotelName(state.projectHotel);
  const projectCollection=()=>projectBucket()==='converted'?runtime.projects('converted'):runtime.projects();
  function requireProjectHotel(){if(!currentProjectHotel())throw Error(`Abra o Constructor no ${projectHotelName()} para acessar os projetos deste hotel.`);}
  function requireOriginalProjectHotel(){requireProjectHotel();if(!originalProjectHotel())throw Error('Selecione os projetos originais deste hotel para copiar ou importar.');}
  function selectProjectSource(source){
    if(state.projectHotel===source)return;
    state.projectSelections[state.projectHotel]=state.selected;
    state.projectHotel=source;state.selected=state.projectSelections[source]??null;
    closeProjectMenu();renderProjects();preview?.resize();
  }
  for(const button of root.querySelectorAll('[data-hotel]'))button.onclick=()=>selectProjectSource(button.dataset.hotel);
  $('close-panel').onclick=()=>ctx.kill();
  function applyTheme(){
    host.dataset.theme=pref.theme;
    const dark=pref.theme==='dark',button=$('theme-toggle'),label=dark?'Ativar modo claro':'Ativar modo escuro';
    button.innerHTML=icons[dark?'sun':'moon'];
    button.setAttribute('aria-label',label);button.setAttribute('title',label);button.setAttribute('aria-pressed',String(dark));
  }
  $('theme-toggle').onclick=()=>{pref.theme=pref.theme==='dark'?'light':'dark';applyTheme();savePref();};
  applyTheme();
  const menu=document.createElement('div');menu.id='project-menu';menu.className='bench-menu';menu.hidden=true;menu.setAttribute('role','menu');
  const sendProjectButton=document.createElement('button');sendProjectButton.id='send-project';sendProjectButton.className='button';sendProjectButton.textContent='Enviar para outro hotel';
  const renameProjectButton=document.createElement('button');renameProjectButton.id='rename-project';renameProjectButton.className='button';renameProjectButton.textContent='Renomear';
  const linkProjectButton=document.createElement('button');linkProjectButton.id='link-hotels';linkProjectButton.className='button';linkProjectButton.textContent='Vincular hotéis';
  menu.append(renameProjectButton,sendProjectButton,nodes.import,nodes.export,nodes.remove,linkProjectButton,nodes.file);shell.append(menu);
  for(const b of menu.querySelectorAll('button')){b.setAttribute('role','menuitem');b.classList.add('small');}
  // Preserva os IDs dos controles internos sem criar um diálogo sobre o jogo.
  captureSection.hidden=true;$('capture-form-slot').append(captureSection);
  buttonLabel($('capture'),'Iniciar cópia','copy');
  buttonLabel($('copy-open'),'Copiar quarto','plus');
  buttonLabel($('copy-mobile'),'Copiar quarto','plus');
  root.querySelector('.bench-caption').title='A prévia não valida colisões nem permissões do quarto.';
  const resize=document.createElement('button');resize.id='resize';resize.className='resize-handle';resize.setAttribute('aria-label','Redimensionar janela com as setas');panel.append(resize);
  for(const [id,icon] of [['project-menu-toggle','more-horizontal'],['menu-mobile','more-horizontal'],['menu-selected-mobile','more-horizontal'],['projects-refresh','refresh-cw'],['projects-refresh-mobile','refresh-cw'],['preview-zoom-in','zoom-in'],['preview-zoom-out','zoom-out'],['preview-fit','maximize']]){
    $(id).innerHTML=ctx.libs?.icon?.(icon)||'⋯';
  }
  let previewKey=null,previewSelection=null,highlightedType=null;
  $('room-preview').parentElement.append($('project-empty'));
  preview=ctx.createPreview?.({container:$('room-preview'),onSelect:selection=>{previewSelection=selection;if(selection&&currentProjectHotel())$('bench-options').open=true;renderSelection();}})||null;
  if(!preview)$('project-empty').lastElementChild.textContent='A prévia está indisponível. Você ainda pode conferir o inventário e os projetos.';
  $('project-select').onchange=()=>selectProject($('project-select').value);
  $('project-search').oninput=()=>renderProjects();
  $('bench-refresh').onclick=()=>{if(currentProjectHotel())$('refresh').click();};
  $('bench-tools').onclick=()=>{if(currentProjectHotel())switchTab('build');};
  $('bench-preferences').onclick=()=>{if(currentProjectHotel())switchTab('settings');};
  $('preview-fit').onclick=()=>preview?.fit();
  $('preview-zoom-in').onclick=()=>preview?.zoomBy(1.2);
  $('preview-zoom-out').onclick=()=>preview?.zoomBy(1/1.2);
  $('copy-open').onclick=$('copy-mobile').onclick=()=>{
    if(disposed||!originalProjectHotel()||!supports('capture'))return;
    closeProjectMenu();
    if(state.copyWaiting){runtime.cancel();return;}
    if(runtime.busy||state.loading)return;
    const room=runtime.currentRoomInfo?.();
    const safeName=runtime.ws?.readyState===1&&room?.epoch===runtime.roomEpoch&&room?.connectionId===runtime.ws?.id&&typeof room?.name==='string'?room.name.trim():'';
    const draft=$('capture-name').value.trim();
    const base=((draft!==captureSuggestion?draft:'')||safeName||'Quarto '+new Date().toLocaleString('pt-BR')).slice(0,120);
    let name=base,index=2;
    while(Object.hasOwn(runtime.projects(),name))name=base.slice(0,108)+' ('+(index++)+')';
    $('capture-name').value=name;captureSuggestion=name;
    $('capture').click();

  };
  function motion(element){
    if(reducedMotion.matches||!ctx.libs?.animate)return;
    const control=ctx.libs.animate(element,{opacity:[.65,1],transform:['translateY(3px)','translateY(0)']},{duration:.16});animations.add(control);
    Promise.resolve(control.finished||control).catch(()=>{}).finally(()=>animations.delete(control));
  }
  function buttonLabel(button,text,icon){
    if(button.dataset.label===text)return;
    button.dataset.label=text;
    button.innerHTML=ctx.libs?.icon?.(icon)||'';
    const label=document.createElement('span');label.textContent=text;button.append(label);
  }
  function syncPreviewVisibility(){preview?.setVisible(!disposed&&!document.hidden&&!host.hidden&&!shell?.classList.contains('minimized')&&!$('view-projects').hidden);}
  document.addEventListener('visibilitychange',syncPreviewVisibility,{signal:ac.signal});
  function closeProjectMenu(){
    menuCleanup?.();menuCleanup=null;if(!$('project-menu'))return;$('project-menu').hidden=true;
    for(const button of root.querySelectorAll('[aria-haspopup="menu"]'))button.setAttribute('aria-expanded','false');
  }
  function openProjectMenu(anchor,scope='general'){
    if(!menu.hidden&&menuAnchor===anchor){closeProjectMenu();return;}
    closeProjectMenu();menuAnchor=anchor;
    nodes.import.hidden=scope==='project';nodes.export.hidden=scope==='project';
    renameProjectButton.hidden=scope!=='project';
    sendProjectButton.hidden=scope!=='project'||!originalProjectHotel();linkProjectButton.hidden=scope==='project';
    updateButtons();menu.hidden=false;anchor.setAttribute('aria-expanded','true');
    const position=()=>{if(!ctx.libs?.computePosition){const rect=anchor.getBoundingClientRect();Object.assign(menu.style,{left:Math.max(8,Math.min(rect.right-210,innerWidth-220))+'px',top:Math.max(8,Math.min(rect.bottom+6,innerHeight-menu.offsetHeight-8))+'px'});return;}void ctx.libs.computePosition(anchor,menu,{strategy:'fixed',placement:'bottom-end',middleware:[ctx.libs.offset(6),ctx.libs.flip(),ctx.libs.shift({padding:8})]}).then(({x,y})=>{if(disposed||menu.hidden||menuAnchor!==anchor)return;Object.assign(menu.style,{left:x+'px',top:y+'px'});});};
    menuCleanup=ctx.libs?.autoUpdate?ctx.libs.autoUpdate(anchor,menu,position):null;position();motion(menu);menu.querySelector('button:not(:disabled):not([hidden])')?.focus();
  }
  $('project-menu-toggle').onclick=()=>openProjectMenu($('project-menu-toggle'));$('menu-mobile').onclick=()=>openProjectMenu($('menu-mobile'));
  $('menu-selected-mobile').onclick=()=>{if(currentProjectHotel()&&state.projects[state.selected])openProjectMenu($('menu-selected-mobile'),'project');};
  root.addEventListener('pointerdown',e=>{if(!e.target.closest('#project-menu,#project-menu-toggle,#menu-mobile,.project-menu-trigger'))closeProjectMenu();},{signal:ac.signal});
  menu.addEventListener('click',e=>{if(e.target.closest('button'))closeProjectMenu();},{signal:ac.signal});
  menu.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();closeProjectMenu();menuAnchor?.focus();}
    if(e.key==='Tab')closeProjectMenu();
    if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
      e.preventDefault();const items=[...menu.querySelectorAll('button:not(:disabled):not([hidden])')];if(!items.length)return;
      const n=items.indexOf(root.activeElement),index=e.key==='Home'?0:e.key==='End'?items.length-1:(n+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;items[index]?.focus();
    }
  },{signal:ac.signal});
  const linkDialog=document.createElement('dialog');linkDialog.id='project-link-dialog';linkDialog.className='project-link-dialog';linkDialog.setAttribute('aria-labelledby','project-link-title');
  linkDialog.innerHTML=`<div class="project-link-heading"><h2 id="project-link-title">Vincular hotéis</h2><button id="project-link-close" class="icon" aria-label="Fechar vínculo">×</button></div><p id="project-link-state" role="status" aria-live="polite"></p><p class="hint" id="project-link-help"></p><section id="project-link-start"><button id="project-link-create" class="button wide">Gerar código neste hotel</button><div class="project-link-join"><label for="project-link-input">Código gerado no outro hotel</label><input id="project-link-input" class="control" type="text" maxlength="64" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Digite o código"><button id="project-link-join" class="button wide">Usar código</button></div></section><section id="project-link-invite" hidden><label for="project-link-code">Código para o outro hotel</label><output id="project-link-code"></output><p id="project-link-expiry" class="hint"></p></section><p id="project-link-candidate" class="hint"></p><div class="actions project-link-actions"><button id="project-link-check" class="button" hidden>Conferir vínculo</button><button id="project-link-confirm" class="button primary" hidden>Confirmar vínculo</button><button id="project-link-cancel" class="button quiet" hidden>Cancelar convite</button><button id="project-link-disconnect" class="button danger" hidden>Desconectar hotéis</button></div><p id="project-link-feedback" class="status-note" role="status" aria-live="polite"></p>`;
  root.append(linkDialog);
  function linkExpiry(){const value=linkStatus.expiresAt;return typeof value==='number'?value:Date.parse(value)||0;}
  function stopLinkPolling(){clearTimeout(linkPollTimer);linkPollTimer=null;linkEpoch++;}
  function closeLinkDialog(){
    stopLinkPolling();linkPollDeadline=0;
    if($('project-link-dialog')?.open){$('project-link-dialog').close();const fallback=$('menu-mobile').getClientRects().length?$('menu-mobile'):$('project-menu-toggle');(linkReturnFocus?.isConnected?linkReturnFocus:fallback)?.focus();}
  }
  function renderProjectLink(){
    if(disposed)return;
    const linked=linkStatus.linked===true,pending=!linked&&linkStatus.pending===true,expired=pending&&linkExpiry()>0&&linkExpiry()<=Date.now();
    $('link-hotels').textContent=linked?'Gerenciar vínculo entre hotéis':'Vincular hotéis';
    $('project-link-state').textContent=linked?'Habblive e Habblet vinculados':pending?(expired?'Código expirado':linkStatus.role==='host'?'Aguardando o outro hotel':'Aguardando confirmação no outro hotel'):'Conecte seus projetos entre Habblive e Habblet';
    $('project-link-help').textContent=linked?'Para enviar um projeto, feche esta janela e use o menu do projeto original. O recebimento não compra nem monta móveis.':pending?'O hotel que gerou o código precisa confirmar o vínculo. Depois, envie o projeto pelo menu novamente.':'Gere um código aqui e insira no outro hotel, ou use um código que você já gerou lá.';
    $('project-link-start').hidden=linked||pending;
    $('project-link-invite').hidden=!pending||linkStatus.role!=='host'||!linkStatus.code;
    $('project-link-code').textContent=String(linkStatus.code||'');
    $('project-link-expiry').textContent=linkExpiry()?`Válido até ${new Date(linkExpiry()).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}.`:'';
    $('project-link-candidate').textContent=pending&&linkStatus.role==='host'&&linkStatus.candidate?`${hotelName(linkStatus.candidate.hotel)} solicitou o vínculo. Confirme se foi você.`:'';
    $('project-link-confirm').hidden=!pending||linkStatus.role!=='host'||!linkStatus.candidate||expired;
    $('project-link-check').hidden=!pending;
    $('project-link-cancel').hidden=!pending;
    $('project-link-disconnect').hidden=!linked;
    for(const id of ['project-link-create','project-link-join','project-link-input','project-link-check','project-link-confirm','project-link-cancel','project-link-disconnect'])$(id).disabled=linkBusy;
    linkDialog.setAttribute('aria-busy',String(linkBusy));
    if(expired)$('project-link-feedback').textContent='Use Conferir vínculo para recuperar uma confirmação já feita. Se não houver confirmação, gere um novo código.';
    updateButtons();
  }
  function applyProjectLinkStatus(status){
    if(disposed)return;
    const wasLinked=linkStatus.linked===true;
    linkStatus=status||runtime.projectLinkStatus?.()||{linked:false,pending:false};
    if(linkStatus.linked||!linkStatus.pending)$('project-link-feedback').textContent='';
    renderProjectLink();
    if(linkStatus.linked||!linkStatus.pending)stopLinkPolling();else scheduleLinkPoll();
    if(!wasLinked&&linkStatus.linked)notice('Hotéis vinculados. Abra o menu do projeto e envie novamente.','success');
    if(state.projectHotel==='converted'&&!state.projects[state.selected])renderProjectDetail();
  }
  function scheduleLinkPoll(){
    if(disposed||!linkDialog.open||!linkStatus.pending||linkStatus.linked||linkBusy||linkPollTimer!==null||typeof runtime.checkProjectLink!=='function')return;
    const deadline=Math.min(linkPollDeadline||Date.now(),linkExpiry()||Infinity);
    if(Date.now()>=deadline){$('project-link-feedback').textContent=linkExpiry()&&Date.now()>=linkExpiry()?'O código expirou. Use Conferir vínculo para verificar se a conexão já foi confirmada.':'A conferência automática terminou. Use Conferir vínculo para atualizar.';return;}
    const epoch=linkEpoch;
    linkPollTimer=setTimeout(async()=>{
      linkPollTimer=null;
      if(disposed||epoch!==linkEpoch||!linkDialog.open||!linkStatus.pending)return;
      if(Date.now()>=deadline){renderProjectLink();scheduleLinkPoll();return;}
      try{
        const status=await runtime.checkProjectLink();
        if(disposed||epoch!==linkEpoch||!linkDialog.open)return;
        applyProjectLinkStatus(status);
      }catch(error){if(!disposed&&epoch===linkEpoch&&linkDialog.open)$('project-link-feedback').textContent=error.message||'Não foi possível conferir o vínculo. Use Conferir vínculo para tentar novamente.';}
    },Math.min(3000,Math.max(1,deadline-Date.now())));
  }
  function openLinkDialog(){
    if(disposed||linkDialog.open)return;
    linkReturnFocus=menuAnchor?.isConnected?menuAnchor:root.activeElement;closeProjectMenu();
    linkStatus=runtime.projectLinkStatus?.()||{linked:false,pending:false};
    $('project-link-feedback').textContent='';renderProjectLink();
    linkPollDeadline=Date.now()+5*60*1000;linkDialog.showModal();$('project-link-close').focus();scheduleLinkPoll();
  }
  async function linkAction(method,args=[]){
    if(disposed||linkBusy||!linkDialog.open)return;
    if(typeof runtime[method]!=='function'){$('project-link-feedback').textContent='O vínculo entre hotéis está indisponível nesta sessão.';return;}
    stopLinkPolling();const epoch=linkEpoch;linkBusy=true;$('project-link-feedback').textContent='';renderProjectLink();
    try{
      await runtime[method](...args);
      if(disposed||epoch!==linkEpoch||!linkDialog.open)return;
      applyProjectLinkStatus(runtime.projectLinkStatus());
    }catch(error){if(!disposed&&epoch===linkEpoch&&linkDialog.open)$('project-link-feedback').textContent=error.message||'Não foi possível atualizar o vínculo.';}
    finally{linkBusy=false;if(!disposed){renderProjectLink();scheduleLinkPoll();}}
  }
  $('project-link-close').onclick=closeLinkDialog;
  linkDialog.addEventListener('cancel',e=>{e.preventDefault();closeLinkDialog();},{signal:ac.signal});
  linkDialog.addEventListener('close',()=>{stopLinkPolling();linkPollDeadline=0;},{signal:ac.signal});
  $('project-link-create').onclick=()=>void linkAction('createProjectLink');
  $('project-link-join').onclick=()=>{const code=$('project-link-input').value.trim();if(!code){$('project-link-feedback').textContent='Digite o código gerado no outro hotel.';$('project-link-input').focus();return;}void linkAction('joinProjectLink',[code]);};
  $('project-link-input').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('project-link-join').click();}},{signal:ac.signal});
  $('project-link-check').onclick=()=>void linkAction('checkProjectLink');
  $('project-link-confirm').onclick=()=>{if(linkStatus.pending&&linkStatus.role==='host'&&linkStatus.candidate&&(!linkExpiry()||linkExpiry()>Date.now()))void linkAction('confirmProjectLink');};
  $('project-link-cancel').onclick=()=>void linkAction('cancelProjectLink');
  $('project-link-disconnect').onclick=()=>attempt(async()=>{
    if(linkBusy||!linkStatus.linked)return;
    const epoch=linkEpoch;
    if(!await confirmAction('Desconectar hotéis?','Novos envios entre Habblive e Habblet ficarão indisponíveis até um novo vínculo.','Desconectar'))return;
    if(disposed||epoch!==linkEpoch||!linkDialog.open||!runtime.projectLinkStatus().linked)return;
    await linkAction('disconnectProjectLink');
  });
  $('link-hotels').onclick=openLinkDialog;
  function refreshProjectsOnOpen(){
    if(initialProjectRefresh||!runtime.projectLinkStatus?.().linked||typeof runtime.refreshProjects!=='function')return;
    initialProjectRefresh=true;void refreshProjectInbox();
  }
  async function refreshProjectInbox(){
    if(disposed||state.projectRefreshing||!runtime.projectLinkStatus?.().linked||typeof runtime.refreshProjects!=='function')return;
    state.projectRefreshing=true;updateButtons();
    try{
      const result=await runtime.refreshProjects();if(disposed)return;
      renderProjects();
      const received=Math.max(0,Number(result?.received)||0),expired=Math.max(0,Number(result?.expired)||0);
      notice(`${received} ${received===1?'projeto recebido':'projetos recebidos'}${expired?`; ${expired} ${expired===1?'envio expirado':'envios expirados'}`:''}.`,'success',false);
      if(received){
        const action=document.createElement('button');action.id='toast-action';action.className='toast-action';action.textContent='Abrir Convert';
        action.onclick=()=>{selectProjectSource('converted');switchTab('projects');$('toast').classList.remove('visible');};$('toast').append(action);
      }
    }catch(error){if(!disposed)notice(error.message||'Não foi possível atualizar os projetos.','error',false);}
    finally{state.projectRefreshing=false;if(!disposed)updateButtons();}
  }
  $('projects-refresh').onclick=$('projects-refresh-mobile').onclick=()=>void refreshProjectInbox();
  $('send-project').onclick=()=>attempt(async()=>{
    requireOriginalProjectHotel();
    const name=state.selected;if(!name||!runtime.projects()[name]||state.projectSending||runtime.busy)return;
    if(!runtime.projectLinkStatus?.().linked){openLinkDialog();return;}
    state.projectSending=true;updateButtons();
    try{await runtime.sendProject(name);if(!disposed)notice('Projeto enviado. No outro hotel, use Atualizar projetos para receber a versão convertida.','success');}
    finally{state.projectSending=false;if(!disposed)updateButtons();}
  });
  ctx.installInputGuard(ac.signal);
  const colors=['#65CFD0','#F4C568','#A9B8F4','#ECACBD'];
  let groupId=0;

  function savePref(){try{localStorage.setItem('hl_oficina_preferences',JSON.stringify(pref));}catch{notice('Não foi possível salvar suas preferências.','warning',false);}}
  let geometry={width:1440,height:860};
  try{const saved=JSON.parse(localStorage.getItem('hl_constructor_workbench')||'null');if(saved&&Number.isFinite(saved.width)&&Number.isFinite(saved.height))geometry={width:Math.max(360,saved.width),height:Math.max(420,saved.height)};}catch{}
  function saveGeometry(){try{localStorage.setItem('hl_constructor_workbench',JSON.stringify(geometry));}catch{}}
  function applyWidth(){
    panel.style.setProperty('--width',Math.max(280,Math.min(geometry.width,innerWidth-16))+'px');
    panel.style.setProperty('--height',Math.max(300,Math.min(geometry.height,innerHeight-16))+'px');
    panel.classList.toggle('compact',geometry.width<620);
    if(!host.style.left){host.style.right='auto';host.style.left=Math.max(8,(innerWidth-panel.getBoundingClientRect().width)/2)+'px';}
    clampHost();preview?.resize();
    if($('bench-details'))$('bench-details').open=Math.min(geometry.width,innerWidth-16)>740;
  }
  function clampHost(){
    if(host.style.left){
      host.style.left=Math.max(8,Math.min(parseFloat(host.style.left),innerWidth-host.getBoundingClientRect().width-8))+'px';
      host.style.top=Math.max(8,Math.min(parseFloat(host.style.top),innerHeight-Math.min(host.getBoundingClientRect().height,innerHeight-16)-8))+'px';
    }
  }

  async function unlockAudio(gesture=false){
    if(gesture)audioGesture=true;
    if(disposed||!audioGesture)return;
    if(state.audio){if(gesture&&state.audio.state==='suspended')try{await state.audio.resume();}catch{}return;}
    const Audio=window.AudioContext||window.webkitAudioContext;
    if(!Audio)return;
    try{state.audio=new Audio();if(state.audio.state==='suspended')await state.audio.resume();}catch{}
  }

  async function sound(type='success',force=false){
    if(!force&&!pref.sound||pref.volume<=0)return;
    await unlockAudio();
    const ctx=state.audio;
    if(disposed||!ctx)return;
    try{
      await ctx.resume();
      if(disposed)return;
      stopPlacementVoice();
      const tones=type==='error'?[330,220]:type==='warning'?[440]:[523.25,659.25,783.99];
      audioNoticeUntil=ctx.currentTime+(tones.length-1)*0.105+0.17;
      tones.forEach((f,i)=>{
        const o=ctx.createOscillator(),g=ctx.createGain(),t=ctx.currentTime+i*0.105;
        o.type='sine';o.frequency.value=f;
        g.gain.setValueAtTime(0,t);
        g.gain.linearRampToValueAtTime(pref.volume*0.22,t+0.015);
        g.gain.exponentialRampToValueAtTime(0.0001,t+0.15);
        o.connect(g);g.connect(ctx.destination);
        o.start(t);o.stop(t+0.17);
      });
    }catch{}
  }

  function stopPlacementVoice(){
    if(!placementVoice)return;const voice=placementVoice;placementVoice=null;
    try{voice.osc.stop();voice.osc.disconnect();voice.gain.disconnect();}catch{}
  }
  function placementSound(event){
    if(disposed||!event)return;
    const generation=String(runtime.roomEpoch)+'|'+String(runtime.ws?.id);
    if(placementGeneration!==generation){placementGeneration=generation;placementHeard.clear();stopPlacementVoice();}
    if(runtime.ws?.readyState!==1||event.epoch!==runtime.roomEpoch||event.connectionId!==runtime.ws?.id||event.roomId==null)return;
    const key=generation+'|'+String(event.roomId);if(placementHeard.has(key))return;placementHeard.add(key);
    const audio=state.audio,now=performance.now();
    if(!pref.sound||!pref.placementSound||pref.volume<=0||!audioGesture||!audio||audio.state!=='running'||now-lastPlacementAt<250||placementVoice||audio.currentTime<audioNoticeUntil)return;
    try{
      const osc=audio.createOscillator(),gain=audio.createGain(),time=audio.currentTime;osc.type='sine';osc.frequency.setValueAtTime(120,time);osc.frequency.exponentialRampToValueAtTime(75,time+0.05);
      gain.gain.setValueAtTime(0.0001,time);gain.gain.exponentialRampToValueAtTime(Math.max(0.0002,pref.volume*0.12),time+0.006);gain.gain.exponentialRampToValueAtTime(0.0001,time+0.055);
      osc.connect(gain);gain.connect(audio.destination);placementVoice={osc,gain};lastPlacementAt=now;
      osc.onended=()=>{try{osc.disconnect();gain.disconnect();}catch{}if(placementVoice?.osc===osc)placementVoice=null;};osc.start(time);osc.stop(time+0.055);
    }catch{stopPlacementVoice();}
  }

  function log(text,type='info'){
    const item=document.createElement('div');
    item.className=type;
    item.textContent=`${new Date().toLocaleTimeString('pt-BR')} ${text}`;
    $('log').append(item);
    while($('log').children.length>100)$('log').firstChild.remove();
    $('log').scrollTop=$('log').scrollHeight;
  }

  function notice(text,type='info',play=true){
    if(disposed)return;
    $('toast-action')?.remove();
    $('toast-text').textContent=text;
    $('toast').className='toast visible '+type;
    clearTimeout(state.toastTimer);
    state.toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),type==='error'?16000:10000);
    log(text,type);
    if(play&&['success','error','warning'].includes(type))void sound(type);
  }

  async function attempt(fn){
    if(disposed)return;
    try{return await fn();}
    catch(e){if(!e.__oficinaShown)notice(e.message||'Não foi possível concluir a ação.','error');return undefined;}
  }

  function confirmAction(title,text,yes='Confirmar'){
    if(state.dialogResolve)return Promise.resolve(false);
    $('dialog-title').textContent=title;
    $('dialog-text').textContent=text;
    $('dialog-yes').textContent=yes;
    return new Promise(resolve=>{state.dialogResolve=resolve;$('dialog').showModal();$('dialog-no').focus();});
  }
  function finishDialog(value){
    $('dialog').close();
    const resolve=state.dialogResolve;
    state.dialogResolve=null;
    resolve?.(value);
  }
  $('dialog-yes').onclick=()=>finishDialog(true);
  $('dialog-no').onclick=()=>finishDialog(false);
  $('dialog').addEventListener('cancel',e=>{e.preventDefault();finishDialog(false);});
  const renameDialog=document.createElement('dialog');renameDialog.id='project-rename-dialog';renameDialog.setAttribute('aria-labelledby','project-rename-title');
  renameDialog.innerHTML='<form id="project-rename-form"><h2 id="project-rename-title">Renomear projeto</h2><label for="project-rename-name">Nome do projeto</label><input id="project-rename-name" class="control" type="text" required maxlength="120" autocomplete="off" aria-describedby="project-rename-error"><p id="project-rename-error" class="status-note" role="alert"></p><div class="actions"><button id="project-rename-cancel" class="button" type="button">Voltar</button><button id="project-rename-save" class="button primary" type="submit">Renomear</button></div></form>';
  root.append(renameDialog);
  function closeRenameDialog(){
    if($('project-rename-dialog')?.open)$('project-rename-dialog').close();
    renameTarget=null;
  }
  renameDialog.addEventListener('close',()=>{
    renameTarget=null;
    if(disposed||host.hidden||shell.classList.contains('minimized'))return;
    const selected=[...$('projects').querySelectorAll('.project')].find(button=>button.dataset.name===state.selected);
    ($('menu-selected-mobile').getClientRects().length?$('menu-selected-mobile'):selected||$('project-menu-toggle')).focus();
  });
  $('project-rename-cancel').onclick=closeRenameDialog;
  renameProjectButton.onclick=()=>attempt(()=>{
    requireProjectHotel();
    if(renameProjectButton.disabled||state.projectRenaming)return;
    const project=projectCollection()[state.selected];if(!project)return;
    renameTarget={name:state.selected,bucket:projectBucket(),id:project.id};
    $('project-rename-name').value=state.selected;$('project-rename-error').textContent='';
    renameDialog.showModal();$('project-rename-name').focus();$('project-rename-name').select();
  });
  $('project-rename-form').addEventListener('submit',event=>{
    event.preventDefault();
    if(state.projectRenaming||!renameTarget)return;
    const target=renameTarget,nextName=$('project-rename-name').value.trim();
    void attempt(async()=>{
      try{
        requireProjectHotel();
        if(runtime.busy||state.projectSending)throw Error('Aguarde a tarefa atual antes de renomear.');
        state.projectRenaming=true;$('project-rename-save').disabled=true;$('project-rename-error').textContent='';updateButtons();
        await runtime.renameProject(target.name,nextName,target.bucket,target.id);
        if(disposed)return;
        if(currentProjectHotel()&&projectBucket()===target.bucket){
          state.selected=nextName;state.projectSelections[state.projectHotel]=nextName;
          if(!$('project-search').value.trim()||!nextName.toLocaleLowerCase('pt-BR').includes($('project-search').value.trim().toLocaleLowerCase('pt-BR')))$('project-search').value='';
          renderProjects();
        }
        closeRenameDialog();notice('Projeto renomeado.','success');
      }catch(error){
        if(!disposed){if(renameDialog.open&&renameTarget===target)$('project-rename-error').textContent=error.message;else throw error;}
      }finally{
        state.projectRenaming=false;
        if(!disposed){$('project-rename-save').disabled=false;updateButtons();}
      }
    });
  });
  for(const type of ['pointerdown','keydown'])root.addEventListener(type,event=>{if(event.isTrusted)void unlockAudio(true);},{signal:ac.signal});

  function switchTab(key){
    for(const tab of root.querySelectorAll('.tab')){
      const selected=tab.dataset.tab===key;
      tab.setAttribute('aria-selected',String(selected));
      tab.tabIndex=selected?0:-1;
      $('view-'+tab.dataset.tab).hidden=!selected;
    }
    if(key==='projects')renderProjects();
    closeProjectMenu();syncPreviewVisibility();preview?.resize();
  }
  for(const tab of root.querySelectorAll('.tab')){
    tab.onclick=()=>switchTab(tab.dataset.tab);
    tab.onkeydown=e=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
      e.preventDefault();
      const tabs=[...root.querySelectorAll('.tab')],idx=tabs.indexOf(tab);
      const n=e.key==='Home'?0:e.key==='End'?2:(idx+(e.key==='ArrowRight'?1:-1)+3)%3;
      switchTab(tabs[n].dataset.tab);tabs[n].focus();
    };
  }
  $('fold').onclick=()=>{ctx.ui.hide();$('launcher').focus();};
  $('launcher').onclick=e=>{if(launcherDragged&&e.detail!==0){launcherDragged=false;return;}launcherDragged=false;ctx.ui.show();motion(panel);$('fold').focus();};
  $('toast-close').onclick=()=>$('toast').classList.remove('visible');

  for(const id of ['drag','launcher']){
    const handle=$(id);
    handle.addEventListener('pointerdown',e=>{
      if(e.button!==0||!e.isPrimary||(id==='drag'&&e.target.closest('button')))return;
      if(id==='launcher')launcherDragged=false;
      const r=host.getBoundingClientRect();
      drag={x:e.clientX-r.left,y:e.clientY-r.top,startX:e.clientX,startY:e.clientY,id:e.pointerId,handle:id,moved:false};
      handle.setPointerCapture(e.pointerId);
    },{signal:ac.signal});
    handle.addEventListener('pointermove',e=>{
      if(!drag||drag.id!==e.pointerId||drag.handle!==id)return;
      if(!drag.moved&&Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<5)return;
      drag.moved=true;
      if(id==='launcher')launcherDragged=true;
      host.style.right='auto';
      host.style.left=Math.max(8,Math.min(e.clientX-drag.x,innerWidth-host.getBoundingClientRect().width-8))+'px';
      host.style.top=Math.max(8,Math.min(e.clientY-drag.y,innerHeight-host.getBoundingClientRect().height-8))+'px';
    },{signal:ac.signal});
    handle.addEventListener('pointerup',releasePointers,{signal:ac.signal});
    handle.addEventListener('pointercancel',releasePointers,{signal:ac.signal});
    handle.addEventListener('lostpointercapture',()=>{if(drag?.handle===id)drag=null;},{signal:ac.signal});
  }
  function releasePointers(){
    const operations=[[drag?.handle,drag],['resize',resizing]];drag=null;resizing=null;
    for(const [id,operation] of operations){const node=root.getElementById(id);if(operation&&node?.hasPointerCapture(operation.id))node.releasePointerCapture(operation.id);}
  }
  $('resize').addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();const rect=panel.getBoundingClientRect();resizing={id:e.pointerId,x:e.clientX,y:e.clientY,width:rect.width,height:rect.height};$('resize').setPointerCapture(e.pointerId);},{signal:ac.signal});
  $('resize').addEventListener('pointermove',e=>{if(!resizing||resizing.id!==e.pointerId)return;const rect=host.getBoundingClientRect();geometry.width=Math.max(360,Math.min(resizing.width+e.clientX-resizing.x,innerWidth-rect.left-8));geometry.height=Math.max(420,Math.min(resizing.height+e.clientY-resizing.y,innerHeight-rect.top-8));applyWidth();},{signal:ac.signal});
  $('resize').addEventListener('pointerup',()=>{releasePointers();saveGeometry();},{signal:ac.signal});
  $('resize').addEventListener('pointercancel',releasePointers,{signal:ac.signal});
  $('resize').addEventListener('lostpointercapture',()=>{resizing=null;},{signal:ac.signal});
  $('resize').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();geometry.width=Math.max(360,geometry.width+(e.key==='ArrowRight'?32:e.key==='ArrowLeft'?-32:0));geometry.height=Math.max(420,geometry.height+(e.key==='ArrowDown'?32:e.key==='ArrowUp'?-32:0));applyWidth();saveGeometry();},{signal:ac.signal});
  window.addEventListener('resize',applyWidth,{signal:ac.signal});

  const name=sid=>state.names.get(Number(sid))||`Móvel ${sid}`;

  function optionsForSelect(sel){
    const previous=sel.value,term=$('search').value.toLocaleLowerCase('pt-BR').trim(),counts=new Map();
    for(const i of runtime.inventory)counts.set(i.spriteId,(counts.get(i.spriteId)||0)+1);
    sel.replaceChildren();
    const none=document.createElement('option');none.value='';none.textContent='Escolha um móvel';sel.append(none);
    const entries=[...counts].sort((a,b)=>name(a[0]).localeCompare(name(b[0]),'pt-BR'));
    for(const [sid,count] of entries){
      if(term&&!name(sid).toLocaleLowerCase('pt-BR').includes(term)&&String(sid)!==previous)continue;
      const o=document.createElement('option');
      o.value=String(sid);
      o.textContent=`${name(sid)} · ${count} disponíveis${state.walls.has(sid)||runtime.inventory.find(i=>i.spriteId===sid)?.type==='i'?' · parede':''}`;
      sel.append(o);
    }
    if(previous&&!counts.has(Number(previous))){
      const o=document.createElement('option');
      o.value=previous;
      o.textContent=`${name(previous)} · sem unidades`;
      sel.append(o);
    }
    sel.value=previous;
  }

  function addGroup(){
    if(state.groups.length>=12)return notice('Use até 12 grupos de móveis por construção.','warning');
    const id=++groupId,el=document.createElement('div');
    el.className='group';
    el.style.setProperty('--group-color',colors[(id-1)%colors.length]);
    el.innerHTML=`<div class="group-top"><span class="group-number"></span><select class="control item-select" aria-label="Móvel do grupo"></select><button class="icon remove" aria-label="Remover grupo" title="Remover grupo">${icons.close}</button></div><div class="group-details"><label>Por posição<input class="control count" type="number" value="1" min="1" max="100"></label><label>Onde colocar<select class="control type"><option value="auto">Detectar</option><option value="floor">No chão</option><option value="wall">Na parede</option></select></label><label class="rise-label">Subir por móvel<input class="control rise" type="number" value="0.65" min="0" max="100" step="0.05"></label></div>`;
    state.groups.push(el);
    $('groups').append(el);
    el.querySelector('.remove').onclick=()=>{el.remove();state.groups=state.groups.filter(g=>g!==el);renumber();compute();};
    el.addEventListener('input',scheduleCompute);
    el.addEventListener('change',compute);
    optionsForSelect(el.querySelector('select'));
    renumber();compute();
  }

  function renumber(){state.groups.forEach((g,i)=>g.querySelector('.group-number').textContent=String(i+1));}

  const definitions=ctx.shapes;

  function loadCustom(){
    const raw=JSON.parse(localStorage.getItem('mp_cs')||'[]');
    if(!Array.isArray(raw)||raw.length>100)throw Error('As formas pessoais salvas são inválidas.');
    state.custom=raw;
  }
  function customDefinition(){return state.custom.find(s=>s.key===state.shape);}

  function buildShapes(){
    $('shapes').replaceChildren();
    for(const [key,def] of [...Object.entries(definitions),...state.custom.map(s=>[s.key,{name:s.name,icon:s.icon||'◇'}])]){
      const btn=document.createElement('button');
      btn.className='shape'+(state.shape===key?' active':'');
      btn.setAttribute('aria-pressed',String(state.shape===key));
      const b=document.createElement('b');b.setAttribute('aria-hidden','true');b.textContent=def.icon;
      const t=document.createElement('span');t.textContent=def.name;
      btn.append(b,t);
      btn.onclick=()=>{state.shape=key;buildShapes();renderParameters();compute();};
      $('shapes').append(btn);
    }
  }

  function renderParameters(){
    const def=definitions[state.shape],custom=customDefinition();
    $('shape-params').replaceChildren();
    const params=def?def.params:(custom?.params||[]).map(p=>[p.id,p.label||p.id,p.def,p.type]);
    for(const [id,label,value,type] of params){
      const l=document.createElement('label');l.textContent=label;
      const input=document.createElement('input');input.id='param-'+id;
      if(type==='check'){input.type='checkbox';input.checked=!!value;l.className='check';l.prepend(input);}
      else{
        input.type='number';input.className='control';input.value=String(value??1);
        input.step=String(custom?.params?.find(p=>p.id===id)?.step||1);
        l.append(input);
      }
      input.addEventListener('input',scheduleCompute);
      $('shape-params').append(l);
    }
    if(state.shape!=='wallLineH'){
      const l=document.createElement('label');l.textContent='Camadas de móveis';
      const input=document.createElement('input');input.id='layers';input.type='number';input.min='1';input.max='50';input.value='1';input.className='control';
      l.append(input);input.oninput=scheduleCompute;
      $('shape-params').append(l);
    }
    if(['square','rect','circle'].includes(state.shape)){
      const l=document.createElement('label');l.className='check';
      l.innerHTML='<input id="hollow" type="checkbox"> Só o contorno';
      $('shape-params').append(l);
      $('hollow').checked=state.shape==='circle';
      $('hollow').onchange=compute;
    }
    if(state.shape!=='wallLineH'){
      const l=document.createElement('label');l.className='check';
      l.innerHTML='<input id="zebra" type="checkbox"> Deixar uma posição vazia entre móveis';
      $('shape-params').append(l);
      $('zebra').onchange=compute;
    }
  }

  function compileCustom(s){
    const params=s.params||[];
    if(!Array.isArray(params)||params.length>12||params.some(p=>!/^[A-Za-z_][\w]*$/.test(p.id)||['x','y','rest','params'].includes(p.id)))throw Error('Use nomes válidos e distintos para os parâmetros.');
    if(new Set(params.map(p=>p.id)).size!==params.length)throw Error('Os nomes dos parâmetros estão repetidos.');
    return new Function('params',`"use strict"; const {x,y,...rest}=params; const {${params.map(p=>p.id).join(',')}}=rest; ${s.body}`);
  }

  function config(){
    const cfg={
      shape:state.shape,
      x:C.int($('start-x').value,-10000,10000),
      y:C.int($('start-y').value,-10000,10000),
      heightMode:$('height-mode').value,
      height:C.number($('height').value,-1000,1000),
      rot:Number($('rotation').value),
      layers:Number($('layers')?.value??1),
      hollow:$('hollow')?.checked,
      zebra:$('zebra')?.checked,
      wx:C.int($('wall-wx').value,-1000,1000),
      wy:C.int($('wall-wy').value,-1000,1000),
      lx:C.int($('wall-lx').value,-1000,1000),
      ly:C.int($('wall-ly').value,-1000,1000),
      wallDir:$('wall-dir').value,
      groups:state.groups.filter(g=>g.querySelector('.item-select').value).map(g=>({
        sid:Number(g.querySelector('.item-select').value),
        count:C.int(g.querySelector('.count').value,1,100),
        type:g.querySelector('.type').value,
        rise:C.number(g.querySelector('.rise').value,0,100)
      }))
    };
    for(const input of $('shape-params').querySelectorAll('input[id^=param-]'))
      cfg[input.id.slice(6)]=input.type==='checkbox'?input.checked:C.number(input.value);
    if(customDefinition())cfg.customFn=compileCustom(customDefinition());
    return cfg;
  }

  function draw(positions){
    const svg=$('preview'),NS='http://www.w3.org/2000/svg';
    svg.replaceChildren();
    const make=(tag,attrs)=>{const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));return e;};
    const defs=make('defs',{}),pat=make('pattern',{id:'of-grid',width:16,height:16,patternUnits:'userSpaceOnUse'});
    pat.append(make('path',{d:'M 16 0 L 0 0 0 16',fill:'none',stroke:'#29465B','stroke-width':0.6}));
    defs.append(pat);
    svg.append(defs,make('rect',{width:400,height:164,fill:'url(#of-grid)'}));
    if(!positions?.length){
      const t=make('text',{x:200,y:88,'text-anchor':'middle',fill:'#90A7B9','font-size':12});
      t.textContent='A disposição dos móveis aparece aqui';
      svg.append(t);
      return;
    }
    const xs=positions.map(p=>p.x),ys=positions.map(p=>p.y);
    const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    const size=Math.max(2,Math.min(22,310/(maxX-minX+1),114/(maxY-minY+1)));
    const ox=(400-(maxX-minX+1)*size)/2,oy=(164-(maxY-minY+1)*size)/2;
    const unique=new Map();
    for(const p of positions)unique.set(`${p.x},${p.y}`,p);
    for(const p of unique.values()){
      const index=state.groups.findIndex(g=>Number(g.querySelector('.item-select').value)===p.spriteId);
      const color=colors[Math.max(0,index)%colors.length];
      svg.append(make('rect',{
        x:ox+(p.x-minX)*size+1,
        y:oy+(p.y-minY)*size+1,
        width:Math.max(1,size-2),
        height:Math.max(1,size-2),
        rx:Math.min(3,size/5),
        fill:color,
        opacity:p.wall?0.65:0.9
      }));
    }
  }

  function scheduleCompute(){clearTimeout(computeTimer);computeTimer=setTimeout(compute,180);}

  function compute(){
    clearTimeout(computeTimer);
    state.plan=null;
    let pos=[],text='';
    for(const g of state.groups){
      const step=$('height-mode').value==='step';
      g.querySelector('.rise-label').hidden=!step;
      g.querySelector('.group-details').classList.toggle('has-rise',step);
    }
    $('height-label').hidden=!['fixed','step'].includes($('height-mode').value);
    try{
      const cfg=config();
      pos=C.makeShape(cfg.shape,cfg);
      const total=pos.length*cfg.layers*cfg.groups.reduce((n,g)=>n+g.count,0);
      $('preview-total').textContent=total?`${total} móveis em ${pos.length} posições`:`${pos.length} posições`;
      if(!supports('build'))text='Construção ainda em validação neste hotel. Inventário e catálogo já podem ser conferidos.';
      else if(!cfg.groups.length)text='Escolha os móveis para esta forma.';
      else if(!runtime.inventoryFresh)text='Atualize seus móveis antes de construir.';
      else{
        state.plan=C.planShape(cfg,runtime.inventory);
        pos=state.plan;
        if(state.plan.some(p=>p.wall))text='Confira os envios de parede no quarto; não há confirmação específica de posição.';
      }
    }
    catch(e){text=e.message;$('preview-total').textContent='Confira a configuração';}
    draw(pos);
    $('build-note').textContent=text;
    updateButtons();
  }

  function updateInventory(){
    const kinds=new Set(runtime.inventory.map(i=>i.spriteId));
    $('inventory-count').textContent=runtime.inventoryFresh?`${runtime.inventory.length} móveis disponíveis · ${kinds.size} tipos`:'Atualize para escolher os móveis.';
    state.groups.forEach(g=>optionsForSelect(g.querySelector('.item-select')));
    compute();
    renderProjectDetail();
  }

  async function loadNames(){
    if(demo){if(!state.names.size){state.names=new Map([[7,'Banco de jardim'],[8,'Vaso de lavanda'],[9,'Piso de madeira'],[10,'Luminária de parede']]);state.walls.add(10);updateInventory();}return;}
    if(state.names.size)return;
    try{
      const data=await ctx.loadFurniture();
      if(disposed)return;
      for(const [sid,items] of data.floor.byId){
        if(new Set(items.map(item=>item.classname)).size===1&&items[0].name)state.names.set(sid,String(items[0].name));
      }
      for(const [sid,items] of data.wall.byId){
        if(!data.floor.byId.has(sid))state.walls.add(sid);
        if(!state.names.has(sid)&&new Set(items.map(item=>item.classname)).size===1&&items[0].name)state.names.set(sid,String(items[0].name));
      }
      log(`FurnitureData do ${ctx.hotel.name}: ${data.floor.count} registros de chão e ${data.wall.count} de parede.`);
      updateInventory();
    }catch(error){
      if(!disposed)log(`Nomes indisponíveis: ${error.message}. A lista continua utilizável pelo número do móvel.`,'warning');
    }
  }

  function connection(){
    const s=runtime.status(),online=s.state==='OPEN';
    $('connection').classList.toggle('online',online);
    $('connection-text').textContent=`${ctx.hotel?.name||'Hotel'} · ${s.state==='UNSUPPORTED'?'protocolo indisponível':online?'conectado':s.state==='CLOSED'?'conexão encerrada':'aguardando conexão'}`;
    updateInventory();
    updateButtons();operations();
  }

  function updateButtons(){
    const busy=runtime.busy,online=runtime.status().state==='OPEN',local=currentProjectHotel(),original=originalProjectHotel();
    $('refresh').disabled=busy||state.loading||!online||!supports('inventory');
    buttonLabel($('refresh'),state.loading?'Atualizando…':'Atualizar','refresh-cw');
    $('bench-refresh').disabled=!local||$('refresh').disabled;
    buttonLabel($('bench-refresh'),state.loading?'Atualizando…':'Atualizar inventário','refresh-cw');
    $('build').disabled=busy||state.loading||!online||!state.plan||!runtime.inventoryFresh||!supports('build');
    $('capture').disabled=!original||busy||state.loading||!online||!supports('capture');
    const project=local?state.projects[state.selected]:null,missing=project?C.missingItems(project.layout,projectInventory()):[],originValid=renderOriginSummary();
    $('mount').disabled=busy||state.loading||!online||!project?.layout.length||!runtime.inventoryFresh||!originValid||!supports('build');
    $('buy').disabled=busy||state.loading||!online||!project?.layout.length||!runtime.inventoryFresh||missing.length===0||!supports('buy');
    $('delete-project').disabled=!local||busy||!project;
    $('copy-open').disabled=$('copy-mobile').disabled=!original||!supports('capture')||!state.copyWaiting&&(busy||state.loading||!online);
    buttonLabel($('copy-open'),state.copyWaiting?'Aguardando reentrada · cancelar':'Copiar quarto','plus');
    buttonLabel($('copy-mobile'),state.copyWaiting?'Aguardando · cancelar':'Copiar quarto','plus');
    $('custom-save').disabled=busy;
    $('custom-delete').disabled=busy||!customDefinition();
    $('import-projects').disabled=!original||busy;
    $('export').disabled=!local||busy||!Object.keys(state.projects).length;
    $('project-file').disabled=!original||busy;
    $('project-select').disabled=!local;
    $('project-search').disabled=!local;
    $('import-catalog').disabled=busy;
    const active=runtime.catalogCapture?.active===true;
    $('capture-catalog').disabled=busy||!online||!supports('catalog');
    $('capture-catalog').textContent=active?'Parar captura':'Captura manual';
    $('auto-catalog').disabled=busy||!online||!supports('catalog');
    $('configuration-retry').disabled=busy||!supports('configuration')||!runtime.configurationStatus?.().canRetry;
    $('menu-selected-mobile').hidden=!local;
    $('menu-selected-mobile').disabled=!local||!project;
    $('rename-project').disabled=!local||!project||busy||state.projectSending||state.projectRenaming===true;
    $('send-project').disabled=!original||!project||busy||state.projectSending;
    for(const id of ['projects-refresh','projects-refresh-mobile']){
      $(id).disabled=state.projectRefreshing||!linkStatus.linked||typeof runtime.refreshProjects!=='function';
      $(id).title=linkStatus.linked?(state.projectRefreshing?'Atualizando projetos…':'Atualizar projetos'):'Vincule os hotéis para receber projetos';
      $(id).setAttribute('aria-busy',String(state.projectRefreshing));
    }
    const captureReason=state.projectHotel==='converted'?'Selecione os projetos originais deste hotel para copiar ou importar.':!local?`Abra o Constructor no ${projectHotelName()} para acessar os projetos deste hotel.`:!supports('capture')?'A cópia de quartos ainda não está disponível neste hotel.':'';
    $('project-hotel-note').textContent=original?captureReason:'';
    for(const id of ['copy-open','copy-mobile','capture'])$(id).title=captureReason;
    $('mount-help').textContent=!local?'':!supports('build')?'A montagem ainda não está disponível neste hotel.':!project?'Escolha um projeto para preparar a montagem.':!project.layout.length?'Este projeto não tem móveis compatíveis para montar.':!online?'Entre no jogo para montar o projeto.':!runtime.inventoryFresh?'Atualize o inventário para conferir os móveis.':missing.length?'Os móveis disponíveis serão colocados. Os faltantes ficarão pendentes.':'Confira a posição inicial antes de montar.';
    $('mount').title=!supports('build')?'A montagem ainda não está disponível neste hotel.':'';
  }

  const operationStates={done:'Concluído',pending:'Pendente',running:'Em execução',failed:'Falhou',ignored:'Ignorado'};
  const operationStages={buy:'Compra',place:'Colocação',configure:'Ajuste do móvel'};
  const operationCategories={catalog:'Catálogo',unavailable:'Indisponibilidade ou limitado',balance:'Saldo insuficiente',communication:'Comunicação',unexpected:'Erro inesperado',missing:'Ausente no inventário',dependency:'Apoio ou dependência',room:'Quarto a confirmar',confirmation:'Resultado desconhecido'};
  const operationCount=value=>Math.max(0,Number(value)||0);
  const operationText=(node,text)=>{const value=String(text);if(node.textContent!==value)node.textContent=value;};
  function operationReport(report={}){
    return `${operationCount(report.done)} confirmados · ${operationCount(report.pending)} pendentes · ${operationCount(report.running)} em execução · ${operationCount(report.failed)} falharam · ${operationCount(report.ignored)} ignorados · ${operationCount(report.total)} no total`;
  }
  function selectedOperation(snapshot=operationSnapshot){return snapshot?.jobs?.find(job=>String(job.id)===String(operationJobId));}
  function canRetryOperation(job){return !!job?.canRetry&&!runtime.busy&&!state.loading&&!operationAction&&runtime.status().state==='OPEN'&&supports(job.kind==='buy'?'buy':'build')&&typeof runtime.retryOperation==='function';}
  function operationOverview(){return runtime.operationSummary?.()||runtime.operationStatus?.();}
  function renderExecutionSummary(){
    if(disposed)return;
    const report=operationSnapshot.report||{},jobs=operationSnapshot.jobs||[];
    const done=operationCount(report.done),pending=operationCount(report.pending),failed=operationCount(report.failed),running=operationCount(report.running);
    $('execution-panel').hidden=!jobs.length&&$('configuration').hidden;
    operationText($('execution-summary'),`${done} confirmados · ${pending} pendentes${running?` · ${running} em execução`:''}${failed?` · ${failed} falharam`:''}`);
    const critical=executionError||(failed?`${failed} unidades falharam. Consulte os motivos nas pendências.`:pending?'Há pendências. Envios sem confirmação aguardam conciliação e não serão reenviados.':'');
    $('execution-critical').hidden=!critical;$('execution-critical').dataset.state=executionError||failed?'error':'warning';operationText($('execution-critical'),critical);
  }
  function operations(snapshot=operationOverview()){
    if(disposed)return;
    if(!snapshot){$('operations').hidden=true;renderExecutionSummary();return;}
    operationSnapshot=snapshot;
    const jobs=Array.isArray(snapshot.jobs)?snapshot.jobs:[];
    $('operations').hidden=!jobs.length;renderExecutionSummary();if(!jobs.length)return;
    let job=selectedOperation(snapshot);
    if(!job){job=jobs.find(candidate=>candidate.canRetry)||jobs[jobs.length-1];operationJobId=job.id;operationPage=0;}
    const optionsKey=JSON.stringify(jobs.map(item=>[item.id,item.kind,item.label]));
    if(optionsKey!==operationOptionsKey){
      operationOptionsKey=optionsKey;const options=document.createDocumentFragment();
      for(const item of jobs){const option=document.createElement('option');option.value=String(item.id);option.textContent=`${item.kind==='buy'?'Compra':'Montagem'} · ${item.label||'Sem nome'}`;options.append(option);}
      $('operation-job').replaceChildren(options);
    }
    $('operation-job').value=String(operationJobId);
    operationText($('operations-summary'),operationReport(snapshot.report));
    operationText($('operation-report'),operationReport(job.report));
    $('operations').dataset.state=operationCount(snapshot.report?.running)?'running':operationCount(snapshot.report?.pending)||operationCount(snapshot.report?.failed)?'pending':'done';
    $('operations-retry').disabled=!canRetryOperation(job);
    $('operations-retry').setAttribute('aria-label',`Tentar somente pendências de ${job.label||'operação selecionada'}`);
    const help=[];
    if(runtime.busy)help.push('Aguarde a tarefa atual para retomar pendências ou ignorar itens.');
    else if(runtime.status().state!=='OPEN')help.push('Entre no jogo para retomar as pendências.');
    else help.push('A nova tentativa trata somente pendências; unidades já confirmadas não são repetidas.');
    help.push('Envios sem confirmação aguardam conciliação do jogo e não serão reenviados.');
    operationText($('operations-help'),help.join(' '));
    if(!$('execution-panel').open||!$('operations-details').open)return;
    const filter=$('operation-filter').value;
    const fetchPage=()=>{
      if(typeof runtime.operationItems==='function'){
        const revision=job.revision??snapshot.revision,key=String(job.id)+'|'+String(revision)+'|'+filter+'|'+operationPage;
        if(revision!=null&&key===operationPageKey&&operationPageData)return operationPageData;
        const result=runtime.operationItems(job.id,{offset:operationPage*12,limit:12,status:filter});operationPageKey=key;operationPageData=result;return result;
      }
      const filtered=(job.items||[]).filter(item=>filter==='all'||(filter==='attention'?['pending','running','failed'].includes(item.status):item.status===filter));
      return {items:filtered.slice(operationPage*12,operationPage*12+12),total:filtered.length};
    };
    let page=fetchPage();const total=operationCount(page.total),pages=Math.max(1,Math.ceil(total/12));
    if(operationPage>=pages){operationPage=pages-1;page=fetchPage();}
    const shown=page.items||[],list=$('operation-items'),scroll=list.scrollTop,focused=root.activeElement?.closest?.('[data-operation-item]');
    const previous=new Map([...list.querySelectorAll('[data-operation-item]')].map(row=>[row.dataset.operationItem,row]));
    const keep=new Set();
    for(const [index,item] of shown.entries()){
      const key=String(job.id)+'|'+String(item.id);keep.add(key);let row=previous.get(key);
      if(!row){
        row=document.createElement('li');row.className='operation-item';row.dataset.operationItem=key;row.tabIndex=-1;
        const content=document.createElement('div');content.className='operation-item-content';
        for(const [tag,className] of [['strong','operation-item-title'],['span','operation-item-meta'],['span','operation-item-reason'],['span','operation-item-result']]){const text=document.createElement(tag);text.className=className;content.append(text);}
        const status=document.createElement('span');status.className='operation-item-status';
        const ignore=document.createElement('button');ignore.type='button';ignore.className='button small quiet operation-ignore';ignore.textContent='Ignorar';
        ignore.onclick=()=>ignoreOperation(job.id,item.id);row.append(content,status,ignore);
      }
      row.dataset.state=item.status;
      operationText(row.querySelector('.operation-item-title'),`${operationCount(item.quantity)} × ${name(item.spriteId)}`);
      operationText(row.querySelector('.operation-item-meta'),[operationStages[item.stage]||item.stage,operationCategories[item.category]||item.category].filter(Boolean).join(' · '));
      operationText(row.querySelector('.operation-item-reason'),item.reason||'');
      const result=[`${operationCount(item.confirmed)} confirmados`,`${operationCount(item.attempts)} tentativas`];
      if(item.uncertain)result.push('Resultado desconhecido: aguarde conciliação; não será reenviado.');
      operationText(row.querySelector('.operation-item-result'),result.join(' · '));
      operationText(row.querySelector('.operation-item-status'),operationStates[item.status]||item.status);
      const ignore=row.querySelector('.operation-ignore');ignore.hidden=!['pending','failed'].includes(item.status);ignore.disabled=runtime.busy||operationAction||typeof runtime.ignoreOperationItem!=='function';ignore.setAttribute('aria-label',`Ignorar pendência de ${name(item.spriteId)}`);
      if(list.children[index]!==row)list.insertBefore(row,list.children[index]||null);
    }
    for(const row of [...list.children])if(!keep.has(row.dataset.operationItem))row.remove();
    if(!shown.length){const empty=document.createElement('li');empty.className='operation-empty';empty.textContent='Nenhum item neste filtro.';list.append(empty);}
    list.scrollTop=scroll;
    if(focused&&!focused.isConnected)$('operation-filter').focus();
    operationText($('operations-page'),total?`${operationPage*12+1}–${Math.min(total,(operationPage+1)*12)} de ${total} itens`:'0 itens');
    $('operations-previous').disabled=operationPage===0;$('operations-next').disabled=operationPage>=pages-1;
  }
  try{$('execution-panel').open=sessionStorage.getItem('hl_constructor_execution_open')==='true';}catch{}
  $('execution-panel').addEventListener('toggle',()=>{try{sessionStorage.setItem('hl_constructor_execution_open',String($('execution-panel').open));}catch{}if($('execution-panel').open)queueUi('operations');},{signal:ac.signal});
  $('operations-details').addEventListener('toggle',()=>{if($('operations-details').open)queueUi('operations');},{signal:ac.signal});
  $('operation-job').onchange=()=>{operationJobId=$('operation-job').value;operationPage=0;operations();};
  $('operation-filter').onchange=()=>{operationPage=0;operations();};
  $('operations-previous').onclick=()=>{if(operationPage>0){operationPage--;operations();$('operation-items').scrollTop=0;}};
  $('operations-next').onclick=()=>{operationPage++;operations();$('operation-items').scrollTop=0;};
  $('operations-retry').onclick=()=>attempt(async()=>{
    const job=selectedOperation(operationOverview());if(!canRetryOperation(job))return;
    const latest=operationOverview()?.jobs.find(item=>item.id===job.id);
    if(!canRetryOperation(latest))return;
    const options=latest.kind==='buy'?{delay:1100}:buildOptions();
    operationAction=true;operations();
    try{await runUi(()=>runtime.retryOperation(latest.id,options));}
    finally{operationAction=false;if(!disposed){operations();configuration();updateButtons();}}
  });
  function ignoreOperation(jobId,itemId){return attempt(async()=>{
    if(operationAction||runtime.busy||typeof runtime.ignoreOperationItem!=='function')return;
    const item=runtime.operationStatus?.().jobs.find(job=>job.id===jobId)?.items.find(candidate=>candidate.id===itemId);
    if(!item||!['pending','failed'].includes(item.status))return;
    operationAction=true;operations();
    try{await runUi(()=>runtime.ignoreOperationItem(jobId,itemId));}
    finally{operationAction=false;if(!disposed)operations();}
  });}

  function configuration(snapshot=runtime.configurationStatus?.()){
    if(!snapshot)return;
    const pending=snapshot.pending||[],report=snapshot.report||{};configurationPendingCount=pending.length;
    const count=key=>Math.max(0,Number(report[key])||0);
    $('configuration').dataset.state=pending.length||count('unconfirmed')?'warning':'ready';
    $('configuration').hidden=!pending.length&&!['placed','configured','statePending','colorPending','rotationPending','unconfirmed','wallSent'].some(key=>count(key)>0);
    const quantity=(key,singular,plural)=>`${count(key)} ${count(key)===1?singular:plural}`;
    $('configuration-summary').textContent=[quantity('placed','colocado','colocados'),quantity('configured','configurado','configurados'),quantity('statePending','estado pendente','estados pendentes'),...(count('rotationPending')?[quantity('rotationPending','rotação pendente','rotações pendentes')]:[]),quantity('colorPending','cor pendente','cores pendentes'),quantity('unconfirmed','colocação incerta','colocações incertas'),...(count('wallSent')?[quantity('wallSent','envio para parede','envios para parede')]:[])].join(' · ');
    $('configuration-pending-count').textContent=pending.length?`Pendências de ${pending.length} ${pending.length===1?'móvel':'móveis'}`:'Nenhuma configuração pendente';
    $('configuration-retry').hidden=!pending.length||!supports('configuration');
    $('configuration-retry').disabled=runtime.busy||!supports('configuration')||!snapshot.canRetry;
    $('configuration-help').textContent=pending.length
      ?!supports('configuration')?'Confira os estados pendentes diretamente no quarto. A repetição de ajustes ainda não está disponível neste hotel.'
        :runtime.busy?'Aguarde a tarefa atual para repetir apenas os ajustes pendentes; nenhum móvel será colocado novamente.'
        :snapshot.canRetry?'A nova tentativa ajusta apenas os móveis já confirmados; não coloca móveis novamente.'
          :'Para tentar novamente, permaneça na mesma sala e conexão em que os móveis foram colocados.'
      :count('unconfirmed')?'Confira as colocações incertas no quarto; elas não são reenviadas pela tentativa de configuração.':'As configurações dos móveis confirmados estão em dia.';
    const list=$('configuration-pending'),scroll=list.scrollTop,fragment=document.createDocumentFragment();
    for(const item of pending.slice(0,30)){
      const row=document.createElement('li'),title=document.createElement('strong'),detail=document.createElement('span');
      title.textContent=`${name(item.spriteId)} · ID ${item.roomId} · (${item.x??'—'}, ${item.y??'—'})`;
      const flags=[];
      if(item.statePending)flags.push(`Estado pendente: ${item.currentState??'desconhecido'} → ${item.expectedState??'desconhecido'}`);
      if(item.colorsPending)flags.push('Cores pendentes');
      if(item.rotationPending)flags.push(`Rotação pendente: ${item.currentRotation??'desconhecida'} → ${item.expectedRotation}`);
      detail.textContent=flags.join(' · ')+(item.reason?` — ${item.reason}`:'. Aguarda confirmação do jogo.');
      row.append(title,detail);fragment.append(row);
    }
    list.replaceChildren(fragment);list.scrollTop=scroll;
    $('configuration-pending-limit').textContent=pending.length>30?`Mostrando 30 de ${pending.length} móveis com pendências.`:'';
    $('configuration-pending-limit').hidden=pending.length<=30;
  }

  function projectInventory(){return runtime.inventory.filter(item=>item.type!=='i');}

  function renderConversionReport(project){
    const conversion=projectBucket()==='converted'?project?.conversion:null;
    $('conversion-report').hidden=!conversion;
    $('conversion-pending').replaceChildren();$('conversion-warnings').replaceChildren();
    if(!conversion)return;
    const pending=Array.isArray(conversion.pending)?conversion.pending:[],warnings=Array.isArray(conversion.warnings)?conversion.warnings:[];
    const count=pending.reduce((total,item)=>total+Math.max(0,Number(item.count)||0),0);
    $('conversion-direction').textContent=`${hotelName(conversion.sourceHotel||project.originHotel)} → ${hotelName(conversion.targetHotel||ctx.hotel?.id)}`;
    const compatible=Math.max(0,Number(conversion.compatible)||0),total=Math.max(0,Number(conversion.total)||0);
    $('conversion-summary').textContent=`${compatible} de ${total} compatíveis${count?` · ${count} pendentes`:''}${warnings.length?` · ${warnings.length} avisos`:''}`;
    const reasons={missing:'sem equivalente neste hotel',ambiguous:'mais de um equivalente possível',unknown:'móvel de origem não identificado'};
    for(const item of pending.slice(0,100)){
      const row=document.createElement('li');row.textContent=`${Math.max(0,Number(item.count)||0)} × ${item.classname||`Móvel ${item.spriteId}`} — ${reasons[item.reason]||'equivalência pendente'}`;$('conversion-pending').append(row);
    }
    for(const item of warnings.slice(0,100)){
      const row=document.createElement('li');row.textContent=`${item.classname||'Móvel convertido'} — dimensões diferentes; confira a ocupação no quarto.`;$('conversion-warnings').append(row);
    }
    for(const [items,id] of [[pending,'conversion-pending'],[warnings,'conversion-warnings']])if(items.length>100){const row=document.createElement('li');row.textContent=`Mais ${items.length-100} registros neste relatório.`;$(id).append(row);}
    if(!count&&!warnings.length){const row=document.createElement('li');row.textContent='Todos os móveis foram reconhecidos para este hotel.';$('conversion-pending').append(row);}
  }

  function projectTimestamp(project){
    const value=project?.createdAt;if(value==null||value==='')return null;
    const timestamp=typeof value==='number'?value:typeof value==='string'?(Number.isFinite(Number(value))?Number(value):Date.parse(value)):NaN;
    return Number.isFinite(timestamp)&&!Number.isNaN(new Date(timestamp).getTime())?timestamp:null;
  }
  function projectDate(project){
    const timestamp=projectTimestamp(project);if(timestamp===null)return 'Data indisponível';
    const date=new Date(timestamp),pad=value=>String(value).padStart(2,'0');
    return `${pad(date.getDate())}/${pad(date.getMonth()+1)} · ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  function renderOriginSummary(){
    try{
      if(!$('project-x').value.trim()||!$('project-y').value.trim())throw Error();
      const x=C.int($('project-x').value,-10000,10000),y=C.int($('project-y').value,-10000,10000);
      $('origin-summary').textContent=`Posição inicial · X ${x} · Y ${y}`;return true;
    }catch{$('origin-summary').textContent='Posição inicial · confira X e Y';return false;}
  }
  for(const id of ['project-x','project-y'])$(id).addEventListener('input',()=>{renderOriginSummary();updateButtons();},{signal:ac.signal});

  function renderProjects(){
    try{
      closeProjectMenu();
      const local=currentProjectHotel();
      for(const button of root.querySelectorAll('[data-hotel]'))button.setAttribute('aria-pressed',String(button.dataset.hotel===state.projectHotel));
      $('bench-details').hidden=!local;
      projectsView.classList.toggle('foreign-hotel',!local);
      if(!local){
        $('projects').replaceChildren();
        const empty=document.createElement('div');empty.className='empty';empty.textContent='Sem projetos disponíveis nesta página.';$('projects').append(empty);
        const option=document.createElement('option');option.value='';option.textContent='Abra este hotel para acessar';$('project-select').replaceChildren(option);
        renderProjectDetail();return;
      }
      state.projects=projectCollection();
      const names=Object.keys(state.projects).map((key,index)=>({key,index,time:projectTimestamp(state.projects[key])})).sort((a,b)=>a.time===null?(b.time===null?a.index-b.index:1):b.time===null?-1:a.time-b.time||a.index-b.index).map(item=>item.key),term=$('project-search').value.trim().toLocaleLowerCase('pt-BR');
      if(!names.includes(state.selected))state.selected=names[0]??null;
      state.projectSelections[state.projectHotel]=state.selected;
      const list=$('projects'),scroll=list.scrollTop;list.replaceChildren();
      $('project-select').replaceChildren();
      for(const key of names){
        const option=document.createElement('option');option.value=key;option.textContent=key+' · '+projectDate(state.projects[key]);$('project-select').append(option);
        if(term&&!key.toLocaleLowerCase('pt-BR').includes(term))continue;
        const b=document.createElement('button');b.className='project'+(key===state.selected?' active':'');
        b.setAttribute('aria-pressed',String(key===state.selected));b.dataset.name=key;
        const title=document.createElement('b');title.textContent=key;
        const count=document.createElement('span');count.textContent=state.projects[key].layout.length+' móveis';
        const date=document.createElement('time');date.className='project-date';date.textContent=projectDate(state.projects[key]);const timestamp=projectTimestamp(state.projects[key]);if(timestamp!==null)date.dateTime=new Date(timestamp).toISOString();
        b.append(title,count,date);b.onclick=()=>selectProject(key);
        const entry=document.createElement('div');entry.className='project-entry';entry.append(b);
        if(currentProjectHotel()){
          const options=document.createElement('button');options.className='icon project-menu-trigger';options.type='button';options.innerHTML=ctx.libs?.icon?.('more-horizontal')||'⋯';
          options.setAttribute('aria-label',`Opções do projeto ${key}`);options.setAttribute('aria-haspopup','menu');options.setAttribute('aria-expanded','false');
          options.onclick=()=>{selectProject(key);openProjectMenu(options,'project');};entry.append(options);
        }
        list.append(entry);
      }
      if(!list.children.length){const empty=document.createElement('div');empty.className='empty';empty.textContent=names.length?'Nenhum projeto nesta busca.':state.projectHotel==='converted'?'Nenhum projeto convertido recebido.':supports('capture')?'Copie um quarto para criar seu primeiro projeto.':'Nenhum projeto salvo neste hotel.';list.append(empty);}
      if(!names.length){const option=document.createElement('option');option.textContent='Nenhum projeto salvo';option.value='';$('project-select').append(option);}
      $('project-select').value=state.selected||'';list.scrollTop=scroll;renderProjectDetail();
    }catch(e){log(e.message,'error');notice('Não foi possível carregar os projetos.','error',false);}
  }

  function selectProject(key){
    if(!currentProjectHotel()||!key||!state.projects[key])return;
    const changed=state.selected!==key;state.selected=key;state.projectSelections[state.projectHotel]=key;$('project-select').value=key;
    for(const b of $('projects').querySelectorAll('.project')){const active=b.dataset.name===key;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));}
    renderProjectDetail();if(changed)motion($('project-title'));
  }

  function renderSelection(){
    const target=$('preview-selection'),choices=$('selection-candidates');target.replaceChildren();choices.replaceChildren();
    const selected=currentProjectHotel()?previewSelection:null;
    if(!selected){target.textContent='Clique em um móvel para conferir sua posição.';return;}
    const item=selected.item,title=document.createElement('strong');title.textContent=`${selected.index+1}. ${name(item.spriteId)}`;
    const status=document.createElement('p');status.className='hint';status.textContent=selected.availability==='available'?'Unidade disponível para esta posição':selected.availability==='missing'?'Falta uma unidade para esta posição':'Atualize o inventário para conferir';
    const values=document.createElement('div');values.className='selection-values';
    for(const [label,value] of [['X',item.relX],['Y',item.relY],['Altura',item.z],['Giro',Number(item.rot)*45+'°']]){const span=document.createElement('span');span.textContent=`${label}: ${value??'—'}`;values.append(span);}
    target.append(title,status,values);
    if(selected.candidates?.length>1){const label=document.createElement('p');label.className='hint';label.textContent='Móveis sobrepostos neste ponto:';choices.append(label);for(const candidate of selected.candidates){const button=document.createElement('button');button.className='button small quiet';button.textContent=`${candidate.index+1}. ${name(candidate.item.spriteId)}`;button.setAttribute('aria-pressed',String(candidate.index===selected.index));button.onclick=()=>preview?.select(candidate.index);choices.append(button);}}
  }

  function renderProjectDetail(){
    const local=currentProjectHotel(),project=local?state.projects[state.selected]:null;$('project-detail').hidden=!project;
    $('project-title').textContent=local?(project?state.selected:state.projectHotel==='converted'?'Projetos em Convert':supports('capture')?'Sua próxima construção':`Seus projetos do ${projectHotelName()}`):`Projetos do ${projectHotelName()}`;
    $('project-empty').firstElementChild.textContent=state.projectHotel==='converted'?'Receba seus projetos de outro hotel':local&&supports('capture')?'Um quarto, novas possibilidades':`Seus projetos do ${projectHotelName()}`;
    $('project-empty').lastElementChild.textContent=!local?`Abra o Constructor no ${projectHotelName()} para acessar os projetos deste hotel. Os dados são locais a cada hotel.`:project&&!preview?'A prévia está indisponível. Você ainda pode conferir o inventário e os projetos.':state.projectHotel==='converted'?(linkStatus.linked?'Envie um projeto pelo menu no outro hotel e clique em Atualizar projetos.':'Vincule os hotéis pelo menu de projetos para receber uma versão convertida.'):preview?(supports('capture')?'Copie um quarto ou escolha um projeto salvo para visualizar sua próxima construção.':'Importe um projeto deste hotel para visualizar.'):'A prévia está indisponível. Você ainda pode conferir o inventário e os projetos.';
    for(const id of ['preview-fit','preview-zoom-in','preview-zoom-out'])$(id).disabled=!project?.layout.length||!preview;
    $('project-meta').textContent=project?`${state.projectHotel==='converted'?`${hotelName(project.conversion?.sourceHotel||project.originHotel)} → ${hotelName(project.conversion?.targetHotel||ctx.hotel?.id)}`:projectHotelName()} · ${project.layout.length} móveis · ${new Set(project.layout.map(item=>item.spriteId)).size} tipos · ${projectDate(project)}`:'';
    $('project-empty').hidden=!!project&&!!preview;
    if(project&&!project.layout.length){$('project-empty').hidden=false;$('project-empty').firstElementChild.textContent='Nenhum móvel compatível';$('project-empty').lastElementChild.textContent='Confira o relatório de conversão. Este projeto não tem posições disponíveis para comprar ou montar.';}
    renderConversionReport(project);
    const key=project?projectBucket()+'|'+state.selected+'|'+JSON.stringify(project):null;
    if(key!==previewKey){previewKey=key;previewSelection=null;highlightedType=null;preview?.setProject(project||null,state.selected||'');renderSelection();}
    preview?.setInventory(local?runtime.inventory:[],local&&runtime.inventoryFresh);
    $('needs').replaceChildren();
    $('bench-inventory-status').textContent=state.loading?'Atualizando inventário…':runtime.inventoryFresh?'Inventário conferido nesta conexão.':'Não conferido · atualize o inventário.';
    if(!project){$('inspector-inventory-summary').textContent='Resumo do inventário';for(const id of ['required-total','available-total','missing-total'])$(id).textContent='—';updateButtons();return;}
    const required=new Map(),available=new Map();
    for(const item of project.layout)required.set(Number(item.spriteId),(required.get(Number(item.spriteId))||0)+1);
    for(const item of projectInventory())available.set(Number(item.spriteId),(available.get(Number(item.spriteId))||0)+1);
    const missing=C.missingItems(project.layout,projectInventory()),totalMissing=missing.reduce((n,item)=>n+item.count,0),excluded=new Set(purchasePlan(project).excluded.map(i=>i.spriteId));
    $('required-total').textContent=String(project.layout.length);
    $('available-total').textContent=runtime.inventoryFresh?String(project.layout.length-totalMissing):'—';
    $('missing-total').textContent=runtime.inventoryFresh?String(totalMissing):'—';
    $('inspector-inventory-summary').textContent=runtime.inventoryFresh?`Inventário · ${project.layout.length-totalMissing} disponíveis · ${totalMissing} faltantes`:'Inventário · atualizar para conferir';
    const banner=document.createElement('p');banner.className='step-banner';
    banner.textContent=!project.layout.length?'Sem móveis compatíveis para comprar ou montar.':!runtime.inventoryFresh?'Conferir: atualize o inventário para comparar as unidades.':totalMissing?`${totalMissing===1?'Falta 1 unidade':`Faltam ${totalMissing} unidades`}. Você pode montar os móveis disponíveis e retomar as pendências depois.`:'Tudo disponível. Confira a origem e reconstrua quando estiver pronto.';
    if(runtime.inventoryFresh&&excluded.size)banner.textContent+=' Limitados não são comprados automaticamente e permanecerão nas pendências.';
    $('needs').append(banner);
    $('missing-summary').textContent=runtime.inventoryFresh?(totalMissing?`Ver móveis faltantes (${totalMissing})`:'Nenhum móvel faltante'):'Conferir móveis faltantes';
    for(const [sid,count] of required){
      const have=available.get(sid)||0,short=Math.max(0,count-have);
      if(!runtime.inventoryFresh||!short)continue;
      const row=document.createElement('button');row.className='need-type';row.setAttribute('aria-pressed',String(highlightedType===sid));
      const description=document.createElement('span');description.textContent=name(sid);const detail=document.createElement('small');detail.textContent=runtime.inventoryFresh?`${count} ${count===1?'necessário':'necessários'} · ${have} no inventário`:`${count} ${count===1?'necessário':'necessários'}`;description.append(detail);
      if(excluded.has(sid))detail.textContent+=' · LTD: compra pendente';
      const indicator=document.createElement('span');indicator.className='missing';indicator.dataset.missing=String(runtime.inventoryFresh&&short>0);indicator.textContent=runtime.inventoryFresh?(short?`${short===1?'Falta':'Faltam'} ${short}`:'OK'):'—';row.append(description,indicator);
      row.onclick=()=>{highlightedType=highlightedType===sid?null:sid;preview?.highlightType(highlightedType);for(const other of $('needs').querySelectorAll('.need-type'))other.setAttribute('aria-pressed',String(other===row&&highlightedType!==null));};$('needs').append(row);
    }
    if(previewSelection){const index=previewSelection.index;const states=ctx.previewAvailability?.(project.layout,runtime.inventory,runtime.inventoryFresh);if(states)previewSelection={...previewSelection,availability:states[index]};renderSelection();}
    updateButtons();syncPreviewVisibility();
  }

  function progress(p){
    p={...p,paused:runtime.paused};
    const confirmed=operationCount(p.done),total=operationCount(p.total),pending=operationCount(p.pending),failed=operationCount(p.failed);
    executionError=p.phase==='error'?(p.error||'A tarefa foi interrompida. Confira as pendências.'):p.phase==='running'?'':executionError;
    const configurationTask=/^Construir(?: · Flash)?$/.test(p.label||'')||p.label==='Tentar configurações pendentes';
    const hasPending=pending>0||failed>0||configurationTask&&configurationPendingCount>0;
    const completed=hasPending?'Tarefa encerrada com pendências':'Tarefa concluída';
    $('task').hidden=!runtime.busy||state.copyWaiting;
    $('task').className='task'+(p.phase==='idle'?' idle':'');
    $('task-label').textContent=p.paused?'Tarefa pausada':p.phase==='done'?completed:p.phase==='stopped'?'Tarefa cancelada':p.phase==='error'?'Tarefa interrompida':p.label||'Pronta para construir';
    $('task-count').textContent=total?`${confirmed} / ${total} confirmados${pending?` · ${pending} pendentes`:''}${failed?` · ${failed} falharam`:''}`:'';
    $('task-fill').style.width=total?Math.min(100,confirmed/total*100)+'%':'0%';
    $('task-track').setAttribute('aria-valuemax',String(total||100));$('task-track').setAttribute('aria-valuenow',String(Math.min(total||100,confirmed)));$('task-track').setAttribute('aria-valuetext',`${confirmed} confirmados, ${pending} pendentes, ${failed} falharam`);
    $('task-note').textContent=p.phase==='error'?p.error:p.uncertain?'Envios sem confirmação aguardam conciliação; não serão reenviados.':pending||failed?'Confira os motivos em Compras e montagens.':p.wallSent?`${p.confirmed||0} confirmados · ${p.wallSent} envios para parede`:p.sent&&!confirmed?'Pedidos enviados; aguardando confirmação':p.phase==='done'?'Confira o resultado no quarto.':'Cancelar não desfaz comandos já enviados.';
    const running=runtime.busy&&p.phase==='running';
    $('pause').hidden=!running;$('cancel').hidden=!running;$('pause').textContent=p.paused?'Continuar':'Pausar';
    $('launcher-label').textContent=running?(state.copyWaiting?'Constructor · aguardando reentrada':p.paused?'Constructor · pausada':`Constructor · ${confirmed}/${total||'…'}`):'Constructor';
    queueUi('buttons');queueUi('operations');renderExecutionSummary();
  }

  subscribe('connection',()=>{stopPlacementVoice();queueUi('connection');});
  subscribe('inventory',()=>queueUi('inventory'));
  subscribe('projects',()=>queueUi('projects'));
  subscribe('project-link',status=>applyProjectLinkStatus(status));
  subscribe('progress',progress);
  subscribe('idle',p=>{progress(p);queueUi('inventory');queueUi('operations');});
  subscribe('operations',snapshot=>queueUi('operations',snapshot));
  subscribe('placement-confirmed',placementSound);
  subscribe('ready',()=>queueUi('operations'));
  subscribe('notice',n=>notice(n.text,n.type));
  subscribe('diagnostic',m=>log(m,'warning'));
  subscribe('configuration',snapshot=>queueUi('configuration',snapshot));

  $('refresh').onclick=()=>attempt(async()=>{
    if(runtime.busy)return;
    state.loading=true;updateButtons();
    try{
      await Promise.all([runtime.refreshInventory(),loadNames()]);
      notice(`${runtime.inventory.length} móveis disponíveis.`,'success');
    }
    finally{state.loading=false;if(!disposed)renderProjectDetail();}
  });

  $('search').oninput=()=>{clearTimeout(state.searchTimer);state.searchTimer=setTimeout(()=>state.groups.forEach(g=>optionsForSelect(g.querySelector('.item-select'))),150);};
  $('add-group').onclick=addGroup;
  for(const id of ['start-x','start-y','height','height-mode','rotation','wall-wx','wall-wy','wall-lx','wall-ly','wall-dir'])
    $(id).addEventListener('input',scheduleCompute);

  function buildOptions(){
    if(pref.flash){const delay=C.int($('flash-delay').value,25,2000);pref.flashDelay=delay;savePref();return {flash:true,delay,strictConfiguration:pref.strictConfiguration};}
    return {delay:pref.delay,strictConfiguration:pref.strictConfiguration};
  }

  const runUi=async fn=>{
    try{return await fn();}
    catch(e){if(!e.__oficinaShown)notice(e.message,'error');return undefined;}
  };

  $('build').onclick=()=>attempt(async()=>{
    if(!supports('build'))throw Error('A construção ainda não está disponível neste hotel.');
    compute();
    if(!state.plan)throw Error($('build-note').textContent);
    const snapshot=state.plan.map(i=>({...i}));
    await runUi(()=>runtime.execute(snapshot,buildOptions()));
    compute();
  });

  $('pause').onclick=()=>runtime.paused?runtime.resume():runtime.pause();
  $('cancel').onclick=()=>runtime.cancel();
  $('configuration-retry').onclick=()=>attempt(async()=>{
    if(!supports('configuration'))throw Error('Os ajustes de estado e cor ainda não estão disponíveis neste hotel.');
    if(runtime.busy||!runtime.configurationStatus?.().canRetry)return;
    state.configurationRetry=true;
    try{await runUi(()=>runtime.retryPending(buildOptions()));}
    finally{state.configurationRetry=false;if(!disposed){configuration();updateButtons();}}
  });

  $('capture').onclick=()=>attempt(async()=>{
    requireOriginalProjectHotel();
    if(!supports('capture'))throw Error('A cópia de quartos ainda não está disponível neste hotel.');
    if(runtime.busy||state.copyWaiting)return;
    const n=$('capture-name').value.trim();
    if(!n)throw Error('Dê um nome ao projeto.');
    if(Object.hasOwn(runtime.projects(),n))throw Error('Esse nome já existe. Escolha outro.');
    state.copyWaiting=true;
    try{
      ctx.ui.hide();
      await runtime.capture(n);
      if(disposed)return;
      $('capture-form-slot').hidden=true;captureSection.hidden=true;renderProjects();selectProject(n);switchTab('projects');
      ctx.ui.show();
    }catch(error){
      if(!disposed)ctx.ui.show();
      throw error;
    }finally{
      state.copyWaiting=false;
      if(!disposed)progress(runtime.progress);
    }
  });

  $('mount').onclick=()=>attempt(async()=>{
    requireProjectHotel();
    if(!supports('build'))throw Error('A montagem ainda não está disponível neste hotel.');
    if(runtime.busy||state.loading)return;
    const key=state.selected,bucket=projectBucket(),p=projectCollection()[key];
    if(!p)throw Error('Escolha um projeto.');
    if(!p.layout.length)throw Error('Este projeto não tem móveis compatíveis para esta ação.');
    if(!runtime.inventoryFresh)throw Error('Atualize o inventário antes de reconstruir.');
    const signature=JSON.stringify(p),snapshot=JSON.parse(signature);
    const origin={x:C.int($('project-x').value,-10000,10000),y:C.int($('project-y').value,-10000,10000)},options=buildOptions();
    const missingCount=C.missingItems(snapshot.layout,projectInventory()).reduce((sum,item)=>sum+item.count,0);
    const conversionPending=(snapshot.conversion?.pending||[]).reduce((sum,item)=>sum+item.count,0);
    if(!await confirmAction('Montar este projeto?',`Projeto: ${key}\nQuantidade: ${snapshot.layout.length} móveis de chão${missingCount?`\nFaltam ${missingCount} unidades no inventário. Elas ficarão pendentes; os móveis disponíveis serão montados.`:''}${conversionPending?`\nPendências de conversão: ${conversionPending} móveis não serão colocados; os espaços ficarão vazios.`:''}\nOrigem: X ${origin.x} · Y ${origin.y}\n\nConfira o quarto de destino. Os comandos confirmados não são desfeitos ao cancelar.`,'Montar projeto'))return;
    if(disposed)return;
    requireProjectHotel();
    if(!supports('build'))throw Error('A montagem ainda não está disponível neste hotel.');
    if(runtime.busy||state.loading||runtime.status().state!=='OPEN')throw Error('A conexão ou tarefa mudou. Confira novamente antes de reconstruir.');
    if(bucket!==projectBucket()||key!==state.selected||JSON.stringify(projectCollection()[key])!==signature||origin.x!==C.int($('project-x').value,-10000,10000)||origin.y!==C.int($('project-y').value,-10000,10000))throw Error('O projeto ou a origem mudou. Confira a prévia e confirme novamente.');
    if(!runtime.inventoryFresh)throw Error('O inventário está desatualizado. Atualize e confira novamente.');
    const plan=C.planProject(snapshot,origin,projectInventory());
    await runUi(()=>runtime.execute(plan,{...options,projectId:p.id,label:key}));
  });

  function purchasePlan(project){return C.purchaseItems(project.layout,projectInventory(),runtime.catalog(),runtime.limitedSprites);}
  $('buy').onclick=()=>attempt(async()=>{
    requireProjectHotel();
    if(!supports('buy'))throw Error('A compra ainda não está disponível neste hotel.');
    const bucket=projectBucket(),key=state.selected,p=state.projects[key];
    if(!p)throw Error('Escolha um projeto.');
    if(!p.layout.length)throw Error('Este projeto não tem móveis compatíveis para esta ação.');
    if(!runtime.inventoryFresh||runtime.busy)throw Error('Atualize o inventário e aguarde a tarefa atual.');
    const missing=C.missingItems(p.layout,projectInventory());
    if(!missing.length)return;
    const page=$('catalog-page').value===''?undefined:C.int($('catalog-page').value,0);
    const text=missing.slice(0,30).map(item=>`${item.count} × ${name(item.spriteId)}`).join('\n')+(missing.length>30?`\nMais ${missing.length-30} tipos de móveis.`:'');
    if(!await confirmAction('Comprar os móveis que faltam?',text+'\n\nO jogo define os preços e a compra usa seu saldo. Limitados, itens sem oferta e compras sem confirmação ficam pendentes; a operação não monta o projeto.','Comprar móveis'))return;
    if(disposed)return;
    requireProjectHotel();
    if(!supports('buy'))throw Error('A compra ainda não está disponível neste hotel.');
    if(runtime.busy||!runtime.inventoryFresh||runtime.status().state!=='OPEN'||bucket!==projectBucket()||key!==state.selected||JSON.stringify(projectCollection()[key])!==JSON.stringify(p)||JSON.stringify(C.missingItems(p.layout,projectInventory()))!==JSON.stringify(missing))throw Error('O projeto ou inventário mudou. Confira novamente antes da compra.');
    await runUi(()=>runtime.buy(missing,runtime.catalog(),{pageId:page,delay:1100,projectId:p.id,label:key}));
  });

  $('delete-project').onclick=()=>attempt(async()=>{
    requireProjectHotel();
    const n=state.selected,bucket=projectBucket(),signature=JSON.stringify(state.projects[n]);
    if(n&&await confirmAction('Excluir projeto?',`O projeto “${n}” será removido deste navegador. Os móveis no quarto não serão alterados.`,'Excluir projeto')){
      if(disposed)return;
      requireProjectHotel();
      if(bucket!==projectBucket()||n!==state.selected||JSON.stringify(projectCollection()[n])!==signature)throw Error('O projeto selecionado mudou. Confira novamente antes de excluir.');
      await runtime.deleteProject(n,bucket);
    }
  });

  async function readFile(file){
    const text=await file.text();
    if(disposed)throw Error('Constructor encerrado.');
    return text;
  }

  function download(filename,text){
    const url=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'})),a=document.createElement('a');
    urls.add(url);
    a.href=url;a.download=filename;
    document.body.append(a);a.click();a.remove();
    setTimeout(()=>{URL.revokeObjectURL(url);urls.delete(url);},1000);
  }

  $('export').onclick=()=>attempt(()=>{
    requireProjectHotel();
    download('oficina-projetos.json',JSON.stringify(projectCollection(),null,2));
    notice('Cópia dos projetos preparada.','success');
  });

  $('import-projects').onclick=()=>attempt(()=>{requireOriginalProjectHotel();$('project-file').click();});
  $('project-file').onchange=()=>attempt(async()=>{
    requireOriginalProjectHotel();
    const file=$('project-file').files[0];
    $('project-file').value='';
    if(!file)return;
    if(file.size>4*1024*1024)throw Error('Use um arquivo menor que 4 MB.');
    const raw=await readFile(file);
    requireOriginalProjectHotel();
    const imported=C.normalizeProjects(JSON.parse(raw)),existing=runtime.projects();
    for(const n of Object.keys(imported))if(Object.hasOwn(existing,n))throw Error(`Já existe um projeto chamado “${n}”. Renomeie-o no arquivo antes de importar.`);
    requireOriginalProjectHotel();
    await runtime.saveProjects({...existing,...imported},'original');
    renderProjects();
    notice(`${Object.keys(imported).length} projetos importados.`,'success');
  });

  function catalogStatus(info=runtime.catalogCaptureStatus?.()){
    if(!info)return;
    const readiness=info.readiness;
    $('catalog-readiness').textContent=readiness?.message||(info.active?'Abra a loja e uma página de móveis para preparar a captura.':'Ative Capturar catálogo e abra a loja para preparar a captura.');
    $('catalog-readiness').dataset.ready=String(readiness?.ready===true);
    $('capture-catalog-state').textContent=info.active?`Capturando: ${info.pages||0} páginas reconhecidas · ${info.total||0} móveis salvos.`:`${info.total||0} móveis salvos para compras. ${info.pages||0} páginas reconhecidas nesta captura.`;
    $('catalog-state').textContent=`Catálogo com ${info.total||0} móveis.`;
    const report=info.scanReport;
    $('catalog-scan-report').textContent=report?Object.entries(report).filter(([,value])=>typeof value==='number').slice(0,8).map(([key,value])=>`${({total:'Páginas',confirmed:'Confirmadas',failed:'Falhas',pending:'Pendentes',skipped:'Ignoradas',done:'Concluídas',attempted:'Consultadas'})[key]||key}: ${value}`).join(' · '):'';
    const diagnostics=$('catalog-diagnostics');diagnostics.replaceChildren();
    const entries=Array.isArray(info.diagnostics)?info.diagnostics:info.diagnostics&&typeof info.diagnostics==='object'?Object.entries(info.diagnostics).map(([key,value])=>`${key}: ${String(value)}`):[];
    for(const entry of entries.slice(-20)){const row=document.createElement('li');row.textContent=typeof entry==='string'?entry:entry.message||entry.reason||entry.code||'Diagnóstico sem descrição';diagnostics.append(row);}
    if(entries.length>20){const row=document.createElement('li');row.textContent='Exibindo os 20 diagnósticos mais recentes.';diagnostics.append(row);}
    updateButtons();
  }

  subscribe('catalog',info=>queueUi('catalog',info));
  subscribe('catalog-ready',info=>queueUi('catalog',info));

  $('auto-catalog').onclick=()=>attempt(async()=>{
    if(typeof runtime.scanCatalog!=='function')throw Error('Use a conexão real com o jogo.');
    const info=runtime.catalogCaptureStatus?.();catalogStatus(info);
    if(info?.readiness?.ready===false){notice(info.readiness.message||'Abra a loja e uma página de móveis após ativar a captura para continuar.','warning',false);$('catalog-readiness').focus();return;}
    await runUi(()=>runtime.scanCatalog());
  });

  $('capture-catalog').onclick=()=>attempt(()=>{
    if(typeof runtime.startCatalogCapture!=='function')throw Error('A captura precisa da conexão real com o jogo.');
    if(runtime.catalogCapture.active)runtime.stopCatalogCapture();else runtime.startCatalogCapture();
  });

  $('export-catalog').onclick=()=>attempt(()=>{
    download('oficina-catalogo.json',JSON.stringify(runtime.catalog(),null,2));
    notice('Cópia do catálogo preparada.','success');
  });

  $('import-catalog').onclick=()=>$('catalog-file').click();
  $('catalog-file').onchange=()=>attempt(async()=>{
    const file=$('catalog-file').files[0];
    $('catalog-file').value='';
    if(!file)return;
    if(file.size>4*1024*1024)throw Error('Use um catálogo menor que 4 MB.');
    const valid=await runtime.saveCatalog(JSON.parse(await readFile(file)));
    $('catalog-state').textContent=`Catálogo com ${Object.keys(valid).length} móveis.`;
    notice('Catálogo de compras atualizado.','success');
  });

  $('custom-save').onclick=()=>attempt(async()=>{
    const n=$('custom-name').value.trim();
    if(!n)throw Error('Dê um nome à forma.');
    const params=JSON.parse($('custom-params').value),body=$('custom-code').value,key='cs_'+n.toLowerCase().replace(/\W+/g,'_'),s={key,name:n,icon:'◇',params,body};
    const fn=compileCustom(s);
    C.validatePositions(fn({x:0,y:0,...Object.fromEntries(params.map(p=>[p.id,p.def]))}));
    if(state.custom.some(i=>i.key===key)&&!await confirmAction('Atualizar forma?',`A forma “${n}” será substituída.`,'Atualizar forma'))return;
    state.custom=state.custom.filter(i=>i.key!==key);
    state.custom.push(s);
    localStorage.setItem('mp_cs',JSON.stringify(state.custom));
    state.shape=key;
    buildShapes();renderParameters();compute();
    notice('Forma salva.','success');
  });

  $('custom-delete').onclick=()=>attempt(async()=>{
    const s=customDefinition();
    if(s&&await confirmAction('Excluir forma?',`Remover a forma “${s.name}”?`,'Excluir forma')){
      state.custom=state.custom.filter(i=>i.key!==s.key);
      localStorage.setItem('mp_cs',JSON.stringify(state.custom));
      state.shape='lineX';
      buildShapes();renderParameters();compute();
    }
  });

  $('sound').checked=pref.sound;$('placement-sound').checked=pref.placementSound;
  $('strict-configuration').checked=pref.strictConfiguration;
  $('volume').value=String(pref.volume*100);
  const wideOption=document.createElement('option');wideOption.value='1100';wideOption.textContent='Bancada';$('width').append(wideOption);
  if(![430,540,660,1100,1440].includes(geometry.width)){const customOption=document.createElement('option');customOption.value=String(geometry.width);customOption.textContent='Personalizado';$('width').append(customOption);}
  $('width').value=String(geometry.width);
  $('speed').value=pref.flash?'flash':String([180,450,900].includes(pref.delay)?pref.delay:180);
  $('flash-delay').value=String(pref.flashDelay);
  $('flash-setting').hidden=!pref.flash;
  $('flash-tip').hidden=!pref.flash;

  $('sound').onchange=()=>{pref.sound=$('sound').checked;if(!pref.sound)stopPlacementVoice();savePref();};
  $('placement-sound').onchange=()=>{pref.placementSound=$('placement-sound').checked;if(!pref.placementSound)stopPlacementVoice();savePref();};
  $('strict-configuration').onchange=()=>{pref.strictConfiguration=$('strict-configuration').checked;savePref();};
  $('volume').oninput=()=>{pref.volume=Number($('volume').value)/100;savePref();};
  $('width').onchange=()=>{pref.width=Number($('width').value);geometry.width=pref.width;applyWidth();saveGeometry();savePref();};
  $('speed').onchange=()=>{
    pref.flash=$('speed').value==='flash';
    if(!pref.flash)pref.delay=Number($('speed').value);
    $('flash-setting').hidden=!pref.flash;
    $('flash-tip').hidden=!pref.flash;
    savePref();
  };
  $('flash-delay').onchange=()=>attempt(()=>{const delay=C.int($('flash-delay').value,25,2000);pref.flashDelay=delay;savePref();});
  $('test-sound').onclick=()=>void sound('success',true);
  $('clear-log').onclick=()=>$('log').replaceChildren();

  try{loadCustom();}catch(e){log(e.message,'warning');}
  applyWidth();
  buildShapes();
  renderParameters();
  addGroup();
  renderProjects();
  connection();
  try{$('catalog-state').textContent=`Catálogo com ${Object.keys(runtime.catalog()).length} móveis.`;}
  catch(e){$('catalog-state').textContent=e.message;}

  void loadNames();
  switchTab('projects');progress(runtime.progress||{phase:'idle'});
  configuration();operations();
  $('footer-state').textContent='Constructor '+ctx.version;
  const versionNote=$('view-settings').querySelector('p.subtle:last-child');if(versionNote)versionNote.textContent='Constructor '+ctx.version;
  log(demo?'Demonstração local: nenhuma conexão com o jogo.':'Constructor standalone instalado. Entre no jogo e atualize seus móveis.');
  if(!demo&&!supports('colors'))log('Cores não são aplicadas nesta etapa. Estados divergentes ficam pendentes para conferência no quarto.','info');
  catalogStatus();renderExecutionSummary();renderProjectLink();refreshProjectsOnOpen();
  host.oficina={notice,compute,switchTab,selectProject};
  return host;
};



  ctx.parts.add('ui.js');
})();
