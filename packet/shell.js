// packetlive/shell.js — entry carregado pelo hub
(function () {
    'use strict';

    const UID = '_analyzer';
    const MODULE_ID = 'packetlive';
    const VERSION = '3.1.0';
    const BASE = 'https://sh.hlivescript.workers.dev/load?p=' + encodeURIComponent('modules/packet/');

    try { window[UID]?.kill?.(); } catch (_) {}

    const bridge = window._hubBridge;
    if (!bridge) { console.error('[Analyzer] _hubBridge ausente.'); return; }

    const MODULES = [
        { id: 'pl-ctx',      instanceKey: '_analyzerCtx',     url: BASE + 'ctx.js' },
        { id: 'pl-protocol', instanceKey: '_analyzerProto',   url: BASE + 'protocol.js' },
        { id: 'pl-traffic',  instanceKey: '_analyzerTraffic', url: BASE + 'traffic.js' },
        { id: 'pl-tools',    instanceKey: '_analyzerTools',   url: BASE + 'tools.js' },
        { id: 'pl-catalog',  instanceKey: '_analyzerCatalog', url: BASE + 'catalog.js' },
        { id: 'pl-payload',  instanceKey: '_analyzerPayload', url: BASE + 'payload.js' },
        { id: 'pl-flows',    instanceKey: '_analyzerFlows',   url: BASE + 'flows.js' },
        { id: 'pl-ai',       instanceKey: '_analyzerAI',      url: BASE + 'ai.js' },
        { id: 'pl-assistant', instanceKey: '_analyzerAssistant', url: BASE + 'assistant.js' },
        { id: 'pl-ui',       instanceKey: '_analyzerUI',      url: BASE + 'ui.js' },
    ];

    let loaded = [];
    let stopped = false;
    let ownedCtx = null;
    const initialCtx = window._analyzerCtx;
    const controller = new AbortController();
    const instance = { kill, version: VERSION, modules: MODULES.map(m => m.id) };
    function current() { return !stopped && window[UID] === instance && window._hubBridge === bridge; }
    function check() { if (!current()) throw new DOMException('Analyzer encerrado', 'AbortError'); }

    async function boot() {
        for (const m of MODULES) {
            try {
                check();
                await bridge.loadModule(m, { signal: controller.signal });
                check();
                loaded.push({ mod: m, instance: window[m.instanceKey] });
                if (m.id === 'pl-ctx') ownedCtx = window._analyzerCtx;
            } catch (e) {
                if (current()) {
                    console.error('[Analyzer] falha ao carregar', m.id, e);
                    kill();
                }
                throw e;
            }
        }
        check();
        const ctx = ownedCtx;
        if (!ctx || ctx !== window._analyzerCtx) { kill(); throw new Error('Contexto Analyzer ausente'); }
        ctx.bus.emit('boot:ready');
        ctx.log.info('packetlive pronto — v' + VERSION);
    }

    function kill() {
        if (stopped) return;
        const wasCurrent = window[UID] === instance;
        stopped = true;
        controller.abort();
        const ctx = ownedCtx || (wasCurrent && window._analyzerCtx !== initialCtx ? window._analyzerCtx : null);
        if (ctx?.shutdown) { try { ctx.shutdown(); } catch (e) { console.error(e); } }
        for (const entry of loaded) {
            if (entry.instance && window[entry.mod.instanceKey] === entry.instance) {
                try { delete window[entry.mod.instanceKey]; } catch (_) {}
            }
        }
        loaded = [];
        if (ctx && window._analyzerCtx === ctx) { try { delete window._analyzerCtx; } catch (_) {} }
        if (!wasCurrent) return;
        try {
            window.dispatchEvent(new CustomEvent('sang:module-close', { detail: { id: MODULE_ID } }));
        } catch (_) {}
        if (window[UID] === instance) { try { delete window[UID]; } catch (_) {} }
    }

    window[UID] = instance;
    instance.ready = boot();
    instance.ready.catch(() => {}); // O Hub observa a falha; uso direto não deixa rejection solta.
})();
