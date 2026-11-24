(() => {
 'use strict';
 const N=window.SSYRNotice,{$,el,feedback}=N;
 let device=N.getDevice(),contact=null,worker=null,key=null,busy=false,localSub=null,initial=false,pending=null,inviteCode='',lastSignature='';
 const ios=/iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 const supported=window.isSecureContext&&'Notification'in window&&'serviceWorker'in navigator&&'PushManager'in window&&(!ios||standalone);
 function render(){
   $('claim-panel').hidden=!!contact||!initial;
   $('settings-panel').hidden=!initial;$('messages').hidden=!initial;
   const registered=!!contact?.enabled&&!!localSub&&supported&&Notification.permission==='granted';
   $('notice-state').textContent=registered?'通知 ON':'通知 OFF';
   $('notice-state').classList.toggle('on',registered);
   if(!busy)$('news').checked=!!contact?.muumeiNews;
   $('device-guide').hidden=supported;
   $('device-guide').textContent=ios?'Safariで名刺をホーム画面に追加し、追加したアイコンから開くと通知を設定できます。':'通知の設定には、対応するブラウザで名刺を開いてください。チャットはこのまま使えます。';
   $('enable').disabled=busy||!supported||!worker||!key||registered;
   $('enable').textContent=contact?.enabled&&!registered?'通知を再設定':'通知をONにする';
   $('test').disabled=busy||!registered;
   $('stop').disabled=busy||!contact||(!contact.enabled&&!localSub);
   $('disconnect').disabled=busy||!contact;
   $('refresh').disabled=busy;$('news').disabled=busy;
   $('chat-send').disabled=busy;$('claim-button').disabled=busy;
   $('claim-button').hidden=!inviteCode&&!$('invite').value.trim();
 }
 function badge(count){const label=$('chat-unread');if(label){label.hidden=!count;label.textContent=count?'未読 '+count+'件':''}try{if(count&&navigator.setAppBadge)void navigator.setAppBadge(count).catch(()=>{});if(!count&&navigator.clearAppBadge)void navigator.clearAppBadge().catch(()=>{})}catch{}}
 function renderMessages(messages){
   const signature=JSON.stringify(messages);
   if(signature===lastSignature)return;
   lastSignature=signature;
   const root=$('message-list');root.replaceChildren();
   if(!messages.length)root.append(el('p','ここから会話を始めましょう。','muted'));
   for(const m of [...messages].reverse()){
     const mine=m.direction==='inbound';
     const article=el('article',undefined,'bubble '+(mine?'mine':'theirs'));
     article.append(el('span',mine?'自分':"S's-YR",'bubble-name'));
     if(m.title&&m.title!=='チャット')article.append(el('h3',m.title));
     article.append(el('p',m.body,'message-body'),el('time',N.date(m.created_at)+(mine&&m.read_at?' · 既読':'')));
     if(!mine&&!m.read_at){
       const b=el('button','既読にする','read-button');b.type='button';
       b.addEventListener('click',()=>void run(async()=>{await N.call('read',{device,id:m.id});await refresh()}));article.append(b);
     }
     root.append(article);
   }
   badge(messages.filter(m=>m.direction!=='inbound'&&!m.read_at).length);
   root.scrollTop=root.scrollHeight;
 }
 async function refresh(){
   if(!N.validToken(device)){contact=null;renderMessages([]);initial=true;render();return}
   try{const r=await N.call('status',{device});contact=r.contact;renderMessages(r.messages||[])}
   catch(e){if(e.status===401){contact=null;N.clearDevice();device='';renderMessages([])}else throw e}
   if(worker)try{localSub=await worker.pushManager.getSubscription()}catch{localSub=null}
   initial=true;render();
 }
 async function ensureContact(){
   if(contact)return contact;
   const pasted=$('invite').value.trim(),invite=inviteCode||N.inviteFrom(pasted);
   if(pasted&&!invite)throw Error('連絡リンクを確認してください。');
   if(!N.validToken(device)){device=N.random();N.setDevice(device)}
   const r=invite?await N.call('claim',{invite,device,muumeiNews:$('news').checked}):
     await N.call('visitor-start',{device,name:$('visitor-name').value.trim(),muumeiNews:$('news').checked});
   contact=r.contact;inviteCode='';$('invite').value='';render();return contact;
 }
 async function prepare(){
   if(!supported)return;
   const [v,reg]=await Promise.all([N.config(),navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'})]);
   if(v.ok!==true||typeof v.vapidPublicKey!=='string')throw Error('通知への接続を確認できません。');
   key=N.decode(v.vapidPublicKey);if(key.length!==65||key[0]!==4)throw Error('通知への接続を確認できません。');
   worker=await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('通知の準備を再試行してください。')),10000))]);
   if(worker.scope!==new URL('./',location.href).href||reg.scope!==worker.scope)throw Error('名刺アプリから開いてください。');
   localSub=await worker.pushManager.getSubscription();
 }
 async function run(task){if(busy)return;busy=true;render();feedback('通信中…');try{await task()}catch(e){feedback(e.message||'もう一度お試しください。',true)}finally{busy=false;render()}}
 const h=new URLSearchParams(location.hash.slice(1)).get('invite');
 if(N.validToken(h)){inviteCode=h;$('invite').value=h;$('invite-options').hidden=true;history.replaceState(null,'',location.pathname+location.search)}
 $('invite').addEventListener('input',render);
 $('claim-form').addEventListener('submit',e=>{e.preventDefault();void run(async()=>{await ensureContact();await refresh();feedback('チャットを開きました。');if(supported&&(!worker||!key))await prepare()})});
 $('chat-form').addEventListener('submit',e=>{e.preventDefault();void run(async()=>{
   const body=$('chat-body').value.trim();if(!body)throw Error('メッセージを入力してください。');
   await ensureContact();
   if(!pending||pending.body!==body)pending={body,requestId:crypto.randomUUID()};
   const r=await N.call('chat-send',{device,body,requestId:pending.requestId});
   if(!r?.message)throw Error('送信結果を確認できません。再送してください。');
   pending=null;$('chat-body').value='';
   const push=r.message.push_status;
   const result=push==='disabled'?'相手の通知はOFFまたは未登録です。':N.pushLabels[push]||'通知結果未確定';
   feedback('メッセージを送信しました。 '+result,push==='failed'||push==='expired'||push==='unknown');
   try{await refresh()}catch{feedback('メッセージを保存しました。 '+result+'。履歴は更新ボタンで確認してください。',true)}
 })});
 $('enable').addEventListener('click',()=>{
   if(busy||!supported||!worker||!key)return;
   const permission=Notification.requestPermission();
   void run(async()=>{
     if(await permission!=='granted')throw Error('ブラウザの通知設定から許可してください。');
     await ensureContact();
     let sub=await worker.pushManager.getSubscription(),created=false;
     if(sub){const existing=sub.options?.applicationServerKey;if(existing){const bytes=new Uint8Array(existing);if(bytes.length!==key.length||!bytes.every((n,i)=>n===key[i])){await sub.unsubscribe();sub=null}}}
     if(!sub){sub=await worker.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});created=true}
     try{const r=await N.call('subscribe',{device,subscription:sub.toJSON()});contact=r.contact;localSub=sub;feedback('通知をONにしました。')}
     catch(e){if(created)await sub.unsubscribe().catch(()=>{});throw e}
   });
 });
 $('test').addEventListener('click',()=>void run(async()=>{const r=await N.call('test',{device});feedback(r.status==='accepted'?'テスト通知を送信しました。端末に表示されるかご確認ください。':N.pushLabels[r.status]||'通知の送信結果を確認できませんでした。',r.status!=='accepted');await refresh()}));
 $('stop').addEventListener('click',()=>void run(async()=>{await N.call('stop',{device});if(localSub)await localSub.unsubscribe().catch(()=>{});await refresh();feedback('通知をOFFにしました。')}));
 $('disconnect').addEventListener('click',()=>{if(!confirm('この端末の連絡登録を解除しますか？'))return;void run(async()=>{await N.call('disconnect',{device});if(localSub)await localSub.unsubscribe().catch(()=>{});N.clearDevice();device='';contact=null;localSub=null;pending=null;renderMessages([]);badge(0);feedback('端末の登録を解除しました。')})});
 $('news').addEventListener('change',()=>{const selected=$('news').checked;void run(async()=>{await ensureContact();const r=await N.call('preferences',{device,muumeiNews:selected});contact=r.contact;feedback('設定を保存しました。')})});
 $('refresh').addEventListener('click',()=>void run(async()=>{if(supported&&(!worker||!key))await prepare();await refresh();feedback('更新しました。')}));
 async function quietRefresh(){if(busy||!contact||document.visibilityState!=='visible')return;busy=true;try{await refresh()}catch{}finally{busy=false;render()}}
 window.addEventListener('focus',quietRefresh);
 if('serviceWorker'in navigator&&navigator.serviceWorker.addEventListener)navigator.serviceWorker.addEventListener('message',e=>{if(e.data?.type==='ssyr-chat-update')void quietRefresh()});
 setInterval(quietRefresh,30000);
 (async()=>{try{await refresh()}catch(e){initial=true;render();feedback(e.message,true)}try{await prepare();render()}catch(e){if(contact)feedback(e.message,true)}})();
})();
