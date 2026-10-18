// Declarative flows. Only run() can send, and only after explicit UI action.
(function () {
    'use strict';
    const ctx=window._analyzerCtx;
    if(!ctx || ctx.Flows) return;
    const clone=value=>JSON.parse(JSON.stringify(value));
    const integer=(value,min,max,label)=>{const n=Number(value);if(value==null || String(value).trim()==='' || !Number.isInteger(n)||n<min||n>max)throw new Error(label+' inválido.');return n;};
    const abortError=()=>new DOMException('Fluxo cancelado.','AbortError');
    function validate(flow) {
        if(flow?.schema!==1 || !Array.isArray(flow.steps))throw new Error('Versão de fluxo não suportada.');
        let expanded=0,sendCount=0,estimatedMs=0;
        function steps(items,depth=0,multiplier=1) {
            if(!Array.isArray(items)||!items.length||items.length>200)throw new Error('Fluxo vazio ou com mais de 200 passos.');
            return items.map(item=>{
                if(++expanded>2000)throw new Error('Fluxo excede o limite de passos.');
                if(item.type==='send') {
                    const id=integer(item.id,0,65535,'Opcode'),hex=ctx.Payload.normalize(item.hex);
                    sendCount+=multiplier;
                    if(sendCount>2000)throw new Error('Fluxo excede 2000 envios.');
                    return {...item,type:'send',id,hex};
                }
                if(item.type==='delay'){const ms=integer(item.ms,0,300000,'Delay');estimatedMs+=ms*multiplier;return {...item,type:'delay',ms};}
                if(item.type==='wait'){
                    const timeoutMs=integer(item.timeoutMs??5000,1,300000,'Timeout');
                    estimatedMs+=timeoutMs*multiplier;
                    return {...item,type:'wait',id:integer(item.id,0,65535,'ID IN'),hexPrefix:ctx.Payload.normalize(item.hexPrefix||''),timeoutMs};
                }
                if(item.type==='repeat') {
                    if(depth)throw new Error('Repetições aninhadas não são suportadas.');
                    const count=integer(item.count,1,100,'Repetições');
                    return {type:'repeat',count,steps:steps(item.steps,depth+1,multiplier*count)};
                }
                throw new Error('Tipo de passo desconhecido.');
            });
        }
        const result={...flow,steps:steps(flow.steps)};
        if(!sendCount)throw new Error('O fluxo precisa de pelo menos um envio OUT.');
        return {...result,sendCount,estimatedMs};
    }
    function create(raw,sources,defaultDelay=300) {
        if(!raw?.ready)return {...raw,schema:1,ready:false,steps:[],sources,sendCount:0,estimatedMs:0};
        let requiresConfirmation=false;
        const allSources=new Map(sources.map(s=>[s.source,s]));
        function convert(items,depth=0) {
            if(!Array.isArray(items))throw new Error('Passos inválidos.');
            const converted=[];let lastSend=null,hasPause=false;
            for(const item of items) {
                if(item.type==='repeat'){
                    if(depth)throw new Error('Repetições aninhadas não suportadas.');
                    const nested=convert(item.steps,depth+1);
                    if(lastSend && !hasPause && nested[0]?.type==='send')converted.push({type:'delay',ms:defaultDelay,origin:'default'});
                    if(Number(item.count)>1 && nested.at(-1)?.type==='send')nested.push({type:'delay',ms:defaultDelay,origin:'default'});
                    converted.push({type:'repeat',count:item.count,steps:nested});
                    lastSend=nested.at(-1)?.type==='send'?allSources.get(nested.at(-1).source):null;hasPause=false;continue;
                }
                if(item.type!=='send'){converted.push({...item,...(item.type==='delay'?{origin:'requested'}:{})});if(item.type==='delay'||item.type==='wait')hasPause=true;continue;}
                const sample=allSources.get(item.source);
                if(!sample||sample.dir!=='SEND')throw new Error('Envio sem fonte OUT correspondente.');
                if(item.id!=null && Number(item.id)!==sample.id)throw new Error('O ID não corresponde à fonte.');
                if(lastSend&&!hasPause) {
                    const observed=Number(sample.ts)-Number(lastSend.ts);
                    const ms=Number.isFinite(observed)&&observed>0&&observed<=300000?observed:defaultDelay;
                    converted.push({type:'delay',ms,origin:ms===observed?'observed':'default'});
                }
                let hex=sample.hex,changes=[];
                if(item.edits?.length) {
                    const edits=item.edits.map(edit=>{
                        const mapped=(sample.fields||[]).some(f=>f.status==='confirmed'&&f.offset===Number(edit.offset)&&f.type===edit.type);
                        if(!mapped)requiresConfirmation=true;
                        return {...edit,confirmed:true};
                    });
                    const result=ctx.Payload.patch({header:sample.id,payloadHex:sample.hex},'SEND',edits);hex=result.hex;changes=result.changes;
                }
                if(item.hex && ctx.Payload.normalize(item.hex)!==ctx.Payload.normalize(hex))throw new Error('HEX proposto não corresponde à edição determinística dos campos.');
                converted.push({type:'send',id:sample.id,hex,source:sample.source,sourceHex:sample.hex,changes,origin:sample.origin});
                lastSend=sample;hasPause=false;
            }
            return converted;
        }
        return validate({...raw,schema:1,steps:convert(raw.steps),sources:clone(sources),requiresConfirmation,changesConfirmed:false});
    }
    function toQueue(flow) {
        const result=validate(flow);
        if(!result.ready || result.missing?.length)throw new Error('O fluxo ainda contém dúvidas.');
        if(result.requiresConfirmation&&!result.changesConfirmed)throw new Error('Confirme os campos e offsets propostos antes de adicionar.');
        return [{isFlow:true,version:1,steps:clone(result.steps)}];
    }
    async function run(items,options={}) {
        const ws=options.ws||ctx.Net.getGameWS(),signal=options.signal;
        const check=()=>{if(signal?.aborted)throw abortError();if(ctx.Net.getGameWS()!==ws||ws?.readyState!==1)throw new Error('A conexão mudou. Fluxo interrompido sem reenvio.');};
        let alive=true;const pending=new Set();
        const closed=()=>pending.forEach(cancel=>cancel(new Error('A conexão foi encerrada. Nenhum reenvio foi feito.')));
        ws?.addEventListener?.('close',closed);
        const stop=ctx.bus.on('net:connected',()=>{if(ctx.Net.getGameWS()!==ws)pending.forEach(cancel=>cancel(new Error('A conexão mudou.')));});
        const sleep=ms=>new Promise((resolve,reject)=>{
            let timer;const done=error=>{clearTimeout(timer);pending.delete(done);signal?.removeEventListener('abort',abort);error?reject(error):resolve();};
            const abort=()=>done(abortError());pending.add(done);signal?.addEventListener('abort',abort,{once:true});
            if(signal?.aborted)return abort();timer=setTimeout(()=>done(),ms);
        });
        function waiter(step) {
            let release, timer, settled=false,finish;
            const promise=new Promise((resolve,reject)=>{
                finish=error=>{if(settled)return;settled=true;clearTimeout(timer);release?.();pending.delete(finish);signal?.removeEventListener('abort',abort);error?reject(error):resolve();};
                const abort=()=>finish(abortError());pending.add(finish);signal?.addEventListener('abort',abort,{once:true});
                release=ctx.bus.on('traffic:packet',event=>{
                    if(!alive||event.dir!=='RECV'||event.packet?.header!==step.id)return;
                    try{check();if(ctx.Payload.normalize(event.packet.payloadHex).startsWith(ctx.Payload.normalize(step.hexPrefix||'')))finish();}catch(error){finish(error);}
                });
                if(signal?.aborted)abort();else timer=setTimeout(()=>finish(new Error(`Timeout aguardando IN ${step.id}. Nenhum reenvio foi feito.`)),step.timeoutMs);
            });
            promise.catch(()=>{});return {promise,cancel:()=>finish(abortError())};
        }
        async function execute(steps) {
            for(let index=0;index<steps.length;index++) {
                check();const step=steps[index];options.onStep?.(step,index);
                if(step.type==='repeat'){for(let n=0;n<step.count;n++){check();await execute(step.steps);}continue;}
                if(step.type==='delay'){await sleep(step.ms);continue;}
                if(step.type==='wait'){const wait=waiter(step);await wait.promise;continue;}
                if(step.type!=='send')throw new Error('Passo desconhecido.');
                const following=steps[index+1],wait=following?.type==='wait'?waiter(following):null;
                try {
                    check();ws.send(ctx.Codec.buildPacket(step.id,step.hex));
                    if(wait){options.onStep?.(following,index+1);await wait.promise;index++;}
                }catch(error){wait?.cancel();throw error;}
            }
        }
        try{await execute(validate({schema:1,steps:items}).steps);}
        finally{alive=false;stop();ws?.removeEventListener?.('close',closed);pending.forEach(cancel=>cancel(abortError()));pending.clear();}
    }
    ctx.Flows={validate,create,toQueue,run};
    ctx.register(()=>{delete ctx.Flows;});
    window._analyzerFlows={version:'3.1.0'};
    window.dispatchEvent(new CustomEvent('sang:module-loaded',{detail:{id:'pl-flows'}}));
})();
