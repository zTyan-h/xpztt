// Constructor — extraído da Oficina 1.5.1.
(function () {
  'use strict';
  const ctx = window._constructor;
  if (!ctx?.current()) return;
  const OficinaCore = ctx.Core;
  ctx.extendRuntime(class {
  height(value){
    this.requireCapability('build');
    this.send(this.protocol.height(OficinaCore,value));
  }

  async execute(plan,options={}){
    if(this.executeOperation&&!options.operationJob)return this.executeOperation(plan,options);
    const job=options.operationJob;
    this.requireCapability('build');
    if(!Array.isArray(plan)||!plan.length||plan.length>5000)throw Error('Escolha uma construção válida.');
    if(!this.inventoryFresh)throw Error('Atualize seus móveis antes de construir.');
    if(this.protocol.prepareBuildPlan)plan=this.protocol.prepareBuildPlan(OficinaCore,plan);
    const owned=new Set(this.inventory.map(i=>i.itemId)),used=new Set(),preparation=new Map();
    for(const p of plan){
      if(!job&&(!owned.has(p.itemId)||used.has(p.itemId)))throw Error('Os móveis mudaram. Atualize a lista e confira novamente.');
      used.add(p.itemId);
      if(!p.wall&&this.protocol.preparePlacement)preparation.set(p,this.protocol.preparePlacement(OficinaCore,p));
    }
    const flash=options.flash===true,delay=OficinaCore.number(options.delay??(flash?100:180),flash?25:0,flash?2000:10000,true);
    return this.run(flash?'Construir · Flash':'Construir',async signal=>{
      this.flashBuilding=flash;
      this.building=true;
      this.activeOperationJob=job||null;
      this.buildSettings=this.protocol.buildSetting?new Map():null;
      this.lastBuildSendAt=null;
      const roomEpoch=this.roomEpoch;
      this.buildRoomEpoch=roomEpoch;
      const pace=async()=>{
        await this.checkpoint(signal);
        while(flash&&this.lastBuildSendAt!==null&&Date.now()-this.lastBuildSendAt<delay)await this.sleep(delay-(Date.now()-this.lastBuildSendAt),signal);
        await this.checkpoint(signal);
      };
      const buildSend=async buffer=>{
        await this.checkpoint(signal);
        if(this.isRepeatedBuildSetting(this.protocol.buildSetting?.(OficinaCore,buffer)))return false;
        await pace();return this.send(buffer);
      };
      const buildHeight=async value=>buildSend(this.protocol.height(OficinaCore,value));
      const settleDelay=flash&&this.protocol.configurationMinDelay===0?Math.min(80,delay):80;
      const result={sent:0,confirmed:0,wallSent:0};
      let changedHeight=false;
      this.update({total:plan.length});
      try{
        for(const buffer of (this.protocol.startBuild?this.protocol.startBuild(OficinaCore):this.protocol.resetBuild?.(OficinaCore))||[]){await buildSend(buffer);await this.sleep(settleDelay,signal);}
        for(const p of plan){
          await this.checkpoint(signal);
          let operationItem;
          try{
          if(job){operationItem=await this.beginBuildOperationItem(job,p,signal,{...options,delay});if(!operationItem)continue;}
          for(const buffer of preparation.get(p)||[]){await buildSend(buffer);await this.sleep(settleDelay,signal);}
          if(!p.wall&&(p.height!=null||this.protocol.groupBuildHeights&&changedHeight)){
            const sent=await buildHeight(p.height??null);changedHeight=p.height!=null;
            if(sent!==false)await this.sleep(settleDelay,signal);await this.checkpoint(signal);
          }
          if(p.wall){
            if(job){await this.markPlacementSending(job,operationItem);await this.checkpoint(signal);}
            await buildSend(this.protocol.placeWall(OficinaCore,p));
            result.wallSent++;result.sent++;
            this.configurationReport.wallSent++;
            this.inventory=this.inventory.filter(i=>i.itemId!==p.itemId);
            this.emit('inventory',this.inventory);
            this.publishConfiguration();
            if(job)await this.deferOperationItem(job,operationItem,'confirmation','Envio de parede sem confirmação específica de posição. Confira no jogo; não será repetido automaticamente.',{uncertain:true});
          }
          else{
            await pace();
            result.sent++;
            let response;
            try{
              if(job){await this.markPlacementSending(job,operationItem);await this.checkpoint(signal);}
              response=await this.exchange('placed',v=>v.spriteId===p.spriteId&&v.x===p.x&&v.y===p.y&&(!!this.protocol.rotate||p.rot===undefined||v.rot===p.rot),this.protocol.placeFloor(OficinaCore,p),signal);
            }catch(error){
              this.check(signal);
              if(error.code==='RESPONSE_TIMEOUT')this.configurationReport.unconfirmed++;
              this.publishConfiguration();
              throw error;
            }
            this.check(signal);
            if(roomEpoch!==this.roomEpoch)throw Error('O quarto mudou durante a confirmação de colocação.');
            result.confirmed++;
            if(job)await this.markPlacementConfirmed(job,operationItem,response);
            // A confirmação de colocação consome o item, mesmo se os ajustes falharem.
            this.inventory=this.inventory.filter(i=>i.itemId!==p.itemId);
            const configuration=this.trackConfiguration(p,response,roomEpoch);
            if(this.placementObservation?.response===response)this.placementObservation=null;
            this.emit('inventory',this.inventory);
            if(job)this.operationProgress(job);else this.update({done:result.confirmed+result.wallSent,...result});
            if(p.releaseHeight&&!this.protocol.rotate){await this.checkpoint(signal);await buildHeight(null);changedHeight=false;}
            if(this.supports('configuration'))await this.configureItem(configuration,signal,{...options,delay});
            else if(configuration.statePending){
              configuration.stateReason='O estado solicitado na colocação não foi confirmado. Confira o móvel no quarto.';
              this.finishConfiguration(configuration);
              if(options.strictConfiguration)throw Object.assign(Error('Modo estrito: o estado solicitado não foi confirmado. O móvel colocado não será recolocado.'),{configurationOnly:true});
            }
            if(p.releaseHeight&&this.protocol.rotate){await this.checkpoint(signal);await buildHeight(null);changedHeight=false;}
            if(job)await this.finishBuildOperationItem(job,operationItem,configuration);
          }
          }catch(error){
            if(!job)throw error;
            await this.failBuildOperationItem(job,operationItem,error,signal);
            if(options.strictConfiguration&&error.configurationOnly)throw error;
          }
          if(job)this.operationProgress(job);else this.update({done:result.confirmed+result.wallSent,...result});
          if(!flash)await this.sleep(delay,signal);
        }
        if(result.wallSent&&!job){
          await this.checkpoint(signal);
          await this.refreshInventory(signal);
          const remaining=new Set(this.inventory.map(i=>i.itemId));
          if(plan.some(p=>p.wall&&remaining.has(p.itemId)))throw Error('Há móveis de parede ainda no inventário. Confira a parede antes de tentar novamente.');
        }
        const status=this.configurationStatus();
        if(job)return this.finishOperation(job,{...result,configuration:status});
        const text=`${result.confirmed} móveis de chão confirmados`+(result.wallSent?`; ${result.wallSent} envios para a parede`:'')+'.';
        const pending=status.pending.length?` Pendências nesta sala: ${status.report.statePending} estados, ${status.report.rotationPending||0} rotações e ${status.report.colorPending} cores. `+(this.supports('configuration')?'Use Tentar pendências novamente.':'Confira os estados no quarto; a repetição de ajustes ainda não está disponível neste hotel.'):'';
        this.emit('notice',{type:result.wallSent||status.pending.length?'warning':'success',text:text+pending+(result.wallSent?' Confira as posições na parede.':'')});
        return {...result,configuration:status};
      }
      finally{
        this.flashBuilding=false;
        this.building=false;
        if(roomEpoch===this.roomEpoch&&this.ws?.readyState===1){
          if(this.protocol.resetBuild)this.resetBuildModes();
          else if(changedHeight)try{this.height(null);}catch{}
        }
        this.buildRoomEpoch=null;
        this.buildSettings=null;
        this.placementObservation=null;
        this.activeOperationJob=null;
        if(job)await this.interruptOperation(job);
      }
    });
  }

  async buy(missing,catalog,options={}){
    return this.buyOperation(missing,catalog,options);
  }

  }.prototype);

  ctx.parts.add('tasks.js');
})();
