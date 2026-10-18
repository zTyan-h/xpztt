// Packet catalog: local aliases and explicit payload mappings. No network writes.
(function () {
    'use strict';
    const ctx = window._analyzerCtx;
    if (!ctx || ctx.Catalog) return;
    const scope = location.origin + '|' + (ctx.protocolBuild || 'unknown');
    const KEY = 'catalog_v1';
    const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const original = ctx.Names.nome.bind(ctx.Names);
    const direction = value => {
        if (value === 'SEND' || value === 'OUT') return 'SEND';
        if (value === 'RECV' || value === 'IN') return 'RECV';
        throw new Error('Informe a direção IN ou OUT.');
    };
    const idOf = value => {
        if (!/^\d+$/.test(String(value)) || Number(value) > 65535) throw new Error('Opcode inválido.');
        return Number(value);
    };
    function load() {
        const saved = ctx.storage.get(KEY, null);
        return saved?.schema === 1 && saved.entries && typeof saved.entries === 'object' && !Array.isArray(saved.entries)
            ? saved : { schema: 1, entries: {}, history: [] };
    }
    let state = load();
    const keyOf = (id, dir) => JSON.stringify([scope, direction(dir), idOf(id)]);
    function changed() {
        for (const log of ctx.state.logs) {
            const name = ctx.Names.nome(log.packet.header, log.dir) || '';
            log.searchString = `${log.packet.header} ${name} ${log.packet.fullHex || ''} ${log.packet.ascii || ''}`.toLowerCase();
            log.rawText = `${log.dir === 'SEND' ? 'OUT' : 'IN'} ID ${log.packet.header} ${name}\n${log.packet.fullHex || ''}\n${log.packet.ascii || ''}`;
        }
        ctx.bus.emit('catalog:changed');
    }
    function commit(key, after) {
        const next = copy(state), before = next.entries[key] || null;
        const undoId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
        if (after) next.entries[key] = copy(after); else delete next.entries[key];
        next.history = [...(Array.isArray(next.history) ? next.history : []), { undoId, key, before, after: copy(after), at: Date.now() }].slice(-100);
        if (!ctx.storage.set(KEY, next)) throw new Error('Não foi possível salvar o catálogo. Nada foi alterado.');
        state = next; changed(); return { undoId, entry: copy(after) };
    }
    function get(id, dir) { return copy(state.entries[keyOf(id, dir)] || null); }
    function set(value, options = {}) {
        if (!options.confirmed) throw new Error('Confirme a identificação antes de salvar.');
        const id = idOf(value.id), dir = direction(value.dir), key = keyOf(id, dir), previous = get(id, dir);
        const name = String(value.name || '').trim().slice(0, 120);
        if (!name) throw new Error('Informe um nome para o pacote.');
        if (previous?.name && previous.name !== name && !options.replace)
            throw new Error('Confirme explicitamente a substituição do nome existente.');
        return commit(key, {
            ...previous, id, dir, scope, name, description: String(value.description || '').slice(0, 2000),
            evidence: String(value.evidence || '').slice(0, 3000), source: value.source === 'ai-confirmed' ? 'ai-confirmed' : 'user',
            fields: previous?.fields || [], updatedAt: Date.now(), originalName: original(id, dir)
        });
    }
    function setFields(id, dir, fields, options = {}) {
        if (!options.confirmed || !Array.isArray(fields) || fields.length > 128) throw new Error('Confirme os campos mapeados.');
        const normalized = fields.map(field => {
            if (!Number.isInteger(Number(field.offset)) || Number(field.offset) < 0 || Number(field.offset) > 65535 ||
                !['i32','u32','i16','u16','u8','bool','string','bytes'].includes(field.type)) throw new Error('Mapeamento inválido.');
            if (field.type === 'bytes' && (!Number.isInteger(Number(field.length)) || Number(field.length) < 1 || Number(field.length) > 65535)) throw new Error('Informe o tamanho dos bytes.');
            return { offset: Number(field.offset), type: field.type, name: String(field.name || '').slice(0, 100),
                ...(field.type === 'bytes' ? { length: Number(field.length) } : {}), status: 'confirmed' };
        });
        const previous = get(id, dir) || { id: idOf(id), dir: direction(dir), scope, name: '', description: '', evidence: '', source: 'user', originalName: original(id, direction(dir)) };
        return commit(keyOf(id, dir), { ...previous, fields: normalized, updatedAt: Date.now() });
    }
    function list() { return copy(Object.values(state.entries).filter(entry => entry?.scope === scope)); }
    function search(query, options = {}) {
        const terms = String(query || '').toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
        const dir = options.dir ? direction(options.dir) : null;
        const found = [];
        for (const d of ['SEND', 'RECV']) {
            if (dir && dir !== d) continue;
            const names = d === 'SEND' ? ctx.Names.OUT : ctx.Names.IN;
            const ids = new Set([...Object.keys(names), ...list().filter(e => e.dir === d).map(e => String(e.id))]);
            for (const id of ids) {
                const saved = get(id, d), note = ctx.Notebook?.get?.(Number(id));
                const entry = saved || { id: Number(id), dir: d, scope, name: original(Number(id), d), originalName: original(Number(id), d), reference: true, source: 'dictionary-reference', fields: [] };
                const text = `${entry.id} ${entry.name} ${entry.originalName} ${entry.description || ''} ${JSON.stringify(note || '')}`.toLowerCase();
                const score = terms.reduce((n, term) => n + (text.includes(term) ? (String(id) === term ? 8 : 1) : 0), 0);
                if (!terms.length || score) found.push({ ...entry, legacyNotebook: note || null, legacyDirection: 'unknown', score });
            }
        }
        const legacy = ctx.Notebook?.listar?.() || terms.filter(term=>/^\d+$/.test(term)).map(term=>({id:Number(term),...ctx.Notebook?.get?.(Number(term))}));
        for (const note of legacy) {
            if (!Number.isInteger(note.id) || !note.notas && !note.hipoteses) continue;
            const text = `${note.id} ${JSON.stringify(note)}`.toLowerCase();
            const score = terms.reduce((n,term)=>n+(text.includes(term)?(String(note.id)===term?8:1):0),0);
            if ((!terms.length || score) && !found.some(item=>item.id===note.id && item.legacyNotebook))
                found.push({id:note.id,dir:'UNKNOWN',scope,name:'',source:'legacy-notebook',reference:true,fields:[],legacyNotebook:note,legacyDirection:'unknown',score});
        }
        return found.sort((a,b) => b.score - a.score || a.id - b.id).slice(0, Math.max(1, Math.min(50, Number(options.limit) || 20)));
    }
    function undo(undoId) {
        const history = Array.isArray(state.history) ? state.history : [], item = history.find(h => h.undoId === undoId);
        if (!item || history.filter(h => h.key === item.key).at(-1)?.undoId !== undoId || JSON.stringify(state.entries[item.key] || null) !== JSON.stringify(item.after))
            throw new Error('O registro mudou após esta ação. Revise o histórico antes de restaurar.');
        const next = copy(state);
        if (item.before) next.entries[item.key] = item.before; else delete next.entries[item.key];
        next.history = next.history.filter(h => h.undoId !== undoId);
        if (!ctx.storage.set(KEY, next)) throw new Error('Não foi possível restaurar o catálogo.');
        state = next; changed(); return copy(item.before);
    }
    ctx.Names.original = original;
    ctx.Names.nome = (id, dir) => {
        if (id == null || !['SEND','RECV','OUT','IN'].includes(dir)) return original(id, dir);
        return get(id, dir)?.name || original(id, direction(dir));
    };
    ctx.Names.rotulo = (id, dir) => `${direction(dir) === 'SEND' ? 'OUT' : 'IN'}.${ctx.Names.nome(id,dir) || id}`;
    ctx.Catalog = { scope, direction, get, set, list, search, setFields, undo,
        remove: (id, dir) => commit(keyOf(id, dir), null),
        history: (id, dir) => copy((state.history || []).filter(h => h.key === keyOf(id, dir))) };
    ctx.on(window, 'storage', event => { if (event.key === 'hl_pro_' + KEY) { state = load(); changed(); } });
    ctx.register(() => { ctx.Names.nome = original; delete ctx.Names.original; delete ctx.Catalog; });
    window._analyzerCatalog = { version: '3.1.0' };
    window.dispatchEvent(new CustomEvent('sang:module-loaded', { detail: { id: 'pl-catalog' } }));
})();
