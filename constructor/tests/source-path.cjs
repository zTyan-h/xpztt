'use strict';
// Os testes consomem o mesmo mapa explícito da entrada pública.
const fs=require('node:fs'),path=require('node:path'),root=path.join(__dirname,'..');
const shell=fs.readFileSync(path.join(root,'src','shell.js'),'utf8');
const sources=new Map([...shell.matchAll(/'([^']+)':\s*'(src\/[^']+\.js)'/g)].map(match=>[match[1]+'.js',match[2]]));
module.exports=file=>{const relative=sources.get(file);if(!relative)throw Error('Fonte ausente no mapa do Constructor: '+file);return path.join(root,relative);};
