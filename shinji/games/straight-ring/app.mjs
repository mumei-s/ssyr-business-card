import {ROUND_MS,MATCH_COUNT,PRIZE,MOVES,opponentOptions,classOf,makeMatch,advance,drain,launch,progression} from './engine.mjs?v=3';
import {render,STOCK_FIGHTERS} from './render.mjs?v=5';
import {initCharacterLab} from './character.js';
import {createPlayGestureGuard} from './play-gestures.mjs?v=3';
import {initPlayLayout} from './play-layout.mjs?v=4';
import {createSuperStyleDeck} from './super-style.mjs?v=5';

initPlayLayout();

const $=id=>document.getElementById(id);
const menu=$('setup'),rules=$('rules'),outcome=$('outcome');
const ring=$('ring'),ctx=ring.getContext('2d');
const arena=ring.parentElement;
const setPlayGestureGuard=createPlayGestureGuard(document.documentElement,document.querySelector('meta[name=viewport]'),[arena,document.querySelector('.console')]);
const superCut=$('super-cut'),superPortrait=$('super-portrait');
const nextSuperStyle=createSuperStyleDeck();
const superArtCache=new Map();
function getSuperArt(id,alt=false){
  const path='./art/super-'+id+(alt?'-alt':'')+'.webp';
  if(!superArtCache.has(path)){
    const image=new Image();image.src=path;
    image.decode?.().catch(()=>{});
    superArtCache.set(path,image);
  }
  return superArtCache.get(path);
}
let impactStyle='bolt';
let sceneUntil=0, cutUntil=0, customPortrait='';
function clearCinematic(){sceneUntil=0;cutUntil=0;superCut.hidden=true;superCut.classList.remove('cut-live');}
function specialCinematic(now){
  const custom=settings.fighter==='custom'&&look;
  const id=Object.hasOwn(STOCK_FIGHTERS,settings.fighter)?settings.fighter:'rose';
  const {style,alternate}=nextSuperStyle();
  if(custom&&customPortrait)superPortrait.src=customPortrait;
  else{
    const normal=getSuperArt(id),alt=alternate?getSuperArt(id,true):null;
    superPortrait.src=alt?.complete&&alt.naturalWidth?alt.src:normal.src;
  }
  impactStyle=style;
  superCut.dataset.variant=style;
  superCut.classList.toggle('cut-custom',!!custom);
  superCut.dataset.fighter=custom?'rose':settings.fighter;
  $('super-owner').textContent=settings.name+' / SPECIAL';
  const duration=reducedMotion.matches?760:1760;
  superCut.style.setProperty('--cut-duration',duration+'ms');
  superCut.classList.remove('cut-live');
  superCut.hidden=false;void superCut.offsetWidth;superCut.classList.add('cut-live');
  // Release the punch after the panel starts to leave; the actual contact
  // happens in the ring, rather than behind the illustration.
  sceneUntil=now+duration-95;
  cutUntil=now+duration;
}
const buttons=[...document.querySelectorAll('.console button')];
const pad=$('pad'),holdIds=['up','down','left','right','guard'];
const holds=new Map();
const KEY={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',w:'up',s:'down',a:'left',d:'right',' ':'guard'};
const PUNCH={j:'jab',k:'straight',l:'hook',i:'upper',e:'card'};
const friendlyType={male:'男性',female:'女性'};
const settingsKey='hikari-boxing.profile.v1';
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
let settings={name:'マイキャラ',kg:55,type:'any',opponent:'rin',fighter:'rose'};
let match=null,state={wins:0,used:[]},appearance=null,look=null,last=performance.now(),effects=[],resultAction=null,sound=false,audio=null,pause=false,flashLabel='',flashUntil=0,shapeRatio=1;
function store(){
  try{localStorage.setItem(settingsKey,JSON.stringify(settings));}catch{/* Private browsing still plays. */}
}
try{
  const stored=JSON.parse(localStorage.getItem(settingsKey)||'null');
  if(stored&&typeof stored.name==='string'&&Number.isFinite(stored.kg)&&stored.kg>=35&&stored.kg<=150&&['any','female','male'].includes(stored.type)){
    settings={name:stored.name.slice(0,18)||'マイキャラ',kg:stored.kg,type:stored.type,opponent:stored.opponent,fighter:(Object.hasOwn(STOCK_FIGHTERS,stored.fighter)||stored.fighter==='custom')?stored.fighter:'rose'};
  }
}catch{/* corrupted or unavailable local storage; leave default */}
function optionList(select,items,selected){
  select.replaceChildren(...items.map(f=>new Option(f.name+'（'+friendlyType[f.type]+'・'+f.style+'）',f.id)));
  if(items.some(f=>f.id===selected))select.value=selected;
}
function refreshClass(){
  const value=$('weight').valueAsNumber;
  $('weight-class').textContent=Number.isFinite(value)&&value>=35&&value<=150?classOf(value)+'級':'体重を入力';
}
$('nickname').value=settings.name;
$('weight').value=settings.kg;
$('opponent-type').value=settings.type;
optionList($('opponent'),opponentOptions(settings.type),settings.opponent);
refreshClass();
$('weight').addEventListener('input',refreshClass);
$('opponent-type').addEventListener('change',()=>optionList($('opponent'),opponentOptions($('opponent-type').value)));
const fighterSelect=$('fighter-select'),customOption=fighterSelect.querySelector('[value=custom]');
fighterSelect.value=settings.fighter==='custom'?'rose':settings.fighter;
let characterReady=false;
try{
 initCharacterLab({onCharacter:character=>{
  look=character?.sprite??null;customOption.disabled=!look;
  customPortrait='';
  if(look){try{customPortrait=look.currentSrc||look.src||look.toDataURL?.('image/png')||'';}catch{/* tainted or unavailable canvas */}
  }
  if(look&&(characterReady||settings.fighter==='custom'))fighterSelect.value='custom';
  else if(!look&&fighterSelect.value==='custom')fighterSelect.value='rose';
  characterReady=true;
 }});
}catch(err){
 // The default fighter can still be used if the character editor cannot open.
 $('character-lab').textContent='キャラクター作成画面を開けませんでした。既定のキャラクターで遊べます。';
 console.warn('Character editor did not start',err);
}

function show(dialog){
  clearHolds();setPlayGestureGuard(false);
  if(!dialog.open)dialog.showModal();
}
$('setup-open').addEventListener('click',()=>show(menu));
$('rules-open').addEventListener('click',()=>show(rules));
$('profile-form').addEventListener('submit',event=>{
  event.preventDefault();
  const value=$('weight').valueAsNumber;
  if(!Number.isFinite(value)||value<35||value>150)return;
  settings={name:$('nickname').value.trim().slice(0,18)||'マイキャラ',kg:value,type:$('opponent-type').value,opponent:$('opponent').value,fighter:customOption.disabled&&fighterSelect.value==='custom'?'rose':fighterSelect.value||'rose'};
  store();menu.close();
  state={wins:0,used:[]};start(settings.opponent);
});
function start(id){
  clearCinematic();
  appearance=opponentOptions(settings.type,state.used).find(f=>f.id===id)??opponentOptions(settings.type,state.used)[0];
  if(!appearance)return;
  if(outcome.open)outcome.close();
  pause=false;effects=[];clearHolds();flashLabel='';flashUntil=0;
  match=makeMatch({bout:state.wins});last=performance.now();setPlayGestureGuard(true);
  $('intro').hidden=true;$('back').hidden=false;arena.classList.remove('lobby');
  $('player-name').textContent=settings.name;$('cpu-name').textContent=appearance.name;$('cpu-style').textContent=appearance.style;
  $('division').textContent=classOf(settings.kg)+'級';
  $('battle-log').textContent='ゴングで試合開始';
  // Warm up the selected illustration during the first round, not on impact.
  if(settings.fighter!=='custom'){
    getSuperArt(settings.fighter);
    getSuperArt(settings.fighter,true);
  }
  bracket();hud();
}
function home(){
  clearCinematic();setPlayGestureGuard(false);
  if(outcome.open)outcome.close();
  match=null;appearance=null;pause=false;effects=[];clearHolds();flashLabel='';flashUntil=0;
  $('intro').hidden=false;$('back').hidden=true;arena.classList.add('lobby');
  $('battle-log').textContent='有効打・ガード成功でチャージ';hud();$('setup-open').focus();
}
$('result-home').addEventListener('click',home);
$('result-primary').addEventListener('click',()=>resultAction?.());
outcome.addEventListener('cancel',event=>event.preventDefault());

const pauseDialog=document.createElement('dialog');
pauseDialog.className='dialog outcome';
pauseDialog.setAttribute('aria-label','試合を一時停止');
pauseDialog.innerHTML='<p class="kicker">PAUSE</p><h2>試合を一時停止</h2><div class="outcome-actions"><button type="button" class="cta">試合に戻る</button><button type="button" class="quiet">タイトルへ戻る</button></div>';
document.body.append(pauseDialog);
pauseDialog.querySelector('.cta').addEventListener('click',()=>pauseDialog.close());
pauseDialog.querySelector('.quiet').addEventListener('click',()=>{pauseDialog.close();home();});
pauseDialog.addEventListener('close',()=>{pause=false;last=performance.now();if(match&&match.phase!=='result')setPlayGestureGuard(true);});
$('back').addEventListener('click',()=>{if(!match||match.phase==='result')return;pause=true;show(pauseDialog);});

function syncHold(){
  for(const button of document.querySelectorAll('[data-hold]')){
    const pressed=[...holds.values()].includes(button.dataset.hold);
    button.classList.toggle('pressed',pressed);
  }
}
function clearHolds(){holds.clear();syncHold();}
function setHold(source,kind){
  if(match?.phase==='fight'&&!pause)holds.set(source,kind);
  syncHold();
}
function release(source){if(holds.delete(source))syncHold();}
function input(){
  const a=[...holds.values()];
  return {x:+a.includes('right')-a.includes('left'),y:+a.includes('down')-a.includes('up'),guard:a.includes('guard')};
}
function padDirection(event){
  const rect=pad.getBoundingClientRect(),dx=event.clientX-rect.left-rect.width/2,dy=event.clientY-rect.top-rect.height/2;
  if(Math.hypot(dx,dy)<rect.width*.15)return null;
  return Math.abs(dx)>Math.abs(dy)?dx<0?'left':'right':dy<0?'up':'down';
}
pad.addEventListener('pointerdown',event=>{
  if(match?.phase!=='fight'||pause)return;
  event.preventDefault();pad.setPointerCapture(event.pointerId);
  const d=padDirection(event);if(d)setHold(event.pointerId,d);
});
pad.addEventListener('pointermove',event=>{
  if(!pad.hasPointerCapture(event.pointerId))return;
  const d=padDirection(event);if(d)setHold(event.pointerId,d);else release(event.pointerId);
});
for(const t of ['pointerup','pointercancel','lostpointercapture'])pad.addEventListener(t,event=>release(event.pointerId));
const guard=document.querySelector('[data-hold=guard]');
guard.addEventListener('pointerdown',event=>{
  event.preventDefault();
  if(guard.disabled)return;
  guard.setPointerCapture(event.pointerId);setHold(event.pointerId,'guard');
});
for(const t of ['pointerup','pointercancel','lostpointercapture'])guard.addEventListener(t,event=>release(event.pointerId));

function strike(kind){
  if(!match||pause||sceneUntil>performance.now()||input().guard)return;
  if(launch(match,kind))tone(150,75,.025);
}
for(const b of buttons.filter(b=>b.dataset.punch)){
  // A second finger can attack while the first finger keeps moving. Do not
  // depend on compatibility clicks, which can be primary-touch only.
  b.addEventListener('pointerdown',event=>{
    if(b.disabled||event.button!==0)return;
    event.preventDefault();strike(b.dataset.punch);
  });
  b.addEventListener('click',event=>{if(event.detail===0)strike(b.dataset.punch);});
}
window.addEventListener('keydown',event=>{
  if(!match||pause||menu.open||outcome.open||rules.open||event.ctrlKey||event.metaKey||event.altKey)return;
  if(event.target?.matches?.('input,select,textarea'))return;
  const k=event.key.length===1?event.key.toLowerCase():event.key;
  if(KEY[k]){event.preventDefault();setHold('k'+k,KEY[k]);}
  else if(PUNCH[k]){event.preventDefault();if(!event.repeat)strike(PUNCH[k]);}
});
window.addEventListener('keyup',event=>{
  const k=event.key.length===1?event.key.toLowerCase():event.key;
  if(KEY[k])release('k'+k);
});
window.addEventListener('blur',clearHolds);
document.addEventListener('visibilitychange',()=>{clearHolds();last=performance.now();});

$('sound').addEventListener('click',async()=>{
  sound=!sound;
  if(sound){
    try{audio??=new (window.AudioContext||window.webkitAudioContext)();await audio.resume();}catch{sound=false;}
  }
  $('sound').textContent='音 '+(sound?'ON':'OFF');
  $('sound').setAttribute('aria-pressed',String(sound));
  if(sound)tone(400,150,.035);
});
function tone(freq,duration,volume){
  if(!sound||!audio||audio.state!=='running')return;
  try{
    const osc=audio.createOscillator(),amp=audio.createGain(),t=audio.currentTime;
    osc.type='triangle';osc.frequency.setValueAtTime(freq,t);osc.frequency.exponentialRampToValueAtTime(freq*.71,t+duration/1000);
    amp.gain.setValueAtTime(volume,t);amp.gain.exponentialRampToValueAtTime(.001,t+duration/1000);
    osc.connect(amp);amp.connect(audio.destination);osc.start(t);osc.stop(t+duration/1000);
  }catch{/* sound is optional */}
}
function bar(id,value){
  const v=Math.max(0,Math.round(value));
  const item=$(id);
  if(item.getAttribute('aria-valuenow')!==String(v)){
    item.setAttribute('aria-valuenow',String(v));item.style.setProperty('--amount',v+'%');
  }
}
function setText(id,value){const n=$(id);if(n.textContent!==value)n.textContent=value;}
function bracket(){
  $('bracket').replaceChildren(...Array.from({length:MATCH_COUNT},(_,i)=>{
    const li=document.createElement('li'),done=i<state.wins;
    li.textContent=done?'✓':String(i+1);
    if(done)li.className='done';
    if(i===state.wins){li.className='current';li.setAttribute('aria-current','step');}
    li.setAttribute('aria-label',(i+1)+'試合目'+(done?' 勝利':''));
    return li;
  }));
}
function hud(){
  const active=match?.phase==='fight'&&!pause&&!outcome.open;
  for(const button of buttons){
    const blocked=!active||(button.id==='card'&&(match.p.meter<100||match.p.guard));
    if(button.disabled!==blocked)button.disabled=blocked;
  }
  if(!match){
    bar('meter',0);$('card').classList.remove('ready');setText('card-percent','0%');$('stage-banner').hidden=true;return;
  }
  const m=match;
  bar('player-vital',m.p.vital);bar('cpu-vital',m.cpu.vital);bar('energy',m.p.energy);bar('meter',m.p.meter);
  setText('player-percent',String(Math.round(m.p.vital)));setText('cpu-percent',String(Math.round(m.cpu.vital)));
  const tit=`ROUND ${m.round}/3`;setText('round',tit);
  const secs=Math.ceil(m.time/1000);
  setText('timer',Math.floor(secs/60)+':'+String(secs%60).padStart(2,'0'));
  setText('card-percent',Math.floor(m.p.meter)+'%');
  $('card').classList.toggle('ready',m.p.meter>=100);
  const banner=m.phase==='intro'?state.wins===MATCH_COUNT-1?'FINAL BOUT':'ROUND 1':
    m.phase==='rest'?'INTERVAL':m.phase==='count'?'COUNT '+(m.knock?.count||1):performance.now()<flashUntil?flashLabel:'';
  $('stage-banner').hidden=!banner;
  if(banner)setText('stage-banner',banner);
}
function events(items,now){
  for(const {event,value} of items){
    if(event==='bell'){tone(940,300,.05);setText('battle-log','ラウンド '+value+'！');}
    if(event==='rest'){tone(700,160,.04);setText('battle-log','採点 '+value.join(' : ')+' ／ インターバル');clearHolds();}
    if(event==='down'){tone(90,235,.05);clearHolds();setText('battle-log',value==='player'?'ダウン！カウント中':'相手がダウン！');}
    if(event==='count')tone(320+value*15,80,.021);
    if(event==='card'){
      specialCinematic(now);setText('battle-log','必殺：ストレートフラッシュ');
      tone(820,420,.055);
    }
    if(event==='hit'||event==='block'){
      const hit=event==='hit',side=hit?value.side:value;
      const target=side==='player'?match.cpu:match.p, special=hit&&value.kind==='card';
      if(!reducedMotion.matches){
        effects.push({kind:hit?'hit':'block',x:target.x,y:246,time:now,life:360});
        if(special)effects.push({kind:'card',variant:impactStyle,x:target.x,y:238+target.y*.4,time:now,life:550});
      }
      if(special)tone(112,220,.064);else tone(hit?220:410,hit?109:82,.042);
      if(hit&&side==='player'){
        setText('battle-log',mFull()?'ゲージ満タン！ 必殺カードが使えます':MOVES[value.kind].label+' がヒット！');
      }
      if(hit&&side==='cpu'){setText('battle-log','相手のパンチがヒット');}
      if(!hit&&side==='cpu')setText('battle-log',mFull()?'ゲージ満タン！ 必殺カードが使えます':'ガード成功！ ゲージ＋');
      if(!hit&&side==='player')setText('battle-log','相手がガード');
    }
    if(event==='result')finish(value);
  }
}
function mFull(){return match?.p.meter>=100;}
function finish(result){
  clearCinematic();clearHolds();state=progression(state,result,appearance.id);bracket();
  outcome.classList.toggle('champion',!!state.finished);
  $('ending').hidden=!state.finished;
  $('next-picker').hidden=!state.won||state.finished;
  $('result-score').textContent=result.method==='判定'?'採点 '+result.score.join(' : '):result.method+' ／ ROUND '+match.round;
  if(state.finished){
    $('result-art').textContent='🏆 ✦ 🥇';$('result-kicker').textContent='HIKARI STRAIGHT CHAMPION';
    $('result-title').textContent=classOf(settings.kg)+'級 チャンピオン！';
    $('result-copy').textContent='トロフィー・チャンピオンベルト・ゲーム内賞金 '+PRIZE.toLocaleString('ja-JP')+' G を獲得！';
    $('result-primary').textContent='もう一度タイトル戦へ';resultAction=()=>{state={wins:0,used:[]};start(settings.opponent);};
    tone(620,470,.075);
  }else if(state.won){
    $('result-art').textContent='✦';$('result-kicker').textContent='BOUT CLEARED';
    $('result-title').textContent=state.wins+'試合目 勝利！';
    $('result-copy').textContent='現在 '+state.wins+' / '+MATCH_COUNT+' 勝。次の相手を選べます。';
    const next=opponentOptions(settings.type,state.used);
    optionList($('next-opponent'),next);$('result-primary').textContent='次の試合へ';
    resultAction=()=>start($('next-opponent').value);tone(510,300,.053);
  }else{
    $('result-art').textContent='◇';$('result-kicker').textContent=result.winner==='draw'?'DRAW':'TRY AGAIN';
    $('result-title').textContent=result.winner==='draw'?'引き分け':'今回は敗戦';
    $('result-copy').textContent='勝った試合はそのまま。第'+(state.wins+1)+'試合から再挑戦できます。';
    $('result-primary').textContent='同じ相手に再挑戦';resultAction=()=>start(appearance.id);
  }
  show(outcome);
}
let lastHud=0;
const sizing=()=>{
 const {width,height}=ring.getBoundingClientRect();
 if(width>0&&height>0)shapeRatio=Math.max(.58,Math.min(1.22,(height/ring.height)/(width/ring.width)));
};
if('ResizeObserver' in window)new ResizeObserver(sizing).observe(ring);
window.addEventListener('resize',()=>{clearHolds();sizing();});
window.addEventListener('orientationchange',clearHolds);
sizing();
function frame(now){
  const dt=Math.min(65,Math.max(0,now-last));
  if(match&&!pause&&!document.hidden&&match.phase!=='result'&&now>=sceneUntil){
    advance(match,dt,input());
  }
  last=now;
  if(match)events(drain(match),now);
  if(cutUntil&&now>=cutUntil)clearCinematic();
  effects=effects.filter(e=>now-e.time<e.life);
  if(match&&!document.hidden){
    render(ctx,match,settings.fighter==='custom'?look:null,appearance,effects,now,settings.fighter,shapeRatio);
  }
  if(now-lastHud>=32){lastHud=now;hud();}
  requestAnimationFrame(frame);
}
home();
requestAnimationFrame(frame);
