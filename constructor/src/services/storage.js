// Constructor — extraído da Oficina 1.5.1.
(function () {
  'use strict';
  const ctx = window._constructor;
  if (!ctx?.current()) return;
  const OficinaCore = ctx.Core;
  ctx.extendRuntime(class {
  storageKey(key){return this.hotel.storagePrefix+key;}

  async initStorage(){
    try{
      if(!this.env.indexedDB)return;
      this.database=await new Promise((resolve,reject)=>{
        const request=this.env.indexedDB.open(this.hotel.database,1);
        request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('data'))request.result.createObjectStore('data');};
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>reject(request.error||Error('Não foi possível abrir o armazenamento.'));
        request.onblocked=()=>this.emit('diagnostic','Feche outras abas antigas do jogo para liberar o armazenamento.');
      });
      if(this.disposed){this.database.close();this.database=null;return;}
      this.database.onversionchange=()=>{
        this.database.close();
        this.database=null;
        this.storageError='O armazenamento mudou em outra aba. Recarregue o jogo.';
        this.emit('notice',{type:'warning',text:this.storageError});
      };
      for(const key of ['hl_module_rooms','hl_module_shop_db','constructor_projects_v2','constructor_projects_backup_v1','constructor_link_v1','constructor_operations_v1']){
        let raw=await this.databaseValue('readonly',store=>store.get(key));
        if(this.disposed)return;
        if(raw===undefined){
          const legacy=this.env.localStorage.getItem(this.storageKey(key));
          if(legacy!==null){
            const parsed=JSON.parse(legacy);
            if(key==='hl_module_rooms')OficinaCore.normalizeProjects(parsed);
            else if(key==='hl_module_shop_db')OficinaCore.normalizeCatalog(parsed);
            await this.databaseValue('readwrite',store=>store.put(legacy,key));
            raw=legacy;
          }
        }
        if(this.disposed)return;
        if(raw!==undefined){
          this.savedData.set(key,raw);
          try{this.env.localStorage.removeItem(this.storageKey(key));}catch{/* A cópia no banco já foi confirmada. */}
        }
      }
    }
    catch(error){
      this.storageError='Não foi possível preparar o armazenamento: '+error.message;
      this.env.console?.error('[Oficina] Armazenamento:',error);
    }
    finally{this.storageSettled=true;}
  }

  databaseValue(mode,operation){
    return new Promise((resolve,reject)=>{
      let transaction,result;
      try{
        transaction=this.database.transaction('data',mode);
        const request=operation(transaction.objectStore('data'));
        request.onsuccess=()=>{result=request.result;};
      }
      catch(error){reject(error);return;}
      transaction.oncomplete=()=>resolve(result);
      transaction.onerror=transaction.onabort=()=>reject(transaction.error||Error('Não foi possível salvar os dados.'));
    });
  }

  persist(key,value){
    if(this.disposed)throw Error('Constructor encerrado.');
    const raw=JSON.stringify(value);
    if(this.env.indexedDB&&!this.storageSettled)return this.ready.then(()=>this.persist(key,value));
    if(this.storageError)throw Error(this.storageError);
    if(this.database)return this.databaseValue('readwrite',store=>store.put(raw,key)).then(()=>{this.savedData.set(key,raw);});
    try{this.env.localStorage.setItem(this.storageKey(key),raw);this.savedData.set(key,raw);}
    catch(error){
      if(error.name==='QuotaExceededError')throw Error('O armazenamento está cheio e o banco de dados não está disponível. Exporte uma cópia dos seus dados.');
      throw error;
    }
  }

  storage(key,fallback){
    const raw=this.database&&this.savedData.has(key)?this.savedData.get(key):this.env.localStorage.getItem(this.storageKey(key));
    if(raw===null||raw===undefined)return fallback;
    try{return JSON.parse(raw);}
    catch{throw Error('Dados salvos inválidos. Exporte uma cópia antes de alterar os projetos.');}
  }

  }.prototype);

  ctx.parts.add('storage.js');
})();
