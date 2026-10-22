'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(require('./source-path.cjs')('ui.js'), 'utf8');
function section(start, end) {
  const from = source.indexOf(start), until = source.indexOf(end, from);
  assert.ok(from >= 0 && until > from, 'As funções reais de áudio precisam estar disponíveis para verificação.');
  return source.slice(from, until);
}
const actualAudio = section('  async function unlockAudio(', '  async function sound(')
  + section('  function stopPlacementVoice()', "  function log(text,type='info')");
function harness() {
  const clock = { ms: 0 }, result = { created: 0, voices: [] };
  class AudioStub {
    constructor() { result.created++; this.state = 'running'; this.destination = {}; }
    get currentTime() { return clock.ms / 1000; }
    async resume() { this.state = 'running'; }
    createOscillator() {
      const voice = { frequencies: [], disconnected: 0, ended: false };
      const node = {
        frequency: { setValueAtTime(value) { voice.frequencies.push(value); }, exponentialRampToValueAtTime(value) { voice.frequencies.push(value); } },
        connect() {}, disconnect() { voice.disconnected++; },
        start(at) { voice.started = at; voice.wall = clock.ms; result.voices.push(voice); },
        stop(at) { voice.stopped = at; if (at === undefined) { voice.ended = true; node.onended?.(); } }
      };
      voice.node = node; return node;
    }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  }
  const context = vm.createContext({ window: { AudioContext: AudioStub }, performance: { now: () => clock.ms } });
  vm.runInContext(`
    let disposed=false,audioGesture=false,placementVoice=null,lastPlacementAt=-Infinity,audioNoticeUntil=0,placementGeneration='';
    const placementHeard=new Set(),state={audio:null},pref={sound:true,placementSound:true,volume:.22};
    const runtime={roomEpoch:1,ws:{id:'socket-a',readyState:1}};
    ${actualAudio}
    globalThis.audioCheck={
      unlock:()=>unlockAudio(true), unlockWithoutGesture:()=>unlockAudio(),
      fire:(roomId,extra={})=>placementSound({roomId,epoch:runtime.roomEpoch,connectionId:runtime.ws.id,...extra}),
      pref:(key,value)=>pref[key]=value,
      epoch:value=>runtime.roomEpoch=value,
      socket:(id,state=1)=>runtime.ws={id,readyState:state},
      noticeUntil:value=>audioNoticeUntil=value,
      dispose:()=>{disposed=true;stopPlacementVoice();}, stop:stopPlacementVoice
    };
  `, context, { filename: 'ui.js:audio-functions' });
  return {
    api: context.audioCheck, result,
    at(ms, finish = true) {
      clock.ms = ms;
      if (finish) for (const voice of result.voices) if (!voice.ended && voice.stopped <= ms / 1000) { voice.ended = true; voice.node.onended?.(); }
    }
  };
}
(async () => {
  const blocked = harness();
  await blocked.api.unlockWithoutGesture(); blocked.api.fire(1);
  assert.equal(blocked.result.created, 0, 'Nenhum AudioContext é criado sem gesto.');
  assert.equal(blocked.result.voices.length, 0, 'Colocação antes de gesto não toca nem fica em fila.');

  const rate = harness(); await rate.api.unlock();
  for (const [at, room] of [[0,1],[100,2],[249,3],[250,4],[500,5],[750,6],[999,7]]) { rate.at(at); rate.api.fire(room); }
  assert.equal(rate.result.voices.length, 4, 'Limite de quatro sons no intervalo de um segundo.');
  assert.deepEqual(rate.result.voices.map(voice => voice.wall), [0,250,500,750]);
  for (const voice of rate.result.voices) {
    assert.ok(Math.abs((voice.stopped - voice.started) - .055) < .000001, 'A voz termina em 55 ms.');
    assert.ok(voice.frequencies.every(value => value > 0 && value < 200), 'O toque usa frequências graves.');
  }
  rate.at(2000); assert.equal(rate.result.voices.length, 4, 'Eventos descartados não são enfileirados.');

  const dedup = harness(); await dedup.api.unlock();
  dedup.api.fire(8); dedup.at(300); dedup.api.fire(8);
  assert.equal(dedup.result.voices.length, 1, 'Duplicado da mesma epoch/conexão/roomId não toca novamente.');
  dedup.api.epoch(2); dedup.api.fire(8);
  assert.equal(dedup.result.voices.length, 2, 'O mesmo ID em uma nova epoch tem identidade independente.');
  dedup.at(600); dedup.api.socket('socket-b'); dedup.api.fire(8);
  assert.equal(dedup.result.voices.length, 3, 'O mesmo ID em uma nova conexão tem identidade independente.');

  const stale = harness(); await stale.api.unlock();
  stale.api.fire(9, { epoch: 0 }); stale.api.fire(9, { connectionId: 'old-socket' });
  stale.api.socket('socket-a', 3); stale.api.fire(9);
  assert.equal(stale.result.voices.length, 0, 'Eventos de epoch/socket antigos ou conexão fechada são descartados.');
  stale.api.socket('socket-a'); stale.api.fire(9);
  assert.equal(stale.result.voices.length, 1, 'Evento confiável posterior continua apto.');

  for (const [key, value] of [['sound',false],['placementSound',false],['volume',0]]) {
    const muted = harness(); await muted.api.unlock(); muted.api.pref(key,value); muted.api.fire(10);
    assert.equal(muted.result.voices.length,0, `Respeita preferência ${key}.`);
  }
  const overlap = harness(); await overlap.api.unlock(); overlap.api.fire(20); overlap.at(300,false); overlap.api.fire(21);
  assert.equal(overlap.result.voices.length,1,'Não sobrepõe vozes mesmo com encerramento de áudio atrasado.');
  overlap.api.stop(); overlap.at(600); overlap.api.noticeUntil(2); overlap.api.fire(22);
  assert.equal(overlap.result.voices.length,1,'Não sobrepõe o toque aos sons de aviso.');
  overlap.api.dispose(); overlap.at(3000); overlap.api.fire(23);
  assert.equal(overlap.result.voices.length,1,'Instância descartada não agenda novos sons.');
  assert.ok(overlap.result.voices[0].disconnected>0,'A voz é desconectada no descarte.');
  console.log('UI polish: funções reais verificadas — bloqueio por gesto, 55 ms, 250 ms, dedup, epoch/socket, preferências e descarte.');
})().catch(error => { console.error(error); process.exitCode = 1; });

