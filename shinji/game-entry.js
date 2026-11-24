(() => {
 'use strict';
 const showcase=document.getElementById('straight-ring-showcase'),link=document.getElementById('straight-ring-play');
 if(!showcase||!link)return;
 const directory=new URL('./games/straight-ring/',location.href);
 const stateUrl=new URL('release.json',directory);
 const entry=new URL('index.html',directory);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6500);
 // Fail closed. A missing game, malformed release, failed request or redirect
 // must never present a non-playable link, including the former hosting URL.
 (async()=>{
  try{
   const options={cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal};
   const state=await fetch(stateUrl,options);
   if(!state.ok)return;
   const data=await state.json();
   if(data?.version!==1||data.ready!==true||data.entry!=='index.html'||typeof data.verifiedCommit!=='string'||!/^[a-f0-9]{40}$/.test(data.verifiedCommit))return;
   const game=await fetch(entry,{...options,method:'HEAD'});
   if(!game.ok||!/^text\/html(?:;|$)/i.test(game.headers.get('Content-Type')||''))return;
   link.href=entry.href;
   showcase.hidden=false;
  }catch{}finally{clearTimeout(timer)}
 })();
})();
