'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const SOURCE=fs.readFileSync(path.join(__dirname,'../worker/worker.js'),'utf8').replace('export default {','module.exports = {');
const LINK='a'.repeat(32),UID='receiver_1',PROJECT='project_1',TOKEN='test-user-id-token';
function setup(options={}){
  const calls=[],assets=[];
  const context=vm.createContext({module:{exports:{}},Request,Response,Headers,URL,URLSearchParams,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout,fetch:async(url,init)=>{calls.push({url:String(url),init});return options.fetch?options.fetch(url,init):Response.json({ok:true},{headers:{ETag:'"etag-1"'}});}});
  vm.runInContext(SOURCE,context,{filename:'worker.js'});
  const env={FIREBASE_PROJECT_ID:'test-project',FIREBASE_API_KEY:'test-public-api-key',FIREBASE_DATABASE_URL:'https://test-project-default-rtdb.firebaseio.com',ASSETS:{fetch:async request=>{assets.push(request.url);return options.asset?options.asset(request):new Response('asset bytes');}},...options.env};
  const request=(relative,init={})=>context.module.exports.fetch(new Request('https://constructor.example'+relative,init),env);
  const rtdb=(suffix,init={},query='')=>request('/firebase/rtdb/constructor/v1'+suffix+'.json?auth='+TOKEN+query,init);
  return {calls,assets,request,rtdb};
}
const post=value=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
const patch=value=>({method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});

test('Configuração pública vazia desabilita somente relay',async()=>{
  const {request,calls,assets}=setup({env:{FIREBASE_PROJECT_ID:'',FIREBASE_API_KEY:'',FIREBASE_DATABASE_URL:''}});
  const config=await (await request('/config')).json();assert.equal(config.enabled,false);assert.equal(config.firebase.projectId,'');
  assert.equal((await request('/shell.js')).status,200);assert.equal(assets[0],'https://constructor.example/src/shell.js');
  assert.equal((await request('/firebase/auth/signup',post({returnSecureToken:true}))).status,503);assert.equal(calls.length,0);
});

test('Somente allowlist pública é servida, sem bypass por caminho interno ou URL',async()=>{
  const {request,assets}=setup();
  for(const file of ['src/core/core.js','furnis/habblive.json','assets/fonts/constructor/body.ttf'])assert.equal((await request('/load?p='+file+'&v=1')).status,200);
  for(const value of ['worker/worker.js','firebase/database.rules.json','src/../worker/worker.js','https://evil.example/x','src%2Fcore%2Funknown.js'])assert.equal((await request('/load?p='+value)).status,404);
  for(const route of ['/src/shell.js','/worker.js','/public/src/shell.js','/load?p=src/core/core.js&p=src/ui/ui.js'])assert.notEqual((await request(route)).status,200);
  assert.equal(assets.length,3);assert.equal((await request('/shell.js',{method:'POST'})).status,405);
});

test('CORS aceita apenas hotéis HTTPS, expõe ETag e permite GM sem Origin',async()=>{
  const {request}=setup();
  for(const origin of ['https://habblive.in','https://www.habblet.city','https://a.b.habblive.in']){
    const response=await request('/config',{headers:{Origin:origin}});assert.equal(response.status,200);assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);assert.equal(response.headers.get('Access-Control-Allow-Credentials'),null);
  }
  for(const origin of ['null','http://habblive.in','https://habblive.in.evil.example','https://habblet.city:8443','https://evil.example'])assert.equal((await request('/config',{headers:{Origin:origin}})).status,403);
  assert.equal((await request('/config')).status,200);
  const preflight=await request('/firebase/auth/signup',{method:'OPTIONS',headers:{Origin:'https://habblet.city','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});assert.equal(preflight.status,204);
  assert.equal((await request('/config',{method:'OPTIONS',headers:{'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization'}})).status,403);
});

test('Auth encaminha só signup Anônimo e refresh para destinos fixos',async()=>{
  const {request,calls}=setup();
  assert.equal((await request('/firebase/auth/signup',post({returnSecureToken:true}))).status,200);
  assert.equal((await request('/firebase/auth/signup',post({returnSecureToken:true,email:'x@y.example'}))).status,400);
  assert.equal((await request('/firebase/auth/signup?url=https://evil.example',post({returnSecureToken:true}))).status,400);
  assert.equal((await request('/firebase/auth/refresh',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=refresh_token&refresh_token=refresh-one'})).status,200);
  assert.match(calls[0].url,/^https:\/\/identitytoolkit.googleapis.com\/v1\/accounts:signUp\?key=test-public-api-key$/);assert.match(calls[1].url,/^https:\/\/securetoken.googleapis.com\/v1\/token\?/);assert.equal(calls[1].init.redirect,'manual');
});

test('RTDB mantém token, condições, HTTP 412 e remove headers externos',async()=>{
  const {rtdb,calls}=setup({fetch:async()=>Response.json({error:'conflict'},{status:412,headers:{ETag:'"new-version"'}})});
  const response=await rtdb('/payloads/'+LINK+'/'+UID+'/'+PROJECT,{method:'DELETE',headers:{'if-match':'"old-version"',Authorization:'Bearer must-not-forward',Cookie:'private'}});
  assert.equal(response.status,412);assert.equal(response.headers.get('ETag'),'"new-version"');assert.equal(response.headers.get('Cache-Control'),'no-store');
  const call=calls[0];assert.equal(call.url,'https://test-project-default-rtdb.firebaseio.com/constructor/v1/payloads/'+LINK+'/'+UID+'/'+PROJECT+'.json?auth='+TOKEN);
  assert.equal(call.init.headers.get('if-match'),'"old-version"');assert.equal(call.init.headers.get('Authorization'),null);assert.equal(call.init.headers.get('Cookie'),null);
});

test('RTDB bloqueia varreduras, métodos, queries arbitrárias e exige páginas indexadas',async()=>{
  const {request,rtdb,calls}=setup();
  for(const suffix of ['','/queues','/links','/payloads/'+LINK+'/'+UID,'/unknown/'+UID])assert.equal((await rtdb(suffix)).status,400);
  assert.equal((await rtdb('/queues/'+LINK+'/'+UID,{},'&orderBy=%22expiresAt%22&startAt=1&limitToFirst=25')).status,200);
  assert.equal((await rtdb('/receipts/'+LINK+'/'+UID,{},'&orderBy=%22revision%22&limitToFirst=25')).status,200);
  for(const query of ['', '&orderBy=%22expiresAt%22&limitToFirst=26','&orderBy=%22%24key%22&limitToFirst=25','&orderBy=%22expiresAt%22&limitToFirst=25&shallow=true','&orderBy=%22expiresAt%22&limitToFirst=25&startAt=1&endAt=2'])assert.equal((await rtdb('/queues/'+LINK+'/'+UID,{},query)).status,400);
  assert.equal((await request('/firebase/rtdb/other/path.json?auth='+TOKEN)).status,404);
  assert.equal((await request('/firebase/rtdb/constructor/v1/clocks/'+UID+'.json')).status,401);
  assert.equal((await rtdb('/links/'+LINK,{method:'POST'})).status,400);assert.equal(calls.length,2);
});

test('PATCH permite só envio atômico ou revogação do mesmo vínculo',async()=>{
  const {rtdb,calls}=setup(),suffix=LINK+'/'+UID+'/'+PROJECT;
  assert.equal((await rtdb('',patch({['payloads/'+suffix]:{body:'{}'},['queues/'+suffix]:{revision:1}}))).status,200);
  assert.equal((await rtdb('',patch({['links/'+LINK+'/revoked']:true,['payloads/'+LINK]:null,['queues/'+LINK]:null,['receipts/'+LINK]:null,['invites/'+LINK]:null}))).status,200);
  for(const value of [{['links/'+LINK+'/revoked']:true},{['payloads/'+suffix]:{},['queues/'+LINK+'/'+UID+'/different_1']:{}},{'../outside':null},{['payloads/'+suffix]:null,['queues/'+suffix]:null}])assert.equal((await rtdb('',patch(value))).status,400);
  assert.equal(calls.length,2);
});

test('Worker recusa destinos de ambiente inválidos, redirecionamentos e corpos grandes',async()=>{
  for(const databaseURL of ['https://evil.example','http://test.firebaseio.com','https://test.firebaseio.com/path','https://test.firebaseio.com?x=1']){
    const {request,calls}=setup({env:{FIREBASE_DATABASE_URL:databaseURL}});assert.equal((await request('/firebase/auth/signup',post({returnSecureToken:true}))).status,503);assert.equal(calls.length,0);
  }
  const redirect=setup({fetch:async()=>new Response(null,{status:302,headers:{Location:'https://evil.example'}})});assert.equal((await redirect.request('/firebase/auth/signup',post({returnSecureToken:true}))).status,502);
  const incoming=setup();assert.equal((await incoming.request('/firebase/auth/signup',post({returnSecureToken:true,extra:'x'.repeat(4*1024*1024)}))).status,413);assert.equal(incoming.calls.length,0);
  const outgoing=setup({fetch:async()=>new Response('x'.repeat(4*1024*1024+1))});assert.equal((await outgoing.request('/firebase/auth/signup',post({returnSecureToken:true}))).status,413);
  const asset=setup({asset:async()=>new Response('x',{headers:{'Content-Length':String(8*1024*1024+1)}})});assert.equal((await asset.request('/shell.js')).status,413);
  assert.equal((await asset.request('/load?p=furnis/habblet.json')).status,200);
});
