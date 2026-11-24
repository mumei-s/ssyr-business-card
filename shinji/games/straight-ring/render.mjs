import {SUPER_ACCENTS} from './super-style.mjs?v=5';
import {clamp, motionPose, footwork} from './boxing-motion.mjs?v=3';

const W=1000,H=468, TAU=Math.PI*2;
const lerp=(a,b,t)=>a+(b-a)*t;
const belly=(x,c,w)=>Math.max(0,1-Math.abs(x-c)/w)**1.35;
const ctxColor=(color,a)=> color?.length===7?color+Math.round(clamp(a)*255).toString(16).padStart(2,'0'):color;
function ell(c,x,y,rx,ry,fill){if(rx<=0||ry<=0)return;c.beginPath();c.ellipse(x,y,rx,ry,0,0,TAU);c.fillStyle=fill;c.fill();}
function line(c,x,y,x2,y2,color,size=2){c.beginPath();c.moveTo(x,y);c.lineTo(x2,y2);c.lineWidth=size;c.strokeStyle=color;c.lineCap='round';c.stroke();}
function polygon(c,points,fill,stroke,width=2){
  c.beginPath();c.moveTo(...points[0]);for(const p of points.slice(1))c.lineTo(...p);c.closePath();
  if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.lineJoin='round';c.stroke();}
}
function round(c,x,y,w,h,r,fill,stroke,width=2){
  c.beginPath();c.roundRect(x,y,w,h,r);c.fillStyle=fill;c.fill();
  if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.stroke();}
}
function grad(c,x,y,x2,y2,stops){const g=c.createLinearGradient(x,y,x2,y2);for(const [a,b] of stops)g.addColorStop(a,b);return g;}
function radial(c,x,y,w,stops){const g=c.createRadialGradient(x,y,0,x,y,w);for(const [a,b] of stops)g.addColorStop(a,b);return g;}

export const STOCK_FIGHTERS=Object.freeze({
  rose:{color:'#f47991',skin:'#eab08f',hair:'#392746',shape:0,rig:[.53,.84,.33,.31]},
  azure:{color:'#61c7fa',skin:'#da9a70',hair:'#273955',shape:3,rig:[.49,.78,.34,.32]},
  jade:{color:'#70deb2',skin:'#bf825c',hair:'#213c37',shape:1,rig:[.47,.78,.33,.29]},
  violet:{color:'#bb93fb',skin:'#eab6a2',hair:'#5e3259',shape:2,rig:[.50,.77,.32,.30]},
});
const archetype={rin:'rose',kai:'azure',mio:'violet',ren:'jade',aoi:'violet',gaku:'jade',nagi:'rose',riku:'azure',sora:'rose',yuto:'azure'};

