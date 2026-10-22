'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),originalLoader=fs.readFileSync(path.join(root,'loader/constructor.user.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({configured=false,failOnce=false}={}){
 class Socket extends EventTarget{
  constructor(url){super();this.url=url;this.readyState=0;this.sent=[];}
  open(){this.readyState=1;this.dispatchEvent(new Event('open'));}
  send(data){this.sent.push(data);}
  receive(data){this.dispatchEvent(new MessageEvent('message',{data}));}
 }
 const events=new EventTarget(),storage=new Map(),calls=[],nodes=new Map(),messages=[];
 const element=()=>({style:{},textContent:'',hidden:false,appendChild(node){if(node.id)nodes.set(node.id,node);},remove(){}});
 const doc={documentElement:element(),head:element(),body:element(),createElement:element};
 const env={WebSocket:Socket,EventTarget,Event,MessageEvent,CustomEvent,ArrayBuffer,DataView,Uint8Array,Blob,AbortController,AbortSignal,DOMException,TextEncoder,TextDecoder,URL,URLSearchParams,Headers,Response,Request,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto,
  location:{hostname:'www.habblet.city',pathname:'/hotel',href:'https://www.habblet.city/hotel'},history:{pushState(){},replaceState(){}},
  document:doc,addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),dispatchEvent:events.dispatchEvent.bind(events),
  console:{info:message=>messages.push(message),warn(){},error(){}},localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}};
 let context,failed=false;
 const globals={...env,window:env,unsafeWindow:env,MutationObserver:class{observe(){}disconnect(){}},GM_registerMenuCommand(){},
  GM_xmlhttpRequest(options){calls.push(options);let aborted=false;queueMicrotask(()=>{
   if(aborted)return;
   if(failOnce&&!failed){failed=true;options.onerror();return;}
   const url=new URL(options.url);let body,type='application/javascript';
   if(url.pathname==='/config'){body=JSON.stringify({enabled:true,firebase:{projectId:'fixture-project',apiKey:'fixture-public-key',databaseURL:'https://fixture.firebaseio.com'}});type='application/json';}
   else if(url.pathname==='/shell.js')body=fs.readFileSync(path.join(root,'src/shell.js'),'utf8');
   else if(url.pathname==='/load'){
    const relative=url.searchParams.get('p');assert.ok(relative&&!relative.includes('..'));
    if(relative.startsWith('furnis/')){body=JSON.stringify({roomitemtypes:{furnitype:[{id:13,classname:'fixture'}]},wallitemtypes:{furnitype:[{id:1,classname:'fixture_wall'}]}});type='application/json';}
    else body=fs.readFileSync(path.join(root,relative),'utf8');
   }else throw Error('Destino inesperado '+url.pathname);
   const bytes=new TextEncoder().encode(body);options.onload({status:200,statusText:'OK',response:bytes.buffer,responseHeaders:'Content-Type: '+type,finalUrl:options.url});
  });return {abort(){aborted=true;options.onabort();}};},
  async GM_addElement(parent,tag,attributes){
   assert.equal(tag,'script');const source=attributes.textContent,name=/sourceURL=constructor-(.+)\.js/.exec(source)?.[1].replace(/^constructor-/,'');
   if(['libs','input','preview','typography','styles','view','ui'].includes(name)){
    env._constructor.parts.add(name+'.js');if(name==='typography')env._constructor.loadFonts=async()=>{};
    if(name==='ui')env._constructor.mount=runtime=>{env.mounted=(env.mounted||0)+1;env._constructor.ui={show(){env.shown=true;},hide(){},dispose(){}};};
   }else vm.runInContext(source,context);
   return element();
  }};
 context=vm.createContext(globals);
 vm.runInContext(configured?originalLoader.replace('const WORKER_URL = ""','const WORKER_URL = "https://constructor.invalid"'):originalLoader,context);
 return {env,context,calls,nodes,messages,executeAgain(){vm.runInContext(configured?originalLoader.replace('const WORKER_URL = ""','const WORKER_URL = "https://constructor.invalid"'):originalLoader,context);}};
}
async function ready(f){for(let n=0;n<80;n++){if(f.env.mounted)return;await tick();}throw Error('Bootstrap não terminou.');}
test('URL vazia não faz rede, informa configuração e captura WebSocket uma única vez',async()=>{
 const f=fixture();await tick();assert.equal(f.calls.length,0);assert.match(f.nodes.get('constructor-loader').textContent,/WORKER_URL/);
 const Constructor=f.env.WebSocket;f.executeAgain();assert.equal(f.env.WebSocket,Constructor);
 const ws=new f.env.WebSocket('wss://game.habblet.city/');ws.open();const packet=new ArrayBuffer(6);new DataView(packet).setInt32(0,2);new DataView(packet).setUint16(4,7777);ws.receive(packet);await tick();assert.equal(f.env._constructorSocketTransport.acquire('test').getStatus().state,'OPEN');
});
test('Loader → shell → runtime real sem Hub, recursos via Worker e reabertura sem duplicar hooks',async()=>{
 const f=fixture({configured:true});await ready(f);assert.equal(f.env._hubBridge,undefined);assert.equal(f.env._constructor.version,'1.0.0');assert.equal(f.env._constructor.runtime.busy,false);
 assert.equal(f.calls.filter(call=>new URL(call.url).pathname==='/load').length,22);assert.ok(f.calls.every(call=>new URL(call.url).origin==='https://constructor.invalid'));
 assert.equal(f.calls.some(call=>new URL(call.url).pathname.startsWith('/firebase/')),false);
 const data=await f.env._constructor.loadFurniture('habblet');assert.equal(data.floor.byId.has(13),true);
 const firstCore=f.env._constructorSocketTransport;f.env._constructor.kill();assert.equal(f.env._constructor,undefined);await f.env.__constructorLoader.open();assert.equal(f.env.mounted,2);assert.equal(f.env._constructorSocketTransport,firstCore);f.env._constructor.kill();
});
test('Transporte privilegiado rejeita destinos externos e cancela requisições da instância',async()=>{
 const f=fixture({configured:true});await ready(f);const bridge=f.env._constructorBridge;
 const before=f.calls.length;await assert.rejects(bridge.request('https://example.org/secret'),/não autorizado/);assert.equal(f.calls.length,before);
 const request=bridge.request('https://constructor.invalid/config');const rejected=assert.rejects(request,/encerrado|abort/i);bridge.release();await rejected;f.env._constructor.kill();
});
test('Falha de inicialização permite tentar novamente sem criar outro hook',async()=>{
 const f=fixture({configured:true,failOnce:true});await tick();assert.match(f.nodes.get('constructor-loader').textContent,/tentar novamente/);const core=f.env._constructorSocketTransport;await f.env.__constructorLoader.open();await ready(f);assert.equal(f.env._constructorSocketTransport,core);f.env._constructor.kill();
});
