(() => {
 'use strict';
 const N=window.SSYRNotice,{$,el,feedback}=N;
 let device=N.getDevice(),contact=null,worker=null,key=null,busy=false,localSub=null;
 const ios=/iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 const supported=window.isSecureContext&&'Notification'in window&&'serviceWorker'in navigator&&'PushManager'in window&&(!ios||standalone);
 const actions=['enable','test','stop','disconnect','refresh','news'];
 let initial=false;
 function render(){
   $('claim-panel').hidden=!!contact||!initial;
   $('settings-panel').hidden=!contact;
   $('messages').hidden=!contact;
   if(!contact)return;
   const registered=!!contact.enabled&&!!localSub&&supported&&Notification.permission==='granted';
   $('recipient-name').textContent=contact.displayName+' さん';
   $('notice-state').textContent=registered?'通知 ON':'通知 OFF';
   $('notice-state').classList.toggle('on',registered);
   if(!busy)$('news').checked=!!contact.muumeiNews;
   $('device-guide').hidden=supported;
   $('device-guide').textContent=ios?'Safariからホーム画面に追加し、追加したアイコンから開いてください。':'対応するブラウザで名刺を開いてください。';
   $('enable').disabled=busy||!supported||!worker||!key||registered;
   $('enable').textContent=contact.enabled&&!registered?'通知を再登録する':'通知を許可する';
   $('test').disabled=busy||!registered;
   $('stop').disabled=busy||(!contact.enabled&&!localSub);
   $('disconnect').disabled=busy;
   $('refresh').disabled=busy;
   $('news').disabled=busy;
 }
 function setBadge(count){try{if(count&&navigator.setAppBadge)void navigator.setAppBadge(count).catch(()=>{});if(!count&&navigator.clearAppBadge)void navigator.clearAppBadge().catch(()=>{})}catch{}}
 function renderMessages(messages){
   const root=$('message-list');root.replaceChildren();
   if(!messages.length)root.append(el('p','新しい連絡はありません。','muted'));
   for(const m of messages){
     const article=el('article',undefined,'message');const top=el('div',undefined,'between');
     top.append(el('h3',m.title),el('span',m.read_at?'既読':'新着','state'+(m.read_at?'':' on')));
     article.append(top,el('time',N.date(m.created_at)),el('p',m.body,'message-body'));
     if(!m.read_at){const b=el('button','既読にする');b.type='button';b.addEventListener('click',()=>run(async()=>{await N.call('read',{device,id:m.id});await refresh()}));article.append(b)}
     root.append(article);
   }
   setBadge(messages.filter(m=>!m.read_at).length);
 }
 async function refresh(){
   if(!N.validToken(device)){contact=null;initial=true;render();return}
   try{
     const r=await N.call('status',{device});
     contact=r.contact;renderMessages(r.messages||[]);
   }catch(e){if(e.status===401){contact=null;N.clearDevice();device=''}else throw e}
   if(worker)try{localSub=await worker.pushManager.getSubscription()}catch{localSub=null}
   initial=true;render();
 }
 async function prepare(){
   if(!supported)return;
   const results=await Promise.all([
     N.config(),
     navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'})
   ]);
   const v=results[0];
   if(v.ok!==true||typeof v.vapidPublicKey!=='string')throw Error('通知への接続を確認できません。');
   key=N.decode(v.vapidPublicKey);
   if(key.length!==65||key[0]!==4)throw Error('通知への接続を確認できません。');
   worker=await navigator.serviceWorker.ready;
   if(worker.scope!==new URL('./',location.href).href)throw Error('名刺アプリから開いてください。');
   localSub=await worker.pushManager.getSubscription();
 }
 async function run(task){if(busy)return;busy=true;render();feedback();try{await task()}catch(e){feedback(e.message||'もう一度お試しください。',true)}finally{busy=false;render()}}
 const hashInvite=new URLSearchParams(location.hash.slice(1)).get('invite');
 if(N.validToken(hashInvite)){ $('invite').value=hashInvite;history.replaceState(null,'',location.pathname+location.search); }
 $('claim-form').addEventListener('submit',e=>{
   e.preventDefault();void run(async()=>{
     const invite=N.inviteFrom($('invite').value);
     if(!invite)throw Error('招待コードまたは招待リンクを確認してください。');
     if(!N.validToken(device)){device=N.random();N.setDevice(device)}
     const r=await N.call('claim',{invite,device,muumeiNews:$('claim-news').checked});
     contact=r.contact;$('invite').value='';await refresh();
     feedback('登録しました。続いて通知を許可してください。');
     if(supported&&(!worker||!key))await prepare();
   });
 });
 $('enable').addEventListener('click',()=>{
   if(busy||!supported||!worker||!key)return;
   // Permission must be requested immediately in the user gesture.
   const permission=Notification.requestPermission();
   void run(async()=>{
     if(await permission!=='granted')throw Error('ブラウザの通知設定から許可してください。');
     let sub=await worker.pushManager.getSubscription(),created=false;
     if(sub){
       const existing=sub.options?.applicationServerKey;
       if(existing){const bytes=new Uint8Array(existing);if(bytes.length!==key.length||!bytes.every((n,i)=>n===key[i])){await sub.unsubscribe();sub=null}}
     }
     if(!sub){sub=await worker.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});created=true}
     try{const r=await N.call('subscribe',{device,subscription:sub.toJSON()});contact=r.contact;localSub=sub;feedback('通知をONにしました。テスト通知を送れます。')}
     catch(e){if(created)await sub.unsubscribe().catch(()=>{});throw e}
   });
 });
 $('test').addEventListener('click',()=>void run(async()=>{const r=await N.call('test',{device});feedback(r.status==='accepted'?'テスト通知を送信しました。端末に表示されるかご確認ください。':N.pushLabels[r.status]||'通知の送信結果を確認できませんでした。',r.status!=='accepted');await refresh()}));
 $('stop').addEventListener('click',()=>void run(async()=>{await N.call('stop',{device});if(localSub)await localSub.unsubscribe().catch(()=>{});await refresh();feedback('通知を停止しました。')}));
 $('disconnect').addEventListener('click',()=>{if(!confirm('この端末の受け取り登録を解除しますか？'))return;void run(async()=>{await N.call('disconnect',{device});if(localSub)await localSub.unsubscribe().catch(()=>{});N.clearDevice();device='';contact=null;localSub=null;$('message-list').replaceChildren();setBadge(0);feedback('端末登録を解除しました。')})});
 $('news').addEventListener('change',()=>{const selected=$('news').checked;void run(async()=>{const r=await N.call('preferences',{device,muumeiNews:selected});contact=r.contact;feedback('設定を保存しました。')})});
 $('refresh').addEventListener('click',()=>void run(async()=>{if(supported&&(!worker||!key))await prepare();await refresh()}));
 window.addEventListener('focus',()=>{if(!busy&&contact)void run(refresh)});
 (async()=>{try{await refresh()}catch(e){initial=true;render();feedback(e.message,true)}try{await prepare();render()}catch(e){if(contact)feedback(e.message,true)}})();
})();
