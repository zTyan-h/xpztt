'use strict';
// Copia apenas recursos publicáveis; configurações locais, Worker e testes não são servidos.
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..'),out=path.join(root,'worker/public');
const shell=fs.readFileSync(path.join(root,'src/shell.js'),'utf8');
const sources=[...shell.matchAll(/'[^']+':\s*'(src\/[^']+\.js)'/g)].map(match=>match[1]);
if(sources.length!==22)throw Error('Mapa do shell incompleto.');
const files=['src/shell.js',...sources,'furnis/habblet.json','furnis/habblive.json',...['body.ttf','display.ttf'].map(name=>'assets/fonts/constructor/'+name)];
for(const file of files){const from=path.join(root,file),to=path.resolve(out,file);if(!to.startsWith(out+path.sep)||!fs.statSync(from).isFile())throw Error('Recurso inválido: '+file);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);}
console.log(files.length+' recursos preparados em worker/public.');
