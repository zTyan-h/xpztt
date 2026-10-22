'use strict';
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const template=fs.readFileSync(path.join(root,'loader/bootstrap.js'),'utf8').replace(/^\uFEFF/,''),transport=fs.readFileSync(path.join(root,'src/services/socket-transport.js'),'utf8');
if(template.split('/*__TRANSPORT__*/').length!==2)throw Error('Marcador de transporte inválido.');
const output=template.replace('/*__TRANSPORT__*/',()=>transport);
new (require('node:vm').Script)(output,{filename:'constructor.user.js'});
fs.writeFileSync(path.join(root,'loader/constructor.user.js'),output);
console.log('loader/constructor.user.js gerado com captura incorporada.');
