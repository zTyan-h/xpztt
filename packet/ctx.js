// packetlive/ctx.js — infra compartilhada. Deve ser o primeiro a carregar.
(function () {
    'use strict';
    if (window._analyzerCtx) return;

    const ctx = {
        version: '3.1.0',
        moduleId: 'packetlive',
        _destroyers: [],
        _listeners: [],
    };

    // ─── STORAGE (definido primeiro: log e outros dependem dele) ──
    const PFX = 'hl_pro_';
    ctx.storage = {
        get(key, fallback) {
            try {
                const raw = localStorage.getItem(PFX + key);
                return raw === null ? fallback : JSON.parse(raw);
            } catch (e) { console.warn('[Analyzer] storage.get', key, e); return fallback; }
        },
        set(key, value) {
            try { localStorage.setItem(PFX + key, JSON.stringify(value)); return true; }
            catch (e) { console.warn('[Analyzer] storage.set', key, e); return false; }
        },
        remove(key) {
            try { localStorage.removeItem(PFX + key); return true; }
            catch (e) { console.warn('[Analyzer] storage.remove', key, e); return false; }
        },
    };

    // ─── LOG (nível filtrável, persistido) ─────────────────
    const P = '[Analyzer]';
    const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
    let _logLevel = ctx.storage.get('log_level', 'info');
    if (!( _logLevel in LOG_LEVELS)) _logLevel = 'info';

    function _shouldLog(level) {
        return (LOG_LEVELS[level] ?? 1) >= (LOG_LEVELS[_logLevel] ?? 1);
    }

    ctx.log = {
        debug: (...a) => { if (_shouldLog('debug')) console.debug(P, ...a); },
        info:  (...a) => { if (_shouldLog('info'))  console.info(P, ...a); },
        warn:  (...a) => { if (_shouldLog('warn'))  console.warn(P, ...a); },
        error: (...a) => { if (_shouldLog('error')) console.error(P, ...a); },
        setLevel(level) {
            if (!(level in LOG_LEVELS)) return _logLevel;
            _logLevel = level;
            ctx.storage.set('log_level', level);
            return _logLevel;
        },
        getLevel() { return _logLevel; },
    };

    // ─── BUS ───────────────────────────────────────────────
    const busMap = new Map();
    ctx.bus = {
        on(evt, cb) {
            const list = busMap.get(evt) ?? [];
            list.push(cb);
            busMap.set(evt, list);
            return () => busMap.set(evt, (busMap.get(evt) ?? []).filter(fn => fn !== cb));
        },
        once(evt, cb) {
            const off = ctx.bus.on(evt, (data) => {
                off();
                try { cb(data); }
                catch (e) { ctx.log.error(`bus.once "${evt}"`, e); }
            });
            return off;
        },
        emit(evt, data) {
            for (const cb of busMap.get(evt) ?? []) {
                try { cb(data); }
                catch (e) { ctx.log.error(`bus "${evt}"`, e); }
            }
        },
        clear() { busMap.clear(); },
    };

    // ─── STATE ─────────────────────────────────────────────
    const defaultProfile = () => ({ name: 'Padrão', packets: [], spamInterval: 300, spamQtd: 1 });
    const profiles = ctx.storage.get('profiles', { default: defaultProfile() });
    const currentProfileId = ctx.storage.get('current_profile', 'default');
    if (!profiles[currentProfileId]) profiles[currentProfileId] = defaultProfile();

    ctx.state = {
        blIds: new Set(ctx.storage.get('bl_ids', [])),
        blPayloads: ctx.storage.get('bl_payloads', []),
        dropIds: new Set(ctx.storage.get('drop_ids', [])),
        dropPayloads: ctx.storage.get('drop_payloads', []),
        profiles,
        currentProfileId,
        globalPacketCount: 0,
        logs: [],
        maxLogs: 2000,
        isPaused: false,
        killSwitchActive: false,
        fontSize: ctx.storage.get('font_size', 13),
        showSend: true,
        showRecv: true,
        dicionario: ctx.storage.get('dicionario', {}),
        stats: {
            totalOut: 0,
            totalIn: 0,
            totalDrop: 0,
            primeiro: Date.now(),
        },
    };

    // ─── UTIL ──────────────────────────────────────────────
    ctx.util = {
        escapeHtml(str) {
            return String(str ?? '').replace(/[&<>"']/g, c => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
            }[c]));
        },
        formatDuration(ms) {
            const s = Math.max(0, Math.floor(ms / 1000));
            const pad = n => String(n).padStart(2, '0');
            return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor((s % 3600) / 60)) + ':' + pad(s % 60);
        },
        formatClock() {
            return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        },
    };

    // ─── LISTENER + DESTROYER REGISTRY ─────────────────────
    ctx.on = (target, type, fn, opts) => {
        target.addEventListener(type, fn, opts);
        const off = () => { try { target.removeEventListener(type, fn, opts); } catch (_) {} };
        ctx._listeners.push(off);
        return off;
    };

    ctx.register = (destroy) => { ctx._destroyers.push(destroy); };

    ctx.shutdown = () => {
        while (ctx._destroyers.length) {
            const fn = ctx._destroyers.pop();
            try { fn(); } catch (e) { ctx.log.warn('shutdown destroyer', e); }
        }
        while (ctx._listeners.length) {
            const fn = ctx._listeners.pop();
            try { fn(); } catch (e) { ctx.log.warn('shutdown listener', e); }
        }
        ctx.bus.clear();
    };

    // ─── TOAST (delega ao hub; fallback pro console) ───────
    ctx.toast = (msg, kind) => {
        try {
            if (window._hubBridge?.ui?.toast) {
                window._hubBridge.ui.toast(msg, kind);
                return;
            }
        } catch (_) {}
        const fn = kind === 'error' ? ctx.log.error
                 : kind === 'warn'  ? ctx.log.warn
                 : ctx.log.info;
        fn(msg);
    };

    // ─── CROSS-TAB: invalidação via evento storage ─────────
    ctx.on(window, 'storage', (e) => {
        if (!e.key) return;
        if (e.key === PFX + 'notebook')         ctx.bus.emit('storage:notebook-changed');
        if (e.key === PFX + 'profiles')         ctx.bus.emit('storage:profiles-changed');
        if (e.key === PFX + 'watchers_regras')  ctx.bus.emit('storage:watchers-changed');
        if (e.key === PFX + 'correlacao_pares') ctx.bus.emit('storage:correlacao-changed');
    });

    window._analyzerCtx = ctx;
    window.dispatchEvent(new CustomEvent('sang:module-loaded', { detail: { id: 'pl-ctx' } }));
})();
