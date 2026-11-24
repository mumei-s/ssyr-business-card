(() => {
 'use strict';
 const N=window.SSYRNotice,{$,el,feedback}=N;
 let device=N.getDevice(),contact=null,worker=null,key=null,busy=false,localSub=null,initial=false,pending=null,inviteCode='',lastSignature='',quietBusy=false,revision=0,preparing=false;
 let threadChoices=[];
 let messageCount=null,writing=false;
 const drafts=new Map();
 const ios=/iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 const supported=window.isSecureContext&&'Notification'in window&&'serviceWorker'in navigator&&'PushManager'in window&&(!ios||standalone);
 function render(){
   $('claim-panel').hidden=(!inviteCode&&!!contact)||!initial;
   $('settings-panel').hidden=!initial||!!inviteCode;$('messages').hidden=!initial||!!inviteCode;
   $('claim-title').textContent=inviteCode?'個別チャットへの招待':'SHINJIとの個別チャット';
   $('claim-info').textContent=inviteCode?'「チャットを開く」を押すと、相手からのメッセージを読めます。':'連絡を受け取りたい方は、下のボタンを押してください。メッセージの送信やメールアドレスの入力は不要です。';
   const privateInvite=!!(inviteCode||$('invite').value.trim());
   $('visitor-name-label').hidden=privateInvite;$('visitor-name').required=!privateInvite;
   $('invite-options').hidden=!!inviteCode;$('dismiss-invite').hidden=!inviteCode;
   const saved=N.getThreads().map(t=>t.device);
   if(saved.join()!==threadChoices.join()){
     threadChoices=saved;
     $('thread-select').replaceChildren(...saved.map((_,i)=>{const option=el('option','チャット '+(i+1));option.value=String(i);return option}));
   }
   $('thread-picker').hidden=!saved.length||(saved.length===1&&saved[0]===device);
   $('thread-select').value=String(saved.indexOf(device));$('thread-select').disabled=busy;
   const registered=!!contact?.enabled&&!!localSub&&supported&&Notification.permission==='granted';
   $('notice-state').textContent=registered?'通知 ON':'通知 OFF';
   $('notice-state').classList.toggle('on',registered);
   if(!busy)$('news').checked=!!contact?.muumeiNews;
   $('device-guide').hidden=supported&&!preparing&&!!worker&&!!key;
   $('device-guide').textContent=preparing?'通知を準備しています。チャットはそのまま使えます。':supported?'通知の準備を再試行できます。':ios?'Safariで名刺をホーム画面に追加し、追加したアイコンから開くと通知を設定できます。':'通知の設定には、対応するブラウザで名刺を開いてください。チャットはこのまま使えます。';
   $('enable').disabled=busy||!supported||preparing||registered;
   $('enable').textContent=contact?.enabled&&!registered?'通知を再設定':'通知をONにする';
   $('test').disabled=busy||!registered;
   $('stop').disabled=busy||!contact?.enabled;
   $('disconnect').disabled=busy||!contact;
   $('refresh').disabled=busy;$('news').disabled=busy;
   $('chat-send').disabled=busy;$('claim-button').disabled=busy;
   for(const button of $('message-list').querySelectorAll('.message-delete'))button.disabled=busy;
   $('claim-button').textContent=inviteCode||$('invite').value.trim()?'チャットを開く':'SHINJIからの連絡を受け取る';
   renderComposer();
 }
 function renderComposer(){
   const acceptedEmpty=!!contact&&messageCount===0;
   const optional=acceptedEmpty&&!writing&&!$('chat-body').value;
   $('chat-accepted').hidden=!acceptedEmpty;
   $('message-list').hidden=!messageCount;
   $('chat-compose-open').hidden=!optional;
   $('chat-form').hidden=optional||(N.validToken(device)&&(!contact||messageCount===null));
 }
 function badge(count){const label=$('chat-unread');label.hidden=!count;label.textContent=count?'未読 '+count+'件':'';window.dispatchEvent(new Event('ssyr-chat-unread-changed'))}
 function renderMessages(messages){
   const signature=JSON.stringify(messages);
   if(signature===lastSignature)return;
   lastSignature=signature;messageCount=messages.length;renderComposer();
   const root=$('message-list');root.replaceChildren();
   for(const m of [...messages].reverse()){
     const mine=m.direction==='inbound';
     const article=el('article',undefined,'bubble '+(mine?'mine':'theirs'));
     article.append(el('span',mine?'自分':"S's-YR",'bubble-name'));
     if(m.title&&m.title!=='チャット')article.append(el('h3',m.title));
     article.append(el('p',m.body,'message-body'),el('time',N.date(m.created_at)+(mine&&m.read_at?' · 既読':'')));
     if(mine&&m.id)article.append(N.messageDeleteButton(run,()=>N.call('chat-delete',{device,id:m.id}),refresh));
     if(!mine&&!m.read_at){
       const b=el('button','既読にする','read-button');b.type='button';
       b.addEventListener('click',()=>void run(async()=>{await N.call('read',{device,id:m.id});await refresh()}));article.append(b);
     }
     root.append(article);
   }
   badge(messages.filter(m=>m.direction!=='inbound'&&!m.read_at).length);
   root.scrollTop=root.scrollHeight;
 }
 async function refresh(accept=()=>true){
   if(!accept())return;
   if(!N.validToken(device)){contact=null;renderMessages([]);initial=true;render();return}
   try{const r=await N.call('status',{device});if(!accept())return;contact=r.contact;N.rememberThread(device,contact?.id);renderMessages(r.messages||[])}
   catch(e){if(!accept())return;if(e.status===401){forgetCurrentThread()}else throw e}
   initial=true;render();
   // The chat must not wait for the browser's PushManager to respond.
   if(worker){const reg=worker;void N.wait(reg.pushManager.getSubscription(),4000).then(sub=>{if(worker===reg&&accept()){localSub=sub;render()}}).catch(()=>{})}
 }
 async function ensureContact(){
   if(inviteCode||$('invite').value.trim())throw Error('個別リンクは「チャットを開く」で受け取ってください。');
   if(contact)return contact;
   const result=await N.startReceiving(N.readVisitorName($('visitor-name')),$('news').checked,device);
   device=result.device;contact=result.contact;render();return contact;
 }
 function clearInvite(){
   inviteCode='';$('invite').value='';
   if(history.state?.chatInvite||location.hash.startsWith('#invite='))history.replaceState(null,'',location.pathname+location.search);
 }
 function forgetCurrentThread(){
   N.forgetThread(device);drafts.delete(device);device='';contact=null;pending=null;
   writing=false;
   $('chat-body').value='';lastSignature='';renderMessages([]);render();
 }
 function activateThread(next,summary){
   if(!summary)throw Error('会話を確認できません。もう一度お試しください。');
   const previous=N.getDevice();
   if(N.validToken(previous)&&previous!==next)N.rememberThread(previous);
   if(N.validToken(device)&&device!==next)N.rememberThread(device,contact?.id);
   N.rememberThread(next,summary.id);N.setDevice(next);
   if(device!==next){
     if(device&&$('chat-body').value)drafts.set(device,$('chat-body').value);
     else drafts.delete(device);
     $('chat-body').value=drafts.get(next)||'';pending=null;lastSignature='';
     messageCount=null;writing=false;
     $('message-list').replaceChildren();$('chat-unread').hidden=true;
   }
   device=next;contact=summary;clearInvite();render();
 }
 async function openSaved(next){
   let r;
   try{r=await N.call('status',{device:next})}
   catch(e){if(e.status===401&&next!==device)N.forgetThread(next);throw e}
   activateThread(next,r.contact);renderMessages(r.messages||[]);
 }
 async function openNotification(id){
   const threads=N.getThreads(),known=threads.find(t=>t.id===id);
   if(known){await openSaved(known.device);return}
   for(const thread of threads.filter(t=>!t.id)){
     let r;
     try{r=await N.call('status',{device:thread.device})}
     catch(e){if(e.status===401)continue;throw e}
     N.rememberThread(thread.device,r.contact?.id);
     if(r.contact?.id===id){activateThread(thread.device,r.contact);renderMessages(r.messages||[]);return}
   }
   await refresh();throw Error('通知の会話をこのブラウザで確認できませんでした。');
 }
 async function prepare(){
   if(!supported||preparing)return;
   preparing=true;render();
   try{
     const [v,reg]=await N.wait(Promise.all([N.config(),navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'})]),9000,'通知の準備を再試行してください。');
     if(v.ok!==true||typeof v.vapidPublicKey!=='string')throw Error('通知への接続を確認できません。');
     const k=N.decode(v.vapidPublicKey);if(k.length!==65||k[0]!==4)throw Error('通知への接続を確認できません。');
     const active=await N.wait(navigator.serviceWorker.ready,6000,'通知の準備を再試行してください。');
     if(active.scope!==new URL('./',location.href).href||reg.scope!==active.scope)throw Error('名刺アプリから開いてください。');
     worker=active;key=k;localSub=await N.wait(worker.pushManager.getSubscription(),5000);
   }catch(e){worker=null;key=null;throw e}
   finally{preparing=false;render()}
 }
 async function run(task){
   if(busy)return;revision++;busy=true;render();feedback('通信中…');
   const slow=setTimeout(()=>feedback('通信に時間がかかっています。送信中の内容は履歴をご確認ください。'),12000);
   try{await task()}catch(e){feedback(e.message||'もう一度お試しください。',true)}
   finally{clearTimeout(slow);busy=false;render()}
 }
 function pendingInvite(){
   const h=new URLSearchParams(location.hash.slice(1)).get('invite');
   if(N.validToken(h)){
     inviteCode=h;history.replaceState({chatInvite:h},'',location.pathname+location.search);
   }else if(N.validToken(history.state?.chatInvite))inviteCode=history.state.chatInvite;
 }
 pendingInvite();
 $('invite').addEventListener('input',render);
 $('dismiss-invite').addEventListener('click',()=>void run(async()=>{clearInvite();render();await refresh();feedback()}));
 $('claim-form').addEventListener('submit',e=>{e.preventDefault();void run(async()=>{
   if(!inviteCode&&!$('invite').value.trim()){
     await ensureContact();feedback('受け取り設定が完了しました。');
     await refresh();return;
   }
   const invite=inviteCode||N.inviteFrom($('invite').value);
   if(!invite)throw Error('連絡リンクを確認してください。');
   const next=await N.deviceForInvite(invite);
   const r=await N.call('claim',{invite,device:next,muumeiNews:false});
   activateThread(next,r.contact);await refresh();feedback('招待を受け取りました。');
 })});
 $('thread-select').addEventListener('change',()=>{const next=threadChoices[$('thread-select').selectedIndex];if(next&&next!==device)void run(async()=>{await openSaved(next);feedback()})});
 $('chat-compose-open').addEventListener('click',()=>{writing=true;renderComposer();$('chat-body').focus()});
 $('chat-form').addEventListener('submit',e=>{e.preventDefault();void run(async()=>{
   const body=$('chat-body').value.trim();if(!body)throw Error('メッセージを入力してください。');
   await ensureContact();
   if(!pending||pending.body!==body)pending={body,requestId:N.requestId()};
   const r=await N.call('chat-send',{device,body,requestId:pending.requestId});
   if(!r?.message)throw Error('送信結果を確認できません。再送してください。');
   pending=null;$('chat-body').value='';
   const push=r.message.push_status;
   const result=push==='disabled'?'相手の通知はOFFまたは未登録です。':N.pushLabels[push]||'通知結果未確定';
   feedback('メッセージを送信しました。 '+result,push==='failed'||push==='expired'||push==='unknown');
   try{await refresh()}catch{feedback('メッセージを保存しました。 '+result+'。履歴は更新ボタンで確認してください。',true)}
 })});
 $('enable').addEventListener('click',()=>{
   if(busy||!supported||preparing)return;
   if(!contact){
     try{N.readVisitorName($('visitor-name'))}catch(e){feedback(e.message,true);return}
   }
   const permission=N.wait(Notification.requestPermission(),15000,'通知の許可画面が応答しません。ブラウザーの通知設定をご確認ください。');
   void run(async()=>{
     if(await permission!=='granted')throw Error('ブラウザの通知設定から許可してください。');
     if(!worker||!key)await prepare();
     if(!worker||!key)throw Error('通知を準備できませんでした。もう一度お試しください。');
     await ensureContact();
     let sub=await N.wait(worker.pushManager.getSubscription()),created=false;
     if(sub){const existing=sub.options?.applicationServerKey;if(existing){const bytes=new Uint8Array(existing);if(bytes.length!==key.length||!bytes.every((n,i)=>n===key[i])){await N.wait(sub.unsubscribe());sub=null}}}
     if(!sub){sub=await N.wait(worker.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key}),10000);created=true}
     try{const r=await N.call('subscribe',{device,subscription:sub.toJSON()});contact=r.contact;localSub=sub;feedback('通知をONにしました。')}
     catch(e){if(created)await N.wait(sub.unsubscribe()).catch(()=>{});throw e}
   });
 });
 $('test').addEventListener('click',()=>void run(async()=>{const r=await N.call('test',{device});feedback(r.status==='accepted'?'テスト通知を送信しました。端末に表示されるかご確認ください。':N.pushLabels[r.status]||'通知の送信結果を確認できませんでした。',r.status!=='accepted');await refresh()}));
 $('stop').addEventListener('click',()=>void run(async()=>{await N.call('stop',{device});await refresh();feedback('この会話の通知をOFFにしました。')}));
 $('disconnect').addEventListener('click',()=>{if(!confirm('この会話の端末登録を解除しますか？'))return;void run(async()=>{await N.call('disconnect',{device});forgetCurrentThread();feedback('この会話の端末登録を解除しました。')})});
 $('news').addEventListener('change',()=>{const selected=$('news').checked;void run(async()=>{await ensureContact();const r=await N.call('preferences',{device,muumeiNews:selected});contact=r.contact;feedback('設定を保存しました。')})});
 $('refresh').addEventListener('click',()=>void run(async()=>{await refresh();feedback('更新しました。');if(supported&&(!worker||!key))void prepare().catch(()=>{})}));
 async function quietRefresh(){
   if(busy||quietBusy||!contact||document.visibilityState!=='visible')return;
   quietBusy=true;const stamp=revision,secret=device;
   const accept=()=>stamp===revision&&!busy&&device===secret&&document.visibilityState==='visible';
   try{await refresh(accept)}catch{}finally{quietBusy=false;if(!busy)render()}
 }
 window.addEventListener('focus',quietRefresh);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void quietRefresh()});
 if('serviceWorker'in navigator&&navigator.serviceWorker.addEventListener)navigator.serviceWorker.addEventListener('message',e=>{if(e.data?.type==='ssyr-chat-update')void quietRefresh()});
 setInterval(quietRefresh,30000);
 $('recover-page').addEventListener('click',()=>{if((busy||$('chat-body').value.trim())&&!confirm('画面を再読み込みします。未送信の入力は消えることがあります。送信中だった場合は履歴をご確認ください。'))return;location.reload()});
 // Render immediately, even while the first read or notification preparation is pending.
 initial=true;render();
 function handleNotification(){
   const id=new URLSearchParams(location.hash.slice(1)).get('thread');
   if(!N.validThreadId(id))return false;
   void run(async()=>{await openNotification(id);history.replaceState(null,'',location.pathname+location.search);feedback()});return true;
 }
 window.addEventListener('hashchange',()=>{if(!handleNotification()){pendingInvite();render()}});
 if(!handleNotification()&&N.validToken(device)){
   const stamp=revision,secret=device;
   void refresh(()=>stamp===revision&&!busy&&device===secret).catch(e=>{if(stamp===revision&&!busy)feedback(e.message,true)});
 }else renderMessages([]);
 void prepare().catch(()=>{});

})();
