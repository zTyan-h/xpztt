// ==UserScript==
// @name         Constructor
// @namespace    https://github.com/zTyan-h/xpztt
// @version      1.0.0
// @description  Constructor standalone para Habblive e Habblet
// @match        https://*.habblive.in/*
// @match        https://*.habblet.city/*
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_addElement
// @grant        GM_registerMenuCommand
// @connect      *
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
  'use strict';
  const WORKER_URL = "[SEU WORKER]"; // Substitua pela URL HTTPS do seu Worker.
  const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  if (page.__constructorLoader) return;
  // Captura incorporada pelo build: instalada antes de qualquer requisição.
/*__TRANSPORT__*/
  const core = installConstructorSocketTransport(page);
  const state = {busy:false, generation:0, bridge:null, control:null, message:'', readyObserver:null};
  page.__constructorLoader = Object.freeze({open:boot,close:()=>page._constructor?.kill?.()});
  function gameRoute(){return /(?:^|\.)habblet\.city$/i.test(page.location.hostname)?/^\/hotel(?:\/|$)/.test(page.location.pathname):page.location.pathname.startsWith('/bigclient');}
  function feedback(message){
    state.message=message;page.console.info('[Constructor]',message);
    const render=()=>{
      state.readyObserver?.disconnect();state.readyObserver=null;
      if(!state.control){
        state.control=document.createElement('button');state.control.type='button';state.control.id='constructor-loader';
        state.control.style.cssText='position:fixed;right:16px;bottom:16px;max-width:360px;padding:12px 16px;background:#18242c;color:white;border:1px solid #f57b43;border-radius:10px;z-index:2147483647;font:13px sans-serif;cursor:pointer';
        state.control.onclick=()=>void boot();document.documentElement.appendChild(state.control);
      }
      state.control.textContent=state.message;state.control.hidden=!gameRoute();
    };
    if(document.documentElement)render();
    else if(!state.readyObserver){state.readyObserver=new MutationObserver(()=>{if(document.documentElement)render();});state.readyObserver.observe(document,{childList:true});}
  }
  function configuredOrigin(){
    if(!WORKER_URL.trim()||WORKER_URL.trim()==='[SEU WORKER]')throw Error('Constructor: substitua [SEU WORKER] pela URL HTTPS do seu Worker e recarregue a página.');
    const url=new URL(WORKER_URL);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('WORKER_URL deve conter somente a origem HTTPS do Worker.');
    return url.origin;
  }
  function platform(baseUrl){
    const life=new AbortController(),socket=core.acquire('constructor-standalone');
    let closed=false;
    const check=()=>{if(closed||life.signal.aborted)throw new DOMException('Constructor encerrado.','AbortError');};
    function endpoint(input){
      const url=new URL(typeof input?.url==='string'?input.url:String(input),baseUrl);
      if(url.origin!==baseUrl||url.username||url.password||url.hash||!(/^\/(?:shell\.js|config|load)$/.test(url.pathname)||url.pathname.startsWith('/firebase/')))throw Error('Destino de rede não autorizado.');
      return url;
    }
    async function request(input,init={}){
      check();const url=endpoint(input),method=String(init.method||input?.method||'GET').toUpperCase();
      if(!['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(method))throw Error('Método não autorizado.');
      const headers=new Headers(init.headers||input?.headers),allowed=new Set(['content-type','x-firebase-etag','if-match']);
      for(const key of headers.keys())if(!allowed.has(key))throw Error('Header não autorizado.');
      const signal=AbortSignal.any([life.signal,...(init.signal?[init.signal]:[])]);
      if(signal.aborted)throw signal.reason;
      if(init.body!=null&&typeof init.body!=='string')throw Error('Corpo de requisição inválido.');
      if(init.body&&new TextEncoder().encode(init.body).length>4*1024*1024)throw Error('Requisição maior que 4 MiB.');
      return new Promise((resolve,reject)=>{
        let handle,settled=false;
        const finish=(fn,value)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);fn(value);};
        const abort=()=>{finish(reject,signal.reason||new DOMException('Requisição cancelada.','AbortError'));handle?.abort();};
        signal.addEventListener('abort',abort,{once:true});
        try{handle=GM_xmlhttpRequest({
          url:url.href,method,headers:Object.fromEntries(headers),data:init.body,responseType:'arraybuffer',anonymous:true,redirect:'error',timeout:30000,
          onload(result){try{
            check();if(result.finalUrl&&endpoint(result.finalUrl).href!==url.href)throw Error('Redirecionamento recusado.');
            if(result.status<100)throw Error('Resposta inválida do Worker.');
            if(result.response?.byteLength>32*1024*1024)throw Error('Resposta maior que 32 MiB.');
            const responseHeaders=new Headers();for(const line of (result.responseHeaders||'').split(/\r?\n/)){const at=line.indexOf(':');if(at>0)responseHeaders.append(line.slice(0,at).trim(),line.slice(at+1).trim());}
            const body=method==='HEAD'||[204,205,304].includes(result.status)?null:result.response;
            finish(resolve,new Response(body,{status:result.status,statusText:result.statusText||'',headers:responseHeaders}));
          }catch(error){finish(reject,error);}},
          onerror:()=>finish(reject,Error('Falha ao acessar o Worker. Confira a URL e a permissão @connect.')),
          ontimeout:()=>finish(reject,Error('O Worker demorou a responder.')),
          onabort:()=>finish(reject,new DOMException('Requisição cancelada.','AbortError'))
        });}catch(error){finish(reject,error);}
      });
    }
    function assetUrl(path){check();const url=new URL('/load',baseUrl);url.searchParams.set('p',path);return url;}
    async function loadModule(module,{signal}={}){
      check();const url=endpoint(module.url);
      if(url.pathname!=='/load'&&url.pathname!=='/shell.js')throw Error('Entrada de código inválida.');
      const response=await request(url,{signal});
      if(!response.ok)throw Error('Não foi possível carregar '+module.id+' (HTTP '+response.status+').');
      if(!/^(?:application|text)\/javascript\b/i.test(response.headers.get('content-type')||''))throw Error('O Worker não retornou JavaScript.');
      const source=await response.text();check();if(signal?.aborted)throw signal.reason;
      if(!source.trim()||source.length>8*1024*1024)throw Error('Código vazio ou maior que 8 MiB.');
      if(!document.documentElement)await new Promise((resolve,reject)=>{
        const observer=new MutationObserver(()=>{if(document.documentElement){cleanup();resolve();}});
        const abort=()=>{cleanup();reject(signal?.reason||life.signal.reason);};
        const cleanup=()=>{observer.disconnect();signal?.removeEventListener('abort',abort);life.signal.removeEventListener('abort',abort);};
        observer.observe(document,{childList:true});signal?.addEventListener('abort',abort,{once:true});life.signal.addEventListener('abort',abort,{once:true});
        if(signal?.aborted||life.signal.aborted)abort();
      });
      check();if(signal?.aborted)throw signal.reason;
      const sourceName='constructor-'+module.id.replace(/[^a-z0-9-]/gi,'')+'.js';let failure=null;
      const onError=event=>{if(event.filename?.endsWith(sourceName)||event.error?.name==='SyntaxError'&&event.filename===page.location.href)failure=Error(event.message);};
      page.addEventListener('error',onError);
      let script;
      try{script=await GM_addElement(document.head||document.documentElement,'script',{textContent:source+'\n//# sourceURL='+sourceName+'\n'});}
      finally{script?.remove();page.removeEventListener('error',onError);}
      if(failure)throw failure;
    }
    return Object.freeze({baseUrl,socket,request,assetUrl,loadModule,toast:feedback,
      release(){if(closed)return;closed=true;life.abort();socket.release();}});
  }
  async function boot(){
    if(!gameRoute())return;
    if(page._constructor?.current?.()){page._constructor.show();return;}
    if(state.busy)return;
    state.busy=true;const generation=++state.generation;
    let bridge;
    try{
      if(!core)throw Error('Captura do WebSocket indisponível. Recarregue a página.');
      bridge=platform(configuredOrigin());state.bridge=bridge;page._constructorBridge=bridge;
      feedback('Carregando Constructor…');
      const shellUrl=new URL('/shell.js',bridge.baseUrl);shellUrl.searchParams.set('v',String(Date.now()));
      await bridge.loadModule({id:'shell',url:shellUrl.href});
      if(generation!==state.generation)return;
      const context=page._constructor;
      if(!context?.ready)throw Error('O shell não inicializou. Confira o Worker e a permissão de scripts do Tampermonkey.');
      await context.ready;
      if(generation!==state.generation)return;
      if(state.control)state.control.hidden=true;
    }catch(error){
      bridge?.release();
      if(generation===state.generation)feedback('Constructor: '+error.message+' Clique para tentar novamente.');
    }finally{if(generation===state.generation)state.busy=false;}
  }
  function syncRoute(){
    if(gameRoute()){void boot();return;}
    state.generation++;state.busy=false;page._constructor?.kill?.();state.bridge?.release();if(state.control)state.control.hidden=true;
  }
  for(const name of ['pushState','replaceState']){
    const original=page.history[name];
    try{page.history[name]=function(...args){const result=original.apply(this,args);syncRoute();return result;};}catch{/* popstate/pageshow continuam disponíveis. */}
  }
  for(const event of ['popstate','hashchange','pageshow'])page.addEventListener(event,syncRoute);
  page.addEventListener('pagehide',()=>{state.generation++;state.busy=false;page._constructor?.kill?.();state.bridge?.release();});
  page.addEventListener('constructor:close',()=>{if(gameRoute())feedback('Constructor encerrado. Clique para abrir.');});
  if(typeof GM_registerMenuCommand==='function'){
    GM_registerMenuCommand('Abrir Constructor',()=>void boot());
    GM_registerMenuCommand('Encerrar Constructor',()=>page._constructor?.kill?.());
  }
  syncRoute();
})();
