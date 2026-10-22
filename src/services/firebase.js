// Constructor — relay privado via Worker standalone, sem SDK.
(function () {
  'use strict';
  const ctx=window._constructor;
  if(!ctx?.current())return;
  // Configuração pública do app Web; nunca colocar tokens ou chaves administrativas aqui.
  const CONFIG=Object.freeze({...ctx.firebaseConfig});
  const ROOT='constructor/v1/',AUTH_KEY='constructor:'+String(CONFIG.projectId||'unconfigured')+':auth',LINK_KEY='constructor_link_v1',MAX_BYTES=4*1024*1024;
  function configured(){
    if(ctx.firebaseEnabled===false||!['projectId','apiKey','databaseURL'].every(key=>typeof CONFIG[key]==='string'&&CONFIG[key].trim())||!ctx.platform?.baseUrl||typeof ctx.platform.request!=='function')throw Error('Vínculo entre hotéis indisponível. Configure o Firebase no Worker para enviar e receber projetos.');
  }
  const hotelId=value=>Object.hasOwn(ctx.hotels,value);
  const validCode=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
  const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{8,160}$/.test(value);
  const digest=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');

  class Relay {
    constructor(runtime){
      this.runtime=runtime;this.state=runtime.storage(LINK_KEY,null);this.generation=0;
      if(this.state&&(!validId(this.state.uid)||this.state.linkId&&(!validCode(this.state.linkId)||!validId(this.state.peerUid)||!hotelId(this.state.peerHotel))||!this.state.linkId&&(!validCode(this.state.code)||!['host','guest'].includes(this.state.role)||!Number.isFinite(this.state.expiresAt))))throw Error('Vínculo local inválido. Os projetos foram preservados.');
      this.controller=new AbortController();this.operations=new Map();this.offset=0;this.closed=false;
    }
    guard(epoch=this.generation){
      if(this.closed||epoch!==this.generation||!ctx.current()||this.runtime.disposed)throw new DOMException('Operação de projetos cancelada.','AbortError');
    }
    rotate(){this.controller.abort();this.controller=new AbortController();this.generation++;}
    dispose(){this.closed=true;this.rotate();}
    status(){
      const state=this.state;
      if(!state)return {linked:false,pending:false};
      if(state.linkId)return {linked:true,pending:false,hotel:state.peerHotel};
      return {linked:false,pending:true,role:state.role,code:state.code,expiresAt:state.expiresAt,candidate:state.candidate};
    }
    async save(state,epoch){
      this.guard(epoch);await this.runtime.persist(LINK_KEY,state);this.guard(epoch);
      this.state=state;const status=this.status();this.runtime.emit('project-link',status);return status;
    }
    exclusive(key,work){
      if(this.operations.has(key))return this.operations.get(key);
      const epoch=this.generation;
      const operation=Promise.resolve().then(()=>{this.guard(epoch);return work(epoch);}).finally(()=>{if(this.operations.get(key)===operation)this.operations.delete(key);});
      this.operations.set(key,operation);return operation;
    }
    async fetch(url,options,epoch){
      this.guard(epoch);
      let response;
      try{response=await ctx.platform.request(url,{...options,signal:AbortSignal.any([ctx.ac.signal,this.controller.signal,AbortSignal.timeout(30000)])});}
      catch(error){this.guard(epoch);if(error.name==='TimeoutError')throw Error('O Firebase demorou a responder. Tente novamente.');throw error;}
      this.guard(epoch);return response;
    }
    async auth(epoch,force=false){
      this.guard(epoch);
      configured();
      if(this.authPending)return this.authPending;
      if(!this.identity){
        try{this.identity=JSON.parse(this.runtime.env.localStorage.getItem(AUTH_KEY)||'null');}
        catch{throw Error('Identidade local do Constructor inválida. Preserve seus projetos antes de limpar os dados do navegador.');}
      }
      if(this.identity&&(!validId(this.identity.uid)||typeof this.identity.token!=='string'||typeof this.identity.refreshToken!=='string'||!Number.isFinite(this.identity.expiresAt)))throw Error('Identidade do Constructor inválida.');
      if(!force&&this.identity?.expiresAt>Date.now()+60000){
        if(this.state&&this.state.uid!==this.identity.uid)await this.save(null,epoch);
        return this.identity;
      }
      const work=(async()=>{
        const saved=this.identity;
        if(saved&&(!validId(saved.uid)||typeof saved.refreshToken!=='string'))throw Error('Identidade do Constructor inválida.');
        const url=new URL(saved?'/firebase/auth/refresh':'/firebase/auth/signup',ctx.platform.baseUrl).href;
        const response=await this.fetch(url,{method:'POST',headers:{'Content-Type':saved?'application/x-www-form-urlencoded':'application/json'},body:saved?new URLSearchParams({grant_type:'refresh_token',refresh_token:saved.refreshToken}).toString():JSON.stringify({returnSecureToken:true})},epoch);
        if(!response.ok)throw Error('Não foi possível autenticar no Firebase. Confira o login Anônimo e a configuração do Worker.');
        const data=await response.json();this.guard(epoch);
        const identity={uid:data.localId||data.user_id,token:data.idToken||data.id_token,refreshToken:data.refreshToken||data.refresh_token,expiresAt:Date.now()+Number(data.expiresIn||data.expires_in)*1000};
        if(!validId(identity.uid)||typeof identity.token!=='string'||typeof identity.refreshToken!=='string'||!Number.isFinite(identity.expiresAt)||saved&&saved.uid!==identity.uid)throw Error('Resposta de autenticação inválida.');
        this.runtime.env.localStorage.setItem(AUTH_KEY,JSON.stringify(identity));this.identity=identity;
        if(this.state&&this.state.uid!==identity.uid)await this.save(null,epoch);
        return identity;
      })();
      this.authPending=work;
      try{return await work;}finally{if(this.authPending===work)this.authPending=null;}
    }
    async request(path,method='GET',body,options={},epoch=this.generation,retry=true){
      const auth=await this.auth(epoch);this.guard(epoch);
      const url=new URL('/firebase/rtdb/'+(ROOT+path).replace(/\/$/,'')+'.json',ctx.platform.baseUrl);url.searchParams.set('auth',auth.token);
      for(const [key,value] of Object.entries(options.query||{}))url.searchParams.set(key,JSON.stringify(value));
      const headers={'Content-Type':'application/json',...(options.etag?{'X-Firebase-ETag':'true'}:{}),...(options.match?{'if-match':options.match}:{})};
      const response=await this.fetch(url.href,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})},epoch);
      if(response.status===401&&retry){await this.auth(epoch,true);return this.request(path,method,body,options,epoch,false);}
      if(response.status===412)return {conflict:true};
      if(!response.ok){
        if(response.status===401||response.status===403)throw Error('Permissão negada no Firebase. Confira as regras e a validade do código ou vínculo.');
        throw Error('Falha no Firebase (HTTP '+response.status+'). Tente novamente.');
      }
      const value=await response.json();this.guard(epoch);return {value,etag:response.headers.get('ETag')};
    }
    async now(epoch){
      const {uid}=await this.auth(epoch);
      const {value}=await this.request('clocks/'+uid,'PUT',{'.sv':'timestamp'},{},epoch);
      if(!Number.isFinite(value))throw Error('Não foi possível conferir o horário do Firebase.');
      this.offset=value-Date.now();return value;
    }
    async linked(epoch){
      await this.auth(epoch);
      if(!this.state?.linkId)throw Error('Vincule os hotéis antes de enviar ou receber projetos.');
      const state={...this.state};
      const {value:link}=await this.request('links/'+state.linkId,'GET',undefined,{},epoch);
      if(!link||link.revoked){await this.save(null,epoch);throw Error('Este vínculo foi desconectado. Vincule os hotéis novamente.');}
      const host=link.hostUid===this.identity.uid,guest=link.guestUid===this.identity.uid;
      if(!host&&!guest||link[host?'hostHotel':'guestHotel']!==this.runtime.hotel.id)throw Error('O vínculo não pertence a esta instalação e hotel.');
      return {...state,peerUid:link[host?'guestUid':'hostUid'],peerHotel:link[host?'guestHotel':'hostHotel']};
    }
    create(){return this.exclusive('pair',async epoch=>{
      if(this.state)throw Error('Cancele ou desconecte o vínculo atual antes de criar outro.');
      const {uid}=await this.auth(epoch),now=await this.now(epoch);
      const code=[...crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,'0')).join('');
      const expiresAt=now+300000;
      await this.request('invites/'+code,'PUT',{hostUid:uid,hostHotel:this.runtime.hotel.id,createdAt:{'.sv':'timestamp'},expiresAt},{},epoch);
      await this.save({uid,role:'host',code,expiresAt},epoch);return {code,expiresAt};
    });}
    join(input){return this.exclusive('pair',async epoch=>{
      if(this.state)throw Error('Cancele ou desconecte o vínculo atual antes de informar outro código.');
      const code=String(input||'').trim().toLowerCase();if(!validCode(code))throw Error('Informe os 32 caracteres do código de vínculo.');
      const {uid}=await this.auth(epoch),now=await this.now(epoch);
      const invite=await this.request('invites/'+code,'GET',undefined,{etag:true},epoch),value=invite.value;
      if(!value||value.expiresAt<=now)throw Error('Código inválido ou expirado.');
      if(value.hostUid===uid||value.hostHotel===this.runtime.hotel.id)throw Error('Abra o código no outro hotel para vincular.');
      if(value.guestUid&&value.guestUid!==uid)throw Error('Este código já foi solicitado por outra instalação.');
      const result=await this.request('invites/'+code,'PUT',{...value,guestUid:uid,guestHotel:this.runtime.hotel.id},{match:invite.etag},epoch);
      if(result.conflict)throw Error('O convite mudou. Confira o código e tente novamente.');
      await this.save({uid,role:'guest',code,expiresAt:value.expiresAt},epoch);return {waiting:true};
    });}
    check(){return this.exclusive('check',async epoch=>{
      await this.auth(epoch);if(!this.state)return this.status();
      if(this.state.linkId){await this.linked(epoch);return this.status();}
      const state={...this.state};
      const {value:link}=await this.request('links/'+state.code,'GET',undefined,{},epoch);
      if(link&&!link.revoked){
        const host=link.hostUid===this.identity.uid;
        if(!host&&link.guestUid!==this.identity.uid)throw Error('Vínculo inválido.');
        return this.save({uid:this.identity.uid,linkId:state.code,peerUid:link[host?'guestUid':'hostUid'],peerHotel:link[host?'guestHotel':'hostHotel']},epoch);
      }
      if(Date.now()+this.offset>=state.expiresAt){await this.cancel();return this.status();}
      const {value:invite}=await this.request('invites/'+state.code,'GET',undefined,{},epoch);
      if(!invite){await this.save(null,epoch);return this.status();}
      if(state.role==='host'&&invite.guestUid){this.state={...state,candidate:{hotel:invite.guestHotel}};this.runtime.emit('project-link',this.status());}
      return this.status();
    });}
    confirm(){return this.exclusive('pair',async epoch=>{
      await this.auth(epoch);
      const state=this.state;if(!state?.code||state.role!=='host')throw Error('A confirmação deve ser feita na página que gerou o código.');
      const {value:invite}=await this.request('invites/'+state.code,'GET',undefined,{},epoch);
      if(!invite?.guestUid)throw Error('Aguardando o outro hotel informar o código.');
      const link={hostUid:invite.hostUid,guestUid:invite.guestUid,hostHotel:invite.hostHotel,guestHotel:invite.guestHotel,createdAt:invite.createdAt,revoked:false};
      await this.request('links/'+state.code,'PUT',link,{},epoch);
      const status=await this.save({uid:this.identity.uid,linkId:state.code,peerUid:invite.guestUid,peerHotel:invite.guestHotel},epoch);
      await this.request('invites/'+state.code,'DELETE',undefined,{},epoch).catch(()=>{});return status;
    });}
    async cancel(){
      const state=this.state;if(state?.linkId)return;
      this.rotate();const epoch=this.generation;
      if(state?.code)await this.request('invites/'+state.code,'DELETE',undefined,{},epoch);
      return this.save(null,epoch);
    }
    async disconnect(){
      const state=this.state;if(!state?.linkId)return this.cancel();
      this.rotate();const epoch=this.generation,id=state.linkId;
      await this.request('','PATCH',{['links/'+id+'/revoked']:true,['payloads/'+id]:null,['queues/'+id]:null,['receipts/'+id]:null,['invites/'+id]:null},{},epoch);
      return this.save(null,epoch);
    }
    send(name){return this.exclusive('send:'+name,async epoch=>{
      const project=this.runtime.projects()[name];
      if(!project||project.conversion)throw Error('Escolha um projeto original deste hotel para enviar.');
      const source={name,id:project.id,revision:project.revision,originHotel:this.runtime.hotel.id,layout:project.layout,...(ctx.Core.validCreatedAt(project.createdAt)?{createdAt:project.createdAt}:{})};
      const body=JSON.stringify(source);if(new TextEncoder().encode(body).length>MAX_BYTES)throw Error('O projeto excede o limite de 4 MiB por transferência.');
      const link=await this.linked(epoch);
      const hash=await digest(body);this.guard(epoch);
      const now=await this.now(epoch),expiresAt=now+900000;
      await this.cleanup(link,link.peerUid,now,epoch);
      const metadata={senderUid:this.identity.uid,sourceHotel:this.runtime.hotel.id,targetHotel:link.peerHotel,revision:project.revision,hash,expiresAt};
      const path=link.linkId+'/'+link.peerUid+'/'+project.id;
      await this.request('','PATCH',{['payloads/'+path]:{...metadata,body},['queues/'+path]:metadata},{},epoch);
      return {sent:true,expiresAt};
    });}
    async removeIndex(path,etag,epoch){
      if(!etag)throw Error('O Firebase não retornou o controle de versão da transferência.');
      return this.request('queues/'+path,'DELETE',undefined,{match:etag},epoch);
    }
    async cleanup(link,uid,now,epoch){
      const prefix=link.linkId+'/'+uid;
      const {value:index}=await this.request('queues/'+prefix,'GET',undefined,{query:{orderBy:'expiresAt',endAt:now,limitToFirst:25}},epoch);
      let expired=0;
      for(const id of Object.keys(index||{})){
        if(!validId(id))continue;
        const path=prefix+'/'+id,entry=await this.request('queues/'+path,'GET',undefined,{etag:true},epoch);
        if(!entry.value||entry.value.expiresAt>now)continue;
        // As regras só permitem esta exclusão sem recibo quando o payload ainda está expirado.
        try{await this.request('payloads/'+path,'DELETE',undefined,{},epoch);await this.removeIndex(path,entry.etag,epoch);expired++;}
        catch(error){this.guard(epoch);if(!error.message.startsWith('Permissão negada'))throw error;}
      }
      return expired;
    }
    async cleanupReceipts(link,uid,epoch){
      const prefix=link.linkId+'/'+uid;
      const {value:index}=await this.request('receipts/'+prefix,'GET',undefined,{query:{orderBy:'revision',limitToFirst:25}},epoch);
      for(const id of Object.keys(index||{})){
        if(!validId(id))continue;
        const path='receipts/'+prefix+'/'+id,entry=await this.request(path,'GET',undefined,{etag:true},epoch);
        if(entry.etag)await this.request(path,'DELETE',undefined,{match:entry.etag},epoch);
      }
    }
    refresh(){return this.exclusive('refresh',async epoch=>{
      if(!this.state?.linkId)return {received:0,expired:0};
      const link=await this.linked(epoch),now=await this.now(epoch),uid=this.identity.uid;
      await this.cleanupReceipts(link,uid,epoch);
      let expired=await this.cleanup(link,uid,now,epoch);expired+=await this.cleanup(link,link.peerUid,now,epoch);
      const prefix=link.linkId+'/'+uid;
      const {value:index}=await this.request('queues/'+prefix,'GET',undefined,{query:{orderBy:'expiresAt',startAt:now+1,limitToFirst:25}},epoch);
      let received=0;
      for(const id of Object.keys(index||{})){
        this.guard(epoch);if(!validId(id))throw Error('Identificação inválida na fila de projetos.');
        const path=prefix+'/'+id,entry=await this.request('queues/'+path,'GET',undefined,{etag:true},epoch);
        if(!entry.value||entry.value.expiresAt<=Date.now()+this.offset)continue;
        const payload=await this.request('payloads/'+path,'GET',undefined,{etag:true},epoch),value=payload.value;
        if(!value){await this.removeIndex(path,entry.etag,epoch);continue;}
        if(!payload.etag)throw Error('O Firebase não retornou o controle de versão do projeto.');
        if(value.senderUid!==link.peerUid||value.sourceHotel!==link.peerHotel||value.targetHotel!==this.runtime.hotel.id||!Number.isSafeInteger(value.revision)||value.revision<1||typeof value.body!=='string'||new TextEncoder().encode(value.body).length>MAX_BYTES||value.expiresAt<=Date.now()+this.offset)throw Error('Transferência inválida ou expirada. Atualize novamente.');
        if(await digest(value.body)!==value.hash)throw Error('O projeto recebido está incompleto. Solicite um novo envio.');
        this.guard(epoch);
        const source=JSON.parse(value.body);
        if(source.id!==id||source.originHotel!==value.sourceHotel||source.revision!==value.revision||!hotelId(source.originHotel))throw Error('O conteúdo não corresponde à transferência.');
        const changed=await this.runtime.receiveProject(source,link.peerUid,()=>this.guard(epoch));
        if(changed)received++;
        // O recibo autoriza apenas a revisão efetivamente persistida. Um reenvio novo é preservado.
        try{
          const receipt=await this.request('receipts/'+path,'PUT',{revision:value.revision,hash:value.hash},{etag:true},epoch);
          const removed=await this.request('payloads/'+path,'DELETE',undefined,{match:payload.etag},epoch);
          if(!removed.conflict)await this.removeIndex(path,entry.etag,epoch);
          if(receipt.etag)await this.request('receipts/'+path,'DELETE',undefined,{match:receipt.etag},epoch);
        }catch(error){this.guard(epoch);if(!error.message.startsWith('Permissão negada'))throw error;}
      }
      if(Object.keys(index||{}).length===25)this.runtime.emit('notice',{type:'warning',text:'Página de transferências processada. Atualize novamente para conferir outros envios.'});
      return {received,expired};
    });}
  }
  ctx.extendRuntime(class {
    relay(){return this.projectRelay||(this.projectRelay=new Relay(this));}
    projectLinkStatus(){return this.relay().status();}
    createProjectLink(){return this.relay().create();}
    joinProjectLink(code){return this.relay().join(code);}
    checkProjectLink(){return this.relay().check();}
    confirmProjectLink(){return this.relay().confirm();}
    cancelProjectLink(){return this.relay().cancel();}
    disconnectProjectLink(){return this.relay().disconnect();}
    sendProject(name){return this.relay().send(name);}
    refreshProjects(){return this.relay().refresh();}
  }.prototype);
  ctx.parts.add('firebase.js');
})();
