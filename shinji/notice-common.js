(() => {
 'use strict';
 const base='https://slamzhgsawfnmwlejgqp.supabase.co';
 const url=base+'/functions/v1/ssyr-card';
 const deviceKey='ssyr-card-device-v1';
 const $=id=>document.getElementById(id);
 class ApiError extends Error{constructor(status,message){super(message);this.status=status}}
 // Browser APIs (permissions, SW registration, clipboard and push subscription)
 // may never resolve on embedded browsers. Do not let them lock the application.
 function wait(promise,ms=6000,message='端末の処理が時間内に完了しませんでした。もう一度お試しください。'){
   let timer;
   return Promise.race([Promise.resolve(promise),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new ApiError(0,message)),ms)})]).finally(()=>clearTimeout(timer));
 }
 async function jsonRequest(path,options={},timeoutMs=27000){
   const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),timeoutMs);
   try{
     const r=await fetch(path,{...options,signal:controller.signal,cache:'no-store',credentials:'omit',redirect:'error'});
     let data;try{data=await r.json()}catch{throw new ApiError(r.status,'接続できませんでした。')}
     if(!r.ok){
       const code=String(data.error_code||data.code||'');
       if(r.status===429){
         if(code==='over_email_send_rate_limit'||path.includes('/auth/v1/otp'))throw new ApiError(429,'認証メールの送信上限に達しています。再送せず、上のパスワードでログインしてください。');
         throw new ApiError(429,typeof data.error==='string'?data.error:'操作回数の上限に達しました。時間をおいてお試しください。');
       }
       if(path.includes('/auth/v1/token?grant_type=password')&&(r.status===400||r.status===401||r.status===403))throw new ApiError(r.status,'メールアドレスまたはパスワードをご確認ください。');
       throw new ApiError(r.status,typeof data.error==='string'?data.error:typeof data.msg==='string'?'認証内容をご確認ください。':'通信に失敗しました。');
     }
     return data;
   }catch(e){if(e instanceof ApiError)throw e;if(controller.signal.aborted)throw new ApiError(0,'接続が時間内に完了しませんでした。もう一度お試しください。');throw new ApiError(0,'通信に失敗しました。もう一度お試しください。')}
   finally{clearTimeout(timer)}
 }
 const call=(action,fields={},access)=>{
   const slow=['owner-send','chat-send','owner-push-test','test','card-owner-login','card-owner-setup'].includes(action);
   return jsonRequest(url,{method:'POST',headers:{'Content-Type':'application/json',...(access?{Authorization:'Bearer '+access}:{})},body:JSON.stringify({action,...fields})},slow?27000:10000);
 };
 const config=()=>jsonRequest(url,{},8000);
 const requestId=()=>{if(typeof crypto.randomUUID==='function')return crypto.randomUUID();const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const s=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return s.slice(0,8)+'-'+s.slice(8,12)+'-'+s.slice(12,16)+'-'+s.slice(16,20)+'-'+s.slice(20)};
 const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 const validToken=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
 function getDevice(){try{return localStorage.getItem(deviceKey)||''}catch{return ''}}
 function setDevice(v){localStorage.setItem(deviceKey,v);if(localStorage.getItem(deviceKey)!==v)throw Error('端末の保存設定をご確認ください。')}
 function clearDevice(){try{localStorage.removeItem(deviceKey)}catch{}}
 const threadPrefix='ssyr-card-thread-v1:';
 const validThreadId=id=>typeof id==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id);
 function getThreads(){
   try{
     const threads=[];
     for(let i=0;i<localStorage.length;i++){
       const key=localStorage.key(i);
       if(!key?.startsWith(threadPrefix))continue;
       const device=key.slice(threadPrefix.length);if(!validToken(device))continue;
       let row;try{row=JSON.parse(localStorage.getItem(key))}catch{continue}
       threads.push({device,id:validThreadId(row?.id)?row.id:'',added:Number(row?.added)||0});
     }
     const active=getDevice();
     if(validToken(active)&&!threads.some(t=>t.device===active))threads.push({device:active,id:'',added:0});
     return threads.sort((a,b)=>a.added-b.added||a.device.localeCompare(b.device));
   }catch{return []}
 }
 function rememberThread(device,id){
   if(!validToken(device))return;
   const key=threadPrefix+device,raw=localStorage.getItem(key);
   let old;try{old=JSON.parse(raw)}catch{}
   const value=JSON.stringify({id:validThreadId(id)?id:old?.id||'',added:old?.added??Date.now()});
   if(raw!==value)localStorage.setItem(key,value);
 }
 function forgetThread(device){
   localStorage.removeItem(threadPrefix+device);
   if(getDevice()===device)clearDevice();
 }
 async function deviceForInvite(invite,reserve=true){
   const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(invite));
   const key='ssyr-claim-v1:'+Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
   let device=localStorage.getItem(key);
   if(!validToken(device)){if(!reserve)return '';device=random();localStorage.setItem(key,device)}
   return device;
 }
 const startKey='ssyr-card-start-pending-v1';
 function reserveStartDevice(preferred){
   const existing=[preferred,getDevice(),...getThreads().map(t=>t.device)].find(validToken);
   if(existing)return existing;
   let candidate=localStorage.getItem(startKey);
   if(!validToken(candidate)){
     candidate=random();localStorage.setItem(startKey,candidate);
     if(localStorage.getItem(startKey)!==candidate)throw Error('受け取りには、このブラウザーの端末保存を許可してください。');
   }
   return candidate;
 }
 // Reserve the reusable key before the request. Two tabs or a lost response
 // must refer to the same conversation even before the first successful reply.
 async function startDevice(preferred){
   if(navigator.locks?.request)return navigator.locks.request(startKey,()=>reserveStartDevice(preferred));
   if(!window.indexedDB)return reserveStartDevice(preferred);
   return new Promise((resolve,reject)=>{
     const opened=indexedDB.open('ssyr-card-registration',1);
     opened.onupgradeneeded=()=>opened.result.createObjectStore('reservation');
     opened.onerror=()=>reject(Error('このブラウザーの端末保存を確認してください。'));
     opened.onsuccess=()=>{
       const db=opened.result,tx=db.transaction('reservation','readwrite');
       const turn=tx.objectStore('reservation').get('start');
       let candidate;
       turn.onsuccess=()=>{try{candidate=reserveStartDevice(preferred)}catch(e){tx.abort();reject(e)}};
       tx.oncomplete=()=>{db.close();resolve(candidate)};
       tx.onabort=()=>{db.close();reject(Error('受け取りの開始をもう一度お試しください。'))};
     };
   });
 }
 function readVisitorName(input){
   const name=input.value.trim();
   const message=!/[^\s\p{Default_Ignorable_Code_Point}\p{Cc}]/u.test(name)
     ? 'SHINJIにわかる名前を入力してください'
     : name.length>100 ? '名前は100文字以内で入力してください。' : '';
   input.setCustomValidity(message);
   if(message){
     input.focus();
     input.reportValidity();
     input.setCustomValidity('');
     throw Error(message);
   }
   return name;
 }
 async function findLinkedReceiver(preferred=''){
   // A revoked key can still be stored on another tab. Only retire keys the
   // server explicitly reports unlinked; a network error keeps the saved chats.
   const saved=[...new Set([preferred,getDevice(),...getThreads().map(t=>t.device)].filter(validToken))];
   let linked=null;
   for(let offset=0;offset<saved.length&&!linked;offset+=30){
     const devices=saved.slice(offset,offset+30);
     const check=await call('chat-unread',{devices});
     if(!Array.isArray(check.threadIds)||check.threadIds.length!==devices.length||
         !check.threadIds.every(id=>id===null||validThreadId(id)))throw Error('受け取り設定を確認できません。もう一度お試しください。');
     devices.forEach((key,i)=>{
       if(check.threadIds[i]===null){
         forgetThread(key);
         if(localStorage.getItem(startKey)===key)localStorage.removeItem(startKey);
       }else if(!linked)linked={device:key,id:check.threadIds[i]};
     });
   }
   return linked;
 }
 async function startReceiving(name,muumeiNews=false,preferred=''){
   const active=getDevice();
   const linked=await findLinkedReceiver(preferred);
   const device=await startDevice(linked?.device);
   const newlyLinked=!linked&&!getThreads().some(t=>t.device===device);
   const result=await call('visitor-start',{device,name,muumeiNews});
   if(!result?.contact)throw Error('受け取りの開始を確認できません。もう一度お試しください。');
   rememberThread(device,result.contact.id);
   if(!validToken(getDevice())||getDevice()===active)setDevice(device);
   if(localStorage.getItem(startKey)===device)localStorage.removeItem(startKey);
   window.dispatchEvent(new Event('ssyr-chat-unread-changed'));
   return {device,contact:result.contact,newlyLinked};
 }
 function inviteFrom(value){const s=String(value||'').trim();if(validToken(s))return s;try{const u=new URL(s);if(u.origin==='https://mumei-s.github.io'&&u.pathname==='/ssyr-business-card/shinji/notices.html'){const t=new URLSearchParams(u.hash.slice(1)).get('invite');if(validToken(t))return t}}catch{}return ''}
 function date(v){if(!v)return '';const d=new Date(v);return Number.isFinite(d.valueOf())?d.toLocaleString('ja-JP'):''}
 function el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);if(cls)e.className=cls;return e}
 function messageDeleteButton(run,remove,refresh){
   const button=el('button','削除','message-delete');
   button.type='button';
   button.addEventListener('click',()=>{
     if(!confirm('このメッセージを自分と相手の会話履歴から削除しますか？'))return;
     void run(async()=>{
       const result=await remove();
       if(result?.ok!==true)throw Error('削除の結果を確認できません。履歴を更新してください。');
       button.closest('.bubble')?.remove();
       try{await refresh();feedback('メッセージを削除しました。')}
       catch(e){
         if(e.status===401||e.status===403)throw e;
         feedback('メッセージを削除しました。最新の履歴は「更新」で確認できます。',true);
       }
     });
   });
   return button;
 }
 function feedback(message='',error=false){$('feedback').textContent=message;$('feedback').classList.toggle('error',!!error)}
 function decode(s){const b=s.replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(b+'='.repeat((4-b.length%4)%4)),x=>x.charCodeAt(0))}
 const ios=/iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const pushSupported=window.isSecureContext&&'Notification' in window&&!!navigator.serviceWorker&&'PushManager' in window&&
   (!ios||navigator.standalone===true||matchMedia('(display-mode: standalone)').matches);
 let permissionTask,askedPermission=false,workerTask,subscriptionTask;
 function requestPushPermission(retry=false){
   if(!pushSupported)return Promise.resolve('unsupported');
   if(Notification.permission!=='default')return Promise.resolve(Notification.permission);
   if(permissionTask)return permissionTask;
   if(askedPermission&&!retry)return Promise.resolve('default');
   askedPermission=true;
   try{
     // Invoke synchronously inside the initiating tap, before registration I/O.
     permissionTask=wait(Notification.requestPermission(),15000).catch(()=>'default').finally(()=>{permissionTask=null});
     return permissionTask;
   }catch{return Promise.resolve('default')}
 }
 function preparePush(){
   if(!workerTask)workerTask=(async()=>{
     const [settings,reg]=await Promise.all([config(),wait(navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}),10000)]);
     const key=settings.ok===true&&typeof settings.vapidPublicKey==='string'&&decode(settings.vapidPublicKey);
     if(!key||key.length!==65||key[0]!==4||reg.scope!==new URL('./',location.href).href)throw Error('名刺の通知設定を確認してください。');
     for(let i=0;i<16&&!reg.active;i++)await new Promise(resolve=>setTimeout(resolve,250));
     if(!reg.active)throw Error('通知の準備をもう一度お試しください。');
     return {reg,key};
   })().catch(error=>{workerTask=null;throw error});
   return workerTask;
 }
 function compatiblePush(subscription,key){
   const existing=subscription?.options?.applicationServerKey;
   if(!existing)return true;
   const bytes=new Uint8Array(existing);
   return !!key&&bytes.length===key.length&&bytes.every((value,i)=>value===key[i]);
 }
 async function pushBinding(subscription){
   if(!subscription)return '';
   const {endpoint,keys}=subscription.toJSON();
   if(!endpoint||!keys?.p256dh||!keys?.auth)return '';
   const contents=new TextEncoder().encode(JSON.stringify([endpoint,keys.p256dh,keys.auth]));
   return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',contents)),n=>n.toString(16).padStart(2,'0')).join('');
 }
 function pushSubscription(){
   if(!subscriptionTask)subscriptionTask=(async()=>{
     const {reg,key}=await preparePush();
     let subscription=await wait(reg.pushManager.getSubscription(),4000);
     if(!compatiblePush(subscription,key))throw Error('この端末の通知登録が一致しません。名刺の通知設定をご確認ください。');
     if(!subscription)subscription=await wait(reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key}),8000);
     const binding=await pushBinding(subscription);
     if(!binding)throw Error('この端末の通知登録を確認してください。');
     return {subscription,binding,reg,key};
   })().finally(()=>{subscriptionTask=null});
   return subscriptionTask;
 }
 const chatPushKey=device=>'ssyr-chat-push-off-v1:'+device;
 function withPushChoice(device,task){
   return navigator.locks?.request?navigator.locks.request(chatPushKey(device),task):task();
 }
 async function saveChatPush(device,id,initial=false){
   const {subscription,binding}=await pushSubscription();
   return withPushChoice(device,async()=>{
     if(initial&&localStorage.getItem(chatPushKey(device)))return null;
     const {contact}=await call('subscribe',{device,subscription:subscription.toJSON()});
     if(contact?.id!==id||!contact.enabled||contact.pushBinding!==binding)throw Error('この会話の通知登録を確認できませんでした。');
     if(!initial)localStorage.removeItem(chatPushKey(device));
     return contact;
   });
 }
 async function stopChatPush(device){
   localStorage.setItem(chatPushKey(device),'1');
   return withPushChoice(device,()=>call('stop',{device}));
 }
 function privateChoice(input,guide){
   const blocked=!pushSupported||Notification.permission==='denied';
   input.disabled=blocked;
   if(blocked)input.checked=false;
   guide.textContent=!pushSupported?(ios?'端末通知はホーム画面に追加した名刺から設定できます。':'このブラウザーでは端末通知を利用できません。'):
     blocked?'端末通知はブラウザーの設定でブロックされています。':'';
   guide.hidden=!guide.textContent;
 }
 async function finishChatPush(result,permission){
   if(!result.newlyLinked||!permission)return '';
   if(await permission!=='granted')return '端末通知はOFFです。新着は名刺とチャットで確認できます。';
   try{
     const contact=await saveChatPush(result.device,result.contact.id,true);
     return contact?'個別チャットの端末通知をONにしました。':'';
   }catch{return '個別チャットの通知登録を確認できません。チャットの通知設定から再設定できます。'}
 }
 async function publicAuthKey(){const c=await jsonRequest(base+'/functions/v1/public-config',{},10000);if(c.url!==base||typeof c.key!=='string'||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(c.key))throw Error('管理者ログインの接続を確認してください。');return c.key}
 const auth=(action,body,key)=>jsonRequest(base+'/auth/v1/'+action,{method:'POST',headers:{'Content-Type':'application/json',apikey:key},body:JSON.stringify(body)},15000);
 // Accept only this project's verification links. Never navigate to a copied URL.
 function loginVerification(value,email){
   const raw=String(value||'').trim();
   if(/^\d{6,10}$/.test(raw)){
     const address=String(email||'').trim();
     if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))throw Error('メールアドレスも入力してください。');
     return {email:address,token:raw,type:'email'};
   }
   let u;try{u=new URL(raw)}catch{throw Error('メールの「Sign in」を長押しし、リンクをコピーしてください。')}
   if(u.protocol!=='https:'||u.username||u.password||u.hash)throw Error('ログインメールのリンクをご確認ください。');
   const type=u.searchParams.get('type');
   if(type!=='magiclink'&&type!=='email')throw Error('ログインメールのリンクをご確認ください。');
   const direct=u.origin===base&&u.pathname==='/auth/v1/verify';
   const trustedConfirm=['https://muumei-owner.sabosan0404.chatgpt.site','https://muumei.sabosan0404.chatgpt.site','https://mumei-s.github.io'].includes(u.origin)&&['/auth/confirm','/auth/confirm/','/muumei-public/auth/confirm','/muumei-public/auth/confirm/'].includes(u.pathname);
   if(!direct&&!trustedConfirm)throw Error('MUUMEIから届いたログインメールのリンクをご確認ください。');
   const hash=direct?(u.searchParams.get('token')||u.searchParams.get('token_hash')):u.searchParams.get('token_hash');
   if(!hash||!/^[a-zA-Z0-9_-]{32,256}$/.test(hash))throw Error('ログインメールのリンクをご確認ください。');
   return {token_hash:hash,type:'email'};
 }
 const pushLabels={pending:'処理結果未確定',accepted:'通知サービス受付済み',failed:'通知送信失敗',expired:'端末登録期限切れ',disabled:'連絡を保存・通知OFF',unknown:'送信結果未確定'};
 function setBusy(root,busy){for(const b of root.querySelectorAll('button[type=submit]'))b.disabled=busy}
 window.SSYRNotice={base,url,$,call,config,wait,requestId,random,validToken,getDevice,setDevice,clearDevice,getThreads,rememberThread,forgetThread,findLinkedReceiver,readVisitorName,startReceiving,deviceForInvite,validThreadId,inviteFrom,date,el,messageDeleteButton,feedback,decode,publicAuthKey,auth,loginVerification,pushLabels,setBusy,pushSupported,requestPushPermission,preparePush,compatiblePush,pushBinding,pushSubscription,saveChatPush,stopChatPush,privateChoice,finishChatPush};
})();
