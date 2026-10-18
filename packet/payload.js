// Binary inspection never treats a guessed field as a confirmed schema.
(function () {
    'use strict';
    const ctx = window._analyzerCtx;
    if (!ctx || ctx.Payload) return;
    const types = ['i32','u32','i16','u16','u8','bool','string','bytes'];
    function normalize(hex) {
        if (typeof hex !== 'string' || !/^[\da-f\s]*$/i.test(hex)) throw new Error('HEX inválido.');
        const clean = hex.replace(/\s/g, '').toUpperCase();
        if (clean.length % 2 || clean.length > 131070) throw new Error('HEX ímpar ou maior que 65535 bytes.');
        return clean;
    }
    const bytes = hex => Uint8Array.from(normalize(hex).match(/../g) || [], byte => parseInt(byte,16));
    const hexOf = data => ctx.Codec.bufferToHex(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    function read(hex, offset, type, length) {
        const data = bytes(hex), view = new DataView(data.buffer), at = Number(offset);
        if (!Number.isInteger(at) || at < 0 || !types.includes(type)) throw new Error('Offset ou tipo inválido.');
        let size = ({ i32:4,u32:4,i16:2,u16:2,u8:1,bool:1 })[type];
        if (type === 'string') {
            if (at + 2 > data.length) throw new Error('Prefixo da string fora do payload.');
            size = 2 + view.getUint16(at, false);
        }
        if (type === 'bytes') size = Number(length);
        if (!Number.isInteger(size) || size < 0 || at + size > data.length) throw new Error('Campo ultrapassa o payload.');
        let value;
        if (type === 'string') value = new TextDecoder('utf-8', { fatal:true }).decode(data.slice(at+2, at+size));
        else if (type === 'bytes') value = hexOf(data.slice(at, at+size));
        else if (type === 'bool') { if (data[at] > 1) throw new Error('Booleano deve ser 0 ou 1.'); value = !!data[at]; }
        else value = view[({ i32:'getInt32',u32:'getUint32',i16:'getInt16',u16:'getUint16',u8:'getUint8' })[type]](at, false);
        return { offset:at,size,type,value,hex:hexOf(data.slice(at,at+size)) };
    }
    function encode(type, value) {
        if (type === 'bytes') return bytes(String(value));
        if (type === 'string') {
            const text = new TextEncoder().encode(String(value));
            if (text.length > 65535) throw new Error('String maior que 65535 bytes.');
            const result = new Uint8Array(text.length + 2); new DataView(result.buffer).setUint16(0,text.length,false); result.set(text,2); return result;
        }
        const limits = { i32:[-2147483648,2147483647,4,'setInt32'],u32:[0,4294967295,4,'setUint32'],i16:[-32768,32767,2,'setInt16'],u16:[0,65535,2,'setUint16'],u8:[0,255,1,'setUint8'] };
        if (type === 'bool') {
            if (![true,false,'true','false',0,1,'0','1'].includes(value)) throw new Error('Booleano inválido.');
            return new Uint8Array([value === true || value === 'true' || value === 1 || value === '1' ? 1 : 0]);
        }
        const spec = limits[type], number = Number(value);
        if (!spec || String(value).trim() === '' || !Number.isInteger(number) || number < spec[0] || number > spec[1]) throw new Error('Valor fora dos limites do tipo.');
        const result = new Uint8Array(spec[2]); new DataView(result.buffer)[spec[3]](0,number,false); return result;
    }
    function inspect(packet, dir) {
        const mapped = ctx.Catalog.get(packet.header,dir)?.fields || [], fields = [], missing = [];
        for (const field of mapped) {
            try { fields.push({ ...read(packet.payloadHex,field.offset,field.type,field.length), name:field.name,status:'confirmed',evidence:'Mapeamento confirmado pelo usuário.' }); }
            catch (e) { missing.push(`${field.name || field.offset}: ${e.message}`); }
        }
        if (!mapped.length) {
            const data = bytes(packet.payloadHex);
            for (let offset=0; offset+4<=data.length && fields.length<32; offset+=4)
                fields.push({ ...read(packet.payloadHex,offset,'i32'),status:'hypothesis',evidence:'Leitura possível de 4 bytes; significado não confirmado.' });
            for (const type of ['string','u16','bool']) {
                try { if (data.length) fields.push({ ...read(packet.payloadHex,0,type),status:'hypothesis',evidence:'Interpretação alternativa no offset 0; não é schema confirmado.' }); } catch (_) {}
            }
            missing.push('Estrutura ainda não mapeada. Confirme tipo e offset antes de editar.');
        }
        return { fields,missing };
    }
    function patch(packet, dir, edits) {
        if (ctx.Catalog.direction(dir) !== 'SEND') throw new Error('IN é somente leitura.');
        if (!Array.isArray(edits) || !edits.length || edits.length>128) throw new Error('Informe os campos a editar.');
        const data = bytes(packet.payloadHex), changes = edits.map(edit => {
            if (!edit.confirmed) throw new Error('Confirme explicitamente o campo e offset.');
            const before = read(packet.payloadHex,edit.offset,edit.type,edit.length);
            if (edit.expectedHex != null && normalize(edit.expectedHex) !== normalize(before.hex)) throw new Error('Os bytes da amostra original mudaram.');
            return { ...before, before:before.value, after:edit.value, replacement:encode(edit.type,edit.value) };
        }).sort((a,b)=>a.offset-b.offset);
        for(let i=1;i<changes.length;i++) if(changes[i].offset<changes[i-1].offset+changes[i-1].size) throw new Error('Campos sobrepostos.');
        let cursor=0; const parts=[];
        for(const change of changes) { parts.push(data.slice(cursor,change.offset),change.replacement); cursor=change.offset+change.size; }
        parts.push(data.slice(cursor)); const result = new Uint8Array(parts.reduce((n,p)=>n+p.length,0));
        let index=0; for(const part of parts) { result.set(part,index); index+=part.length; }
        if(result.length>65535) throw new Error('Payload editado maior que o limite.');
        const hex=hexOf(result), full=ctx.Codec.buildPacket(packet.header,hex);
        return { hex,fullHex:ctx.Codec.bufferToHex(full),before:packet.payloadHex,changes:changes.map(({replacement,...change})=>({...change,afterHex:hexOf(replacement)})) };
    }
    function compare(a,b) {
        const left=a.packet || a,right=b.packet || b;
        if(left.header!==right.header || (a.dir && b.dir && a.dir!==b.dir)) throw new Error('Compare o mesmo ID e direção.');
        const x=bytes(left.payloadHex),y=bytes(right.payloadHex),differences=[];
        for(let i=0;i<Math.max(x.length,y.length);i++) if(x[i]!==y[i]) differences.push({offset:i,before:x[i]==null?'—':x[i].toString(16).padStart(2,'0').toUpperCase(),after:y[i]==null?'—':y[i].toString(16).padStart(2,'0').toUpperCase()});
        return differences;
    }
    ctx.Payload={types,normalize,read,inspect,patch,compare};
    ctx.register(()=>{delete ctx.Payload;});
    window._analyzerPayload={version:'3.1.0'};
    window.dispatchEvent(new CustomEvent('sang:module-loaded',{detail:{id:'pl-payload'}}));
})();
