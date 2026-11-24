(() => {
 'use strict';
 const N=window.SSYRNotice,{$,el,feedback}=N;
 const ROOT=new URL('./',document.currentScript.src);
 let access='',setupCode='',contacts=[],selectedId='',historyPage=0,busy=false,pending=null,ready=false,mode='chats',promoting=false,editing=false,ownerEnabled=false,ownerWorker=null,ownerKey=null,ownerSub=null,historySignature='';
 const isIOS=/iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const canPush=window.isSecureContext&&'Notification'in window&&'serviceWorker'in navigator&&'PushManager'in window&&(!isIOS||matchMedia('(display-mode: standalone)').matches||navigator.standalone===true);
 const isSaved=c=>!!c&&c.entry_type!=='visitor'&&!!(c.email||c.phone);
 const sessionKey='ssyr-owner-session-v1';
 function loadSession(){try{return sessionStorage.getItem(sessionKey)||''}catch{return ''}}
 function saveSession(v){try{if(v)sessionStorage.setItem(sessionKey,v);else sessionStorage.removeItem(sessionKey)}catch{}}
 function setOwnerBadge(n){try{if(n&&navigator.setAppBadge)void navigator.setAppBadge(n).catch(()=>{});else if(!n&&navigator.clearAppBadge)void navigator.clearAppBadge().catch(()=>{})}catch{}}
 const ownerCall=(action,fields={})=>N.call(action,fields,access);
 const status=c=>c.revoked_at?'解除済み':!c.linked_at?'未接続':c.push_enabled_at?'通知 ON':'通知 OFF';
 const selected=()=>contacts.find(c=>c.id===selectedId);
 function clearAuthInputs(){for(const id of ['login-password','setup-password','setup-confirm','setup-code'])$(id).value='';setupCode=''}
 function hideConsole(){access='';saveSession('');contacts=[];selectedId='';pending=null;ready=false;mode='chats';editing=false;promoting=false;historySignature='';ownerEnabled=false;$('owner-console').hidden=true;$('login-panel').hidden=false;$('setup-panel').hidden=true;clearAuthInputs();$('invite-panel').hidden=true;$('invite-link').value='';$('open-invite').href=new URL('notices.html',ROOT).href;$('contact-form').reset();$('send-form').reset();$('contacts').replaceChildren();$('history').replaceChildren();$('selected-panel').hidden=true;$('edit-panel').hidden=true}
 async function run(fn){
   if(busy)return;busy=true;feedback('通信中…');for(const b of document.querySelectorAll('button'))b.disabled=true;
   try{await fn()}catch(e){if(access&&(e.status===401||e.status===403)){hideConsole();feedback('再ログインしてください。',true)}else feedback(e.message||'もう一度お試しください。',true)}
   finally{busy=false;for(const b of document.querySelectorAll('button'))b.disabled=false;updateControls()}
 }
 function updateControls(){
   const c=selected(),registered=ownerEnabled&&!!ownerSub&&canPush&&Notification.permission==='granted';
   $('muumei-send').disabled=busy||!ready||!contacts.some(c=>c.linked_at&&!c.revoked_at&&c.muumei_news&&c.push_enabled_at);
   $('reissue').disabled=busy||!c||!!c.linked_at&&!c.revoked_at;
   $('revoke').disabled=busy||!c||!!c.revoked_at;
   $('history-prev').disabled=busy||historyPage===0;
   $('history-next').disabled=busy||$('history').dataset.more!=='true';
   $('owner-push-state').textContent=registered?'ON':'OFF';$('owner-push-state').classList.toggle('on',registered);
   $('owner-push-on').disabled=busy||!access||!canPush||!ownerWorker||!ownerKey||registered;
   $('owner-push-off').disabled=busy||!access||!ownerEnabled;
   $('owner-push-test').disabled=busy||!registered;
   $('owner-push-guide').textContent=canPush?'相手からのチャットをこの端末に通知します。':'通知を使う場合は管理者アプリをホーム画面に追加して開いてください。';
 }
 function renderContacts(){
   const q=$('search').value.toLowerCase().trim(),list=$('contacts');
   list.replaceChildren();
   const matches=contacts.filter(c=>mode==='contacts'?isSaved(c):!!c.linked_at||!!c.chat_updated_at||!!c.unread).filter(c=>[c.display_name,c.email,c.phone,c.memo].some(v=>String(v||'').toLowerCase().includes(q)));
   $('contact-count').textContent='('+matches.length+'件)';
   $('tab-chats').setAttribute('aria-pressed',String(mode==='chats'));$('tab-contacts').setAttribute('aria-pressed',String(mode==='contacts'));
   $('new-contact').hidden=mode!=='contacts';
   const unread=contacts.reduce((n,c)=>n+(Number(c.unread)||0),0);
   $('unread-count').textContent=unread?' '+unread:'';
   if(location.pathname.endsWith('/owner/')||location.pathname.endsWith('/owner/index.html'))setOwnerBadge(unread);
   for(const c of matches){
     const row=el('button',undefined,'contact-row'+(selectedId===c.id?' selected':''));
     row.type='button';const txt=el('span',undefined,'contact-row-text');
     txt.append(el('strong',c.display_name),el('small',isSaved(c)?(c.email||c.phone):'チャットのみ'));
     const badge=el('span',c.unread?'未読 '+c.unread:status(c),'state'+(c.unread||c.push_enabled_at?' on':''));
     row.append(txt,badge);
     row.addEventListener('click',()=>void run(async()=>{selectedId=c.id;historyPage=0;historySignature='';editing=mode==='contacts';promoting=false;$('invite-panel').hidden=true;showContact();renderContacts();await history();$('selected-panel').scrollIntoView({block:'start',behavior:'auto'})}));
     list.append(row);
   }
   if(!list.childElementCount)list.append(el('p',mode==='chats'?'新しいチャットはありません。':'電話帳に連絡先を追加できます。','muted'));
 }
 function showContact(fill=true){
   const c=selected();$('selected-panel').hidden=!c;$('edit-panel').hidden=!editing;
   $('edit-title').textContent=promoting?'電話帳に追加':c?'連絡先を編集':'連絡先を追加';
   if(fill){$('contact-name').value=c?.display_name||'';$('contact-email').value=c?.email||'';$('contact-phone').value=c?.phone||'';$('contact-memo').value=c?.memo||''}
   if(c){
     $('selected-name').textContent=c.display_name;$('selected-state').textContent=status(c);$('send-panel').hidden=!c.linked_at||!!c.revoked_at;
     $('promote-contact').hidden=isSaved(c);
     const email=String(c.email||''),phone=String(c.phone||'');
     $('mail-contact').hidden=!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
     $('mail-contact').href=$('mail-contact').hidden?'mailto:':'mailto:'+encodeURIComponent(email).replace(/%40/g,'@');
     $('call-contact').hidden=!/^[+0-9()\s-]{5,50}$/.test(phone);
     $('call-contact').href=$('call-contact').hidden?'tel:':'tel:'+phone.replace(/[()\s-]/g,'');
   }else $('send-panel').hidden=true;
   updateControls();
 }
 async function reload(preserve=false){
   const r=await ownerCall('owner-list');contacts=r.contacts||[];ownerEnabled=r.ownerPushEnabled===true;
   if(!selected())selectedId='';
   renderContacts();showContact(!preserve);
 }
 function showInvite(value){
   const link=new URL('notices.html',ROOT);link.searchParams.set('v','share-2');link.hash='invite='+value;
   $('invite-link').value=link.href;$('open-invite').href=link.href;$('invite-panel').hidden=false;
   $('invite-panel').scrollIntoView({block:'start'});
 }
 async function history(){
   if(!selectedId)return;
   const id=selectedId,r=await ownerCall('owner-history',{contactId:id,page:historyPage});
   if(selectedId!==id)return;
   const root=$('history'),rows=r.messages||[],sig=JSON.stringify([id,historyPage,rows]);
   root.dataset.more=String(rows.length===50);
   if(sig!==historySignature){
     historySignature=sig;root.replaceChildren();
     for(const m of [...rows].reverse()){
       const mine=m.direction!=='inbound',card=el('article',undefined,'bubble '+(mine?'mine':'theirs'));
       card.append(el('span',mine?'自分':selected()?.display_name||'相手','bubble-name'));
       if(m.title&&m.title!=='チャット')card.append(el('h3',m.title));
       card.append(el('p',m.body,'message-body'),el('time',N.date(m.created_at)+(mine&&m.read_at?' · 既読':'')));
       if(mine&&m.push_status!=='accepted')card.append(el('small',N.pushLabels[m.push_status]||'確認中'));
       root.append(card);
     }
     if(!rows.length)root.append(el('p','会話はまだありません。','muted'));
     if(historyPage===0)root.scrollTop=root.scrollHeight;
   }
   if(mode==='chats'&&historyPage===0){
     const ids=rows.filter(m=>m.direction==='inbound'&&!m.read_at).map(m=>m.id);
     if(ids.length){await ownerCall('owner-read',{contactId:id,ids});const c=selected();if(c)c.unread=Math.max(0,(c.unread||0)-ids.length);renderContacts()}
   }
   updateControls();
 }
 async function prepareOwnerPush(){
   if(!canPush)return;
   try{
     const [v,reg]=await Promise.all([N.config(),navigator.serviceWorker.register(new URL('owner/sw.js',ROOT).href,{scope:new URL('owner/',ROOT).href,updateViaCache:'none'})]);
     if(!v.ok||typeof v.vapidPublicKey!=='string')throw Error();
     const k=N.decode(v.vapidPublicKey);if(k.length!==65||k[0]!==4)throw Error();
     // Use the registration returned for OWNER, never the visitor's ready worker.
     const expected=new URL('owner/',ROOT).href;if(reg.scope!==expected)throw Error();
     for(let i=0;i<20&&!reg.active;i++)await new Promise(r=>setTimeout(r,250));
     if(!reg.active)throw Error();
     ownerWorker=reg;ownerKey=k;ownerSub=await reg.pushManager.getSubscription();
   }catch{ownerWorker=null;ownerKey=null}
   updateControls();
 }
 $('owner-push-on').addEventListener('click',()=>{
   if(busy||!access||!ownerWorker||!ownerKey||!canPush)return;
   const permission=Notification.requestPermission();
   void run(async()=>{
     if(await permission!=='granted')throw Error('通知を許可してください。');
     let sub=await ownerWorker.pushManager.getSubscription(),created=false;
     if(sub&&sub.options?.applicationServerKey){const b=new Uint8Array(sub.options.applicationServerKey);if(b.length!==ownerKey.length||!b.every((v,i)=>v===ownerKey[i])){await sub.unsubscribe();sub=null}}
     if(!sub){sub=await ownerWorker.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:ownerKey});created=true}
     try{const result=await ownerCall('owner-push-on',{subscription:sub.toJSON()});ownerEnabled=result.enabled;ownerSub=sub;feedback('管理者通知をONにしました。')}
     catch(e){if(created)await sub.unsubscribe().catch(()=>{});throw e}
   });
 });
 $('owner-push-off').addEventListener('click',()=>void run(async()=>{await ownerCall('owner-push-off');ownerEnabled=false;if(ownerSub)await ownerSub.unsubscribe().catch(()=>{});ownerSub=null;feedback('管理者通知をOFFにしました。')}));
 $('owner-push-test').addEventListener('click',()=>void run(async()=>{const r=await ownerCall('owner-push-test');feedback(r.status==='accepted'?'管理者テスト通知を送信しました。':N.pushLabels[r.status]||'送信結果未確定',r.status!=='accepted');if(r.status==='expired'){ownerEnabled=false;ownerSub=null}}));
 function changeMode(next){
   mode=next;selectedId='';editing=false;promoting=false;historyPage=0;historySignature='';$('invite-panel').hidden=true;showContact();renderContacts();feedback();
 }
 $('tab-chats').addEventListener('click',()=>changeMode('chats'));
 $('tab-contacts').addEventListener('click',()=>changeMode('contacts'));
 $('promote-contact').addEventListener('click',()=>{if(!selected())return;editing=true;promoting=true;showContact();$('edit-panel').scrollIntoView({block:'start'});$('contact-name').focus()});
 async function launchState(){
   // The card repository hosts this page on the same origin as MUUMEI.
   try{const r=await fetch('/muumei-public/muumei-config.json',{cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(6000)});const c=await r.json();ready=r.ok&&c.ready===true&&String(c.appUrl).replace(/\/+$/,'')==='https://mumei-s.github.io/muumei-public'}catch{ready=false}
   $('muumei-state').textContent=ready?'正式公開を確認しました。':'正式公開前';updateControls();
 }
 function showSetup(code=''){
   setupCode=/^[A-F0-9]{20}$/.test(code)?code:'';
   $('setup-code-label').hidden=!!setupCode;
   $('setup-code').required=!setupCode;
   $('setup-code').value=setupCode;
   $('setup-panel').hidden=false;$('login-panel').hidden=true;
 }
 function checkPassword(password){
   const length=new TextEncoder().encode(password).length;
   if(length<12||length>72)throw Error('パスワードは12文字以上、72バイト以内で入力してください。');
 }
 async function finishLogin(token){
   if(typeof token!=='string'||!/^ssyr1_[a-f0-9]{64}$/.test(token))throw Error('ログインできませんでした。');
   access=token;
   try{await reload()}catch(e){access='';throw e}
   $('login-panel').hidden=true;$('setup-panel').hidden=true;$('owner-console').hidden=false;
   saveSession(access);clearAuthInputs();feedback('ログインしました。');void launchState();void prepareOwnerPush();
 }
 $('show-setup').addEventListener('click',()=>{feedback();showSetup()});
 $('back-to-login').addEventListener('click',()=>{clearAuthInputs();$('setup-panel').hidden=true;$('login-panel').hidden=false;feedback()});
 $('show-login-password').addEventListener('change',e=>{$('login-password').type=e.target.checked?'text':'password'});
 $('show-setup-password').addEventListener('change',e=>{for(const id of ['setup-password','setup-confirm'])$(id).type=e.target.checked?'text':'password'});
 $('login-form').addEventListener('submit',e=>{e.preventDefault();void run(async()=>{
   const password=$('login-password').value;
   checkPassword(password);
   const r=await N.call('card-owner-login',{password});
   $('login-password').value='';
   await finishLogin(r.accessToken);
 })});
 $('setup-form').addEventListener('submit',e=>{e.preventDefault();void run(async()=>{
   const code=setupCode||$('setup-code').value.trim().toUpperCase();
   const password=$('setup-password').value;
   checkPassword(password);
   if(password!==$('setup-confirm').value)throw Error('確認用パスワードが一致していません。');
   if(!/^[A-F0-9]{20}$/.test(code))throw Error('初回設定コードをご確認ください。');
   const r=await N.call('card-owner-setup',{code,password});
   clearAuthInputs();
   $('setup-panel').hidden=true;$('login-panel').hidden=false;
   try{await finishLogin(r.accessToken)}catch{feedback('パスワードを設定しました。新しい専用パスワードでログインしてください。',true)}
 })});
 function handleSetupFragment(){
   const fragment=new URLSearchParams(location.hash.slice(1));
   if(fragment.has('setup')){
     const code=(fragment.get('setup')||'').toUpperCase();
     window.history.replaceState(null,'',location.pathname+location.search);
     if(!access&&!busy)showSetup(code);
   }else if(fragment.has('access_token')||fragment.has('refresh_token')||fragment.has('error')||fragment.has('error_code')){
     window.history.replaceState(null,'',location.pathname+location.search);
     if(!access)feedback('電話帳専用パスワードでログインしてください。');
   }
 }
 handleSetupFragment();
 window.addEventListener('hashchange',handleSetupFragment);
 $('logout').addEventListener('click',()=>void run(async()=>{
   const old=access;
   try{await N.call('card-owner-logout',{},old);hideConsole();feedback('ログアウトしました。')}
   catch(e){hideConsole();feedback('この画面からログアウトしました。通信状態をご確認ください。',true)}
 }));
 $('search').addEventListener('input',renderContacts);
 $('reload').addEventListener('click',()=>void run(async()=>{await reload();if(selectedId)await history();if(canPush&&(!ownerWorker||!ownerKey))await prepareOwnerPush();await launchState();feedback('更新しました。')}));
 $('new-contact').addEventListener('click',()=>{mode='contacts';selectedId='';pending=null;historyPage=0;editing=true;promoting=false;$('invite-panel').hidden=true;showContact();renderContacts();$('edit-panel').scrollIntoView({block:'start'});$('contact-name').focus()});
 $('contact-form').addEventListener('submit',e=>{e.preventDefault();void run(async()=>{
   const fields={name:$('contact-name').value,email:$('contact-email').value,phone:$('contact-phone').value,memo:$('contact-memo').value};
   if(!fields.email.trim()&&!fields.phone.trim())throw Error('メールまたは電話番号を入力してください。');
   const r=await ownerCall(promoting?'owner-promote':selectedId?'owner-edit':'owner-create',{...fields,contactId:selectedId});
   selectedId=r.contact.id;historyPage=0;editing=false;promoting=false;mode='contacts';await reload();if(selected()?.linked_at)await history();feedback('電話帳に保存しました。');
 })});
 $('reissue').addEventListener('click',()=>void run(async()=>{if(!selectedId)return;const r=await ownerCall('owner-invite',{contactId:selectedId});await reload();showInvite(r.invite);feedback('招待リンクを発行しました。')}));
 $('revoke').addEventListener('click',()=>{if(!selectedId||!confirm('この相手の端末登録を解除しますか？'))return;void run(async()=>{await ownerCall('owner-revoke',{contactId:selectedId});$('invite-panel').hidden=true;await reload();feedback('登録を解除しました。')})});
 $('copy-invite').addEventListener('click',()=>void run(async()=>{try{await navigator.clipboard.writeText($('invite-link').value);feedback('招待リンクをコピーしました。')}catch{$('invite-link').focus();$('invite-link').select();feedback('表示したリンクをコピーしてください。')}}));
 $('share-invite').addEventListener('click',()=>{const url=$('invite-link').value;if(navigator.share)void navigator.share({title:"S's-YR 受け取り登録",url}).catch(()=>{});else $('copy-invite').click()});
 $('send-form').addEventListener('submit',e=>{e.preventDefault();void run(async()=>{
   if(!selectedId)return;
   const title='チャット',body=$('message-body').value.trim();if(!body)throw Error('メッセージを入力してください。');
   const signature=JSON.stringify([selectedId,title,body]);if(!pending||pending.signature!==signature)pending={signature,requestId:crypto.randomUUID()};
   const r=await ownerCall('owner-send',{contactId:selectedId,title,body,requestId:pending.requestId});
   pending=null;$('send-form').reset();historyPage=0;await history();feedback('メッセージを送信しました。'+(N.pushLabels[r.message.push_status]||'送信結果未確定'));
 })});
 $('history-prev').addEventListener('click',()=>void run(async()=>{historyPage=Math.max(0,historyPage-1);await history()}));
 $('history-next').addEventListener('click',()=>void run(async()=>{historyPage++;await history()}));
 async function quietRefresh(){if(busy||!access||editing||document.visibilityState!=='visible')return;busy=true;try{await reload(true);if(selectedId)await history()}catch(e){if(e.status===401||e.status===403){hideConsole();feedback('再ログインしてください。',true)}}finally{busy=false;updateControls()}}
 window.addEventListener('focus',quietRefresh);
 if('serviceWorker'in navigator&&navigator.serviceWorker.addEventListener)navigator.serviceWorker.addEventListener('message',e=>{if(e.data?.type==='ssyr-owner-update')void quietRefresh()});
 setInterval(quietRefresh,30000);
 const saved=loadSession();
 if(saved&&/^ssyr1_[a-f0-9]{64}$/.test(saved)&&$('setup-panel').hidden){void run(async()=>{try{await finishLogin(saved)}catch(e){saveSession('');throw e}})}
 $('muumei-send').addEventListener('click',()=>{
   const targets=contacts.filter(c=>c.linked_at&&!c.revoked_at&&c.muumei_news&&c.push_enabled_at);
   if(!ready||!targets.length||!confirm(targets.length+'件の希望者へMUUMEIの正式公開案内を送りますか？'))return;
   void run(async()=>{
     let accepted=0,other=0,duplicates=0;
     for(const c of targets){try{
       // A contact's ID is a deterministic, dedicated request ID for the one-time launch.
       const r=await ownerCall('owner-send',{contactId:c.id,requestId:c.id,purpose:'muumei',title:'MUUMEI 正式公開のお知らせ',body:'会員制プライベートSNS MUUMEIが正式公開されました。名刺のMUUMEI紹介から、招待・会員登録へお進みください。'});
       if(r.duplicate)duplicates++;else if(r.message.push_status==='accepted')accepted++;else other++;
     }catch{other++}}
     feedback('通知サービス受付 '+accepted+'件 ／ 送信済み '+duplicates+'件 ／ その他 '+other+'件');if(selectedId)await history();
   });
 });
 $('owner-app-link').href=new URL('owner/',ROOT).href;
 if(location.pathname.endsWith('/owner/')||location.pathname.endsWith('/owner/index.html'))$('owner-app-link').hidden=true;
})();
