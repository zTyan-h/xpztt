// packetlive/traffic.js — hook WebSocket + correlação + notebook + diff.
(function () {
    'use strict';
    const ctx = window._analyzerCtx;
    if (!ctx) return;
    if (ctx.Net) return;

    // ═══════════════════════════════════════════════════════════
    // NOTEBOOK
    // ═══════════════════════════════════════════════════════════
    const Notebook = (() => {
        let cache = null;

        function load() {
            if (cache) return cache;
            cache = ctx.storage.get('notebook', {});
            return cache;
        }
        function save() {
            ctx.storage.set('notebook', cache);
            ctx.bus.emit('notebook:changed');
        }

        function get(id) { return load()[id] ?? null; }

        function update(id, patch) {
            const n = load();
            const base = n[id] || { criado: Date.now(), hipoteses: [], resultados: [], notas: [] };
            base.hipoteses = base.hipoteses || [];
            base.resultados = base.resultados || [];
            base.notas = base.notas || [];
            n[id] = Object.assign(base, patch, { atualizado: Date.now() });
            save();
            return n[id];
        }

        function addHipotese(id, texto) {
            const e = get(id) || {};
            const hipoteses = (e.hipoteses || []).concat([
                { texto, criadaEm: Date.now(), testada: false, resultado: null },
            ]);
            update(id, { hipoteses });
        }

        function addNota(id, texto) {
            const e = get(id) || {};
            const notas = (e.notas || []).concat([{ texto, em: Date.now() }]);
            update(id, { notas });
        }

        function remover(id) { const n = load(); delete n[id]; save(); }

        function listar() {
            const n = load();
            return Object.keys(n)
                .map(id => Object.assign({ id: Number(id) }, n[id]))
                .sort((a, b) => (b.atualizado || 0) - (a.atualizado || 0));
        }

        function exportar() { return JSON.stringify(load(), null, 2); }

        function importar(json) {
            try {
                const dados = JSON.parse(json);
                if (typeof dados !== 'object' || Array.isArray(dados)) return false;
                cache = Object.assign(load(), dados);
                save();
                return true;
            } catch (e) { ctx.log.warn('Notebook.importar', e); return false; }
        }

        function limpar() { cache = {}; save(); }

        // Cross-tab: outra aba alterou → invalida cache
        ctx.bus.on('storage:notebook-changed', () => {
            cache = null;
            ctx.bus.emit('notebook:changed');
        });

        return { get, update, addHipotese, addNota, remover, listar, exportar, importar, limpar };
    })();

    ctx.Notebook = Notebook;

    // ═══════════════════════════════════════════════════════════
    // CORRELATOR
    // ═══════════════════════════════════════════════════════════
    const Correlator = (() => {
        const JANELA_MS = 800;
        const NOISE = new Set([452, 2450, 1312, 1150, 1157, 1706]);

        let pendentes = [];
        let pares = null;
        let envios = null;
        let persistTimer = null;

        function init() {
            if (pares) return;
            pares = ctx.storage.get('correlacao_pares', {});
            envios = ctx.storage.get('correlacao_envios', {});
        }

        function agendarPersist() {
            if (persistTimer) return;
            persistTimer = setTimeout(() => {
                persistTimer = null;
                if (!pares) return;
                ctx.storage.set('correlacao_pares', pares);
                ctx.storage.set('correlacao_envios', envios);
            }, 2000);
        }

        function flush() {
            if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
            if (!pares) return;
            ctx.storage.set('correlacao_pares', pares);
            ctx.storage.set('correlacao_envios', envios);
        }

        function registrarEnvio(packet) {
            init();
            const id = packet.header;
            envios[id] = (envios[id] || 0) + 1;
            pendentes.push({ outId: id, em: Date.now(), consumido: false });
            if (pendentes.length > 100) pendentes.shift();
            agendarPersist();
        }

        function registrarRecebimento(packet) {
            init();
            const agora = Date.now();
            for (let i = 0; i < pendentes.length; i++) {
                const p = pendentes[i];
                if (p.consumido) continue;
                if (agora - p.em > JANELA_MS) continue;
                p.consumido = true;
                const inId = packet.header;
                if (!pares[p.outId]) pares[p.outId] = {};
                pares[p.outId][inId] = (pares[p.outId][inId] || 0) + 1;
                agendarPersist();
                return;
            }
        }

        function respostasDe(outId) {
            init();
            const m = pares[outId] || {};
            return Object.entries(m).map(([inId, count]) => ({
                inId: Number(inId),
                inNome: ctx.Names.nome(Number(inId), 'RECV'),
                count,
            })).sort((a, b) => b.count - a.count);
        }

        function suspeitos() {
            init();
            const lista = [];
            for (const outId in envios) {
                const idNum = Number(outId);
                if (NOISE.has(idNum)) continue;
                const enviados = envios[outId];
                if (enviados < 5) continue;
                const respostas = pares[outId]
                    ? Object.values(pares[outId]).reduce((a, b) => a + b, 0)
                    : 0;
                const taxa = respostas / enviados;
                if (taxa < 0.3) {
                    lista.push({
                        outId: idNum,
                        outNome: ctx.Names.nome(idNum, 'SEND') || '?',
                        enviados, respostas,
                        taxa: Math.round(taxa * 100),
                    });
                }
            }
            return lista.sort((a, b) => a.taxa - b.taxa);
        }

        function limpar() {
            pares = {};
            envios = {};
            pendentes = [];
            flush();
        }

        function snapshot() {
            init();
            return JSON.parse(JSON.stringify(pares || {}));
        }

        // Cross-tab
        ctx.bus.on('storage:correlacao-changed', () => {
            pares = null;
            envios = null;
            init();
        });

        return {
            registrarEnvio, registrarRecebimento, respostasDe,
            suspeitos, limpar, flush, snapshot,
        };
    })();

    ctx.Correlator = Correlator;

    // ═══════════════════════════════════════════════════════════
    // PACKET DIFF
    // ═══════════════════════════════════════════════════════════
    const PacketDiff = {
        comparar(a, b) {
            if (!a || !b) return null;
            const hexA = a.fullHex ? String(a.fullHex).split(' ') : [];
            const hexB = b.fullHex ? String(b.fullHex).split(' ') : [];
            const len = Math.max(hexA.length, hexB.length);
            const bytes = [];
            let diferentes = 0;
            for (let i = 0; i < len; i++) {
                const va = hexA[i] || null;
                const vb = hexB[i] || null;
                const igual = va === vb;
                if (!igual) diferentes++;
                bytes.push({ offset: i, a: va, b: vb, igual });
            }
            return {
                bytes, total: len, diferentes,
                igual: len > 0 && diferentes === 0,
                byteLengthA: hexA.length,
                byteLengthB: hexB.length,
            };
        },
    };

    ctx.PacketDiff = PacketDiff;

    // ═══════════════════════════════════════════════════════════
    // NET
    // ═══════════════════════════════════════════════════════════
    let _active = null;
    const _recentPackets = new Map();
    let _sweepTimer = null;
    const connectCbs = [];
    const messageCbs = [];

    function fastBufferHash(buffer) {
        try {
            const u8 = new Uint8Array(buffer);
            let hash = 0;
            const len = u8.length;
            const step = len <= 256 ? 1 : Math.max(1, Math.floor(len / 64));
            for (let i = 0; i < len; i += step) {
                hash = ((hash << 5) - hash) + u8[i];
                hash |= 0;
            }
            return `${len}_${hash}`;
        } catch (e) { ctx.log.warn('fastBufferHash', e); return 'err'; }
    }

    function agendarSweep() {
        if (_sweepTimer) return;
        _sweepTimer = setTimeout(() => {
            _sweepTimer = null;
            const now = Date.now();
            for (const [k, t] of _recentPackets) {
                if (now - t > 200) _recentPackets.delete(k);
            }
        }, 500);
    }

    function isDuplicate(data) {
        if (!(data instanceof ArrayBuffer)) return false;
        try {
            const key = fastBufferHash(data);
            const now = Date.now();
            if (_recentPackets.has(key) && now - _recentPackets.get(key) < 50) return true;
            _recentPackets.set(key, now);
            agendarSweep();
            return false;
        } catch (e) { ctx.log.warn('isDuplicate', e); return false; }
    }

    function handleTraffic(data, dir, isDropped) {
        if (ctx.state.isPaused) return;
        if (dir === 'RECV' && isDuplicate(data)) return;

        const packet = ctx.Codec.parseData(data);
        if (!packet) return;

        if (dir === 'RECV') {
            try { ctx.Watchers?.avaliar?.(packet, 'RECV'); }
            catch (e) { ctx.log.warn('watchers.avaliar(RECV)', e); }
        }

        try { ctx.Recorder?.capturar?.(packet, dir); }
        catch (e) { ctx.log.warn('recorder.capturar', e); }

        if (!isDropped) {
            try {
                if (dir === 'SEND') Correlator.registrarEnvio(packet);
                else Correlator.registrarRecebimento(packet);
            } catch (e) { ctx.log.warn('correlator', e); }
        }

        // Contadores agregados
        const st = ctx.state.stats;
        if (isDropped) st.totalDrop++;
        else if (dir === 'SEND') st.totalOut++;
        else st.totalIn++;

        ctx.bus.emit('traffic:packet', { packet, dir, dropped: !!isDropped });
    }

    function deveBloquear(packet, dir) {
        try {
            if (ctx.state.killSwitchActive && dir === 'SEND') return true;
            try { if (ctx.Watchers?.avaliar?.(packet, dir)) return true; }
            catch (e) { ctx.log.warn('watchers.avaliar(block)', e); }
            try { if (dir === 'SEND' && ctx.PacketFilter.isNetworkDropped(packet)) return true; }
            catch (e) { ctx.log.warn('isNetworkDropped', e); }
            return false;
        } catch (e) { ctx.log.warn('deveBloquear', e); return false; }
    }

    function wrapSend(ws) {
        if (!ws || ws._analyzerSendWrapped) return;
        ws._analyzerSendWrapped = true;

        const originalSend = ws.send.bind(ws);
        ws._analyzerOriginalSend = originalSend;

        ws.send = function (data) {
            try {
                const buf = ctx.Codec.normalizeToArrayBuffer(data);
                if (!buf) return originalSend(data);
                const packet = ctx.Codec.parseData(buf);
                if (!packet) return originalSend(data);

                if (deveBloquear(packet, 'SEND')) {
                    handleTraffic(buf, 'SEND', true);
                    ctx.bus.emit('traffic:blocked', { packet });
                    return;
                }
                handleTraffic(buf, 'SEND', false);
                return originalSend(buf);
            } catch (e) {
                ctx.log.error('wrapSend (fail-open)', e);
                try { return originalSend(data); }
                catch (e2) { throw e2; }
            }
        };
    }

    function unwrapSend() {
        const ws = _active;
        if (!ws || !ws._analyzerSendWrapped) return;
        try {
            if (ws._analyzerOriginalSend) ws.send = ws._analyzerOriginalSend;
            delete ws._analyzerSendWrapped;
            delete ws._analyzerOriginalSend;
        } catch (e) { ctx.log.warn('unwrapSend', e); }
    }

    async function handleInbound(event) {
        try {
            let data = event.data;
            if (data instanceof Blob) {
                try { data = await data.arrayBuffer(); }
                catch (e) { ctx.log.warn('handleInbound: Blob', e); return; }
            }
            const buf = ctx.Codec.normalizeToArrayBuffer(data);
            if (!buf) return;
            handleTraffic(buf, 'RECV');
        } catch (e) { ctx.log.error('handleInbound', e); }
    }

    // FIX: fallback para window.gameWS se _active estiver defasado
    function getGameWS() {
        return _active || window.gameWS || null;
    }

    function onConnect(cb) {
        connectCbs.push(cb);
        if (_active) { try { cb(_active); } catch (e) { ctx.log.warn('onConnect (imediato)', e); } }
    }

    function onMessage(cb) { messageCbs.push(cb); }

    function install() {
        if (install.active) return true;
        const hub = window._hubSocket;
        if (!hub) { ctx.log.error('window._hubSocket ausente'); return false; }
        install.active = true;
        const stopConnect = hub.onConnect((ws) => {
            if (!install.active) return;
            if (_active && _active !== ws) unwrapSend();
            _active = ws;
            window.gameWS = ws;
            wrapSend(ws);
            fireConnect(ws);
            ctx.bus.emit('net:connected', { ws });
        });

        const stopMessage = hub.onMessage((event, ws) => {
            if (!install.active) return;
            if (ws !== _active) return;
            for (const cb of messageCbs) {
                try { cb(event, ws); }
                catch (e) { ctx.log.error('onMessage handler', e); }
            }
            handleInbound(event);
        });

        ctx.register(() => {
            install.active = false;
            if (typeof stopConnect === 'function') stopConnect();
            if (typeof stopMessage === 'function') stopMessage();
            unwrapSend();
            _active = null;
            _recentPackets.clear();
            connectCbs.length = 0;
            messageCbs.length = 0;
            if (_sweepTimer) { clearTimeout(_sweepTimer); _sweepTimer = null; }
            ctx.bus.emit('net:disconnected');
        });

        return true;
    }

    function fireConnect(ws) {
        for (const cb of connectCbs) {
            try { cb(ws); }
            catch (e) { ctx.log.error('onConnect handler', e); }
        }
    }

    ctx.Net = {
        install, getGameWS, wrapSend, unwrapSend,
        handleInbound, onConnect, onMessage,
        get active() { return _active; },
    };

    if (!ctx.Net.install()) {
        ctx.log.error('traffic: falha ao instalar hook');
    }

    window.dispatchEvent(new CustomEvent('sang:module-loaded', { detail: { id: 'pl-traffic' } }));
})();
