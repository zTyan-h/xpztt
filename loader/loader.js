// ==UserScript==
// @name         Sang Hub
// @namespace    http://tampermonkey.net/
// @version      1.7.6
// @description  Sang Hub — carregador lógico sem interface
// @author       Sang
// @match        *://*.habblive.in/*
// @match        https://www.habblet.city/*
// @match        https://kivo.vps-kinghost.net/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addElement
// @grant        unsafeWindow
// @connect      sh.hlivescript.workers.dev
// @connect      firestore.googleapis.com
// @connect      identitytoolkit.googleapis.com
// @connect      securetoken.googleapis.com
// @connect      sanghub-ecf46-default-rtdb.firebaseio.com
// @connect      constructor-v1-default-rtdb.firebaseio.com
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// ==/UserScript==

(function () {
  'use strict';

  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const history = pageWindow.history || globalThis.history;

  if (pageWindow.__sh_loaded) return;
  pageWindow.__sh_loaded = true;

  const WORKER = 'https://sh.hlivescript.workers.dev';
  // Configuração pública Web do Constructor; não contém credenciais de sessão.
  const CONSTRUCTOR_FIREBASE_KEY = 'AIzaSyBpzVYZiUSPbHzAfFLvoQxB07t4TzeVjI0';
  const CONSTRUCTOR_RTDB = 'https://constructor-v1-default-rtdb.firebaseio.com';
  // Preencher na cópia de instalação; não publicar credenciais no repositório.
  const ENROLL = 'sh-enroll-7d4f2a91c3b8';
  const TIMEOUT_MS = 12000;
  const REMOTE_SOURCE = 'sang-hub.remote.js';
  const httpError = status => Object.assign(new Error('SH ' + status), { status });

  function usesPrivilegedTransport(url) {
    if (url.origin === WORKER) return true;
    if (!/(?:^|\.)habblet\.city$/i.test(location.hostname)) return false;
    if (url.origin === 'https://sanghub-ecf46-default-rtdb.firebaseio.com') return true;
    if (url.origin === CONSTRUCTOR_RTDB)
      return url.pathname === '/constructor/v1.json' ||
        (url.pathname.startsWith('/constructor/v1/') && url.pathname.endsWith('.json'));
    if (url.origin === 'https://firestore.googleapis.com')
      return url.pathname.startsWith('/v1/projects/sanghub-ecf46/');
    if (url.origin === 'https://identitytoolkit.googleapis.com' && url.pathname === '/v1/accounts:signUp')
      return url.searchParams.get('key') === CONSTRUCTOR_FIREBASE_KEY;
    return (url.origin === 'https://identitytoolkit.googleapis.com' && url.pathname === '/v1/accounts:signInWithCustomToken') ||
      (url.origin === 'https://securetoken.googleapis.com' && url.pathname === '/v1/token');
  }

  function isGameRoute() {
    return location.pathname.startsWith('/bigclient') ||
      (/(?:^|\.)habblet\.city$/i.test(location.hostname) && /^\/hotel(?:\/|$)/.test(location.pathname));
  }

  let currentSession = null;
  let hubLoaded = false;
  function isCurrent(session) {
    return currentSession === session && isGameRoute() && !session.life.signal.aborted;
  }

  function loadSession(session) {
    try {
      session.device = localStorage.getItem('sh_device_id') || '';
      session.token = (localStorage.getItem('sh_token') || '').trim();
    } catch (_) {}
    if (!/^[\w-]{8,128}$/.test(session.device)) {
      session.device = crypto.randomUUID?.() ||
        'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2);
      try { localStorage.setItem('sh_device_id', session.device); } catch (_) {}
    }
  }

  async function privilegedFetch(input, init) {
    const request = new Request(input, init);
    const data = /^(GET|HEAD)$/.test(request.method) ? undefined : new Blob([await request.arrayBuffer()]);
    return new Promise((resolve, reject) => {
      const signal = request.signal;
      if (signal.aborted) { reject(new DOMException('Requisição cancelada', 'AbortError')); return; }
      let handle;
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', abort);
        callback(value);
      };
      const abort = () => {
        finish(reject, new DOMException('Requisição cancelada', 'AbortError'));
        handle?.abort();
      };
      signal.addEventListener('abort', abort, { once: true });
      try {
        handle = GM_xmlhttpRequest({
          url: request.url, method: request.method, data,
          headers: Object.fromEntries(request.headers), responseType: 'arraybuffer',
          timeout: new URL(request.url).origin === WORKER ? (new URL(request.url).pathname === '/constructor/groq' ? 35000 : /^(GET|HEAD)$/.test(request.method) && ['/hub','/manifest','/load'].includes(new URL(request.url).pathname) ? 30000 : TIMEOUT_MS) : TIMEOUT_MS, anonymous: true,
          onload(result) {
            try {
              const headers = new Headers();
              for (const line of (result.responseHeaders || '').split(/\r?\n/)) {
                const separator = line.indexOf(':');
                if (separator > 0) headers.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
              }
              const body = request.method === 'HEAD' || [204, 205, 304].includes(result.status) ? null : result.response;
              const response = new Response(body, { status: result.status, statusText: result.statusText || '', headers });
              Object.defineProperty(response, 'url', { value: result.finalUrl || request.url });
              finish(resolve, response);
            } catch (cause) { finish(reject, cause); }
          },
          onerror: () => finish(reject, new TypeError('Falha no transporte Tampermonkey')),
          ontimeout: () => finish(reject, httpError(408)),
          onabort: () => finish(reject, new DOMException('Requisição cancelada', 'AbortError'))
        });
      } catch (cause) { finish(reject, cause); }
    });
  }

  function installFetch(session) {
    const previousFetch = pageWindow.fetch;
    const baseFetch = previousFetch.bind(pageWindow);
    const sessionFetch = function (input, init) {
      try {
        const url = new URL(typeof input?.url === 'string' ? input.url : String(input), location.href);
        if (isCurrent(session) && session.token && url.origin === WORKER) {
          const headers = new Headers(init?.headers !== undefined ? init.headers : input?.headers);
          headers.set('x-token', session.token);
          init = { ...init, headers };
        }
        if (usesPrivilegedTransport(url) && typeof GM_xmlhttpRequest === 'function') {
          return privilegedFetch(typeof input?.url === 'string' ? input : url.href, init);
        }
      } catch (cause) { return Promise.reject(cause); }
      return baseFetch(input, init);
    };
    session.loaderFetch = sessionFetch;
    pageWindow.fetch = sessionFetch;
    session.restoreFetch = () => {
      if (pageWindow.fetch === sessionFetch) pageWindow.fetch = previousFetch;
    };
  }

  async function request(session, path, init = {}, json = false) {
    if (!isCurrent(session)) throw new DOMException('Rota encerrada', 'AbortError');
    const controller = new AbortController();
    session.requests.add(controller);
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { reject(httpError(408)); controller.abort(); }, path === '/hub' ? 30000 : TIMEOUT_MS);
    });
    try {
      return await Promise.race([
        (async () => {
          const response = await session.loaderFetch(WORKER + path, {
            ...init, cache: 'no-store', signal: controller.signal
          });
          if (!response.ok) throw httpError(response.status);
          return json ? await response.json() : await response.text();
        })(), timeout
      ]);
    } finally {
      clearTimeout(timer);
      session.requests.delete(controller);
    }
  }

  async function register(session) {
    if (!ENROLL || ENROLL === '__SH_ENROLL__') {
      throw Object.assign(httpError(401), { code: 'ENROLL_NOT_CONFIGURED' });
    }
    const data = await request(session, '/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: session.device, ua: navigator.userAgent, enroll: ENROLL })
    }, true);
    if (!isCurrent(session)) return;
    if (typeof data?.token !== 'string' || !data.token.trim() || data.token.length > 4096) throw httpError(502);
    session.token = data.token.trim();
    try { localStorage.setItem('sh_token', session.token); } catch (_) {}
  }

  function executeHub(source) {
    let script;
    const textContent = source + '\n//# sourceURL=' + REMOTE_SOURCE + '\n';
    let failure = null;
    const onError = event => {
      const inlineSyntax = event.error?.name === 'SyntaxError' && event.filename === location.href;
      if (!event.filename?.endsWith(REMOTE_SOURCE) && !inlineSyntax) return;
      failure = { message: event.message, name: event.error?.name, source: REMOTE_SOURCE,
        filename: event.filename, line: event.lineno, column: event.colno };
    };
    pageWindow.addEventListener('error', onError);
    try {
      const parent = document.head || document.documentElement;
      if (typeof GM_addElement === 'function') script = GM_addElement(parent, 'script', { textContent });
      else {
        script = document.createElement('script');
        script.textContent = textContent;
        parent.appendChild(script);
      }
    }
    catch (cause) { failure = { message: cause.message, name: cause.name, source: REMOTE_SOURCE }; }
    finally { script?.remove(); pageWindow.removeEventListener('error', onError); }
    if (failure) {
      pageWindow.__sh_last_hub_error = { phase: 'hub-execution', ...failure };
      console.error('[SH Loader] Falha no código remoto', pageWindow.__sh_last_hub_error);
      const syntax = failure.name === 'SyntaxError' ||
        /SyntaxError|Unexpected token|already been declared/.test(failure.message);
      throw Object.assign(httpError(502), { code: syntax ? 'HUB_SOURCE_INVALID' : 'HUB_EXECUTION_FAILED' });
    }
    delete pageWindow.__sh_last_hub_error;
  }

  async function boot(session) {
    if (!isCurrent(session) || session.busy || hubLoaded) return;
    session.busy = true;
    try {
      if (!session.token) await register(session);
      if (!isCurrent(session)) return;
      let source;
      try { source = await request(session, '/hub'); }
      catch (cause) {
        if (!isCurrent(session)) return;
        if (cause.status !== 401) throw cause;
        await register(session);
        if (!isCurrent(session)) return;
        source = await request(session, '/hub');
      }
      if (!isCurrent(session)) return;
      if (typeof source !== 'string' || !source.trim()) throw httpError(502);
      executeHub(source);
      hubLoaded = true;
      console.info('[SH Loader] Hub carregado.');
    } catch (cause) {
      if (isCurrent(session)) console.warn('[SH Loader] Falha de abertura', {
        status: cause.status || 0, code: cause.code || 'REQUEST_FAILED'
      });
    } finally { session.busy = false; }
  }

  function deactivateRoute() {
    const session = currentSession;
    if (!session) return;
    currentSession = null;
    session.life.abort();
    session.readyObserver?.disconnect();
    for (const controller of session.requests) controller.abort();
    session.requests.clear();
    session.restoreFetch();
  }

