// Constructor — extraído da Oficina 1.5.1.
(function () {
  'use strict';
  const ctx = window._constructor;
  if (!ctx?.current()) return;
  const OficinaCore = ctx.Core;
ctx.Runtime = class {
  constructor(env=window,options={}) {
    this.env=env;
    this.hotel=ctx.hotel;
    if(!this.hotel)throw Error(ctx.protocolMessage);
    this.protocol=this.hotel.protocol;
    this.options={timeout:5000,...options};
    this.events=new Map();
    this.waiters=new Set();
    this.inventory=[];
    this.limitedSprites=new Set();
    this.inventoryFresh=false;
    this.fragments=new Map();
    this.fragmentTotal=0;
    this.sockets=new Map();
    this.socketSequence=0;
    this.ws=null;
    this.busy=false;
    this.paused=false;
    this.disposed=false;
    this.controller=null;
    this.progress={phase:'idle',done:0,total:0,confirmed:0,sent:0};
    this.savedData=new Map();
    this.catalogWriteQueue=Promise.resolve();
    this.database=null;
    this.storageSettled=false;
    this.storageError=null;
    this.refreshing=false;
    this.flashBuilding=false;
    this.catalogIndex=[];
    this.catalogRequest=null;
    this.catalogCandidates=new Map();
    this.catalogScan=false;
    this.catalogCapture={active:false,opcode:null,pages:new Set(),learned:0};
    this.catalogIndexOpcode=undefined;
    this.pendingConfigurations=new Map();
    this.configurationReport={placed:0,configured:0,statePending:0,colorPending:0,unconfirmed:0,wallSent:0};
    this.roomEpoch=0;
    this.building=false;
    this.buildRoomEpoch=null;
    this.buildSettings=null;
    this.placementObservation=null;
    this.lastBuildSendAt=null;
    this.configurationActive=null;

    const transport=env._constructorBridge?.socket;
    if(transport?.version!==1)throw Error('Recarregue a página com o loader do Constructor instalado.');
    this.transport=transport;
    this.lifetime=ctx.ac.signal;
    this.transportStops=[];
    this.transportStops.push(transport.onConnection(()=>{
      const active=transport.getActive('constructor');
      if(active){this.adopt(active);return;}
      if(!this.ws)return;
      this.inventoryFresh=false;
      this.resetConfigurationRoom();
      this.abort('A conexão caiu. Entre novamente no jogo e atualize seus móveis.');
      this.emit('connection',this.status());
    },{signal:this.lifetime}));
    this.transportStops.push(transport.onReceive(event=>{
      if(!this.disposed&&event.connectionId===this.ws?.id){
        const buffer=this.binary(event.data);
        if(buffer)this.feed(buffer,this.ws);
      }
    },{signal:this.lifetime}));
    this.transportStops.push(transport.onSend(event=>{
      if(!this.disposed&&this.hotel.protocol&&event.status==='sent'&&event.connectionId===this.ws?.id){
        const buffer=this.binary(event.data);
        if(buffer){
          if(this.buildSettings&&event.source!=='constructor'&&this.protocol.buildSetting){
            try{
              for(const packet of OficinaCore.decode(buffer)){
                const setting=this.protocol.buildSetting(OficinaCore,packet.buffer);
                if(setting)this.buildSettings.set(setting.mode,setting.value);
              }
            }catch{for(const mode of this.buildSettings.keys())this.buildSettings.set(mode,undefined);}
          }
          this.observeCatalogRequest(buffer,this.ws);
        }
      }
    },{signal:this.lifetime}));

    this.ready=this.initStorage().then(()=>{if(!this.disposed)return this.initProjects();}).then(()=>{if(!this.disposed)return this.initOperations?.();});
  }

  on(name,fn){if(!this.events.has(name))this.events.set(name,new Set());this.events.get(name).add(fn);return ()=>this.events.get(name)?.delete(fn);}
  emit(name,data){if(this.disposed)return;for(const fn of this.events.get(name)||[])try{fn(data);}catch(e){this.env.console?.error('[Oficina] Interface:',e);} }

  supports(feature){return this.hotel.protocol?.capabilities?.[feature]===true;}

  requireCapability(feature){
    this.check();
    if(!this.supports(feature))throw Error('Constructor no '+this.hotel.name+': este recurso ainda aguarda validação dos pacotes e comandos.');
  }

  binary(data){if(data instanceof ArrayBuffer)return data;if(ArrayBuffer.isView(data))return data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);return null;}

  status(){const code=this.ws?.readyState??-1;return {available:!!this.ws,state:code===1&&!this.hotel.protocol?'UNSUPPORTED':({0:'CONNECTING',1:'OPEN',2:'CLOSING',3:'CLOSED'})[code]||'not_found',stateCode:code,url:this.ws?.url||''};}

  observe(ws){
    if(this.disposed||this.sockets.has(ws))return;
    this.sockets.set(ws,{sequence:++this.socketSequence,retired:false,pending:new Uint8Array(0)});
  }

  adopt(ws){
    if(this.disposed||ws===this.ws)return;
    this.observe(ws);
    const next=this.sockets.get(ws);
    if(next?.retired)return;
    if(this.ws&&this.sockets.get(this.ws)?.sequence>next.sequence)return;
    if(this.ws)this.abort('A conexão mudou. Atualize seus móveis antes de continuar.');
    if(this.ws&&this.sockets.has(this.ws))this.sockets.get(this.ws).retired=true;
    this.resetConfigurationRoom();
    this.catalogIndex=[];
    this.catalogIndexOpcode=undefined;
    this.catalogRequest=null;
    this.catalogCandidates.clear();
    this.catalogCapture={active:false,opcode:null,pages:new Set(),learned:0,connection:ws};
    this.catalogPageDiagnostics=new Map();this.catalogParseError=null;this.catalogScanReport=null;
    this.ws=ws;
    this.inventory=[];
    this.inventoryFresh=false;
    this.fragments.clear();
    this.fragmentTotal=0;
    this.emit('connection',this.status());
  }

  feed(buffer,ws){
    if(this.disposed||!this.hotel.protocol)return;
    this.observe(ws);
    const record=this.sockets.get(ws);
    if(record.retired)return;
    const incoming=new Uint8Array(buffer);
    if(record.pending.length+incoming.length>16*1024*1024){
      record.pending=new Uint8Array(0);
      this.emit('diagnostic','Mensagem descartada: limite de 16 MB.');
      return;
    }
    const bytes=new Uint8Array(record.pending.length+incoming.length);
    bytes.set(record.pending);bytes.set(incoming,record.pending.length);
    const view=new DataView(bytes.buffer),packets=[];
    let offset=0;
    while(offset+4<=bytes.length){
      const length=view.getInt32(offset,false);
      if(length<2||length>16*1024*1024){record.pending=new Uint8Array(0);return;}
      if(offset+4+length>bytes.length)break;
      packets.push({id:view.getUint16(offset+4,false),buffer:bytes.buffer.slice(offset,offset+length+4)});
      offset+=length+4;
    }
    record.pending=bytes.slice(offset);
    if(ws!==this.ws)return;

    for(const packet of packets){
      try{
        const packetOpcode=packet.id;
        this.learnCatalogIndex(packet);
        this.learnCatalog(packet);
        if(packetOpcode===OficinaCore.OP.ROOM_RESET){
          this.resetConfigurationRoom();
        }
        else if(packetOpcode===OficinaCore.OP.INV_REMOVE){
          const reader=new OficinaCore.Reader(packet.buffer,6),itemId=reader.i32();
          if(reader.p!==reader.v.byteLength)throw Error('Remoção de inventário inválida.');
          if(!this.building){
            this.inventory=this.inventory.filter(item=>item.itemId!==itemId);
            this.inventoryFresh=false;
            this.emit('inventory',this.inventory);
          }
        }
        else if(packetOpcode===OficinaCore.OP.INV_RES){
          const f=this.protocol.readInventory(OficinaCore,packet.buffer);
          for(const item of f.items)if(item.limited&&item.type==='s')this.limitedSprites.add(item.spriteId);
          if(f.total!==this.fragmentTotal){this.fragments.clear();this.fragmentTotal=f.total;}
          this.fragments.set(f.index,f.items);
          if(this.fragments.size===f.total){
            const items=[];
            for(let i=0;i<f.total;i++){if(!this.fragments.has(i))throw Error('Inventário incompleto.');items.push(...this.fragments.get(i));}
            const unique=new Map(items.map(i=>[i.itemId,i]));
            if(unique.size!==items.length)throw Error('O inventário contém IDs repetidos.');
            this.inventory=[...unique.values()];
            this.inventoryFresh=true;
            this.fragments.clear();
            this.fragmentTotal=0;
            this.emit('inventory',this.inventory);
            this.dispatch({kind:'inventory',items:this.inventory});
          }
        }
        else if(packetOpcode===OficinaCore.OP.CONFIRM){
          const response=this.protocol.readFloorConfirmation(OficinaCore,packet.buffer);
          this.observeOperationPlacement?.(response);
          this.dispatch({kind:'placed',...response});
        }
        else if(packetOpcode===OficinaCore.OP.UPDATE)for(const i of this.protocol.readUpdates(OficinaCore,packet.buffer)){
          this.observeConfiguration(i);
          this.dispatch({kind:'state',...i});
          this.dispatch({kind:'configurationState',...i});
        }
        else if(packetOpcode===OficinaCore.OP.STATE_UPDATE&&this.protocol.readStateUpdate){
          const item=this.protocol.readStateUpdate(OficinaCore,packet.buffer);
          this.observeConfiguration(item);
          this.dispatch({kind:'state',...item});
          this.dispatch({kind:'configurationState',...item});
        }
        else if(packetOpcode===OficinaCore.OP.OBJECTS){
          const layout=this.protocol.readRoom(OficinaCore,packet.buffer);
          for(const item of layout)if(item.limited)this.limitedSprites.add(item.spriteId);
          this.resetConfigurationRoom();
          this.lastOperationRoom=layout;
          this.observeOperationRoom?.(layout);
          this.dispatch({kind:'room',layout});
        }
        else if(packetOpcode===OficinaCore.OP.ERROR){
          if(this.configurationActive){
            for(const w of [...this.waiters])if(w.kind==='configurationState')w.reject(Object.assign(Error('O jogo recusou o ajuste do móvel.'),{code:'CONFIGURATION_REJECTED'}));
          }else if(this.flashBuilding&&!this.activeOperationJob)this.abort('O jogo recusou um comando. A construção parou; aumente o intervalo Flash antes de tentar novamente.');
          this.emit('diagnostic','O servidor enviou uma recusa (1162).');
          for(const w of [...this.waiters])if(w.kind==='placed')w.reject(Object.assign(Error('O jogo recusou a colocação. Verifique espaço e permissões do quarto.'),{code:'PLACEMENT_REJECTED'}));
        }
      }catch(e){
        this.emit('diagnostic',`Pacote ${packet.id}: ${e.message}`);
        if(packet.id===OficinaCore.OP.OBJECTS)for(const waiter of [...this.waiters])if(waiter.kind==='room')waiter.reject(Object.assign(Error(`Não foi possível copiar este quarto: a lista de móveis recebida não pôde ser lida (pacote ${packet.id}). ${e.message}`),{code:'ROOM_CAPTURE_INVALID'}));
      }
    }
  }

  dispatch(event){for(const w of [...this.waiters])if(w.kind===event.kind&&w.match(event)){
    if(event.kind==='placed'&&this.building)this.placementObservation={epoch:this.roomEpoch,response:event};
    w.resolve(event);
  }}

  wait(kind,match=()=>true,signal,timeout=this.options.timeout){
    let record;
    const promise=new Promise((resolve,reject)=>{
      let timer;
      const cleanup=()=>{this.env.clearTimeout(timer);this.waiters.delete(record);signal?.removeEventListener('abort',aborted);};
      const aborted=()=>record.reject(signal.reason||Error('Tarefa cancelada.'));
      record={kind,match,resolve:v=>{cleanup();resolve(v);},reject:e=>{cleanup();reject(e);}};
      this.waiters.add(record);
      timer=this.env.setTimeout(()=>record.reject(Object.assign(Error('Não chegou uma resposta do jogo. Confira o quarto antes de tentar novamente.'),{code:'RESPONSE_TIMEOUT'})),timeout);
      signal?.addEventListener('abort',aborted,{once:true});
      if(signal?.aborted)aborted();
    });
    return {promise,cancel:e=>record.reject(e)};
  }

  isRepeatedBuildSetting(setting){
    return !!(this.building&&this.buildSettings&&setting&&(setting.value!==''||setting.mode==='up')&&this.buildSettings.get(setting.mode)===setting.value);
  }

  send(buffer){
    if(!this.hotel.protocol)throw Error(ctx.protocolMessage);
    if(this.disposed||!this.ws||this.ws.readyState!==1)throw Error('Entre no jogo para conectar.');
    const binary=this.binary(buffer);
    if(!binary)throw Error('O pacote deve ser binário.');
    const settings=this.buildSettings,setting=this.building&&settings&&this.protocol.buildSetting?.(OficinaCore,binary);
    // A altura persiste entre colocações; o Habblet não precisa repetir o valor.
    if(this.isRepeatedBuildSetting(setting))return false;
    try{this.transport.send(buffer,{connectionId:this.ws.id,source:'constructor'});}
    catch(e){this.abort(e.message);throw e;}
    if(setting&&this.buildSettings===settings)settings.set(setting.mode,setting.value);
    if(this.building)this.lastBuildSendAt=Date.now();
    return true;
  }

  async exchange(kind,match,buffer,signal,timeout){
    const w=this.wait(kind,match,signal,timeout);
    try{this.check(signal);this.send(buffer);}catch(e){w.cancel(e);}
    return await w.promise;
  }

  check(signal){
    if(this.disposed||this.lifetime.aborted)throw Error('Constructor encerrado.');
    if(!this.hotel.protocol)throw Error(ctx.protocolMessage);
    if(signal?.aborted)throw signal.reason||Error('Tarefa cancelada.');
    if(!this.ws||this.ws.readyState!==1)throw Error('A conexão caiu. Entre novamente no jogo.');
  }

  abort(message){
    if(this.controller&&!this.controller.signal.aborted)this.controller.abort(Error(message));
    for(const w of [...this.waiters])w.reject(Error(message));
  }

  cancel(){this.abort('Tarefa cancelada. Os comandos já enviados não são desfeitos.');}
  pause(){if(this.busy){this.paused=true;this.emit('progress',{...this.progress,paused:true});}}
  resume(){this.paused=false;this.emit('progress',{...this.progress,paused:false});}

  async sleep(ms,signal){
    if(signal?.aborted)throw signal.reason;
    if(ms<=0)return;
    await new Promise((resolve,reject)=>{
      const end=()=>{signal?.removeEventListener('abort',abort);resolve();};
      const timer=this.env.setTimeout(end,ms);
      const abort=()=>{this.env.clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason);};
      signal?.addEventListener('abort',abort,{once:true});
    });
  }

  async checkpoint(signal){
    this.check(signal);
    while(this.paused){await this.sleep(80,signal);this.check(signal);}
  }

  update(data){this.progress={...this.progress,...data,paused:this.paused};this.emit('progress',this.progress);}

  async run(label,work){
    if(this.busy)throw Error('Conclua ou cancele a tarefa atual primeiro.');
    this.check();
    this.busy=true;
    this.publishConfiguration();
    this.paused=false;
    this.controller=new AbortController();
    const signal=this.controller.signal;
    this.progress={phase:'running',label,done:0,total:0,confirmed:0,sent:0,wallSent:0};
    this.update({});
    try{
      const result=await work(signal);
      this.check(signal);
      this.update({phase:'done'});
      return result;
    }
    catch(e){
      if(!e.configurationOnly)this.inventoryFresh=false;
      this.update({phase:signal.aborted?'stopped':'error',error:e.message});
      e.__oficinaShown=true;
      this.emit('notice',{type:signal.aborted?'warning':'error',text:e.message});
      throw e;
    }
    finally{
      this.busy=false;
      this.paused=false;
      this.controller=null;
      this.publishConfiguration();
      this.publishOperations?.();
      this.emit('idle',this.progress);
    }
  }

  async refreshInventory(signal=this.lifetime){
    this.check(signal);
    this.requireCapability('inventory');
    if(this.refreshing)throw Error('Já estou atualizando seus móveis.');
    this.refreshing=true;
    this.fragments.clear();
    this.fragmentTotal=0;
    this.inventoryFresh=false;
    try{
      const items=(await this.exchange('inventory',()=>true,this.protocol.inventoryRequest(OficinaCore),signal)).items;
      if(this.operationJournal){
        if(this.operationGate)await this.reconcilePurchases();
        else if(!this.busy)await this.withOperationLock(()=>this.reconcilePurchases());
      }
      return items;
    }
    finally{this.refreshing=false;}
  }

  resetBuildModes(){
    if(!this.protocol.resetBuild||this.buildRoomEpoch!==this.roomEpoch||this.ws?.readyState!==1)return;
    const epoch=this.buildRoomEpoch,connectionId=this.ws.id;
    this.buildRoomEpoch=null;
    for(const buffer of this.protocol.resetBuild(OficinaCore,this.buildSettings)){
      if(this.roomEpoch!==epoch||this.ws?.id!==connectionId||this.ws?.readyState!==1)return;
      try{this.send(buffer);}catch{
        this.emit('notice',{type:'warning',text:'Não foi possível restaurar a altura. Use :up sem valor no quarto.'});
        break;
      }
    }
  }

  dispose(){
    if(this.disposed)return;
    this.projectRelay?.dispose();
    if(this.building)this.resetBuildModes();
    this.disposed=true;
    this.cancel();
    this.transportStops.forEach(stop=>stop());
    this.transportStops=[];
    this.sockets.clear();
    this.pendingConfigurations.clear();
    this.buildSettings=null;
    this.placementObservation=null;
    this.operationObservations=[];
    this.lastOperationRoom=null;
    this.events.clear();
    this.database?.close();
    this.database=null;
    this.ws=null;
  }
};

  ctx.parts.add('runtime.js');
})();
