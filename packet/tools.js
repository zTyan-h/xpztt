// packetlive/tools.js — fuzzer, race, recorder, replay, watchers.
(function () {
    'use strict';
    const ctx = window._analyzerCtx;
    if (!ctx) return;
    if (ctx.Tools) return;

    // ═══════════════════════════════════════════════════════════
    // FUZZER
    // ═══════════════════════════════════════════════════════════
    const Fuzzer = (() => {
        let ativo = false;
        let runId = 0;

        function log(msg, tipo) { ctx.bus.emit('fuzzer:log', { msg, tipo }); }

        async function iniciar(cfg) {
            if (ativo) return;
            const wsInicial = ctx.Net.getGameWS();
            if (!wsInicial) { log('Sem conexão WebSocket.', 'erro'); return; }
            if (!Number.isFinite(cfg.id)) { log('ID alvo inválido.', 'erro'); return; }

            ativo = true;
            const myRunId = ++runId;
            const baseLen = cfg.baseLen || 16;
            const base = new ArrayBuffer(6 + baseLen);
            const baseView = new DataView(base);
            baseView.setInt32(0, 2 + baseLen, false);
            baseView.setInt16(4, cfg.id, false);

            log(`Fuzz #${myRunId} — OUT.ID ${cfg.id}, offset ${cfg.offset}, ${cfg.from}..${cfg.to}, delay ${cfg.delay}ms`, 'info');
            const paresAntes = ctx.Correlator.snapshot();

            for (let v = cfg.from; v <= cfg.to; v++) {
                if (!ativo || myRunId !== runId) break;

                // FIX: aborta se o WebSocket trocou durante o fuzz
                if (ctx.Net.getGameWS() !== wsInicial) {
                    log('WebSocket trocou — abortando fuzz.', 'erro');
                    break;
                }

                const buf = base.slice(0);
                new Uint8Array(buf)[6 + cfg.offset] = v & 0xFF;

                try { wsInicial.send(buf); }
                catch (e) { log(`Erro: ${e.message || e}`, 'erro'); break; }

                log(`→ offset[${cfg.offset}] = 0x${v.toString(16).padStart(2, '0').toUpperCase()}`, 'envio');
                await new Promise(r => setTimeout(r, cfg.delay));
            }

            await new Promise(r => setTimeout(r, 500));
            const paresDepois = ctx.Correlator.snapshot();
            const novasRespostas = {};
            for (const outId in paresDepois) {
                const antes = paresAntes[outId] || {};
                for (const inId in paresDepois[outId]) {
                    const d = (paresDepois[outId][inId] || 0) - (antes[inId] || 0);
                    if (d > 0) novasRespostas[inId] = (novasRespostas[inId] || 0) + d;
                }
            }

            const resumo = {
                id: cfg.id, offset: cfg.offset,
                range: `${cfg.from}..${cfg.to}`,
                enviados: cfg.to - cfg.from + 1,
                respostasNovas: novasRespostas,
                momento: Date.now(),
            };

            const totalResp = Object.values(novasRespostas).reduce((a, b) => a + b, 0);
            if (totalResp === 0) {
                log('✓ Nenhuma resposta nova — campo IGNORADO pelo servidor (candidato a exploit)', 'ok');
            } else {
                const nomes = Object.entries(novasRespostas)
                    .map(([inId, n]) => `${ctx.Names.nome(Number(inId), 'RECV') || inId}×${n}`)
                    .join(', ');
                log(`⚠ Servidor respondeu: ${nomes} — campo VALIDADO`, 'aviso');
            }

            ativo = false;
            ctx.bus.emit('fuzzer:done', resumo);
        }

        function parar() { ativo = false; runId++; }

        return { iniciar, parar, get ativo() { return ativo; } };
    })();

    // ═══════════════════════════════════════════════════════════
    // RACE TESTER
    // ═══════════════════════════════════════════════════════════
    const Race = (() => {
        async function enviarSimultaneo(pacotes) {
            const ws = ctx.Net.getGameWS();
            if (!ws) throw new Error('Sem conexão WebSocket.');
            const validos = pacotes.filter(p => Number.isFinite(p.id));
            if (!validos.length) throw new Error('Nenhum pacote válido.');

            const antes = ctx.Correlator.snapshot();
            const enviados = [];

            for (const p of validos) {
                const buf = ctx.Codec.buildPacket(p.id, p.hex || '');
                try {
                    ws.send(buf);
                    enviados.push(p);
                } catch (e) {
                    throw new Error('Falha ao enviar ' + p.id + ': ' + (e.message || e));
                }
            }

            await new Promise(r => setTimeout(r, 800));
            const depois = ctx.Correlator.snapshot();
            const delta = {};
            for (const outId in depois) {
                const a = antes[outId] || {};
                for (const inId in depois[outId]) {
                    const d = (depois[outId][inId] || 0) - (a[inId] || 0);
                    if (d > 0) delta[inId] = (delta[inId] || 0) + d;
                }
            }
            return { enviados, respostas: delta };
        }

        return { enviarSimultaneo };
    })();

    // ═══════════════════════════════════════════════════════════
    // RECORDER
    // ═══════════════════════════════════════════════════════════
    const Recorder = (() => {
        let gravando = false;
        let inicio = 0;
        let eventos = [];
        const LIMITE = 2000;

        function notificar() {
            ctx.bus.emit('recorder:changed', { gravando, total: eventos.length });
        }

        function iniciar() {
            if (gravando) return false;
            gravando = true;
            inicio = Date.now();
            eventos = [];
            notificar();
            return true;
        }

        function parar() {
            if (!gravando) return null;
            gravando = false;
            notificar();
            return { inicio, duracao: Date.now() - inicio, eventos: eventos.slice() };
        }

        function capturar(packet, dir) {
            if (!gravando) return;
            try {
                eventos.push({
                    t: Date.now(),
                    dir,
                    header: packet.header,
                    payloadHex: packet.payloadHex,
                    fullHex: packet.fullHex,
                    byteLength: packet.byteLength,
                });
                if (eventos.length > LIMITE) eventos.shift();
                if (eventos.length % 25 === 0) notificar();
            } catch (e) { ctx.log.warn('Recorder.capturar', e); }
        }

        function limpar() { eventos = []; notificar(); }

        function exportar() {
            return JSON.stringify({
                version: 1,
                inicio,
                duracao: Date.now() - inicio,
                eventos,
            }, null, 2);
        }

        function importar(json) {
            try {
                const d = JSON.parse(json);
                if (!d || !Array.isArray(d.eventos)) return false;
                eventos = d.eventos;
                inicio = d.inicio || Date.now();
                gravando = false;
                notificar();
                return true;
            } catch (e) { ctx.log.warn('Recorder.importar', e); return false; }
        }

        return {
            iniciar, parar, capturar, limpar, exportar, importar,
            get eventos() { return eventos; },
            get gravando() { return gravando; },
            get inicio() { return inicio; },
        };
    })();

    // ═══════════════════════════════════════════════════════════
    // REPLAY
    // ═══════════════════════════════════════════════════════════
    const Replay = (() => {
        let ativo = false;
        let runId = 0;

        function log(msg, tipo) { ctx.bus.emit('replay:log', { msg, tipo }); }

        async function executar(eventos, opts = {}) {
            if (ativo) { log('Já existe replay em andamento.', 'erro'); return; }
            const wsInicial = ctx.Net.getGameWS();
            if (!wsInicial) { log('Sem conexão WebSocket.', 'erro'); return; }

            const outs = eventos.filter(e => e.dir === 'SEND');
            if (!outs.length) { log('Gravação sem pacotes OUT.', 'erro'); return; }

            ativo = true;
            const myRunId = ++runId;
            const speed = opts.speed || 1;
            const mutar = typeof opts.mutar === 'function' ? opts.mutar : null;

            log(`▶ Replay #${myRunId} — ${outs.length} OUTs, speed ${speed}×${mutar ? ', com mutação' : ''}`, 'info');

            for (let i = 0; i < outs.length; i++) {
                if (!ativo || myRunId !== runId) break;

                // FIX: aborta se o WebSocket trocou durante o replay
                if (ctx.Net.getGameWS() !== wsInicial) {
                    log('WebSocket trocou — abortando replay.', 'erro');
                    break;
                }

                const ev = outs[i];
                let header = ev.header;
                let payloadHex = ev.payloadHex;
                let mutated = false;

                if (mutar) {
                    const m = mutar({ header, payloadHex, indice: i });
                    if (m === false) { log(`⊘ #${i + 1} pulado por mutação`, 'aviso'); continue; }
                    if (m && typeof m === 'object') {
                        const novoHeader = Number.isFinite(m.header) ? m.header : header;
                        const novoPayload = typeof m.payloadHex === 'string' ? m.payloadHex : payloadHex;
                        if (novoHeader !== header || novoPayload !== payloadHex) mutated = true;
                        header = novoHeader;
                        payloadHex = novoPayload;
                    }
                }

                const buf = mutated
                    ? ctx.Codec.buildPacket(header, payloadHex)
                    : ctx.Codec.hexToArrayBuffer(ev.fullHex);

                try { wsInicial.send(buf); }
                catch (e) { log(`Erro no #${i + 1}: ${e.message || e}`, 'erro'); break; }

                const nome = ctx.Names.nome(header, 'SEND') || '?';
                log(`➡ #${i + 1} ${nome} (ID ${header})${mutated ? ' [mutado]' : ''}`, 'envio');

                if (i < outs.length - 1) {
                    const delta = (outs[i + 1].t - ev.t) / speed;
                    const espera = Math.max(16, Math.min(5000, delta));
                    await new Promise(r => setTimeout(r, espera));
                }
            }

            await new Promise(r => setTimeout(r, 400));
            ativo = false;
            log('✓ Replay concluído.', 'ok');
            ctx.bus.emit('replay:done', { runId: myRunId });
        }

        function parar() {
            ativo = false;
            runId++;
            log('⏹ Replay interrompido.', 'aviso');
        }

        return { executar, parar, get ativo() { return ativo; } };
    })();

    // ═══════════════════════════════════════════════════════════
    // WATCHERS
    // ═══════════════════════════════════════════════════════════
    const Watchers = (() => {
        let regras = null;
        const lastFire = new Map();

        function init() {
            if (regras) return;
            regras = ctx.storage.get('watchers_regras', []);
        }
        function save() {
            ctx.storage.set('watchers_regras', regras);
            ctx.bus.emit('watchers:changed');
        }

        function listar() { init(); return regras; }

        function adicionar(cfg) {
            init();
            const regra = {
                id: 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                nome: String(cfg.nome || 'Sem nome').slice(0, 60),
                ativo: cfg.ativo !== false,
                dir: cfg.dir || 'ANY',
                headerId: Number.isFinite(cfg.headerId) ? cfg.headerId : null,
                payloadContem: String(cfg.payloadContem || '').trim(),
                asciiContem: String(cfg.asciiContem || '').trim(),
                minBytes: Number.isFinite(cfg.minBytes) ? cfg.minBytes : null,
                maxBytes: Number.isFinite(cfg.maxBytes) ? cfg.maxBytes : null,
                cooldownMs: Number.isFinite(cfg.cooldownMs) ? cfg.cooldownMs : 200,
                acoes: Array.isArray(cfg.acoes) ? cfg.acoes : ['log'],
                notaTexto: String(cfg.notaTexto || '').slice(0, 200),
                disparos: 0,
            };
            regras.push(regra);
            save();
            return regra;
        }

        function remover(id) {
            init();
            const idx = regras.findIndex(r => r.id === id);
            if (idx > -1) { regras.splice(idx, 1); save(); }
        }

        function alternar(id) {
            init();
            const r = regras.find(x => x.id === id);
            if (r) { r.ativo = !r.ativo; save(); }
        }

        function limpar() { init(); regras = []; save(); }

        function match(regra, packet, dir) {
            try {
                if (!regra.ativo) return false;
                if (regra.dir !== 'ANY' && regra.dir !== dir) return false;
                if (Number.isFinite(regra.headerId) && packet.header !== regra.headerId) return false;
                if (regra.minBytes != null && packet.byteLength < regra.minBytes) return false;
                if (regra.maxBytes != null && packet.byteLength > regra.maxBytes) return false;
                if (regra.payloadContem) {
                    const regraHex = String(regra.payloadContem).replace(/\s/g, '').toUpperCase();
                    const pacoteHex = packet.fullHex.replace(/\s/g, '').toUpperCase();
                    if (!pacoteHex.includes(regraHex)) return false;
                }
                if (regra.asciiContem && !(packet.ascii || '').includes(regra.asciiContem)) return false;
                return true;
            } catch (e) { ctx.log.warn('Watchers.match', e); return false; }
        }

        function avaliar(packet, dir) {
            init();
            if (!regras.length) return false;

            let bloquear = false;
            const agora = Date.now();

            for (const regra of regras) {
                if (!match(regra, packet, dir)) continue;

                const last = lastFire.get(regra.id) || 0;
                if (agora - last < regra.cooldownMs) continue;
                lastFire.set(regra.id, agora);

                regra.disparos++;
                executarAcoes(regra, packet, dir);
                if (regra.acoes.includes('bloquear') && dir === 'SEND') bloquear = true;
            }

            return bloquear;
        }

        function executarAcoes(regra, packet, dir) {
            const nome = ctx.Names.nome(packet.header, dir) || '?';
            const linhaBase = `[W:${regra.nome}] ${dir === 'SEND' ? 'OUT' : 'IN'}.${nome} #${packet.header} ${packet.byteLength}b`;

            if (regra.acoes.includes('log')) {
                ctx.bus.emit('watchers:hit', { regra, packet, dir, linha: linhaBase });
            }
            if (regra.acoes.includes('nota')) {
                try {
                    const texto = (regra.notaTexto || 'Regra disparou') + ` — ${packet.payloadHex.slice(0, 60)}`;
                    ctx.Notebook.addNota(packet.header, texto);
                } catch (e) { ctx.log.warn('Watchers.nota', e); }
            }
            if (regra.acoes.includes('notify')) {
                ctx.toast(linhaBase, 'warn');
            }
        }

        // Cross-tab: regras mudaram em outra aba → recarrega
        ctx.bus.on('storage:watchers-changed', () => {
            regras = null;
            ctx.bus.emit('watchers:changed');
        });

        return {
            listar, adicionar, remover, alternar, limpar,
            avaliar,
        };
    })();

    // ─── Exposição ─────────────────────────────────────────
    ctx.Fuzzer = Fuzzer;
    ctx.Race = Race;
    ctx.Recorder = Recorder;
    ctx.Replay = Replay;
    ctx.Watchers = Watchers;
    ctx.Tools = { Fuzzer, Race, Recorder, Replay, Watchers };

    window.dispatchEvent(new CustomEvent('sang:module-loaded', { detail: { id: 'pl-tools' } }));
})();