// Constructor Groq integration v1
  // Inserir esta função dentro da IIFE do loader. Ver integração em ARCHITECTURE.md.
  function installConstructorGroqBridge(options) {
    'use strict';
    const {pageWindow,session,isCurrent,worker,fetcher,storage}=options;
    const STORE='sh_constructor_groq_v1',available=!!storage&&['get','set','remove'].every(k=>typeof storage[k]==='function');
    let key='',persistent=false,active=null,closed=false,credentialBusy=0,queue=Promise.resolve();
    const valid=value=>typeof value==='string'&&/^gsk_[A-Za-z0-9_-]{16,252}$/.test(value);
    const codes=new Set(['DEVICE_UNAUTHORIZED','INVALID_GROQ_INPUT','GROQ_BUSY','GROQ_RATE_LIMITED','RATE_LIMITED','GROQ_KEY_REJECTED','GROQ_UPSTREAM_REJECTED','GROQ_UPSTREAM_BAD_REQUEST','GROQ_MODEL_UNAVAILABLE','GROQ_SCHEMA_REJECTED','GROQ_CONTEXT_LIMIT','GROQ_OUTPUT_LIMIT','GROQ_INVALID_RESPONSE','GROQ_RESPONSE_TOO_LARGE','GROQ_OUTCOME_UNKNOWN']);
    const check=()=>{if(closed||!isCurrent(session))throw Error('Sessão Groq encerrada.');};
    const ready=(async()=>{
      if(available){const saved=await storage.get(STORE);check();if(saved?.version===1&&valid(saved.apiKey)){key=saved.apiKey;persistent=true;}}
    })().catch(()=>{key='';persistent=false;throw Error('Não foi possível ler a configuração Groq.');});
    // Evita rejeição não observada antes de a interface solicitar ready.
    ready.catch(()=>{});
    const change=(task,removal=false)=>{
      if(!removal&&(active||credentialBusy))return Promise.reject(Error('Groq ocupado.'));credentialBusy++;
      const next=queue.then(async()=>{if(removal)await ready.catch(()=>{});else await ready;check();return task();}).catch(()=>{throw Error('Não foi possível alterar a chave Groq.');}).finally(()=>{credentialBusy--;});
      queue=next.catch(()=>{});return next;
    };
    const bridge=Object.freeze({version:1,ready,
      status:()=>({configured:!!key,persistent,storageAvailable:available,busy:!!active||credentialBusy>0}),
      setKey(value,{persist=false}={}){return change(async()=>{
        if(!valid(value)||typeof persist!=='boolean'||persist&&!available)throw Error('Configuração inválida.');
        if(persist)await storage.set(STORE,{version:1,apiKey:value});else if(available)await storage.remove(STORE);
        check();key=value;persistent=persist;
      });},
      removeKey(){active?.abort();key='';persistent=false;return change(async()=>{if(available)await storage.remove(STORE);check();key='';persistent=false;},true);},
      async generate({body,signal}={}){
        check();if(active||credentialBusy)throw Error('Groq ocupado.');
        const raw=JSON.stringify(body);if(typeof raw!=='string'||new TextEncoder().encode(raw).byteLength>65536)throw Error('Pedido Groq inválido.');
        const controller=new AbortController();active=controller;const abort=()=>controller.abort();
        signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
        let timer,reader,abortListener;
        try{
          const canceled=new Promise((_,reject)=>{abortListener=()=>{reader?.cancel().catch(()=>{});reject(new DOMException('Geração cancelada; resultado pode ser desconhecido.','AbortError'));};controller.signal.addEventListener('abort',abortListener,{once:true});if(controller.signal.aborted)abortListener();});
          await Promise.race([ready,canceled]);check();if(!key)throw Error('Configure a chave Groq.');
          timer=setTimeout(abort,35000);
          const response=await Promise.race([fetcher(worker+'/constructor/groq',{
            method:'POST',headers:{'content-type':'application/json'},cache:'no-store',signal:controller.signal,
            body:JSON.stringify({apiKey:key,body:JSON.parse(raw)})
          }),canceled]);
          if(!response.body)throw Error('Resposta Groq inválida.');
          reader=response.body.getReader();const chunks=[];let size=0;
          for(;;){const part=await Promise.race([reader.read(),canceled]);if(part.done)break;size+=part.value.byteLength;if(size>256*1024){await reader.cancel();throw Error('Resposta Groq excedeu o limite.');}chunks.push(part.value);}
          check();if(controller.signal.aborted)throw new DOMException('Geração cancelada.','AbortError');
          const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
          let data;try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{}
          if(!response.ok){const code=codes.has(data?.error)?data.error:response.status===401?'DEVICE_UNAUTHORIZED':response.status===404?'GROQ_ROUTE_UNAVAILABLE':response.status===429?'GROQ_RATE_LIMITED':'GROQ_RELAY_FAILED';throw Object.assign(Error('Pedido de geração recusado.'),{code,status:response.status});}
          if(!data)throw Error('Resposta Groq inválida.');return data;
        }catch(error){if(error?.name==='AbortError')throw new DOMException('Geração cancelada; resultado pode ser desconhecido.','AbortError');const code=codes.has(error?.code)||['GROQ_ROUTE_UNAVAILABLE','GROQ_RELAY_FAILED'].includes(error?.code)?error.code:'GROQ_RELAY_FAILED';throw Object.assign(Error('Falha no relay Groq. Confira a configuração e tente manualmente.'),{code});}
        finally{clearTimeout(timer);if(reader){try{reader.releaseLock();}catch{}}controller.signal.removeEventListener('abort',abortListener);signal?.removeEventListener('abort',abort);if(active===controller)active=null;}
      }
    });
    pageWindow.__shConstructorGroq=bridge;
    session.life.signal.addEventListener('abort',()=>{closed=true;key='';active?.abort();if(pageWindow.__shConstructorGroq===bridge)delete pageWindow.__shConstructorGroq;},{once:true});
    return bridge;
  }

  function activateRoute() {
    if (currentSession || !isGameRoute()) return;
    const session = { device: '', token: '', busy: false, requests: new Set(), life: new AbortController() };
    currentSession = session;
    loadSession(session);
    installFetch(session);
    installConstructorGroqBridge({pageWindow,session,isCurrent,worker:WORKER,
      fetcher:session.loaderFetch,
      storage:typeof GM_getValue==='function' && typeof GM_setValue==='function' && typeof GM_deleteValue==='function'
        ? {get:key=>GM_getValue(key),set:(key,value)=>GM_setValue(key,value),remove:key=>GM_deleteValue(key)} : null});
    if (hubLoaded) return;
    if (document.documentElement) void boot(session);
    else {
      session.readyObserver = new MutationObserver(() => {
        if (!isCurrent(session) || !document.documentElement) return;
        session.readyObserver.disconnect();
        void boot(session);
      });
      session.readyObserver.observe(document, { childList: true });
    }
  }

  function syncRoute() {
    if (isGameRoute()) activateRoute();
    else deactivateRoute();
  }
  for (const method of ['pushState', 'replaceState']) {
    const originalMethod = history[method];
    history[method] = function (...args) {
      const result = originalMethod.apply(this, args);
      syncRoute();
      return result;
    };
  }
  for (const type of ['popstate', 'hashchange', 'pageshow']) pageWindow.addEventListener(type, syncRoute);
  pageWindow.addEventListener('pagehide', deactivateRoute);
  syncRoute();
})();
