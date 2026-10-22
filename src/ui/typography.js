// Constructor — fontes locais, opcionais e pertencentes à instância atual.
(function () {
  'use strict';
  const ctx=window._constructor;
  if(!ctx?.current())return;
  const owned=new Set();
  ctx.disposeFonts=()=>{for(const face of owned)document.fonts?.delete(face);owned.clear();};
  ctx.loadFonts=async(resolve=name=>{
    return ctx.platform.assetUrl('assets/fonts/constructor/'+name).href;
  })=>{
    if(!window.FontFace||!document.fonts)return;
    await Promise.allSettled([
      ['Constructor Display','display.ttf','200 800'],
      ['Constructor Manrope','body.ttf','200 800']
    ].map(async([family,name,weight])=>{
      const response=await ctx.platform.request(resolve(name),{signal:AbortSignal.any([ctx.ac.signal,AbortSignal.timeout(10000)])});
      if(!response.ok)throw Error('Fonte local indisponível.');
      const bytes=await response.arrayBuffer();
      if(!ctx.current())return;
      const face=await new FontFace(family,bytes,{style:'normal',weight,display:'swap'}).load();
      if(ctx.current()){document.fonts.add(face);owned.add(face);}
    }));
  };
  ctx.parts.add('typography.js');
})();
