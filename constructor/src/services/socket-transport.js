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