// Exercita o handler real de copiar, incluindo o fallback anterior por data.
const copyStart=source.indexOf("  $('copy-open').onclick=$('copy-mobile').onclick=()=>{");
const copyHandler=source.slice(copyStart,source.indexOf('  function motion(',copyStart));
function copyFixture({name='',room=null,existing={}}={}){
  const nodes={'capture-name':{value:name},capture:{click(){nodes.captures++;}},'copy-open':{},'copy-mobile':{},captures:0};
  const runtime={ws:{id:7,readyState:1},roomEpoch:3,currentRoomInfo:()=>room,projects:()=>existing};
  const context=vm.createContext({$:id=>nodes[id],runtime,captureSuggestion:'',state:{copyWaiting:false,loading:false},disposed:false,originalProjectHotel:()=>true,supports:()=>true,closeProjectMenu(){}});
  vm.runInContext(copyHandler,context);nodes['copy-open'].onclick();return nodes;
}
assert.equal(copyFixture({room:{name:'Nome do quarto',epoch:3,connectionId:7}})['capture-name'].value,'Nome do quarto');
assert.equal(copyFixture({name:'Meu nome',room:{name:'Outro nome',epoch:3,connectionId:7}})['capture-name'].value,'Meu nome');
const fallback=copyFixture({room:{name:'Nome antigo',epoch:2,connectionId:7}});assert.match(fallback['capture-name'].value,/^Quarto /);assert.equal(fallback.captures,1);
assert.equal(copyFixture({name:'Repetido',existing:{Repetido:{}}})['capture-name'].value,'Repetido (2)');

const roomName={name:'Primeiro',epoch:3,connectionId:7},consecutive=copyFixture({room:roomName});roomName.name='Segundo';consecutive['copy-open'].onclick();assert.equal(consecutive['capture-name'].value,'Segundo');
