// Constructor — extraído da Oficina 1.5.1.
(function () {
  'use strict';
  const ctx = window._constructor;
  if (!ctx?.current()) return;
  const OficinaCore = ctx.Core;
  const {int,number,LIMIT,validatePositions,missingItems} = OficinaCore;
  function makeShape(key,p={}){
    const x=int(p.x??0,-10000,10000),y=int(p.y??0,-10000,10000),out=[];
    const len=int(p.len??5,1,100),w=int(p.w??4,1,70),h=int(p.h??3,1,70),size=int(p.size??3,1,70),r=int(p.r??4,3,35);
    const add=(dx,dy)=>out.push({x:x+dx,y:y+dy});
    if(key==='lineX'||key==='lineY')for(let i=0;i<len;i++)add(key==='lineX'?i:0,key==='lineY'?i:0);
    else if(key==='square'||key==='rect'){const sw=key==='square'?size:w,sh=key==='square'?size:h;for(let yy=0;yy<sh;yy++)for(let xx=0;xx<sw;xx++)if(!p.hollow||xx===0||yy===0||xx===sw-1||yy===sh-1)add(xx,yy);}
    else if(key==='circle'){
      const edge=new Set();let cx=r,cy=0,d=1-r;while(cx>=cy){for(const [xx,yy] of [[cx,cy],[-cx,cy],[cx,-cy],[-cx,-cy],[cy,cx],[-cy,cx],[cy,-cx],[-cy,-cx]])edge.add(`${xx},${yy}`);if(d<0)d+=2*cy+3;else{d+=2*(cy-cx)+5;cx--;}cy++;}
      if(p.hollow!==false)for(const k of edge){const [xx,yy]=k.split(',').map(Number);add(r+xx,r+yy);}else for(let yy=-r;yy<=r;yy++){const row=[...edge].map(k=>k.split(',').map(Number)).filter(i=>i[1]===yy).map(i=>i[0]);if(row.length)for(let xx=Math.min(...row);xx<=Math.max(...row);xx++)add(r+xx,r+yy);}
    }else if(key==='wallLineH')for(let i=0;i<len;i++)out.push({x:x+i,y,wall:true,wx:x+i,wy:int(p.wy??0,-1000,1000),lx:int(p.lx??0,-1000,1000),ly:int(p.ly??16,-1000,1000),dir:p.wallDir==='l'?'l':'r'});
    else if(typeof p.customFn==='function')return validatePositions(p.customFn({...p,x,y}));else throw Error('Escolha uma forma.');
    return validatePositions(p.zebra?out.filter((_,i)=>i%2===0):out);
  }
  function planShape(cfg,inventory){
    const positions=makeShape(cfg.shape,cfg),layers=int(cfg.layers??1,1,50),groups=cfg.groups||[];if(!groups.length)throw Error('Escolha pelo menos um móvel.');
    const pools=new Map();for(const i of inventory){if(!pools.has(i.spriteId))pools.set(i.spriteId,[]);pools.get(i.spriteId).push(i);}
    const plan=[];for(const coord of positions){let z=number(cfg.height??0,-1000,1000),first=true;
      for(let layer=0;layer<layers;layer++)for(const g of groups){const sid=int(g.sid,1),count=int(g.count??1,1,100),rise=number(g.rise??0.65,0,100);
        for(let n=0;n<count;n++){
          if(plan.length>=LIMIT)throw Error('Limite de 5.000 móveis por tarefa.');const item=pools.get(sid)?.shift();
          const wall=g.type==='wall'||(g.type!=='floor'&&(item?.type||inventory.find(unit=>unit.spriteId===sid)?.type)==='i');if(coord.wall&&!wall)throw Error('Escolha um móvel de parede para esta forma.');
          let height=null;if(cfg.heightMode==='step')height=number(z,-1000,1000);else if(first&&(cfg.heightMode==='fixed'||cfg.heightMode==='base'))height=cfg.heightMode==='base'?0:z;
          plan.push({...coord,itemId:item?.itemId??null,spriteId:sid,wall,wx:coord.wx??coord.x+int(cfg.wx??0,-1000,1000),wy:coord.wy??int(cfg.wy??0,-1000,1000),lx:coord.lx??int(cfg.lx??0,-1000,1000),ly:coord.ly??int(cfg.ly??16,-1000,1000),dir:coord.dir??(cfg.wallDir==='l'?'l':'r'),rot:int(cfg.rot??0,0,7),height,releaseHeight:!wall&&height!==null&&cfg.heightMode!=='step'});
          if(!wall){first=false;z+=rise;}
        }
      }
    }return plan;
  }
  function planProject(project,origin,inventory){
    const x=int(origin.x,-10000,10000),y=int(origin.y,-10000,10000),pools=new Map();
    for(const i of inventory){if(i.type==='i')continue;if(!pools.has(i.spriteId))pools.set(i.spriteId,{items:[],index:0});pools.get(i.spriteId).items.push(i);}
    return project.layout.map(i=>{const pool=pools.get(i.spriteId),item=pool?.items[pool.index++];return {...i,itemId:item?.itemId??null,x:x+i.relX,y:y+i.relY,wall:false,height:number(i.z,-1000,1000)};});
  }
  const definitions={
    lineX:{name:'Linha horizontal',icon:'━',params:[['len','Comprimento',5]]},
    lineY:{name:'Linha vertical',icon:'┃',params:[['len','Comprimento',5]]},
    square:{name:'Quadrado',icon:'□',params:[['size','Tamanho do lado',3]]},
    rect:{name:'Retângulo',icon:'▭',params:[['w','Largura',4],['h','Comprimento',3]]},
    circle:{name:'Círculo',icon:'○',params:[['r','Raio',4]]},
    wallLineH:{name:'Linha na parede',icon:'▥',params:[['len','Comprimento',5]]}
  };


  Object.assign(OficinaCore, {makeShape,planShape,planProject});
  ctx.shapes = definitions;

  ctx.parts.add('shapes.js');
})();
