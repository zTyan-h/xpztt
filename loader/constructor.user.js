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
  const WORKER_URL = ""; // Preencha com a URL HTTPS do seu Worker.
  const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  if (page.__constructorLoader) return;
  // Captura incorporada pelo build: instalada antes de qualquer requisição.
// Transporte do Constructor. Incorporado no userscript por scripts/build-loader.cjs.
// Transporte da página; sessões e consumidores nunca recebem o WebSocket nativo.
function installConstructorSocketTransport(env) {
    'use strict';
    env = env || window;
    const VERSION = 1;
    if (env._constructorSocketTransport?.version === VERSION) return env._constructorSocketTransport;
    const capture = env._constructorSocket;
    const adoptCapture = capture && !capture.version &&
        typeof capture.getActive === 'function' && typeof capture.onConnect === 'function';
    if (env._constructorSocketTransport || (capture && !adoptCapture)) {
        env.console.warn('[Constructor Socket] Captura incompatível encontrada. Recarregue a página para atualizar o transporte.');
        return null;
    }
    const NativeWebSocket = env.WebSocket;
    const hostname = env.location?.hostname || '';
    const game = /(?:^|\.)habblet\.city$/i.test(hostname) ? 'habblet' :
        /(?:^|\.)habblive\.in$/i.test(hostname) ? 'habblive' : 'unknown';
    let captureMethod = adoptCapture ? 'existing' : 'unavailable', prototypeNativeSend;
    const sessions = new Set();
    const observed = new WeakSet();
    const records = new WeakMap();
    const MAX_BYTES = 16 * 1024 * 1024;
    const SEND_IDS = new Set([25, 2761, 150, 3655, 1678, 1755, 6008]);
    const RECEIVE_IDS = new Set([623, 3893, 1362, 2178]);
    let sequence = 0, newest = 0, arrival = 0, active = null;
    function error(code, message) { return Object.assign(new Error(message), { code }); }
    function binary(data) {
        if (data instanceof env.ArrayBuffer) return data;
        if (env.ArrayBuffer.isView(data)) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        return null;
    }
    function copy(data) { const buffer = binary(data); return buffer ? buffer.slice(0) : data; }
    function report(e) { env.console.warn('[Constructor Socket]', e?.message || String(e)); }
    function invoke(callback, value) { try { return callback(value); } catch (e) { report(e); } }
    function hasReceivers() {
        for (const session of sessions) if (session.subs.receive.size || session.messageCount) return true;
        return false;
    }
    function status() {
        const code = active?.ws.readyState ?? -1;
        return { available: !!active, state: ({ 0: 'CONNECTING', 1: 'OPEN', 2: 'CLOSING', 3: 'CLOSED' })[code] || 'not_found',
            stateCode: code, connectionId: active?.id ?? null, url: active?.ws.url || '', game, captureMethod };
    }
    function accepts(ws) {
        if (game !== 'habblet') return true;
        try {
            const url = new env.URL(ws.url);
            return (url.protocol === 'wss:' || url.protocol === 'ws:') &&
                /^(?:game|proxy)\.habblet\.city$/i.test(url.hostname);
        } catch (_) { return false; }
    }
    function publish(name, event) {
        for (const session of [...sessions]) {
            if (session.closed) continue;
            for (const cb of [...session.subs[name]]) {
                if (session.closed || !session.subs[name].has(cb)) continue;
                if (name === 'receive' && cb.after >= event.sequence) continue;
                invoke(cb, Object.freeze({ ...event, ...(event.data !== undefined ? { data: copy(event.data) } : {}) }));
            }
        }
    }
    function dispatch(record, type, data, eventSequence) {
        for (const session of sessions) {
            for (const handle of session.handles.get(record)?.values() || []) {
                if (type === 'message' && !session.messageListeners.get(handle)?.size) continue;
                if (type === 'message' && session.handleArrivals.get(handle) >= eventSequence) continue;
                const event = type === 'message' ? new env.MessageEvent(type, { data: copy(data) }) : new env.Event(type);
                handle.dispatchEvent(event);
            }
        }
    }
    function select(record) {
        if (active === record) return true;
        if (record.id <= newest || record.ws.readyState !== 1) return false;
        const previousId = active?.id ?? null;
        active = record; newest = record.id;
        publish('connection', { type: 'changed', previousId, ...status() });
        // A seleção também pode acontecer num SEND entre duas partes de um IN.
        const initial = record.initial; record.initial = []; record.initialBytes = 0;
        for (const chunk of initial) deliver(record, chunk.data, chunk.sequence);
        return true;
    }
    // Reconhecimento limitado ao envelope e às assinaturas já usadas no Constructor.
    // O buffer parcial pertence ao socket; não há histórico de pacotes do usuário.
    function recognize(record, data, direction) {
        if (active === record) return true;
        if (record.id <= newest) return false;
        // No Habblet o endpoint do jogo identifica o transporte; IDs pertencem aos codecs.
        // Habblive mantém o reconhecimento existente, sem presumir novos endpoints/opcodes.
        if (game === 'habblet') return select(record);
        const buffer = binary(data);
        if (!buffer) return false;
        const key = direction === 'SEND' ? 'outPending' : 'inPending';
        const pending = record[key];
        if (pending.length + buffer.byteLength > MAX_BYTES) { record[key] = new env.Uint8Array(0); return false; }
        const bytes = new env.Uint8Array(pending.length + buffer.byteLength);
        bytes.set(pending); bytes.set(new env.Uint8Array(buffer), pending.length);
        const view = new env.DataView(bytes.buffer), ids = direction === 'SEND' ? SEND_IDS : RECEIVE_IDS;
        let offset = 0, found = false;
        while (offset + 4 <= bytes.length) {
            const length = view.getInt32(offset, false);
            if (length < 2 || length > MAX_BYTES - 4) { record[key] = new env.Uint8Array(0); return false; }
            if (offset + 4 + length > bytes.length) break;
            if (ids.has(view.getUint16(offset + 4, false))) found = true;
            offset += length + 4;
        }
        record[key] = bytes.slice(offset);
        if (!found) return false;
        record.inPending = record.outPending = new env.Uint8Array(0);
        return select(record);
    }
    function received(record, data, eventSequence) {
        if (record.ws.readyState !== 1) return;
        if (active !== record) {
            if (record.id <= newest) { record.initial = []; record.initialBytes = 0; return; }
            const size = binary(data)?.byteLength ?? 0;
            if (!size) return;
            if (record.initialBytes + size > MAX_BYTES || record.initial.length >= 4096) {
                record.initial = []; record.initialBytes = 0; record.inPending = new env.Uint8Array(0);
            }
            record.initial.push({ data: copy(data), sequence: eventSequence }); record.initialBytes += size;
            if (!recognize(record, data, 'RECV')) return;
            return;
        }
        record.initial = []; record.initialBytes = 0;
        deliver(record, data, eventSequence);
    }
    function deliver(record, data, eventSequence) {
        if (active !== record || record.ws.readyState !== 1) return;
        publish('receive', { connectionId: record.id, data, sequence: eventSequence });
        dispatch(record, 'message', data, eventSequence);
    }
    function transmit(record, data, source, strict) {
        // A captura nunca altera os bytes passados ao send nativo.
        try { recognize(record, data, 'SEND'); } catch (e) { report(e); }
        const current = active === record;
        let blocked = false;
        if (current) {
            outer: for (const session of [...sessions]) {
                if (session.closed) continue;
                for (const cb of [...session.subs.before]) {
                    if (session.closed || !session.subs.before.has(cb)) continue;
                    const decision = invoke(cb, Object.freeze({ connectionId: record.id, source, data: copy(data) }));
                    if (decision === false) { blocked = true; break outer; }
                }
            }
        }
        if (blocked) {
            publish('send', { connectionId: record.id, source, data, status: 'blocked' });
            if (strict) throw error('PACKET_BLOCKED', 'O PacketLive bloqueou o envio. Revise os filtros de saída.');
            return;
        }
        // Nenhum catch/retry aqui: uma falha nativa nunca pode reenviar o comando.
        const result = record.nativeSend.call(record.ws, data);
        if (current) publish('send', { connectionId: record.id, source, data, status: 'sent' });
        return result;
    }
    function observe(ws, viaPrototype = false) {
        // Loader pode anunciar a mesma instância em onConnect e getActive.
        if (!ws || typeof ws.send !== 'function' || typeof ws.addEventListener !== 'function' ||
            typeof ws.removeEventListener !== 'function' || typeof ws.readyState !== 'number' ||
            ws.readyState >= 2 || observed.has(ws) || !accepts(ws)) return ws;
        observed.add(ws);
        const record = { ws, id: ++sequence, nativeSend: viaPrototype === true ? prototypeNativeSend : ws.send, chain: null,
            inPending: new env.Uint8Array(0), outPending: new env.Uint8Array(0), initial: [], initialBytes: 0 };
        if (viaPrototype !== true) ws.send = function(data) { return transmit(record, data, 'game', false); };
        const message = event => {
            const eventSequence = ++arrival;
            if ((active === record && !hasReceivers()) || (active !== record && record.id <= newest)) return;
            // Serializar Blob junto das mensagens seguintes, sem mudar binaryType do jogo.
            // ArrayBuffer sem conversão pendente pode ser distribuído diretamente:
            // cada consumidor já recebe sua própria cópia em publish/dispatch.
            const data = event.data;
            if (!(data instanceof env.Blob) && !record.chain) {
                try { received(record, data, eventSequence); } catch (e) { report(e); }
                return;
            }
            // Só a espera assíncrona exige preservar uma cópia dos bytes da chegada.
            const queued = copy(data);
            const tail = (record.chain || Promise.resolve()).then(async () => {
                const value = queued instanceof env.Blob ? await queued.arrayBuffer() : queued;
                received(record, value, eventSequence);
            }).catch(report);
            record.chain = tail;
            tail.then(() => { if (record.chain === tail) record.chain = null; });
        };
        const open = () => { if (active === record) publish('connection', { type: 'open', ...status() }); dispatch(record, 'open'); };
        const close = () => {
            const wasActive = active === record;
            if (wasActive) active = null;
            if (wasActive) publish('connection', { type: 'close', connectionId: record.id, available: false,
                state: 'CLOSED', stateCode: 3, url: ws.url, game, captureMethod });
            dispatch(record, 'close');
            record.initial = []; record.initialBytes = 0;
            record.inPending = record.outPending = new env.Uint8Array(0);
            ws.removeEventListener('message', message); ws.removeEventListener('open', open); ws.removeEventListener('close', close);
            records.delete(ws);
            for (const session of sessions) {
                for (const handle of session.handles.get(record)?.values() || []) {
                    for (const entries of session.messageListeners.get(handle)?.values() || [])
                        for (const entry of [...entries.values()]) entry.remove();
                    session.messageListeners.delete(handle);
                }
                session.handles.delete(record);
            }
        };
        ws.addEventListener('message', message); ws.addEventListener('open', open); ws.addEventListener('close', close);
        records.set(ws, record);
        return ws;
    }
    function replaceProperty(target, key, value) {
        const descriptor = Object.getOwnPropertyDescriptor(target, key);
        try {
            if (Reflect.set(target, key, value) && target[key] === value) return true;
            if (descriptor?.configurable) return Reflect.defineProperty(target, key, {
                value, writable: descriptor.writable ?? true,
                configurable: descriptor.configurable, enumerable: descriptor.enumerable
            });
        } catch (_) { /* Proteção do ambiente: tentar outro método sem interromper o Hub. */ }
        return false;
    }
    // Proxy mantém new obrigatório, subclassing, constantes e instanceof nativos.
    if (!adoptCapture) {
        const constructor = new Proxy(NativeWebSocket, {
            construct(target, args, newTarget) { return observe(Reflect.construct(target, args, newTarget)); }
        });
        if (replaceProperty(env, 'WebSocket', constructor)) captureMethod = 'constructor';
        else {
            const prototype = NativeWebSocket.prototype;
            prototypeNativeSend = prototype.send;
            function send(data) {
                // Preservar erros nativos para receptor inválido e ausência de argumento.
                if (!(this instanceof NativeWebSocket) || !arguments.length)
                    return prototypeNativeSend.apply(this, arguments);
                if (!records.has(this)) {
                    try { observe(this, true); } catch (e) { report(e); }
                }
                const record = records.get(this);
                return record ? transmit(record, data, 'game', false) : prototypeNativeSend.apply(this, arguments);
            }
            if (typeof prototypeNativeSend === 'function' && replaceProperty(prototype, 'send', send))
                captureMethod = 'prototype-send';
            else report(error('SOCKET_CAPTURE_UNAVAILABLE', 'Construtor e método send protegidos; captura indisponível.'));
        }
    }
    const core = {
        version: VERSION,
        acquire(owner) {
            const session = { owner, closed: false, handles: new Map(), handleArrivals: new WeakMap(),
                messageListeners: new Map(), messageCount: 0, subs: {
                connection: new Set(), receive: new Set(), send: new Set(), before: new Set()
            }, removers: new Set() };
            sessions.add(session);
            function check() { if (session.closed) throw error('SOCKET_SESSION_CLOSED', 'A sessão de transporte foi encerrada.'); }
            function subscribe(name, cb, options = {}) {
                check(); if (typeof cb !== 'function') throw new TypeError('Callback inválido.');
                if (options.signal?.aborted) return () => {};
                // Cada inscrição tem identidade própria, mesmo com o mesmo callback.
                const listener = value => cb(value);
                listener.after = arrival;
                session.subs[name].add(listener);
                const remove = () => { session.subs[name].delete(listener); session.removers.delete(remove); options.signal?.removeEventListener('abort', remove); };
                session.removers.add(remove); options.signal?.addEventListener('abort', remove, { once: true });
                return remove;
            }
            function handle(record, source = 'module') {
                let handles = session.handles.get(record);
                if (!handles) { handles = new Map(); session.handles.set(record, handles); }
                if (handles.has(source)) return handles.get(source);
                const value = new env.EventTarget();
                session.handleArrivals.set(value, arrival);
                const messages = new Map();
                session.messageListeners.set(value, messages);
                const nativeAdd = env.EventTarget.prototype.addEventListener;
                const nativeRemove = env.EventTarget.prototype.removeEventListener;
                // Só fachadas que realmente assinam message precisam de cópias/eventos.
                // Preservar identidade, capture, once, signal e EventListener objects.
                function addEventListener(type, cb, options) {
                    if (String(type) !== 'message') return nativeAdd.call(value, type, cb, options);
                    if (!cb || session.closed || options?.signal?.aborted) return;
                    const capture = typeof options === 'boolean' ? options : !!options?.capture;
                    const once = !!options?.once, signal = options?.signal;
                    let entries = messages.get(cb);
                    if (entries?.has(capture)) return;
                    const entry = {};
                    entry.remove = () => {
                        if (!entries.delete(capture)) return;
                        if (!entries.size) messages.delete(cb);
                        session.messageCount--; session.removers.delete(entry.remove);
                        signal?.removeEventListener('abort', entry.remove);
                        nativeRemove.call(value, 'message', entry.listener, { capture });
                    };
                    entry.listener = function(event) {
                        if (once) entry.remove();
                        if (typeof cb === 'function') cb.call(value, event);
                        else cb.handleEvent(event);
                    };
                    nativeAdd.call(value, 'message', entry.listener, options);
                    if (!entries) { entries = new Map(); messages.set(cb, entries); }
                    entries.set(capture, entry); session.messageCount++;
                    session.removers.add(entry.remove);
                    signal?.addEventListener('abort', entry.remove, { once: true });
                }
                function removeEventListener(type, cb, options) {
                    if (String(type) !== 'message') return nativeRemove.call(value, type, cb, options);
                    const capture = typeof options === 'boolean' ? options : !!options?.capture;
                    messages.get(cb)?.get(capture)?.remove();
                }
                Object.defineProperties(value, {
                    id: { value: record.id }, url: { get: () => record.ws.url },
                    readyState: { get: () => record.ws.readyState },
                    send: { value: data => api.send(data, { connectionId: record.id, source }) },
                    addEventListener: { value: addEventListener }, removeEventListener: { value: removeEventListener }
                });
                handles.set(source, value); return value;
            }
            const api = {
                version: VERSION,
                getActive(source) { return !session.closed && active ? handle(active, source) : null; },
                getStatus: status,
                send(data, options = {}) {
                    check();
                    if (!active || active.ws.readyState !== 1) throw error('SOCKET_UNAVAILABLE', 'Entre no jogo para conectar.');
                    if (options.connectionId != null && options.connectionId !== active.id)
                        throw error('CONNECTION_CHANGED', 'A conexão mudou. A operação foi interrompida sem reenvio.');
                    return transmit(active, data, options.source || 'module', true);
                },
                onConnection(cb, options) {
                    const remove = subscribe('connection', cb, options);
                    if (!options?.signal?.aborted) invoke(cb, Object.freeze({ type: 'snapshot', ...status() }));
                    return remove;
                },
                onReceive: (cb, options) => subscribe('receive', cb, options),
                onSend: (cb, options) => subscribe('send', cb, options),
                beforeSend: (cb, options) => subscribe('before', cb, options),
                onConnect(cb, options) {
                    return api.onConnection(e => { if (e.available) cb(api.getActive()); }, options);
                },
                onMessage(cb, options) {
                    return api.onReceive(e => cb(new env.MessageEvent('message', { data: e.data }), api.getActive()), options);
                },
                release() {
                    if (session.closed) return;
                    session.closed = true;
                    for (const remove of [...session.removers]) remove();
                    session.handles.clear(); session.messageListeners.clear(); sessions.delete(session);
                }
            };
            return Object.freeze(api);
        }
    };
    env._constructorSocketTransport = Object.freeze(core);
    if (adoptCapture) {
        // O loader continua descobrindo sockets; somente o núcleo gerencia o tráfego.
        // Assinatura pertence à página e sobrevive às sessões do Constructor.
        capture.onConnect(observe);
        observe(capture.getActive());
    }
    return env._constructorSocketTransport;
}

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
    if(!WORKER_URL.trim())throw Error('Constructor: preencha WORKER_URL no userscript e recarregue a página.');
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
