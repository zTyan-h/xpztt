// Constructor — projetos locais com identidade e buckets independentes.
(function () {
  'use strict';
  const ctx = window._constructor;
  if (!ctx?.current()) return;
  const OficinaCore = ctx.Core, KEY='constructor_projects_v2';
  const uuid=()=>crypto.randomUUID();
  const bucketName=bucket=>{if(!['original','converted'].includes(bucket))throw Error('Divisão de projetos inválida.');return bucket;};
  const caches=new WeakMap();
  const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
  function cached(runtime,key,fallback,normalize){
    // A identidade depende do conteúdo confirmado no armazenamento, inclusive de outra aba.
    const raw=runtime.env?.localStorage&&runtime.storageKey?
      runtime.database&&runtime.savedData?.has(key)?runtime.savedData.get(key):runtime.env.localStorage.getItem(runtime.storageKey(key)):
      JSON.stringify(runtime.storage(key,fallback));
    let cache=caches.get(runtime);if(!cache){cache=new Map();caches.set(runtime,cache);}
    const previous=cache.get(key);if(previous&&previous.raw===raw)return previous.value;
    let value=fallback;
    if(raw!==null&&raw!==undefined){try{value=JSON.parse(raw);}catch{throw Error('Dados salvos inválidos. Exporte uma cópia antes de alterar os projetos.');}}
    value=freeze(normalize(value));cache.set(key,{raw,value});return value;
  }
  const cloneBundle=value=>{
    const bundle=JSON.parse(JSON.stringify(value));
    for(const key of ['original','converted','references'])bundle[key]=Object.assign(Object.create(null),bundle[key]);
    return bundle;
  };
  ctx.extendRuntime(class {
  checkProjectLifecycle(){
    if(this.disposed||this.lifetime?.aborted||!ctx.current())throw new DOMException('Constructor encerrado.','AbortError');
  }

  async initProjects(){
    this.checkProjectLifecycle();
    if(this.storage(KEY,null)){this.projectBundle();return;}
    const legacy=OficinaCore.normalizeProjects(this.storage('hl_module_rooms',{})),original=Object.create(null);
    for(const [name,project] of Object.entries(legacy))original[name]={...project,id:uuid(),revision:1,originHotel:this.hotel.id};
    await this.persist('constructor_projects_backup_v1',this.storage('hl_module_rooms',{}));
    this.checkProjectLifecycle();
    await this.persist(KEY,{version:2,original,converted:{},references:{}});
  }

  projectBundle(){
    return cached(this,KEY,null,bundle=>{
    if(!bundle||bundle.version!==2)throw Error('O armazenamento de projetos ainda não está pronto.');
    for(const bucket of ['original','converted']){
      const normalized=OficinaCore.normalizeProjects(bundle[bucket]);
      bundle[bucket]=Object.assign(Object.create(null),bundle[bucket]);
      for(const [name,project] of Object.entries(bundle[bucket])){
        if(typeof project.id!=='string'||!/^[a-zA-Z0-9_-]{8,160}$/.test(project.id)||!Number.isSafeInteger(project.revision)||project.revision<1||project.originHotel!==this.hotel.id)throw Error('Metadados de projeto inválidos. Os dados foram preservados.');
        delete project.createdAt;Object.assign(project,normalized[name]);
        if(bucket==='converted'&&(!project.conversion||project.conversion.targetHotel!==this.hotel.id||!Array.isArray(project.conversion.pending)||!Array.isArray(project.conversion.warnings)))throw Error('Conversão local inválida. Os dados foram preservados.');
      }
    }
    if(!bundle.references||typeof bundle.references!=='object'||Array.isArray(bundle.references))throw Error('Referências de projetos inválidas.');
    bundle.references=Object.assign(Object.create(null),bundle.references);
    return bundle;
    });
  }

  projects(bucket='original'){return this.projectBundle()[bucketName(bucket)];}
  catalog(){return cached(this,'hl_module_shop_db',{},value=>OficinaCore.normalizeCatalog(value));}

  projectMutation(change){
    const operation=(this.projectWriteQueue||Promise.resolve()).then(async()=>{
      this.checkProjectLifecycle();
      const bundle=cloneBundle(this.projectBundle()),result=change(bundle);
      await this.persist(KEY,bundle);
      this.checkProjectLifecycle();this.emit('projects');return result;
    });
    this.projectWriteQueue=operation.catch(()=>{});return operation;
  }

  saveProjects(value,bucket='original'){
    bucket=bucketName(bucket);
    const valid=OficinaCore.normalizeProjects(value);
    return this.projectMutation(bundle=>{
      const previous=bundle[bucket],next=Object.create(null);
      for(const [name,project] of Object.entries(valid)){
        const old=previous[name],changed=old&&JSON.stringify(old.layout)!==JSON.stringify(project.layout);
        next[name]={...old,...project,id:old?.id||uuid(),revision:(old?.revision||1)+(changed?1:0),originHotel:this.hotel.id};
        if(old){delete next[name].createdAt;if(OficinaCore.validCreatedAt(old.createdAt))next[name].createdAt=old.createdAt;}
        if(changed&&next[name].conversion)next[name].conversion.localModified=true;
        if(bucket==='converted'&&!old)throw Error('Importe projetos na divisão do hotel; Convertidos recebe apenas transferências.');
      }
      bundle[bucket]=next;
      const ids=new Set(Object.values(bundle.converted).map(p=>p.id));
      for(const id of Object.keys(bundle.references))if(!ids.has(id))delete bundle.references[id];
      return next;
    });
  }

  saveProject(name,layout){
    name=String(name).trim();
    if(!name||name.length>120)throw Error('Dê um nome com até 120 caracteres ao projeto.');
    const valid=OficinaCore.normalizeProjects({[name]:{layout,createdAt:Date.now()}});
    return this.projectMutation(bundle=>{
      if(Object.hasOwn(bundle.original,name))throw Error('Esse nome já existe. Use outro nome para preservar o projeto anterior.');
      bundle.original[name]={...valid[name],id:uuid(),revision:1,originHotel:this.hotel.id};
      return bundle.original;
    });
  }

  renameProject(name,nextName,bucket='original',expectedId){
    bucket=bucketName(bucket);nextName=String(nextName).trim();
    if(!nextName||nextName.length>120)throw Error('Dê um nome com até 120 caracteres ao projeto.');
    return this.projectMutation(bundle=>{
      const record=bundle[bucket][name];
      if(!record||expectedId!==undefined&&record.id!==expectedId)throw Error('O projeto mudou. Abra o menu novamente para renomear.');
      if(nextName===name)return nextName;
      if(Object.hasOwn(bundle[bucket],nextName))throw Error('Esse nome já existe. Use outro nome para preservar o projeto anterior.');
      const renamed={...record,revision:record.revision+1};
      if(record.conversion)renamed.conversion={...record.conversion,localModified:true};
      const next=Object.create(null);
      for(const [key,project] of Object.entries(bundle[bucket]))next[key===name?nextName:key]=key===name?renamed:project;
      bundle[bucket]=next;
      return nextName;
    });
  }

  deleteProject(name,bucket='original'){
    bucket=bucketName(bucket);
    return this.projectMutation(bundle=>{
      const record=bundle[bucket][name];if(record)delete bundle.references[record.id];
      delete bundle[bucket][name];return bundle[bucket];
    });
  }

  async capture(name){
    this.requireCapability('capture');
    return this.run('Salvar quarto',async signal=>{
      this.update({label:'Entre novamente no quarto para salvar',total:1});
      const {layout}=await this.wait('room',()=>true,signal,120000).promise;
      if(!layout.length)throw Error('Este quarto não tem móveis de chão para salvar.');
      await this.saveProject(name,layout);
      this.update({done:1});
      this.emit('notice',{type:'success',text:`Projeto “${name}” salvo com ${layout.length} móveis de chão.`});
      return layout;
    });
  }

  }.prototype);

  ctx.parts.add('projects.js');
})();
