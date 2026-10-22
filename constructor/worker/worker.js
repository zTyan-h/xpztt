// Constructor standalone. O Firebase continua autorizando cada operação pelas rules e pelo ID token do usuário.
const MiB=1024*1024,RELAY_LIMIT=4*MiB,ROOT='constructor/v1';
const SOURCE_BASE='https://raw.githubusercontent.com/zTyan-h/xpztt/main/constructor/';
// Configuração pública; variáveis do painel podem substituir estes valores.
const FIREBASE_DEFAULTS={
  FIREBASE_PROJECT_ID:'constructor-v1',
  FIREBASE_API_KEY:'AIzaSyBpzVYZiUSPbHzAfFLvoQxB07t4TzeVjI0',
  FIREBASE_DATABASE_URL:'https://constructor-v1-default-rtdb.firebaseio.com'
};
const SOURCES=new Set([
  'src/shell.js','src/hotels/protocol-habblive.js','src/hotels/protocol-habblet.js','src/hotels/hotels.js','src/hotels/furniture.js',
  'src/core/core.js','src/core/runtime.js','src/services/storage.js','src/services/firebase.js',
  'src/modules/shapes.js','src/modules/catalog.js','src/modules/projects.js','src/modules/conversion.js','src/modules/configurations.js','src/modules/operations.js','src/modules/tasks.js',
  'src/ui/input.js','src/ui/libs.js','src/ui/preview.js','src/ui/typography.js','src/ui/view.js','src/ui/ui.js','src/styles/styles.js',
  'furnis/habblive.json','furnis/habblet.json','assets/fonts/constructor/body.ttf','assets/fonts/constructor/display.ttf'
]);
const code=value=>/^[a-f0-9]{32}$/.test(value||'');
const uid=value=>/^[a-zA-Z0-9_-]{8,128}$/.test(value||'');
const id=value=>/^[a-zA-Z0-9_-]{8,160}$/.test(value||'');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
class Fault extends Error{constructor(status,message){super(message);this.status=status;}}
function fail(status,message){throw new Fault(status,message);}
function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});}
function configuration(env){
  env={...FIREBASE_DEFAULTS,...env};
  const firebase={projectId:String(env.FIREBASE_PROJECT_ID||'').trim(),apiKey:String(env.FIREBASE_API_KEY||'').trim(),databaseURL:String(env.FIREBASE_DATABASE_URL||'').trim()};
  let enabled=false;
  try{
    const url=new URL(firebase.databaseURL);
    enabled=/^[a-z0-9][a-z0-9-]{2,62}$/.test(firebase.projectId)&&/^[a-zA-Z0-9_-]{10,200}$/.test(firebase.apiKey)&&url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!url.search&&!url.hash&&url.pathname==='/'&&/^[a-z0-9-]+(?:\.[a-z0-9-]+)?\.(?:firebaseio\.com|firebasedatabase\.app)$/.test(url.hostname);
    if(enabled)firebase.databaseURL=url.origin;
  }catch{}
  return {firebase,enabled,message:enabled?'':'Configure FIREBASE_PROJECT_ID, FIREBASE_API_KEY e FIREBASE_DATABASE_URL no Worker para vincular e transferir projetos.'};
}
function originAllowed(origin){
  if(!origin)return true;
  try{const url=new URL(origin);return url.origin===origin&&url.protocol==='https:'&&!url.port&&/^(?:[a-z0-9-]+\.)*(?:habblive\.in|habblet\.city)$/.test(url.hostname);}catch{return false;}
}
function cors(response,origin){
  const headers=new Headers(response.headers);
  headers.set('Vary','Origin');headers.set('X-Content-Type-Options','nosniff');
  if(origin){headers.set('Access-Control-Allow-Origin',origin);headers.set('Access-Control-Expose-Headers','ETag');}
  return new Response(response.body,{status:response.status,headers});
}
async function bytes(message,limit){
  const declared=Number(message.headers.get('Content-Length'));
  if(Number.isFinite(declared)&&declared>limit)fail(413,'Conteúdo excede o limite permitido.');
  if(!message.body)return new Uint8Array();
  const reader=message.body.getReader(),parts=[];let size=0;
  try{
    while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();fail(413,'Conteúdo excede o limite permitido.');}parts.push(value);}
  }finally{reader.releaseLock();}
  const result=new Uint8Array(size);let offset=0;for(const part of parts){result.set(part,offset);offset+=part.byteLength;}return result;
}
function uniqueQuery(url,allowed){
  const seen=new Set();for(const [key,value] of url.searchParams){if(!allowed.includes(key)||seen.has(key)||value.length>8192)fail(400,'Parâmetros inválidos.');seen.add(key);}
}
async function asset(request,env,path){
  if(request.method!=='GET')fail(405,'Método não permitido.');
  if(!SOURCES.has(path))fail(404,'Arquivo não permitido.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{
    const source=new URL(path,SOURCE_BASE),version=new URL(request.url).searchParams.get('v');
    if(version)source.searchParams.set('v',version);
    const upstream=env.ASSETS?.fetch
      ?await env.ASSETS.fetch(new Request(new URL('/'+path,request.url),{method:'GET',redirect:'manual',signal:controller.signal}))
      :await fetch(source.href,{method:'GET',redirect:'manual',signal:controller.signal});
    if(upstream.status!==200)fail(upstream.status===404?404:502,'Arquivo indisponível. Confira o caminho e o acesso público ao repositório.');
    const body=await bytes(upstream,path.startsWith('furnis/')?32*MiB:8*MiB);
    const type=path.endsWith('.js')?'application/javascript; charset=utf-8':path.endsWith('.json')?'application/json; charset=utf-8':'font/ttf';
    return new Response(body,{headers:{'Content-Type':type,'Cache-Control':'public, max-age=300'}});
  }catch(error){if(error instanceof Fault)throw error;fail(502,'Não foi possível carregar o arquivo. Tente novamente.');}finally{clearTimeout(timer);}
}
function rtdbPath(path,method){
  if(path===ROOT)return method==='PATCH'?{kind:'root'}:null;
  if(!path.startsWith(ROOT+'/'))return null;
  const [kind,a,b,c,...extra]=path.slice(ROOT.length+1).split('/');
  if(extra.length)return null;
  if(kind==='clocks'&&uid(a)&&b===undefined&&['GET','PUT'].includes(method))return {kind};
  if(['invites','links'].includes(kind)&&code(a)&&b===undefined&&(kind==='invites'?['GET','PUT','DELETE']:['GET','PUT']).includes(method))return {kind};
  if(['queues','receipts'].includes(kind)&&code(a)&&uid(b)&&c===undefined&&method==='GET')return {kind,list:true};
  if(['queues','payloads','receipts'].includes(kind)&&code(a)&&uid(b)&&id(c)&&(kind==='receipts'?['GET','PUT','DELETE']:['GET','DELETE']).includes(method))return {kind};
  return null;
}
function rtdbQuery(url,route,method){
  uniqueQuery(url,['auth','orderBy','startAt','endAt','limitToFirst']);
  const token=url.searchParams.get('auth');
  if(!token||token.length>8192||!/^[-a-zA-Z0-9_.]+$/.test(token))fail(401,'ID token do usuário ausente ou inválido.');
  const query=new URLSearchParams({auth:token});
  const filters=[...url.searchParams.keys()].filter(key=>key!=='auth');
  if(!route.list){if(filters.length)fail(400,'Consulta não permitida para este caminho.');return query;}
  const order=route.kind==='queues'?'expiresAt':'revision';
  if(method!=='GET'||url.searchParams.get('orderBy')!==JSON.stringify(order))fail(400,'Ordenação da fila inválida.');
  const limit=url.searchParams.get('limitToFirst');
  if(!/^(?:[1-9]|1[0-9]|2[0-5])$/.test(limit||''))fail(400,'Consulte páginas de até 25 transferências.');
  if(route.kind==='receipts'&&(url.searchParams.has('startAt')||url.searchParams.has('endAt')))fail(400,'Filtro de recibos inválido.');
  if(url.searchParams.has('startAt')&&url.searchParams.has('endAt'))fail(400,'Use apenas um limite de horário.');
  for(const key of filters){const value=url.searchParams.get(key);if(['startAt','endAt'].includes(key)&&(!/^\d{1,16}$/.test(value)||!Number.isSafeInteger(Number(value))))fail(400,'Horário da fila inválido.');query.set(key,value);}
  return query;
}
function patchValid(value){
  if(!object(value))return false;
  const keys=Object.keys(value);
  if(keys.length===2){
    const payload=keys.find(key=>key.startsWith('payloads/'));
    if(!payload)return false;
    const [kind,link,user,project,...extra]=payload.split('/'),queue='queues/'+[link,user,project].join('/');
    return !extra.length&&code(link)&&uid(user)&&id(project)&&keys.includes(queue)&&object(value[payload])&&object(value[queue]);
  }
  if(keys.length===5){
    const revoke=keys.find(key=>/^links\/[a-f0-9]{32}\/revoked$/.test(key));
    if(!revoke||value[revoke]!==true)return false;
    const link=revoke.split('/')[1];return ['payloads','queues','receipts','invites'].every(kind=>keys.includes(kind+'/'+link)&&value[kind+'/'+link]===null);
  }
  return false;
}
async function forward(url,init){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{
    const response=await fetch(url,{...init,signal:controller.signal,redirect:'manual'});
    if(response.status>=300&&response.status<400)fail(502,'Redirecionamento do Firebase recusado.');
    const body=await bytes(response,RELAY_LIMIT),headers=new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    if(response.headers.has('ETag'))headers.set('ETag',response.headers.get('ETag'));
    return new Response(body,{status:response.status,headers});
  }catch(error){if(error instanceof Fault)throw error;fail(502,'Firebase indisponível. Tente novamente.');}finally{clearTimeout(timer);}
}
async function firebase(request,url,env){
  const config=configuration(env);if(!config.enabled)return json({error:config.message},503);
  if(url.pathname.startsWith('/firebase/auth/')){
    if(request.method!=='POST')fail(405,'Método não permitido.');
    uniqueQuery(url,[]);
    const raw=new TextDecoder().decode(await bytes(request,RELAY_LIMIT));
    if(url.pathname==='/firebase/auth/signup'){
      if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))fail(415,'Envie JSON.');
      let value;try{value=JSON.parse(raw);}catch{fail(400,'JSON inválido.');}
      if(!object(value)||Object.keys(value).length!==1||value.returnSecureToken!==true)fail(400,'Somente autenticação Anônima é permitida.');
      return forward('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key='+encodeURIComponent(config.firebase.apiKey),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
    }
    if(url.pathname==='/firebase/auth/refresh'){
      if(!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))fail(415,'Envie formulário de atualização.');
      const value=new URLSearchParams(raw),token=value.get('refresh_token');
      if([...value].length!==2||value.getAll('grant_type').length!==1||value.getAll('refresh_token').length!==1||value.get('grant_type')!=='refresh_token'||!token||token.length>8192)fail(400,'Atualização de identidade inválida.');
      return forward('https://securetoken.googleapis.com/v1/token?key='+encodeURIComponent(config.firebase.apiKey),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:token}).toString()});
    }
    fail(404,'Endpoint não encontrado.');
  }
  const match=/^\/firebase\/rtdb\/(constructor\/v1(?:\/[a-zA-Z0-9_/-]+)?)\.json$/.exec(url.pathname);
  if(!match)fail(404,'Endpoint não encontrado.');
  const route=rtdbPath(match[1],request.method);if(!route)fail(400,'Caminho ou método Firebase não permitido.');
  const query=rtdbQuery(url,route,request.method),headers=new Headers({'Content-Type':'application/json'});
  const etag=request.headers.get('X-Firebase-ETag'),condition=request.headers.get('if-match');
  if(etag!==null){if(etag!=='true'||request.method==='PATCH')fail(400,'Controle ETag inválido.');headers.set('X-Firebase-ETag','true');}
  if(condition!==null){if(!['PUT','DELETE'].includes(request.method)||condition.length>256||!/^"[^"\r\n]+"$/.test(condition))fail(400,'Condição de versão inválida.');headers.set('if-match',condition);}
  let body;
  if(['PUT','PATCH'].includes(request.method)){
    if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))fail(415,'Envie JSON.');
    body=new TextDecoder().decode(await bytes(request,RELAY_LIMIT));let value;
    try{value=JSON.parse(body);}catch{fail(400,'JSON inválido.');}
    if(route.kind==='root'&&!patchValid(value))fail(400,'Atualização de transferência inválida.');
  }else if(request.body!==null)fail(400,'Este método não aceita corpo.');
  return forward(config.firebase.databaseURL+'/'+match[1]+'.json?'+query,{method:request.method,headers,...(body===undefined?{}:{body})});
}
export default {
  async fetch(request,env){
    const origin=request.headers.get('Origin');
    if(!originAllowed(origin))return json({error:'Origem não permitida.'},403);
    let response;
    try{
      const url=new URL(request.url);
      if(request.method==='OPTIONS'){
        const method=request.headers.get('Access-Control-Request-Method'),headers=(request.headers.get('Access-Control-Request-Headers')||'').toLowerCase().split(',').map(value=>value.trim()).filter(Boolean);
        if(!['GET','POST','PUT','PATCH','DELETE'].includes(method)||headers.some(value=>!['content-type','x-firebase-etag','if-match'].includes(value)))fail(403,'Preflight não permitido.');
        response=new Response(null,{status:204,headers:{'Access-Control-Allow-Methods':'GET, POST, PUT, PATCH, DELETE, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Firebase-ETag, if-match','Access-Control-Max-Age':'600'}});
      }else if(url.pathname==='/shell.js'){
        uniqueQuery(url,['v']);response=await asset(request,env,'src/shell.js');
      }else if(url.pathname==='/load'){
        uniqueQuery(url,['p','v']);response=await asset(request,env,url.searchParams.get('p'));
      }else if(url.pathname==='/config'){
        if(request.method!=='GET')fail(405,'Método não permitido.');uniqueQuery(url,[]);response=json(configuration(env));
      }else if(url.pathname.startsWith('/firebase/'))response=await firebase(request,url,env);
      else fail(404,'Endpoint não encontrado.');
    }catch(error){response=json({error:error instanceof Fault?error.message:'Serviço indisponível. Tente novamente.'},error instanceof Fault?error.status:502);}
    return cors(response,origin);
  }
};
