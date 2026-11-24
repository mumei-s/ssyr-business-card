export const ROUND_MS=35000, REST_MS=4500, TOTAL_ROUNDS=3, MATCH_COUNT=5;
export const PRIZE=500000;
export const MOVES=Object.freeze({
  jab:{label:'ジャブ',damage:7,cost:7,range:116,delay:135,hold:330},
  straight:{label:'ストレート',damage:15,cost:15,range:139,delay:235,hold:585},
  hook:{label:'フック',damage:13,cost:12,range:113,delay:190,hold:490},
  upper:{label:'アッパー',damage:20,cost:19,range:101,delay:295,hold:720},
  card:{label:'ストレートフラッシュ',damage:33,cost:0,range:157,delay:200,hold:815},
});
export const CLASSES=Object.freeze([[48,'ライトフライ'],[52,'フライ'],[57,'フェザー'],[62,'ライト'],[68,'ウェルター'],[75,'ミドル'],[85,'ライトヘビー'],[Infinity,'ヘビー']]);
export const classOf=kg=>CLASSES.find(([limit])=>Number(kg)<=limit)?.[1]||'ヘビー';
export const FIGHTERS=Object.freeze([
  {id:'rin',name:'リン',type:'female',style:'スピード',color:'#fa58ae',hair:'#52255d',skin:'#f3ab90',shape:0},
  {id:'kai',name:'カイ',type:'male',style:'バランス',color:'#44d7ff',hair:'#243450',skin:'#df976e',shape:1},
  {id:'mio',name:'ミオ',type:'female',style:'テンポ',color:'#fb995f',hair:'#482a28',skin:'#f7c198',shape:2},
  {id:'ren',name:'レン',type:'male',style:'スピード',color:'#79f0bc',hair:'#203b39',skin:'#e1a989',shape:3},
  {id:'aoi',name:'アオイ',type:'female',style:'テクニック',color:'#9178ff',hair:'#26214c',skin:'#f4b695',shape:4},
  {id:'gaku',name:'ガク',type:'male',style:'パワー',color:'#ffbc52',hair:'#502d23',skin:'#bc7a5e',shape:1},
  {id:'nagi',name:'ナギ',type:'female',style:'バランス',color:'#54e4d4',hair:'#365674',skin:'#f9c9a4',shape:0},
  {id:'riku',name:'リク',type:'male',style:'テクニック',color:'#ff786b',hair:'#57292d',skin:'#cf9269',shape:3},
  {id:'sora',name:'ソラ',type:'female',style:'パワー',color:'#ffdf67',hair:'#613c85',skin:'#d69672',shape:2},
  {id:'yuto',name:'ユウト',type:'male',style:'テンポ',color:'#87aaff',hair:'#222945',skin:'#f1b58c',shape:4},
]);
export function opponentOptions(type='any',used=[]){
  return FIGHTERS.filter(f=>(type==='any'||f.type===type)&&!used.includes(f.id));
}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const STEP_MS=5, Y_LIMIT=62, MIN_GAP=73;
const PLAYER_X_SPEED=.28, PLAYER_Y_SPEED=.216;
const actor=x=>({x,y:0,vx:0,vy:0,vital:100,energy:100,meter:0,kds:0,roundKds:0,guard:false,attack:null,until:0,stun:0,points:0});
const stop=f=>{f.vx=f.vy=0;};
export function makeMatch({bout=0,random=Math.random}={}){
  return {phase:'intro',p:actor(370),cpu:actor(630),round:1,time:ROUND_MS,score:[[0,0]],bout,random,
    elapsed:0,pendingTime:0,wait:2350,cpuNext:1400,cpuGuardUntil:0,events:[],knock:null,result:null};
}
function note(m,event,value){m.events.push({event,value});}
export const drain=m=>m.events.splice(0);
function end(m,winner,method){
  m.phase='result';m.result={winner,method,score:m.score.reduce(([p,c],[x,y])=>[p+x,c+y],[0,0])};
  m.p.guard=m.cpu.guard=false;m.p.attack=m.cpu.attack=null;
  stop(m.p);stop(m.cpu);
  note(m,'result',m.result);
}
export function scoreRound(playerPoints,cpuPoints,playerKnockdowns,cpuKnockdowns){
  if(playerKnockdowns!==cpuKnockdowns) return playerKnockdowns>cpuKnockdowns?[Math.max(7,10-(playerKnockdowns-cpuKnockdowns)-1),10]:[10,Math.max(7,10-(cpuKnockdowns-playerKnockdowns)-1)];
  return playerPoints===cpuPoints?[10,10]:playerPoints>cpuPoints?[10,9]:[9,10];
}
function endRound(m){
  m.score[m.round-1]=scoreRound(m.p.points,m.cpu.points,m.p.roundKds,m.cpu.roundKds);
  if(m.round>=TOTAL_ROUNDS){
    const sums=m.score.reduce(([p,c],[x,y])=>[p+x,c+y],[0,0]);
    end(m,sums[0]===sums[1]?'draw':sums[0]>sums[1]?'player':'cpu','判定');
    return;
  }
  m.phase='rest';m.wait=REST_MS;m.p.attack=m.cpu.attack=null;m.p.guard=m.cpu.guard=false;
  stop(m.p);stop(m.cpu);
  note(m,'rest',m.score[m.round-1]);
}
export function launch(m,kind,side='player'){
  const f=side==='player'?m.p:m.cpu,move=MOVES[kind];
  if(!move||m.phase!=='fight'||f.guard||f.until>m.elapsed||f.stun>m.elapsed||f.energy<move.cost||(kind==='card'&&f.meter<100))return false;
  f.attack={kind,start:m.elapsed,hit:m.elapsed+move.delay,done:false};
  f.until=m.elapsed+move.hold;f.energy=Math.max(0,f.energy-move.cost);
  if(kind==='card'){f.meter=0;note(m,'card',side);}
  return true;
}
function down(m,side){
  const loser=side==='player'?m.p:m.cpu;
  loser.kds++;loser.roundKds++;
  loser.attack=null;loser.guard=false; m.p.attack=m.cpu.attack=null;
  stop(m.p);stop(m.cpu);
  // The third knockdown in a game bout ends it. Earlier knockdowns receive a count.
  if(loser.kds>=3){end(m,side==='player'?'cpu':'player','TKO');return;}
  m.phase='count';
  const recovery=loser.energy<12&&loser.kds===2?11:8;
  m.knock={side,count:0,recovery};m.wait=0;note(m,'down',side);
}
function resolve(m,f,g,side){
  const a=f.attack;
  if(!a||a.done||m.elapsed<a.hit||m.phase!=='fight')return;
  a.done=true;
  const d=MOVES[a.kind];
  if(Math.abs(f.x-g.x)>d.range||Math.abs(f.y-g.y)>(a.kind==='card'?60:34)){
    note(m,'miss',side);return;
  }
  const blocked=g.guard&&g.energy>=5;
  if(blocked){
    const damage=a.kind==='card'?8:0;
    g.energy=Math.max(0,g.energy-5);
    g.vital=Math.max(1,g.vital-damage);
    g.meter=clamp(g.meter+12,0,100);
    if(damage)f.points+=damage;
    note(m,'block',side);
    return;
  }
  const damage=d.damage*(side==='player'?1:0.69+m.bout*.065);
  g.vital=Math.max(0,g.vital-damage);g.stun=m.elapsed+(a.kind==='card'?310:125);stop(g);
  f.meter=clamp(f.meter+(a.kind==='card'?0:10+Math.round(d.damage/3)),0,100);
  f.points+=Math.round(damage);
  note(m,'hit',{side,kind:a.kind});
  if(g.vital===0)down(m,side==='player'?'cpu':'player');
}
export function advance(m,ms,input={}){
  if(!Number.isFinite(ms)||ms<0||m.phase==='result')return;
  // Carry fractional frame time over rather than rounding phase/impact times
  // independently at each browser frame. 5 ms keeps input latency negligible.
  m.pendingTime+=ms;
  while(m.pendingTime+1e-9>=STEP_MS&&m.phase!=='result'){
    m.pendingTime=Math.max(0,m.pendingTime-STEP_MS);
    step(m,STEP_MS,input);
  }
}
const axis=value=>Number.isFinite(value)?clamp(value,-1,1):0;
function axisMotion(f,pos,vel,target,dt,low,high){
  const from=f[vel],change=target-from;
  const slowing=from!==0&&(Math.sign(from)!==Math.sign(target)||Math.abs(target)<Math.abs(from));
  const rate=pos==='y'?(slowing?.020:.018):(slowing?.016:.010);
  const ramp=Math.min(dt,Math.abs(change)/rate);
  const next=from+Math.sign(change)*rate*ramp;
  f[pos]=clamp(f[pos]+(from+next)*.5*ramp+next*(dt-ramp),low,high);
  // No latent outward velocity at ropes: changing direction is immediate.
  f[vel]=(f[pos]===low&&next<0)||(f[pos]===high&&next>0)?0:next;
}
function move(f,x,y,xSpeed,ySpeed,dt,minX,maxX,now){
  if(f.stun>now){stop(f);return;}
  const scale=f.guard?.25:f.until>now?.43:1;
  const norm=Math.max(1,Math.hypot(x,y));
  axisMotion(f,'x','vx',x*xSpeed*scale/norm,dt,minX,maxX);
  axisMotion(f,'y','vy',y*ySpeed*scale/norm,dt,-Y_LIMIT,Y_LIMIT);
}
function step(m,dt,input){
  m.elapsed+=dt;
  if(m.phase==='intro'||m.phase==='rest'){
    m.wait-=dt;
    if(m.wait<=0){
      if(m.phase==='rest'){
        m.round++;m.score.push([0,0]);m.time=ROUND_MS;
        for(const f of [m.p,m.cpu]){
          f.vital=clamp(f.vital+23,0,100);f.energy=100;f.points=0;f.roundKds=0;
          f.stun=0;f.until=0;
        }
        m.p.x=370;m.cpu.x=630;m.p.y=m.cpu.y=0;
      }
      m.phase='fight';m.cpuNext=m.elapsed+620;m.cpuGuardUntil=0;note(m,'bell',m.round);
    }
    return;
  }
  if(m.phase==='count'){
    m.wait+=dt;
    const count=Math.min(10,Math.floor(m.wait/355));
    if(count!==m.knock.count){m.knock.count=count;note(m,'count',count);}
    if(count>=m.knock.recovery){
      const f=m.knock.side==='player'?m.p:m.cpu;
      f.vital=45;f.energy=63;f.stun=0;f.until=0;
      m.p.x=392;m.cpu.x=608;m.p.y=m.cpu.y=0;
      m.knock=null;m.phase='fight';m.cpuNext=m.elapsed+700;
    }else if(count>=10){
      end(m,m.knock.side==='player'?'cpu':'player','KO');
    }
    return;
  }
  if(m.phase!=='fight')return;
  const p=m.p,c=m.cpu;
  p.guard=Boolean(input.guard)&&p.energy>=5&&p.until<=m.elapsed&&p.stun<=m.elapsed;
  c.guard=m.elapsed<m.cpuGuardUntil&&c.energy>=5&&c.until<=m.elapsed&&c.stun<=m.elapsed;
  move(p,axis(input.x),axis(input.y),PLAYER_X_SPEED,PLAYER_Y_SPEED,dt,170,770,m.elapsed);
  const distance=c.x-p.x;
  const approach=distance>108?-1:distance<86&&c.energy<22?.65:0;
  const dy=clamp((p.y-c.y)/18,-1,1);
  if(m.elapsed>=m.cpuNext){
    const r=m.random();
    const interval=750-m.bout*76+Math.floor(m.random()*380);
    m.cpuNext=m.elapsed+interval;
    if(distance<153&&Math.abs(c.y-p.y)<43){
      if(!c.attack&&r<.14+m.bout*.018){m.cpuGuardUntil=m.elapsed+330;c.guard=true;}
      else if(!c.guard){const pick=r<.48?'jab':r<.76?'straight':r<.91?'hook':'upper';launch(m,pick,'cpu');}
    }
  }
  move(c,approach,dy,.116+m.bout*.024,.182+m.bout*.013,dt,235,825,m.elapsed);
  if(c.x-p.x<MIN_GAP){
    const middle=(c.x+p.x)/2;
    p.x=clamp(middle-MIN_GAP/2,170,825-MIN_GAP);c.x=p.x+MIN_GAP;
    // An inward collision shares the relative velocity while allowing retreat.
    if(p.vx>c.vx){p.vx=c.vx=(p.vx+c.vx)/2;}
    if(p.x===170&&p.vx<0)p.vx=0;
    if(c.x===825&&c.vx>0)c.vx=0;
  }
  for(const f of [p,c]){
    f.energy=clamp(f.energy+(f.guard?-.008:f.until>m.elapsed?.009:.024)*dt,0,100);
    if(f.attack&&f.until<=m.elapsed)f.attack=null;
  }
  resolve(m,p,c,'player');
  resolve(m,c,p,'cpu');
  if(m.phase!=='fight')return;
  m.time=Math.max(0,m.time-dt);
  if(m.time===0)endRound(m);
}
export function progression(state,result,opponentId){
  if(result.winner!=='player')return {...state,won:false,finished:false};
  const wins=state.wins+1;
  return {wins,used:[...state.used,opponentId],won:true,finished:wins===MATCH_COUNT};
}
