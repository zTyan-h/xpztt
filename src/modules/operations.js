// Constructor — diário local de compras e montagem, com confirmação antes de concluir.
(function () {
  'use strict';
  const ctx=window._constructor;
  if(!ctx?.current())return;
  const C=ctx.Core,KEY='constructor_operations_v1',MAX_FAILURES=3;
  const id=()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  const terminal=item=>['done','ignored','failed'].includes(item.status);
  const copy=value=>JSON.parse(JSON.stringify(value));
  const report=items=>{
    const out={done:0,pending:0,running:0,failed:0,ignored:0,total:0};
    for(const item of items){
      const quantity=item.quantity,done=item.status==='done'?quantity:Math.min(quantity,item.confirmed||0);
      out.total+=quantity;out.done+=done;
      if(item.status!=='done')out[item.status]+=quantity-done;
    }
    return out;
  };
  ctx.extendRuntime(class {
    async initOperations(){
      this.operationSession||=id();
      this.operationJournal=this.storage(KEY,{version:1,jobs:[]});
      const journal=this.operationJournal;
      if(journal.version!==1||!Array.isArray(journal.jobs)||journal.jobs.length>20)throw Error('Diário de operações inválido. Os dados foram preservados.');
      this.operationChunkCache=new Map();this.operationPersistedChunks=new Set();this.operationIndexes=new WeakMap();this.operationReports=new WeakMap();
      this.operationRevision=(this.operationRevision||0)+1;
      if(journal.chunked){
        if(!this.database)throw Error('O banco do diário de operações não está disponível. Recarregue o jogo.');
        const rows=[];
        await this.databaseValue('readonly',store=>{
          for(const job of journal.jobs){
            if(!Number.isInteger(job.itemCount)||job.itemCount<0||job.itemCount>5000||job.chunks!==Math.ceil(job.itemCount/128))throw Error('Índice de operação inválido.');
            job.items=[];
            for(let index=0;index<job.chunks;index++){
              const key=KEY+':'+job.id+':'+index,request=store.get(key),row={job,index,key};rows.push(row);
              request.onsuccess=()=>{row.raw=request.result;};
            }
          }
          return store.get(KEY);
        });
        for(const row of rows){
          if(typeof row.raw!=='string')throw Error('Falta um trecho do diário de operações. Os dados foram preservados.');
          const items=JSON.parse(row.raw);
          if(!Array.isArray(items)||items.length>128)throw Error('Trecho de operação inválido.');
          row.job.items.push(...items);this.operationChunkCache.set(row.key,row.raw);this.operationPersistedChunks.add(row.key);
        }
        for(const job of journal.jobs)if(job.items.length!==job.itemCount)throw Error('Operação salva incompleta.');
      }
      for(const job of journal.jobs){
        if(!['buy','build'].includes(job.kind)||!Array.isArray(job.items)||job.items.length>5000||typeof job.id!=='string')throw Error('Operação salva inválida. Os dados foram preservados.');
        for(const item of job.items){
          if(!['done','pending','running','failed','ignored'].includes(item.status)||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>5000||!Number.isInteger(item.confirmed)||item.confirmed<0||item.confirmed>item.quantity||typeof item.id!=='string')throw Error('Pendência salva inválida. Os dados foram preservados.');
          if(item.status==='running'){item.status='pending';item.reason='Execução interrompida. Confira o resultado antes de retomar.';}
        }
      }
      if(!journal.chunked)for(const job of journal.jobs)for(let offset=0;offset<job.items.length;offset+=128)this.operationChunkCache.set(KEY+':'+job.id+':'+offset/128,JSON.stringify(job.items.slice(offset,offset+128)));
      this.publishOperations();
    }

    operationStatus(){
      const jobs=(this.operationJournal?.jobs||[]).map(job=>{
        const requiresRoomConfirmation=false;
        return {...copy(job),report:report(job.items),requiresRoomConfirmation,
          canRetry:!this.busy&&!this.operationGate&&!this.disposed&&this.ws?.readyState===1&&job.items.some(item=>item.status==='pending')};
      });
      return {jobs,report:report(jobs.flatMap(job=>job.items)),canRetry:jobs.some(job=>job.canRetry)};
    }

    operationIndex(job){
      this.operationIndexes||=new WeakMap();
      let index=this.operationIndexes.get(job);
      if(!index||index.items!==job.items||index.size!==job.items.length){
        index={items:job.items,size:job.items.length,byId:new Map(),positions:new Map()};
        job.items.forEach((item,position)=>{index.byId.set(item.id,item);index.positions.set(item,position);});
        this.operationIndexes.set(job,index);
      }
      return index;
    }

    operationReport(job){
      this.operationReports||=new WeakMap();
      let cached=this.operationReports.get(job);
      if(!cached||cached.revision!==job.revision){cached={revision:job.revision,report:report(job.items)};this.operationReports.set(job,cached);}
      return cached.report;
    }

    operationSummary(){
      const total={done:0,pending:0,running:0,failed:0,ignored:0,total:0};
      const jobs=(this.operationJournal?.jobs||[]).map(job=>{
        const summary=this.operationReport(job);
        for(const key of Object.keys(total))total[key]+=summary[key];
        return {id:job.id,kind:job.kind,label:job.label,revision:job.revision||0,report:{...summary},
          requiresRoomConfirmation:false,
          canRetry:!this.busy&&!this.operationGate&&!this.disposed&&this.ws?.readyState===1&&summary.pending>0};
      });
      return {jobs,report:total,canRetry:jobs.some(job=>job.canRetry),revision:this.operationRevision||0};
    }

    operationItems(jobId,{offset=0,limit=12,status='attention'}={}){
      const job=this.operationJournal?.jobs.find(entry=>entry.id===jobId);
      if(!job)return {items:[],total:0,revision:this.operationRevision||0};
      offset=C.int(offset,0,100000);limit=C.int(limit,1,100);
      const items=job.items.filter(item=>status==='all'||(status==='attention'? !['done','ignored'].includes(item.status):item.status===status));
      return {items:copy(items.slice(offset,offset+limit)),total:items.length,revision:job.revision||0};
    }

    publishOperations(){this.emit('operations',this.operationSummary());}

    async saveOperations(job,item){
      if(this.operationsStorageError)throw this.operationsStorageError;
      // Captura somente os blocos alterados ANTES de ceder o controle à fila.
      // Chamadas sem escopo continuam aceitas para migração/compatibilidade.
      const changes=Array.isArray(job)?job:job?[{job,item}]:this.operationJournal.jobs.map(job=>({job}));
      const dirty=new Map();
      for(const change of changes){
        change.job.revision=(change.job.revision||0)+1;
        const positions=this.operationIndex(change.job).positions;
        if(change.item){const position=positions.get(change.item);if(position===undefined)throw Error('Item fora do diário.');dirty.set(KEY+':'+change.job.id+':'+Math.floor(position/128),{job:change.job,offset:Math.floor(position/128)*128});}
        else for(let offset=0;offset<change.job.items.length;offset+=128)dirty.set(KEY+':'+change.job.id+':'+offset/128,{job:change.job,offset});
      }
      this.operationRevision=(this.operationRevision||0)+1;
      const blocks=new Map([...dirty].map(([key,{job,offset}])=>[key,JSON.stringify(job.items.slice(offset,offset+128))]));
      const manifest={version:1,chunked:true,jobs:this.operationJournal.jobs.map(job=>{
        const {items,...metadata}=job;return {...metadata,itemCount:items.length,chunks:Math.ceil(items.length/128)};
      })},raw=JSON.stringify(manifest),snapshot=this.database?null:copy(this.operationJournal);
      const write=(this.operationWriteQueue||Promise.resolve()).then(async()=>{
        const next=new Map(),removed=[];
        for(const metadata of manifest.jobs)for(let index=0;index<metadata.chunks;index++){
          const key=KEY+':'+metadata.id+':'+index,value=blocks.get(key)??this.operationChunkCache?.get(key);
          if(value===undefined)throw Error('Bloco do diário não preparado. Nenhum novo comando será enviado.');
          next.set(key,value);
        }
        const size=raw.length+[...next.values()].reduce((sum,value)=>sum+value.length,0);
        if(size>8*1024*1024)throw Error('O diário de operações atingiu o limite local. Nenhum novo comando será enviado.');
        if(!this.database){await this.persist(KEY,snapshot);this.operationChunkCache=next;return;}
        for(const key of this.operationChunkCache?.keys()||[])if(!next.has(key))removed.push(key);
        await this.databaseValue('readwrite',store=>{
          for(const [key,value] of next)if(!this.operationPersistedChunks?.has(key)||this.operationChunkCache?.get(key)!==value)store.put(value,key);
          for(const key of removed)store.delete(key);
          return store.put(raw,KEY);
        });
        this.operationChunkCache=next;this.operationPersistedChunks=new Set(next.keys());this.savedData.set(KEY,raw);
      });
      this.operationWriteQueue=write.catch(()=>{});
      try{await write;}
      catch(error){this.operationsStorageError=Object.assign(Error('Não foi possível salvar o progresso: '+error.message),{code:'STORAGE_FAILURE'});throw this.operationsStorageError;}
      this.publishOperations();
    }

    operationProgress(job){
      const summary=this.operationReport(job);
      this.update({total:summary.total,done:summary.done,pending:summary.pending,failed:summary.failed});
      this.publishOperations();return summary;
    }

    async withOperationLock(work){
      if(this.operationGate||this.busy)throw Error('Aguarde a operação atual antes de continuar.');
      this.operationGate=true;
      try{
        await this.ready;
        if(this.operationsStorageError)throw this.operationsStorageError;
        const lockedWork=async()=>{
          if(this.disposed||this.lifetime.aborted)throw Error('Constructor encerrado.');
          this.operationLockHeld=true;
          try{
            for(const observe of (this.operationObservations||[]).splice(0))observe();
            await this.operationWriteQueue;
            return await work();
          }finally{this.operationLockHeld=false;}
        };
        const locks=this.env.navigator?.locks;
        if(locks)return await locks.request('constructor-operations-'+this.hotel.id,{ifAvailable:true},lock=>{
          if(!lock)throw Error('Há uma operação do Constructor em outra aba deste hotel.');
          // Outra aba pode ter concluído uma operação desde o carregamento desta.
          return (async()=>{
            await this.operationWriteQueue;
            if(this.database){
              const raw=await this.databaseValue('readonly',store=>store.get(KEY));
              if(raw!==undefined){this.savedData.set(KEY,raw);await this.initOperations();}
            }else{
              // localStorage também é relido sob a trava compartilhada entre abas.
              await this.initOperations();
            }
            return lockedWork();
          })();
        });
        if(this.env.navigator)throw Error('Este navegador não oferece o bloqueio necessário para retomar operações com segurança.');
        return await lockedWork(); // Ambiente isolado de validação, sem navegador/abas.
      }finally{this.operationGate=false;this.publishOperations();}
    }

    deferOperationObservation(observe){
      if(this.operationLockHeld)return false;
      if(this.operationGate){
        this.operationObservations||=[];
        if(this.operationObservations.length<5000)this.operationObservations.push(observe);
        return true;
      }
      this.operationObservationTask=this.withOperationLock(async()=>{observe();await this.operationWriteQueue;}).catch(error=>this.emit('diagnostic','Conciliação adiada: '+error.message));
      return true;
    }

    operationFailure(error,fallback='unexpected'){
      const code=String(error?.code||''),message=String(error?.message||'Erro inesperado.');
      const category=/INSUFFICIENT_FUNDS|NOT_ENOUGH_(?:CREDITS|POINTS)/.test(code)?'balance':
        /CATALOG|OFFER_NOT_FOUND/.test(code)?'catalog':
        /UNAVAILABLE|NOT_FOR_SALE|LIMITED|PLACEMENT_REJECTED|PURCHASE_REJECTED|CONFIGURATION_REJECTED/.test(code)?'unavailable':
        /TIMEOUT|NETWORK|CONNECTION|COMMUNICATION/.test(code)?'communication':fallback;
      return {category,reason:message};
    }

    async deferOperationItem(job,item,category,reason,{uncertain=item.uncertain,failure=false}={}){
      item.uncertain=!!uncertain;item.category=category;item.reason=reason;
      if(failure)item.failures=(item.failures||0)+1;
      item.status=!uncertain&&(item.failures||0)>=MAX_FAILURES?'failed':'pending';
      await this.saveOperations(job,item);this.operationProgress(job);
    }

    async operationJob(kind,plans,options){
      const signature=JSON.stringify(plans.map(plan=>kind==='build'?Object.fromEntries(Object.entries(plan).filter(([key])=>!['itemId','operationKey'].includes(key))):plan));
      if(!this.env.crypto?.subtle)throw Error('O navegador não oferece a identificação segura das operações.');
      const digest=await this.env.crypto.subtle.digest('SHA-256',new TextEncoder().encode(signature));
      const key=kind+':'+(options.projectId||'')+':'+Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
      let job=this.operationJournal.jobs.find(entry=>{
        if(kind==='build'&&(entry.session!==this.operationSession||entry.epoch!==this.roomEpoch))return false;
        if(entry.key!==key&&!(kind==='buy'&&options.projectId&&entry.kind===kind&&entry.projectId===options.projectId&&entry.items.some(item=>!terminal(item))))return false;
        if(entry.items.some(item=>!terminal(item)||item.uncertain||item.status==='failed'))return true;
        if(kind==='build')return entry.session===this.operationSession&&entry.epoch===this.roomEpoch;
        return entry.items.every(item=>this.inventory.filter(unit=>unit.spriteId===item.spriteId).length>=(item.baselineIds?.length||0)+item.quantity);
      });
      if(job)return job;
      // Só remove resultados terminados; pendências nunca são descartadas por limite.
      while(this.operationJournal.jobs.length>=20){
        const index=this.operationJournal.jobs.findIndex(entry=>entry.items.every(item=>terminal(item)&&!item.uncertain&&!item.inFlight));
        if(index<0)throw Error('Resolva as operações anteriores antes de abrir outra fila.');
        this.operationJournal.jobs.splice(index,1);
      }
      job={id:id(),key,kind,projectId:options.projectId||null,label:String(options.label||(kind==='buy'?'Compra de móveis':'Montagem do quarto')).slice(0,120),session:this.operationSession,epoch:this.roomEpoch,createdAt:Date.now(),pageId:options.pageId,items:[]};
      const previous=new Map();
      job.items=plans.map((plan,index)=>{
        const position=plan.x+':'+plan.y,dependency=kind==='build'&&plan.height==null&&!plan.wall?previous.get(position):undefined;
        const item={id:job.id+':'+index,spriteId:plan.spriteId,stage:kind==='buy'?'buy':'place',status:'pending',quantity:kind==='buy'?plan.count:1,confirmed:0,attempts:0,failures:0,uncertain:false,category:'',reason:'Aguardando processamento.',plan:copy(plan)};
        if(kind==='buy')item.baselineIds=this.inventory.filter(entry=>entry.spriteId===plan.spriteId).map(entry=>entry.itemId);
        if(kind==='build'){
          item.dependencies=Array.isArray(plan.dependsOn)?plan.dependsOn.map(value=>String(value).includes(':')?String(value):job.id+':'+value):dependency===undefined?[]:[job.id+':'+dependency];
          if(!plan.wall)previous.set(position,index);
        }
        return item;
      });
      this.operationJournal.jobs.push(job);await this.saveOperations(job);return job;
    }

    async ignoreOperationItem(jobId,itemId){
      return this.withOperationLock(async()=>{
        const job=this.operationJournal.jobs.find(entry=>entry.id===jobId),item=job?.items.find(entry=>entry.id===itemId);
        if(!item||['done','ignored'].includes(item.status))return;
        item.status='ignored';item.reason='Descartado explicitamente pelo usuário. O comando já enviado não é desfeito.';
        // Preserva uncertain/inFlight para nunca liberar uma compra incerta ao ignorar.
        await this.saveOperations(job,item);
      });
    }

    async retryOperation(jobId,options={}){
      return this.withOperationLock(async()=>{
        const job=this.operationJournal.jobs.find(entry=>entry.id===jobId);
        if(!job)throw Error('Operação não encontrada.');
        if(job.kind==='buy')return this.processPurchaseOperation(job,this.catalog(),options);
        return this.processBuildOperation(job,options);
      });
    }

    async buyOperation(missing,catalog,options={}){
      this.requireCapability('buy');
      if(!Array.isArray(missing)||missing.length>5000)throw Error('Lista de compra inválida.');
      const seen=new Set(),plans=missing.map(item=>{
        const spriteId=C.int(item.spriteId,1),count=C.int(item.count,1,5000);
        if(seen.has(spriteId))throw Error('Item repetido na lista de compra.');seen.add(spriteId);return {...item,spriteId,count};
      });
      return this.withOperationLock(async()=>{
        const job=await this.operationJob('buy',plans,options);
        return this.processPurchaseOperation(job,catalog,options);
      });
    }

    async processPurchaseOperation(job,catalog,options){
      const delay=C.number(options.delay??1100,0,10000),pageId=options.pageId??job.pageId,fallback=pageId===undefined?undefined:C.int(pageId,0);
      const valid=Object.create(null);
      for(const item of job.items)try{Object.assign(valid,C.normalizeCatalog({[item.spriteId]:catalog?.[item.spriteId]}));}catch{/* A oferta inválida fica pendente, sem bloquear as demais. */}
      return this.run('Comprar móveis · recuperar pendências',async signal=>{
        let sent=0;
        const limited=new Set([...this.limitedSprites,...this.inventory.filter(item=>item.limited&&item.type!=='i').map(item=>item.spriteId)]);
        if(this.projects)for(const bucket of ['original','converted'])for(const project of Object.values(this.projects(bucket)))for(const item of project.layout)if(item.limited)limited.add(item.spriteId);
        try{
          try{await this.refreshInventory(signal);}
          catch(error){
            this.check(signal);
            for(const item of job.items.filter(entry=>!terminal(entry)))await this.deferOperationItem(job,item,'communication','Não foi possível conferir o inventário. Nenhuma nova compra foi enviada.');
            return this.finishOperation(job,{sent});
          }
          await this.reconcilePurchases();
          for(const item of job.items){
            await this.checkpoint(signal);
            if(terminal(item))continue;
            const blocked=this.operationJournal.jobs.some(other=>other.items.some(entry=>entry!==item&&entry.stage==='buy'&&entry.spriteId===item.spriteId&&entry.uncertain));
            if(item.uncertain||blocked){await this.deferOperationItem(job,item,item.uncertain&&item.category==='balance'?'balance':'confirmation',item.uncertain&&item.category==='balance'?'Possível saldo insuficiente. A compra anterior segue sem resultado definitivo; atualize o inventário. O pedido não será repetido.':'Compra anterior sem resultado definitivo. Atualize o inventário; o pedido não será repetido.');continue;}
            const offer=valid[item.spriteId];
            if(limited.has(item.spriteId)||this.limitedSprites.has(item.spriteId)||this.inventory.some(unit=>unit.spriteId===item.spriteId&&unit.limited&&unit.type!=='i')||offer?.limited||item.plan.limited){await this.deferOperationItem(job,item,'unavailable','Móvel LTD: compra automática indisponível.');continue;}
            if(!offer||offer.pageId===undefined&&fallback===undefined){await this.deferOperationItem(job,item,'catalog','Oferta ou página não registrada. Capture o catálogo e tente esta pendência novamente.');continue;}
            if(catalog?.[item.spriteId]?.available===false||catalog?.[item.spriteId]?.purchasable===false){await this.deferOperationItem(job,item,'unavailable','A oferta não está disponível para compra.');continue;}
            while(item.confirmed<item.quantity&&!item.uncertain&&!terminal(item)){
              await this.checkpoint(signal);
              if(this.limitedSprites.has(item.spriteId)){await this.deferOperationItem(job,item,'unavailable','Móvel identificado como LTD durante a compra.');break;}
              const quantity=Math.min(item.quantity-item.confirmed,offer.bundleAllowed===false?1:100);
              let buffer;
              try{buffer=this.protocol.buy(C,offer,fallback,quantity);}
              catch(error){const failure=this.operationFailure(error);await this.deferOperationItem(job,item,failure.category,failure.reason,{failure:true});break;}
              item.status='running';item.attempts++;item.category='';item.reason='Aguardando chegada ao inventário.';
              item.inFlight={quantity,beforeIds:this.inventory.filter(entry=>entry.spriteId===item.spriteId).map(entry=>entry.itemId)};
              item.uncertain=true;
              // O registro em disco precede qualquer ação com custo.
              await this.saveOperations(job,item);this.operationProgress(job);
              let dispatched=false;
              try{
                await this.checkpoint(signal);
                dispatched=true;this.send(buffer);sent+=quantity;
                await this.sleep(delay,signal);
                await this.refreshInventory(signal);
                await this.reconcilePurchases();
                if(item.uncertain)await this.deferOperationItem(job,item,'balance','Possível saldo insuficiente, por exclusão: oferta registrada e inventário respondeu, mas a compra não chegou integralmente. Resultado desconhecido; não haverá reenvio automático.');
              }catch(error){
                if(error.code==='STORAGE_FAILURE')throw error;
                const failure=this.operationFailure(error,'communication');
                // Só uma recusa explícita e correlacionada autoriza nova tentativa.
                const rejected=error.definitive===true;
                if(rejected||!dispatched){item.inFlight=null;item.uncertain=false;}
                await this.deferOperationItem(job,item,failure.category,failure.reason,{failure:dispatched&&!signal.aborted});
                this.check(signal);break;
              }
            }
          }
          return this.finishOperation(job,{sent});
        }finally{await this.interruptOperation(job);}
      });
    }

    async reconcilePurchases(){
      const changes=[];
      for(const job of this.operationJournal.jobs)if(job.kind==='buy')for(const item of job.items){
        let changed=false;
        if(!item.inFlight&&!terminal(item)&&item.attempts===0){
          const before=new Set(item.baselineIds||[]),available=this.inventory.filter(entry=>entry.spriteId===item.spriteId&&!before.has(entry.itemId)).length;
          const fulfilled=Math.min(item.quantity,available);
          if(fulfilled>item.confirmed){item.confirmed=fulfilled;changed=true;}
          if(item.confirmed===item.quantity){item.status='done';item.category='';item.reason='Unidades necessárias confirmadas no inventário.';changed=true;}
        }
        if(!item.inFlight||!item.uncertain){if(changed)changes.push({job,item});continue;}
        const flight=item.inFlight,before=new Set(flight.beforeIds),seen=new Set(flight.receivedIds||[]);
        for(const entry of this.inventory)if(entry.spriteId===item.spriteId&&!before.has(entry.itemId))seen.add(entry.itemId);
        const received=Math.min(flight.quantity,seen.size),delta=received-(flight.confirmed||0);
        if(delta>0){item.confirmed+=delta;flight.confirmed=received;flight.receivedIds=[...seen];changed=true;}
        if(received===flight.quantity){
          item.inFlight=null;item.uncertain=false;item.failures=0;
          if(item.status!=='ignored'){item.status=item.confirmed===item.quantity?'done':'pending';item.category='';item.reason=item.status==='done'?'Compra confirmada no inventário.':'Lote confirmado; aguardando o restante.';}
          changed=true;
        }
        if(changed)changes.push({job,item});
      }
      if(changes.length)await this.saveOperations(changes);
    }

    async executeOperation(plan,options={}){
      this.requireCapability('build');
      if(!Array.isArray(plan)||!plan.length||plan.length>5000)throw Error('Escolha uma construção válida.');
      return this.withOperationLock(async()=>{
        const job=await this.operationJob('build',plan,options);
        return this.processBuildOperation(job,options);
      });
    }

    async processBuildOperation(job,options){
      if(job.session!==this.operationSession||job.epoch!==this.roomEpoch){
        // Envios incertos conservam seu contexto; uma resposta de outro quarto não os confirma.
        for(const item of job.items)if(item.stage==='place'&&item.uncertain&&!item.placementContext)item.placementContext={session:job.session,epoch:job.epoch};
        job.session=this.operationSession;job.epoch=this.roomEpoch;
        await this.saveOperations(job);
      }
      this.observeOperationRoom(this.lastOperationRoom||[]);
      if(!this.inventoryFresh)await this.refreshInventory();
      const used=new Set(this.operationJournal.jobs.filter(entry=>entry.kind==='build').flatMap(entry=>entry.items.filter(item=>item.uncertain&&item.stage==='place'||item.placementConfirmed&&entry.session===this.operationSession&&entry.epoch===this.roomEpoch).map(item=>item.plan.itemId)));
      const pool=this.inventory.filter(item=>!used.has(item.itemId)),selected=new Set(),byId=new Map(),byType=new Map();
      for(const unit of pool){byId.set(unit.itemId,unit);const key=unit.spriteId+':'+(unit.type==='i'?'wall':'floor');if(!byType.has(key))byType.set(key,[]);byType.get(key).push(unit);}
      const cursors=new Map();
      const plans=[];
      for(const item of job.items){
        if(terminal(item))continue;
        if(item.uncertain&&item.stage==='place'){await this.deferOperationItem(job,item,'confirmation','Colocação sem resultado definitivo. Aguarde a confirmação do jogo; nenhum móvel será reenviado.');continue;}
        try{
          const p={...item.plan,operationKey:item.id};
          C.int(p.spriteId,1);C.int(p.x,-10000,10000);C.int(p.y,-10000,10000);C.int(p.rot??0,0,7);
          if(p.height!=null)C.number(p.height,-1000,1000);
          if(p.wall){for(const key of ['wx','wy','lx','ly'])C.int(p[key],-1000,1000);if(!['l','r'].includes(p.dir))throw Error('Direção da parede inválida.');}
          if(!p.wall)this.protocol.preparePlacement?.(C,p);
          if(item.stage==='place'){
            const key=p.spriteId+':'+(p.wall?'wall':'floor'),units=byType.get(key)||[];
            let position=cursors.get(key)||0;while(position<units.length&&selected.has(units[position].itemId))position++;cursors.set(key,position);
            const exact=byId.get(p.itemId),candidate=exact&&!selected.has(exact.itemId)&&exact.spriteId===p.spriteId&&(p.wall?exact.type==='i':exact.type!=='i')?exact:units[position];
            p.itemId=candidate?.itemId??null;if(candidate)selected.add(candidate.itemId);
          }
          item.plan=copy(p);plans.push(p);
        }catch(error){await this.deferOperationItem(job,item,'unexpected',error.message,{failure:true,uncertain:false});}
      }
      await this.saveOperations();
      if(!plans.length)return this.finishOperation(job);
      return this.execute(plans,{...options,operationJob:job});
    }

    operationInventoryIds(){
      if(this.operationInventorySource!==this.inventory||this.operationInventorySize!==this.inventory.length){this.operationInventorySource=this.inventory;this.operationInventorySize=this.inventory.length;this.operationInventorySet=new Set(this.inventory.map(item=>item.itemId));}
      return this.operationInventorySet;
    }

    async beginBuildOperationItem(job,plan,signal,options){
      const item=this.operationIndex(job).byId.get(plan.operationKey);
      if(!item||terminal(item))return null;
      if(item.dependencies?.some(key=>this.operationIndex(job).byId.get(key)?.status!=='done')){
        await this.deferOperationItem(job,item,'dependency','Aguardando o móvel de apoio/dependência. As coordenadas foram preservadas.');return null;
      }
      if(item.stage==='configure'){
        await this.retryOperationConfiguration(job,item,signal,options);return null;
      }
      if(!plan.itemId||!this.operationInventoryIds().has(plan.itemId)){
        await this.deferOperationItem(job,item,'missing','Móvel ausente no inventário. Obtenha a unidade e tente esta pendência.');return null;
      }
      const conflict=this.operationJournal.jobs.some(other=>other.kind==='build'&&other.session===this.operationSession&&other.epoch===this.roomEpoch&&other.items.some(entry=>entry!==item&&entry.stage==='place'&&entry.uncertain&&this.operationPlacementInRoom(other,entry)&&entry.plan.spriteId===plan.spriteId&&entry.plan.x===plan.x&&entry.plan.y===plan.y));
      if(conflict){await this.deferOperationItem(job,item,'dependency','Há uma colocação incerta deste móvel nesta posição. Aguarde sua confirmação antes de continuar.');return null;}
      item.status='running';item.attempts++;item.reason='Preparando colocação.';item.category='';
      await this.saveOperations(job,item);this.operationProgress(job);return item;
    }

    async markPlacementSending(job,item){
      item.uncertain=true;item.reason='Colocação enviada; aguardando confirmação.';
      await this.saveOperations(job,item);
    }

    async markPlacementConfirmed(job,item,response){
      const first=!item.placementConfirmed;
      item.placementConfirmed=true;item.uncertain=false;item.response=copy(response);item.stage='configure';item.reason='Colocação confirmada; conferindo ajustes.';
      await this.saveOperations(job,item);
      if(first)this.emit('placement-confirmed',{jobId:job.id,itemId:item.id,roomId:response.roomId,epoch:job.epoch,connectionId:this.ws?.id});
    }

    async finishBuildOperationItem(job,item,configuration){
      item.configuration=copy(configuration);
      const pending=configuration.statePending||configuration.rotationPending||configuration.colorsPending;
      item.uncertain=!!(configuration.stateUncertain||configuration.rotationUncertain);
      if(pending)await this.deferOperationItem(job,item,'confirmation',configuration.reason||'Colocação confirmada; ajustes ainda pendentes.');
      else{item.status='done';item.confirmed=1;item.category='';item.reason='Colocação e ajustes confirmados.';await this.saveOperations(job,item);this.operationProgress(job);}
    }

    async failBuildOperationItem(job,item,error,signal){
      if(!item)throw error;
      if(error.code==='STORAGE_FAILURE')throw error;
      if(item.stage==='configure'){
        const configuration=this.pendingConfigurations.get(item.response?.roomId);
        if(configuration)item.configuration=copy(configuration);
        item.uncertain=!!(configuration?.stateUncertain||configuration?.rotationUncertain);
      }else if(error.code==='PLACEMENT_REJECTED')item.uncertain=false;
      const failure=this.operationFailure(error,item.uncertain?'confirmation':'unexpected');
      await this.deferOperationItem(job,item,failure.category,failure.reason,{failure:!signal.aborted});
      this.check(signal);
      if(job.epoch!==this.roomEpoch)throw Error('O quarto mudou. Confirme o destino antes de retomar.');
    }

    async retryOperationConfiguration(job,item,signal,options){
      const live=this.pendingConfigurations.get(item.response?.roomId);
      if(!live||live.epoch!==this.roomEpoch){
        await this.deferOperationItem(job,item,'room','O móvel já foi colocado. Reentre no quarto para conferir seus dados atuais antes de tentar os ajustes.');return;
      }
      item.status='running';item.attempts++;await this.saveOperations(job,item);
      try{await this.configureItem(live,signal,options);await this.finishBuildOperationItem(job,item,live);}
      catch(error){await this.failBuildOperationItem(job,item,error,signal);}
    }

    configurationOperation(roomId){
      for(const job of this.operationJournal?.jobs||[])if(job.kind==='build'&&job.session===this.operationSession&&job.epoch===this.roomEpoch){
        const item=job.items.find(entry=>entry.stage==='configure'&&entry.response?.roomId===roomId);
        if(item)return {job,item};
      }
      return null;
    }

    canRetryOperationConfiguration(roomId){
      const operation=this.configurationOperation(roomId);
      return !operation||!terminal(operation.item);
    }

    operationPlacementInRoom(job,item){
      const context=item.placementContext||job;
      return context.session===this.operationSession&&context.epoch===this.roomEpoch;
    }

    observeOperationPlacement(response){
      if(!this.operationJournal)return;
      if(this.deferOperationObservation(()=>this.observeOperationPlacement(response)))return;
      const matches=[];
      for(const job of this.operationJournal.jobs)if(job.kind==='build'&&job.session===this.operationSession&&job.epoch===this.roomEpoch)for(const item of job.items){
        const p=item.plan;
        if(['pending','ignored'].includes(item.status)&&item.stage==='place'&&item.uncertain&&this.operationPlacementInRoom(job,item)&&!p.wall&&p.spriteId===response.spriteId&&p.x===response.x&&p.y===response.y&&(p.height==null||response.z===undefined||Math.abs(Number(response.z)-p.height)<0.001))matches.push({job,item});
      }
      if(matches.length!==1)return;
      const {job,item}=matches[0];
      item.placementConfirmed=true;item.uncertain=false;item.response=copy(response);item.stage='configure';item.reason='Confirmação tardia recebida. Retome somente os ajustes.';
      if(item.status==='ignored'){
        item.reason='Descartado pelo usuário; o jogo confirmou posteriormente a colocação.';
        void this.saveOperations(job,item).catch(error=>{this.emit('notice',{type:'error',text:error.message});this.abort(error.message);});return;
      }
      const configuration=this.trackConfiguration(item.plan,response,this.roomEpoch);item.configuration=copy(configuration);
      void this.finishBuildOperationItem(job,item,configuration).then(()=>this.emit('placement-confirmed',{jobId:job.id,itemId:item.id,roomId:response.roomId,epoch:job.epoch,connectionId:this.ws?.id})).catch(error=>{this.emit('notice',{type:'error',text:error.message});this.abort(error.message);});
    }

    observeOperationRoom(layout){
      if(!this.operationJournal)return;
      if(this.deferOperationObservation(()=>this.observeOperationRoom(layout)))return;
      const byId=new Map(layout.map(item=>[item.roomId,item]));
      for(const job of this.operationJournal.jobs)if(job.kind==='build'&&job.session===this.operationSession)for(const item of job.items){
        if(item.stage!=='configure'||terminal(item))continue;
        if(this.pendingConfigurations.has(item.response?.roomId))continue;
        const current=byId.get(item.response?.roomId);
        if(!current||current.spriteId!==item.spriteId)continue;
        const response={...current,x:current.x??item.plan.x,y:current.y??item.plan.y,state:current.extraData};
        const configuration=this.trackConfiguration(item.plan,response,this.roomEpoch);
        item.configuration=copy(configuration);
        this.observeOperationConfiguration(configuration);
      }
      this.publishOperations();
    }

    observeOperationConfiguration(configuration){
      if(!this.operationJournal)return;
      if(this.deferOperationObservation(()=>this.observeOperationConfiguration(configuration)))return;
      const changes=[];
      for(const job of this.operationJournal.jobs)if(job.kind==='build'&&job.session===this.operationSession&&job.epoch===this.roomEpoch)for(const item of job.items){
        if(item.stage!=='configure'||['done','ignored'].includes(item.status)||item.response?.roomId!==configuration.roomId)continue;
        item.configuration=copy(configuration);item.uncertain=!!(configuration.stateUncertain||configuration.rotationUncertain);
        if(!configuration.statePending&&!configuration.rotationPending&&!configuration.colorsPending){item.status='done';item.confirmed=1;item.category='';item.reason='Colocação e ajustes confirmados.';}
        changes.push({job,item});
      }
      if(changes.length)void this.saveOperations(changes).catch(error=>{this.emit('notice',{type:'error',text:error.message});this.abort(error.message);});
    }

    async interruptOperation(job){
      const changes=[];
      for(const item of job.items)if(item.status==='running'){item.status='pending';item.category='communication';item.reason='Execução interrompida. O progresso confirmado foi preservado.';changes.push({job,item});}
      if(changes.length)await this.saveOperations(changes);
      this.operationProgress(job);
    }

    finishOperation(job,extra={}){
      const summary=this.operationProgress(job);
      this.emit('notice',{type:summary.pending||summary.failed?'warning':'success',text:`${job.label}: ${summary.done} concluídos · ${summary.pending} pendentes · ${summary.failed} falhas · ${summary.ignored} ignorados.`});
      return {...extra,jobId:job.id,report:summary,obtained:job.kind==='buy'?summary.done:undefined};
    }
  }.prototype);
  ctx.parts.add('operations.js');
})();