const assets=new Map(),cache=new WeakMap();
function pixels(img){const w=img?.naturalWidth||img?.width,h=img?.naturalHeight||img?.height;return w>0&&h>0?[w,h]:null;}
function asset(key){
  if(!assets.has(key)&&typeof Image==='function'){
    const image=new Image();image.decoding='async';assets.set(key,image);
    image.src=new URL('./art/'+key+'.webp',import.meta.url).href;
  }
  const image=assets.get(key);
  return image?.complete&&image.naturalWidth>0?image:null;
}
// Trim empty border once; rectangular, non-transparent custom images still
// stay rectangular. Nothing is recolored, synthesized, or sent for an import.
function cutout(pic){
  if(cache.has(pic))return cache.get(pic);
  const size=pixels(pic);if(!size)return null;
  const [w,h]=size, small=Math.min(1,256/Math.max(w,h));
  let rect=[0,0,w,h];
  try{
    const canvas=document.createElement('canvas'),sw=Math.max(1,Math.round(w*small)),sh=Math.max(1,Math.round(h*small));
    canvas.width=sw;canvas.height=sh;
    const c=canvas.getContext('2d',{willReadFrequently:true});
    c.drawImage(pic,0,0,sw,sh);const rgba=c.getImageData(0,0,sw,sh).data;
    let x0=sw,y0=sh,x1=-1,y1=-1;
    for(let y=0;y<sh;y++)for(let x=0;x<sw;x++)if(rgba[(y*sw+x)*4+3]>27){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
    if(x1<x0)return null;
    const sx=Math.max(0,Math.floor((x0-2)*w/sw)),sy=Math.max(0,Math.floor((y0-2)*h/sh));
    rect=[sx,sy,Math.min(w,Math.ceil((x1+3)*w/sw))-sx,Math.min(h,Math.ceil((y1+3)*h/sh))-sy];
  }catch{/* Local art normally has alpha; keep a valid image if a read is unsupported. */}
  cache.set(pic,rect);return rect;
}

let fallback;
function fallbackArena(){
  const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
  const c=canvas.getContext('2d');
  c.fillStyle=grad(c,0,0,0,H,[[0,'#080d17'],[.5,'#121824'],[1,'#18111b']]);c.fillRect(0,0,W,H);
  let r=689;const rand=()=>((r=(1664525*r+1013904223)>>>0)/4294967296);
  for(const [x,color] of [[138,'#be465f'],[862,'#4a7eca'],[510,'#8072aa']]){
    c.fillStyle=radial(c,x,8,300,[[0,ctxColor(color,.55)],[1,ctxColor(color,0)]]);c.fillRect(0,0,W,280);
  }
  for(let row=0;row<7;row++)for(let i=0;i<76;i++){
    const x=i*15+(row%2)*8-14, y=48+row*21+(rand()-.5)*10;
    const t=rand(),body=t>.8?'#30303c':t>.5?'#252735':'#181d2a';
    ell(c,x,y,4+row/3,4+row/3,t>.82?'#5b4e51':body);
    round(c,x-6-row/3,y+4,12+row*.6,9+row,4,body);
    if(rand()>.975)ell(c,x+5,y+2,1.4,1.4,'#d7dcfbbd');
  }
  for(const [x,col] of [[172,'#d85576'],[827,'#538bf1']]){
    polygon(c,[[x-14,34],[x+10,34],[x+220,263],[x-174,263]],
      grad(c,x,33,x,269,[[0,ctxColor(col,.25)],[1,ctxColor(col,0)]]));
    for(let j=0;j<5;j++)ell(c,x-26+j*13,35,3.5,2.1,'#f5dbf6');
  }
  const floor=grad(c,0,175,0,429,[[0,'#2b3d56'],[.6,'#455770'],[1,'#26384d']]);
  polygon(c,[[156,176],[844,176],[1006,404],[-6,404]],floor,'#7890a3',3);
  polygon(c,[[-6,404],[1006,404],[986,453],[14,453]],grad(c,0,405,0,450,[[0,'#19252f'],[1,'#10131f']]),'#3b495a');
  c.save();c.globalAlpha=.28;
  for(let i=0;i<1650;i++){const x=rand()*W,y=176+rand()*228;if(x>156-(y-176)*.7&&x<844+(y-176)*.7){
    c.fillStyle=rand()>.5?'#99bccb16':'#131b3032';c.fillRect(x,y,2+rand()*12,.75);}}
  for(let i=0;i<15;i++){const x=i*73-12;line(c,500+(x-500)*.68,178,x,403,'#a9c9e43c',.8);}
  for(const y of [202,243,295,361])line(c,155-(y-176)*.68,y,846+(y-176)*.68,y,'#a9c9e43c',1);
  c.translate(500,310);c.scale(1,.46);
  c.strokeStyle='#d2e6ef';c.lineWidth=2.6;
  for(const rr of [129,150]){c.beginPath();c.arc(0,0,rr,0,TAU);c.stroke();}
  c.fillStyle='#e1eaf3';c.textAlign='center';c.font='italic 900 38px system-ui';c.fillText('HIKARI STRAIGHT',0,12);
  c.restore();
  for(let i=0;i<4;i++){
    const y=120+i*14,col=i%2?'#d1bdce':'#acb8cd';
    line(c,151,y+3,850,y+3,'#10131f',5);line(c,151,y,850,y,col,2.3);
  }
  for(const [x,color] of [[153,'#bc3f62'],[848,'#3778ad']]){
    round(c,x-8,89,16,111,5,color,'#0e1422',2);
    round(c,x-13,103,26,52,6,color,'#0e1422',2);
    line(c,x-5,111,x-5,147,'#f7dded72',2);
  }
  return canvas;
}
function scene(c){
  const art=asset('arena');
  if(!art){
    fallback??=fallbackArena();c.drawImage(fallback,0,0);return;
  }
  const [sw,sh]=pixels(art),t=Math.max(W/sw,H/sh);
  const usedW=W/t,usedH=H/t;
  c.drawImage(art,(sw-usedW)/2,(sh-usedH)*.47,usedW,usedH,0,0,W,H);
  c.fillStyle=grad(c,0,0,0,H,[[0,'#0a0e1a5e'],[.37,'#10152310'],[.9,'#08091305'],[1,'#0e12224d']]);c.fillRect(0,0,W,H);
}

// Quad mesh: each ring pose shifts the pixels the athlete already has, rather
// than drawing additional gloves over the source. Triangles share edge
// coordinates, and a fractional overlap avoids hairline seams.
const Y=[0,.16,.325,.52,.76,1];
function tri(c,pic,src,points,dir){
  const [sx,sy,sw,sh]=src,[a,b,d]=points;
  const u0=sx, v0=dir===0?sy:sy+sh;
  let ux,uy,vx,vy;
  ux=(b[0]-a[0])/sw;uy=(b[1]-a[1])/sw;
  if(dir===0){vx=(d[0]-b[0])/sh;vy=(d[1]-b[1])/sh;}
  else{vx=(a[0]-d[0])/sh;vy=(a[1]-d[1])/sh;}
  c.save();
  const mx=(a[0]+b[0]+d[0])/3,my=(a[1]+b[1]+d[1])/3;
  c.beginPath();
  for(let i=0;i<3;i++){
    const [x,y]=points[i],ex=x-mx,ey=y-my,e=.57/(Math.hypot(ex,ey)||1);
    if(i===0)c.moveTo(x+ex*e,y+ey*e);else c.lineTo(x+ex*e,y+ey*e);
  }
  c.closePath();c.clip();
  c.transform(ux,uy,vx,vy,a[0]-ux*u0-vx*v0,a[1]-uy*u0-vy*v0);
  const det=Math.max(1e-8,Math.abs(ux*vy-uy*vx));
  const px=Math.ceil(.58*Math.hypot(vy,vx)/det)+1,py=Math.ceil(.58*Math.hypot(ux,uy)/det)+1;
  const [pw,ph]=pixels(pic),ex=Math.max(0,sx-px),ey=Math.max(0,sy-py),
    ew=Math.min(pw,sx+sw+px)-ex,eh=Math.min(ph,sy+sh+py)-ey;
  c.drawImage(pic,ex,ey,ew,eh,ex,ey,ew,eh);c.restore();
}
function warp(c,pic,rect,w,h,pose,foot,theme,isCustom,dir,limited){
  const [sx,sy,sw,sh]=rect;
  const speed=clamp(Math.hypot(foot.vx*.95,foot.vy*1.4)/.26);
  const [back,lead,backLevel,leadLevel]=theme.rig;
  const neutralGrip=[(lead-.5)*w,(leadLevel-1)*h];
  if(limited||(Math.abs(pose.reach)<.1&&Math.abs(pose.lift)<.1&&speed<.055&&foot.brace<.045)){
    c.translate(pose.drive*.22,-Math.sin(foot.cycle*.62)*1.15+pose.knee*.12);c.rotate(pose.lean*.48);
    c.drawImage(pic,sx,sy,sw,sh,-w/2,-h,w,h);
    return neutralGrip;
  }
  const walk=Math.sin(foot.cycle),phase=Math.cos(foot.cycle),g=foot.brace,
    quality=isCustom?.42:1;
  const xGrid=isCustom?[0,.5,1]:[0,back,lead,1],yGrid=isCustom?[0,.23,.47,.68,.86,1]:Y;
  const base=yGrid.map(v=>xGrid.map(u=>[(u-.5)*w,(v-1)*h]));
  const animated=yGrid.map(v=>xGrid.map(u=>{
    const upper=(1-v)**.64,torso=belly(v,.43,.63),head=belly(v,.16,.25),
      side=(u-.5)*2,planted=clamp((v-.70)/.29),
      knee=belly(v,.59,.41),rest=Math.sin(foot.cycle*.62),
      wristLead=belly(u,lead,.41)*belly(v,leadLevel,.35)*quality,
      wristRear=belly(u,back,.28)*belly(v,backLevel,.32)*quality,
      face=belly(u,.585,.31)*head;
    // Move the original pair of gloves up and toward the face. The chin
    // tucks behind them, while the chest and feet stay distinct landmarks.
    const jabArc=pose.lean*31*head+pose.lean*18*side*torso;
    const offset=pose.drive*upper+jabArc-g*upper*5+foot.vx*dir*42*upper;
    const hand=(pose.reach-g*19)*wristLead+(pose.rearReach+g*11)*wristRear;
    const step=planted*(speed*(walk*6*side+foot.vx*dir*27)+Math.max(0,pose.drive)*.14*Math.max(0,side));
    const bob=(Math.abs(phase)*4.5*speed+rest*1.4)*upper;
    const lift=planted*speed*Math.max(0,(side<0?phase:-phase))*4.2;
    const protection=g*(face*17+torso*5-(wristLead*38+wristRear*37));
    return [(u-.5)*w+offset+hand+step,(v-1)*h+pose.knee*knee+protection-bob-lift-pose.lift*wristLead-pose.rearLift*wristRear];
  }));
  // Find the largest safe fraction instead of sudden all-or-nothing
  // fallbacks. Every source triangle remains forward and nondegenerate.
  const area=(a,b,d)=>(b[0]-a[0])*(d[1]-a[1])-(b[1]-a[1])*(d[0]-a[0]);
  const stable=grid=>{
    for(let j=0;j<yGrid.length-1;j++)for(let i=0;i<xGrid.length-1;i++){
      const [a,b]=[grid[j][i],grid[j][i+1]], [d,e]=[grid[j+1][i],grid[j+1][i+1]];
      const minimum=w*h*(xGrid[i+1]-xGrid[i])*(yGrid[j+1]-yGrid[j])*.18;
      if(area(a,b,e)<minimum||area(d,a,e)<minimum)return false;
    }
    return true;
  };
  let points=animated;
  if(!stable(points)){
    let lo=0,hi=1;points=base;
    for(let pass=0;pass<8;pass++){
      const t=(lo+hi)/2;
      const candidate=base.map((row,j)=>row.map(([x,y],i)=>[lerp(x,animated[j][i][0],t),lerp(y,animated[j][i][1],t)]));
      if(stable(candidate)){lo=t;points=candidate;}else hi=t;
    }
  }
  for(let j=0;j<yGrid.length-1;j++)for(let i=0;i<xGrid.length-1;i++){
    const src=[sx+sw*xGrid[i],sy+sh*yGrid[j],sw*(xGrid[i+1]-xGrid[i]),sh*(yGrid[j+1]-yGrid[j])];
    const a=points[j][i],b=points[j][i+1],d=points[j+1][i],e=points[j+1][i+1];
    tri(c,pic,src,[a,b,e],0);tri(c,pic,src,[d,e,a],1);
  }
  if(isCustom)return neutralGrip;
  const j=yGrid.findIndex(y=>y>leadLevel)-1, t=(leadLevel-yGrid[j])/(yGrid[j+1]-yGrid[j]);
  return [lerp(points[j][2][0],points[j+1][2][0],t),lerp(points[j][2][1],points[j+1][2][1],t)];
}
function gloves(c,ax,ay,ex,ey,gx,gy,theme,arm='lead'){
  const {color,skin}=theme,outline='#181927',rear=arm==='rear';
  c.beginPath();c.moveTo(ax,ay);c.quadraticCurveTo(ex,ey,gx,gy);c.lineCap='round';
  c.strokeStyle=outline;c.lineWidth=rear?19:23;c.stroke();c.strokeStyle=skin;c.lineWidth=rear?13:16;c.stroke();
  c.save();c.translate(gx,gy);
  c.rotate(Math.atan2(gy-ey,gx-ex)*.52);
  const shade=grad(c,0,-15,0,15,[[0,'#fff4e38c'],[.31,color],[1,'#383044']]);
  round(c,-12,2,13,15,5,color,outline,2);
  ell(c,2,-2,rear?13:15,rear?14:16,outline);
  ell(c,2,-3,rear?10.5:12.5,rear?11.5:13.5,shade);
  line(c,-5,-8,3,-12,'#fff2dc75',2.6);
  line(c,-8,10,-4,6,'#130f266b',2);
  c.restore();
}
function standbyFighter(c,theme,pose,foot,dir){
  // Fallback during asset fetch/failure: shoulders, elbows and gloves are
  // connected, with separate rear and lead arm instead of loose overlays.
  const {color,skin,hair,shape}=theme, outline='#211b2d';
  const move=Math.sin(foot.cycle)*clamp(Math.hypot(foot.vx,foot.vy)/.26)*7,
    lean=pose.drive+foot.vx*dir*35,body=lean*.55,head=lean*.85,
    knee=pose.knee*.5+foot.brace*8,gy=-104-pose.lift-foot.brace*39;
  const rear=()=>gloves(c,body-19,-98+knee,body-28,-74+knee,body+1+pose.rearReach+foot.brace*15,-116-pose.rearLift-foot.brace*30,theme,'rear');
  const light=grad(c,-27,-90,20,-47,[[0,color],[1,'#493759']]);
  const shoe=(x,step)=>{line(c,x,-39,x+step,-11,outline,19);line(c,x,-34,x+step,-13,skin,13);round(c,x+step-11,-14,32,14,5,'#202236',outline,2.5);line(c,x+step-7,-4,x+step+15,-4,color,2);};
  shoe(-22,move);shoe(14,-move);
  if(shape===0||shape===2)ell(c,head-32,-147+knee,14,31,hair);
  if(foot.brace<.1)rear();
  polygon(c,[[-30,-67],[27,-67],[24,-31],[4,-26],[-5,-35],[-14,-28],[-33,-33]],light,outline,3);
  round(c,body-31,-108+knee,62,47,12,light,outline,3);
  polygon(c,[[body-17,-108+knee],[body-4,-85+knee],[body+17,-106+knee]],'#fbe3ba85');
  round(c,-30,-68,58,7,2,'#faead9',outline);
  ell(c,head+1,-143+knee,44,41,outline);ell(c,head+4,-140+knee,41,37,skin);
  ell(c,head-30,-139+knee,9,11,skin);
  const hy=-144+knee;
  if(shape===3)polygon(c,[[head-42,hy],[head-47,hy-23],[head-27,hy-18],[head-28,hy-43],[head-8,hy-30],[head+4,hy-46],[head+15,hy-30],[head+38,hy-38],[head+32,hy-23],[head+46,hy-9],[head+33,hy+1],[head+25,hy-12],[head+13,hy-1],[head+4,hy-11],[head-14,hy+2],[head-24,hy-7],[head-34,hy+5]],hair,outline,2.5);
  else polygon(c,[[head-39,hy+2],[head-42,hy-14],[head-32,hy-30],[head-16,hy-40],[head+3,hy-43],[head+25,hy-36],[head+40,hy-24],[head+44,hy-8],[head+35,hy+1],[head+23,hy-11],[head+13,hy+1],[head+1,hy-12],[head-16,hy+3],[head-25,hy-8],[head-32,hy+5]],hair,outline,2.7);
  line(c,head-30,hy-21,head-12,hy-31,'#ffe5d55c',2.5);line(c,head-5,hy-34,head+14,hy-30,color,2);
  for(const [x,w] of [[15,5],[31,4]]){ell(c,head+x,hy+5,w+1,7,'#fef4e9');ell(c,head+x+1,hy+5,w*.65,4.9,outline);ell(c,head+x+2,hy+3,1.3,1.5,'#fff');}
  line(c,head+9,hy-3,head+18,hy-6,outline,2);line(c,head+26,hy-5,head+33,hy-6,outline,2);
  line(c,head+26,hy+18,head+33,hy+16,'#7a3f49',2);
  if(foot.brace>=.1)rear();
  gloves(c,body+18,-98+knee,body+25+pose.reach*.40,-80-pose.lift*.4,body+38+pose.reach-foot.brace*12,gy,theme,'lead');
  return [body+38+pose.reach-foot.brace*12,gy];
}
function shadow(c,x,y,depth,pose,down,color){
  c.save();c.translate(x+pose.drive*.12,y+1);c.scale(1,.22);
  const w=(down?67:53)*depth;
  ell(c,0,1,w,w,radial(c,0,0,w,[[0,'#101828ac'],[.57,'#12182761'],[1,'#15172600']]));
  ell(c,-9,0,26*depth,16,radial(c,-9,0,26*depth,[[0,'#0b111b45'],[1,'#0b111b00']]));
  c.restore();
  // A quiet corner-color glint lets players distinguish mirror matchups.
  if(!down)line(c,x-18,y+4,x+16,y+4,ctxColor(color,.52),1.8);
}
const curvedLength=kind=>kind==='upper'?19:kind==='hook'?42:34;
function trail(c,pose,actor,theme,[gripX,gripY]){
  if(pose.charge>.1){
    const r=15+pose.charge*17,x=gripX,y=gripY;
    c.save();c.globalAlpha=pose.charge*.63;
    c.strokeStyle=theme.color;c.lineWidth=2.1;
    c.beginPath();c.arc(x,y,r,-.86,1.7);c.stroke();c.restore();
  }
  if(pose.trail<.11)return;
  const kind=actor.attack?.kind,x=gripX,y=gripY;
  c.save();c.globalAlpha=pose.trail;
  const top=kind==='upper',curve=kind==='hook',long=kind==='straight'||kind==='card',length=long?59:curvedLength(kind);
  const g=grad(c,x-(top?7:length),y+(top?54:15),x+14,y-4,[[0,ctxColor(theme.color,0)],[.68,ctxColor(theme.color,.55)],[1,'#f5e9e3c8']]);
  for(const [i,d] of [-8,0,10].entries()){
    c.beginPath();c.moveTo(x-length+Math.abs(d),y+d+(top?49:curve?15:0));
    c.quadraticCurveTo(x+(top?-18:curve?8:-7),y+d+(top?23:curve?39:1),x+13,y+d-(top?12:1));
    c.lineWidth=i===1?3.6:1.6;c.strokeStyle=g;c.lineCap='round';c.stroke();
  }c.restore();
}
function fighter(c,entry,now,proportion,quiet){
  const {actor,theme,dir,pic,custom,down,downProgress,light}=entry;
  const y=floorY(actor),depth=depthOf(actor),foot=footwork(actor,now),pose=motionPose(actor,now);
  shadow(c,actor.x,y,depth,pose,down,light);
  c.save();c.translate(actor.x,y);c.scale(dir*proportion*depth,depth);
  if(down){c.translate(lerp(0,-25,downProgress),-3);c.rotate(lerp(0,-1.33,downProgress));}
  const rect=pic&&cutout(pic);
  let grip;
  if(rect){
    const scale=Math.min(202/rect[3],165/rect[2]),w=rect[2]*scale,h=rect[3]*scale;
    grip=warp(c,pic,rect,w,h,pose,foot,theme,custom,dir,down);
  }else{
    c.translate(0,Math.sin(foot.cycle)*1.35);
    grip=standbyFighter(c,theme,pose,foot,dir);
  }
  if(!down&&!quiet&&actor.attack&&(!custom||!pic))trail(c,pose,actor,{color:light},grip);
  c.restore();
}

const floorY=actor=>345+(actor.y||0)*.63;
const depthOf=actor=>1+(actor.y||0)*.00245;
function fx(c,m,e,clock){
  const age=clamp((clock-e.time)/Math.max(1,e.life)),strength=1-age;
  if(age>=1)return;
  const closest=Math.abs((m?.p?.x??390)-e.x)<Math.abs((m?.cpu?.x??610)-e.x)?m?.p:m?.cpu;
  const dir=e.dir??(closest===m?.p?-1:1),special=e.kind==='card',guard=e.kind==='block';
  const source=closest===m?.p?m?.cpu:m?.p;
  const upper=source?.attack?.kind==='upper';
  const x=(e.x??500)-(special?0:dir*(guard?31:19)),y=special?(e.y??230):(floorY(closest??{y:0})-(upper?139:119)*depthOf(closest??{y:0}));
  const variant=e.variant??'impact',primary=special?(SUPER_ACCENTS[variant]||SUPER_ACCENTS.impact):guard?'#87dcff':'#ffd4a2';
  c.save();c.translate(x,y);c.scale(dir,1);c.globalAlpha=strength;
  if(age<.35){
    const r=(special?51:25)+(special?44:16)*age;
    ell(c,0,0,r,r,radial(c,0,0,r,[[0,'#fff7dcad'],[.38,ctxColor(primary,.26)],[1,ctxColor(primary,0)]]));
  }
  if(special&&variant==='prism'){
    const r=17+age*94, ry=r*.65;
    polygon(c,[[0,-ry],[r*.52,0],[0,ry],[-r*.52,0]],null,primary,1.5);
    polygon(c,[[r*.76,-ry*.36],[r,0],[r*.76,ry*.36],[r*.52,0]],null,'#fff4fb',1.2);
  }else if(special&&variant==='bolt'){
    for(let i=0;i<3;i++){
      const d=i-1,r=25+age*(86+i*11),h=8+d*16;
      c.beginPath();c.moveTo(-r*.45,-h*.7);c.lineTo(r*.19,h);c.lineTo(r*.35,-h*.34);c.lineTo(r,h*.6);
      c.strokeStyle=i===1?'#e8fcff':primary;c.lineWidth=1.3+strength*.9;c.stroke();
    }
  }else if(special&&variant==='ink'){
    for(let i=0;i<8;i++){const t=.95*i-3.6,r=17+age*(83+i*4);
      ell(c,Math.cos(t)*r,Math.sin(t)*r*.54,1.5+strength*(i%3+1),1+strength*2,i%2?primary:'#f8e2e5');}
  }else if(guard||special){
    c.strokeStyle=primary;c.lineWidth=guard?2.4:1.55;
    c.beginPath();c.ellipse(0,0,(guard?22:24)+age*(guard?14:95),15+age*(guard?12:30),-.16,guard?-1.24:0,guard?1.4:TAU);c.stroke();
    if(special&&variant==='wave'){
      c.beginPath();c.ellipse(12,1,34+age*107,22+age*35,-.16,0,TAU);c.lineWidth=1;c.stroke();
    }
  }
  const count=special?(variant==='impact'?11:7):guard?4:6;
  for(let i=0;i<count;i++){
    const r=6+age*(special?69:46),a=-1.22+i*2.44/Math.max(1,count-1)+Math.sin(i*31)*.14,
      xx=Math.cos(a)*r,yy=Math.sin(a)*r, length=(special?29:15)*(1-age*.71);
    line(c,xx,yy,xx+Math.cos(a)*length,yy+Math.sin(a)*length,i%2?primary:'#fff8e1',i%3===0?2.8:1.4);
  }
  c.restore();
}
let motionPreference;
export function render(ctx,m,look,appearance,effects=[],clock=0,choice='rose',proportion=1){
  scene(ctx);
  const now=m?.elapsed??clock, phase=m?.phase;
  const player=m?.p??{x:355,y:0},cpu=m?.cpu??{x:645,y:0};
  const pk=Object.hasOwn(STOCK_FIGHTERS,choice)?choice:'rose',ck=archetype[appearance?.id]??'azure',
    pt=STOCK_FIGHTERS[pk],ct=STOCK_FIGHTERS[ck];
  const isRest=phase==='intro'||phase==='rest',quiet=(motionPreference??=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)'))?.matches===true;
  const left={actor:player,theme:pt,dir:1,pic:look||asset(pk),custom:!!look,light:'#f79a9e'};
  const right={actor:cpu,theme:ct,dir:-1,pic:asset(ck),custom:false,light:appearance?.color??'#87c8f6'};
  if(m?.knock&&(phase==='count'||phase==='result')){
    const knocked=m.knock.side==='player'?left:right;
    knocked.down=true;knocked.downProgress=phase==='result'?1:clamp((m.wait??0)/240);
  }else if(phase==='result'&&['KO','TKO'].includes(m.result?.method)){
    const knocked=m.result.winner==='player'?right:left;
    knocked.down=true;knocked.downProgress=1;
  }
  for(const entry of [left,right].sort((a,b)=>a.actor.y-b.actor.y))fighter(ctx,entry,now,proportion,quiet||isRest);
  if(!quiet)for(const event of effects)fx(ctx,m,event,clock);
}
