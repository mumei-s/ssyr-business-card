// A mobile in-app browser's layout area can be larger than the area a
// player can see. Size the short landscape playfield from the latter.
export function getPlayBounds(viewport, width, height){
  const valid=n=>Number.isFinite(n)&&n>0;
  const visibleWidth=valid(viewport?.width)?viewport.width:width;
  const visibleHeight=valid(viewport?.height)?viewport.height:height;
  const w=Math.floor(Math.min(width,visibleWidth)),h=Math.floor(Math.min(height,visibleHeight));
  if(!valid(w)||!valid(h)||w<=h||h>580)return null;
  const bound=(n,max)=>Math.max(0,Math.min(max,Math.ceil(Number.isFinite(n)?n:0)));
  const left=bound(viewport?.offsetLeft,width-w),top=bound(viewport?.offsetTop,height-h);
  return {w,h,left,top,mode:w>=620?'rail':w>=475?'compact-rail':'stack',short:h<=260};
}

export function initPlayLayout({win=window,root=document.documentElement,viewport=win.visualViewport}={}){
  const keys=['--play-width','--play-height','--play-left','--play-top'];
  let previous,frame=null;
  function update(){
    frame=null;
    const width=root.clientWidth||win.innerWidth;
    const height=root.clientHeight||win.innerHeight;
    const bounds=getPlayBounds(viewport,width,height);
    const fingerprint=bounds?Object.values(bounds).join(':'):'';
    if(fingerprint===previous)return;
    previous=fingerprint;
    if(!bounds){
      delete root.dataset.playLayout;
      delete root.dataset.playLayoutShort;
      for(const key of keys)root.style.removeProperty(key);
      return;
    }
    root.dataset.playLayout=bounds.mode;
    if(bounds.short)root.dataset.playLayoutShort='';
    else delete root.dataset.playLayoutShort;
    for(const [i,n] of [bounds.w,bounds.h,bounds.left,bounds.top].entries())root.style.setProperty(keys[i],n+'px');
  }
  function schedule(){
    if(frame===null)frame=win.requestAnimationFrame(update);
  }
  win.addEventListener('resize',schedule,{passive:true});
  viewport?.addEventListener('resize',schedule,{passive:true});
  viewport?.addEventListener('scroll',schedule,{passive:true});
  update();
  return ()=>{
    win.removeEventListener('resize',schedule);
    viewport?.removeEventListener('resize',schedule);
    viewport?.removeEventListener('scroll',schedule);
    if(frame!==null)win.cancelAnimationFrame(frame);
    delete root.dataset.playLayout;
    delete root.dataset.playLayoutShort;
    for(const key of keys)root.style.removeProperty(key);
  };
}
