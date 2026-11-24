(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const button=$('owner-install-button'),guide=$('owner-install-guide'),status=$('owner-install-status'),hint=$('owner-install-hint');
 if(!button||!guide||!status||!hint)return;
 const standalone=matchMedia('(display-mode: standalone)');
 const ios=/iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 let promptEvent=null,installedHere=false,prompting=false;
 const installed=()=>installedHere||standalone.matches||navigator.standalone===true;
 function render(){
   const done=installed();
   button.hidden=done;
   status.hidden=!done;
   if(done){status.textContent='ホーム画面に追加済み';guide.hidden=true;guide.open=false}
   button.disabled=prompting;
 }
 function showGuide(){
   if(installed())return;
   guide.hidden=false;guide.open=true;
   hint.textContent=ios?'Safariの共有ボタン →「ホーム画面に追加」→「追加」を選択してください。':
    'EdgeまたはChromeで開き、ブラウザーのメニューから「アプリをインストール」または「ホーム画面に追加」を選んでください。ChatGPT内で開いている場合は、先に右上のメニューから外部ブラウザーで開いてください。';
 }
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();promptEvent=e;render()});
 window.addEventListener('appinstalled',()=>{installedHere=true;promptEvent=null;prompting=false;render()});
 if(standalone.addEventListener)standalone.addEventListener('change',render);
 button.addEventListener('click',async()=>{
   if(prompting||installed())return;
   if(!promptEvent){showGuide();return}
   const e=promptEvent;promptEvent=null;prompting=true;render();
   try{
     await e.prompt();
     const result=await e.userChoice;
     if(result?.outcome==='accepted'){installedHere=true;guide.hidden=true}
     else showGuide();
   }catch{showGuide()}
   finally{prompting=false;render()}
 });
 // Register before login so installation is available even on the sign-in page.
 // Keep the owner scope distinct from the public card's worker.
 if('serviceWorker'in navigator&&isSecureContext){
   navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).catch(()=>{});
 }
 render();
})();
