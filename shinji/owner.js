(() => {
 'use strict';
 const N=window.SSYRNotice,{$,el,feedback}=N;
 const ROOT=new URL('./',document.currentScript.src);
 let access='',setupCode='',contacts=[],selectedId='',historyPage=0,busy=false,pending=null,ready=false,mode='chats',promoting=false,editing=false,ownerEnabled=false,ownerWorker=null,ownerKey=null,ownerSub=null,historySignature='';
 const isIOS=/iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const canPush=window.isSecureContext&&'Notification'in window&&'serviceWorker'in navigator&&'PushManager'in window&&(!isIOS||matchMedia('(display-mode: standalone)').matches||navigator.standalone===true);
 const isSaved=c=>!!c&&c.entry_type!=='visitor'&&!!(c.email||c.phone);
 const sessionKey='ssyr-owner-session-v1',rememberKey='ssyr-owner-remember-v1';
 const validSession=v=>typeof v==='string'&&/^ssyr1_[a-f0-9]{64}$/.test(v);
 let remembered=false,quietBusy=false,revision=0,pushPreparing=false;
 const drafts=new Map();
 let displayedContact='',newChatRequest=null;
 const inviteCacheKey='ssyr-owner-invite-copies-v1';
 let inviteCopies=new Map(),displayedInvite=null;
 try{inviteCopies=new Map(JSON.parse(sessionStorage.getItem(inviteCacheKey)||'[]'))}catch{}
 function saveInviteCopies(){
   try{
     if(inviteCopies.size)sessionStorage.setItem(inviteCacheKey,JSON.stringify([...inviteCopies]));
     else sessionStorage.removeItem(inviteCacheKey);
   }catch{}
 }
 function currentInvite(c){
   const copy=inviteCopies.get(c.id);
   if(!copy)return null;
   if(!N.validToken(copy.token)||c.linked_at||c.revoked_at||copy.until<=Date.now()||
       ('invite_expires_at' in c&&Date.parse(c.invite_expires_at)!==copy.until)){
     inviteCopies.delete(c.id);saveInviteCopies();return null;
   }
   return copy;
 }
 const startRetryKey='ssyr-owner-start-retry-v1';
 function clearStartRequest(){
   newChatRequest=null;
   try{sessionStorage.removeItem(startRetryKey)}catch{}
 }
 async function getStartRequest(name,body){
   if(newChatRequest?.name===name&&newChatRequest.body===body)return newChatRequest;
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([name,body])));
   const fingerprint=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
   let saved;try{saved=JSON.parse(sessionStorage.getItem(startRetryKey))}catch{}
   if(saved?.fingerprint!==fingerprint||!N.validThreadId(saved.requestId)||!N.validToken(saved.invite)){
     saved={fingerprint,requestId:N.requestId(),invite:N.random()};
     try{sessionStorage.setItem(startRetryKey,JSON.stringify(saved))}catch{}
   }
   return newChatRequest={name,body,requestId:saved.requestId,invite:saved.invite};
 }
 function loadSession(){
   try{const v=localStorage.getItem(rememberKey);if(validSession(v)){remembered=true;return v}}catch{}
   try{return sessionStorage.getItem(sessionKey)||''}catch{return ''}
 }
 function saveSession(v,keep=false){
   let persisted=false;
   try{if(v&&keep){localStorage.setItem(rememberKey,v);persisted=true}else localStorage.removeItem(rememberKey)}catch{}
   try{if(v)sessionStorage.setItem(sessionKey,v);else sessionStorage.removeItem(sessionKey)}catch{}
   remembered=persisted;
   const hint=$('owner-session-status');
   if(hint)hint.textContent=persisted?'この端末でログイン保持中（最長30日）':'';
 }
 function showReconnect(on){$('owner-reconnect').hidden=!on}
 function setOwnerBadge(n){try{if(n&&navigator.setAppBadge)void navigator.setAppBadge(n).catch(()=>{});else if(!n&&navigator.clearAppBadge)void navigator.clearAppBadge().catch(()=>{})}catch{}}
 const ownerCall=(action,fields={})=>N.call(action,fields,access);
 const status=c=>c.revoked_at?'解除済み':!c.linked_at?(c.owner_started?'受け取り待ち':'未接続'):'受け取り済み';
 const pushStatus=c=>c.push_enabled_at?'通知 ON':'通知 OFF';
 const hasAcceptance=c=>!!c.acceptance_at&&!c.acceptance_seen_at&&!c.revoked_at&&!c.chat_hidden_at;
 const canHide=c=>!!c?.revoked_at&&!c.chat_hidden_at;
 const selected=()=>contacts.find(c=>c.id===selectedId);
 let requestedContact='';
 function clearAuthInputs(){for(const id of ['login-password','setup-password','setup-confirm','setup-code'])$(id).value='';setupCode=''}
 function hideConsole(){requestedContact='';$('owner-acceptance-list').replaceChildren();$('owner-acceptances').hidden=true;access='';saveSession('');showReconnect(false);contacts=[];selectedId='';displayedContact='';drafts.clear();inviteCopies.clear();saveInviteCopies();closeInvite();pending=null;clearStartRequest();setNewChatForm(false);$('new-chat-form').reset();ready=false;mode='chats';editing=false;promoting=false;historySignature='';ownerEnabled=false;$('owner-console').hidden=true;$('login-panel').hidden=false;$('setup-panel').hidden=true;clearAuthInputs();$('invite-panel').hidden=true;$('invite-link').value='';$('contact-form').reset();$('send-form').reset();$('contacts').replaceChildren();$('history').replaceChildren();$('selected-panel').hidden=true;$('edit-panel').hidden=true}
 async function run(fn){
   if(busy)return;
   revision++;busy=true;feedback('通信中…');
   // Keep navigation/recovery reachable; only the foreground action is locked.
   const buttons=Array.from(document.querySelectorAll('button')).filter(b=>!['owner-install-button','recover-page'].includes(b.id));
   for(const b of buttons)b.disabled=true;
   const slow=setTimeout(()=>feedback('通信に時間がかかっています。画面を再読み込みする前に、送信済みの履歴をご確認ください。'),12000);
   try{await fn()}catch(e){if(access&&(e.status===401||e.status===403)){hideConsole();feedback('再ログインしてください。',true)}else feedback(e.message||'もう一度お試しください。',true)}
   finally{clearTimeout(slow);busy=false;for(const b of buttons)b.disabled=false;updateControls();openRequestedContact()}
 }
 function updateControls(){
   const c=selected(),registered=ownerEnabled&&!!ownerSub&&canPush&&Notification.permission==='granted';
   $('muumei-send').disabled=busy||!ready||!contacts.some(c=>c.linked_at&&!c.revoked_at&&c.muumei_news&&c.push_enabled_at);
   $('reissue').disabled=busy||!c||!!c.linked_at&&!c.revoked_at;
   $('revoke').disabled=busy||!c||!!c.revoked_at;
   $('history-prev').disabled=busy||historyPage===0;
   $('history-next').disabled=busy||$('history').dataset.more!=='true';
   $('owner-push-state').textContent=registered?'ON':'OFF';$('owner-push-state').classList.toggle('on',registered);
   $('owner-push-on').disabled=busy||!access||!canPush||pushPreparing||registered;
   $('owner-push-off').disabled=busy||!access||!ownerEnabled;
   $('owner-push-test').disabled=busy||!registered;
   $('owner-push-guide').textContent=pushPreparing?'通知を準備しています…':registered?'招待の受け取りと新着メッセージを、この端末にも通知します。':canPush?'招待の受け取りはこの管理画面に表示されます。端末でも受け取るには「管理者通知をON」を押してください。':'招待の受け取りはこの管理画面に表示されます。端末通知を使う場合は管理者アプリをホーム画面に追加して開いてください。';
 }
 function renderAcceptances(){
   const events=contacts.filter(hasAcceptance).sort((a,b)=>Date.parse(b.acceptance_at)-Date.parse(a.acceptance_at));
   const box=$('owner-acceptances'),list=$('owner-acceptance-list');
   box.hidden=events.length===0;
   const rows=events.map(c=>{
     const row=el('button',undefined,'contact-row');row.type='button';row.dataset.contactId=c.id;
     const copy=el('span',undefined,'contact-row-text');
     copy.append(el('strong',c.display_name+' さんが招待を受け取りました'),el('small',N.date(c.acceptance_at)));
     row.append(copy,el('span','→'));
     row.addEventListener('click',()=>void run(()=>openContact(c.id,'chats')));
     return row;
   });
   list.replaceChildren(...rows);
 }
 async function openContact(id,view){
   const contact=contacts.find(c=>c.id===id);
   if(!contact||view==='chats'&&contact.chat_hidden_at){feedback('この会話は一覧にありません。',true);return}
   mode=view;selectedId=id;historyPage=0;historySignature='';editing=view==='contacts';promoting=false;
   showContact();renderContacts();
   await history();
   $('selected-panel').scrollIntoView({block:'start',behavior:'auto'});
   if(hasAcceptance(contact)){
     await ownerCall('owner-ack-acceptance',{contactId:id,acceptanceAt:contact.acceptance_at});
     await reload(true);
   }
   feedback();
 }
 function openRequestedContact(){
   if(!access||busy||!requestedContact)return;
   const id=requestedContact;requestedContact='';
   void run(async()=>{await reload(true);$('search').value='';await openContact(id,'chats')});
 }
 function hideRevoked(c){
   if(busy||!canHide(c))return;
   const question='「'+c.display_name+'」（解除 '+N.date(c.revoked_at)+'）をチャット一覧から消しますか？'+(isSaved(c)?' 電話帳の連絡先は残ります。':'');
   if(!confirm(question))return;
   void run(async()=>{
     await ownerCall('owner-hide-revoked',{contactId:c.id,revokedAt:c.revoked_at});
     if(selectedId===c.id){selectedId='';historyPage=0;editing=false;promoting=false}
     await reload();
     drafts.delete(c.id);
     feedback('解除済みのチャットを一覧から消しました。');
   });
 }
 function renderContacts(){
   const q=$('search').value.toLowerCase().trim(),list=$('contacts');
   list.replaceChildren();
   const matches=contacts.filter(c=>mode==='contacts'?isSaved(c):!c.chat_hidden_at&&(c.owner_started||!!c.linked_at||!!c.chat_updated_at||!!c.unread||!!c.revoked_at)).filter(c=>[c.display_name,c.email,c.phone,c.memo].some(v=>String(v||'').toLowerCase().includes(q)));
   $('contact-count').textContent='('+matches.length+'件)';
   $('tab-chats').setAttribute('aria-pressed',String(mode==='chats'));$('tab-contacts').setAttribute('aria-pressed',String(mode==='contacts'));
   $('new-contact').hidden=mode!=='contacts';
   $('new-chat').hidden=mode!=='chats';$('chat-list-guide').hidden=mode!=='chats';
   const unread=contacts.filter(c=>!c.chat_hidden_at&&!c.revoked_at).reduce((n,c)=>n+(Number(c.unread)||0),0);
   $('unread-count').textContent=unread?' '+unread:'';
   if(location.pathname.endsWith('/owner/')||location.pathname.endsWith('/owner/index.html'))setOwnerBadge(unread+contacts.filter(hasAcceptance).length);
   for(const c of matches){
     const row=el('button',undefined,'contact-row'+(selectedId===c.id?' selected':''));
     row.type='button';const txt=el('span',undefined,'contact-row-text');
     const detail=isSaved(c)?(c.email||c.phone):'';
     const linkState=c.revoked_at?'解除 '+N.date(c.revoked_at):c.linked_at?'受け取り '+N.date(c.linked_at)+' · '+pushStatus(c):'';
     txt.append(el('strong',c.display_name),el('small',[detail,linkState].filter(Boolean).join(' · ')||'チャットのみ'));
     const unreadHere=!c.revoked_at&&!c.chat_hidden_at&&c.unread;
     const badge=el('span',unreadHere?'未読 '+c.unread:status(c),'state'+(unreadHere||c.linked_at&&!c.revoked_at?' on':''));
     row.append(txt,badge);
     row.addEventListener('click',()=>void run(()=>openContact(c.id,mode)));
     if(mode==='chats'&&canHide(c)){
       const group=el('div',undefined,'revoked-chat-row'),remove=el('button','一覧から消す','hide-revoked');
       remove.type='button';remove.dataset.contactId=c.id;remove.addEventListener('click',()=>hideRevoked(c));
       group.append(row,remove);list.append(group);
     }else list.append(row);
   }
   if(!list.childElementCount)list.append(el('p',mode==='chats'?'新しいチャットはありません。':'電話帳に連絡先を追加できます。','muted'));
 }
 function showContact(fill=true){
   const c=selected();$('selected-panel').hidden=!c;$('edit-panel').hidden=!editing;
   if(displayedContact!==selectedId){
     closeInvite();
     const body=$('message-body'),thread=$('history');
     if(displayedContact&&body.value)drafts.set(displayedContact,body.value);
     else drafts.delete(displayedContact);
     displayedContact=selectedId;body.value=drafts.get(selectedId)||'';
     historySignature='';thread.replaceChildren();thread.dataset.more='false';
   }
   syncInvite(c);
   $('edit-title').textContent=promoting?'電話帳に追加':c?'連絡先を編集':'連絡先を追加';
   if(fill){$('contact-name').value=c?.display_name||'';$('contact-email').value=c?.email||'';$('contact-phone').value=c?.phone||'';$('contact-memo').value=c?.memo||''}
   if(c){
     $('selected-name').textContent=c.display_name;$('selected-state').textContent=status(c)+(c.linked_at&&!c.revoked_at?' · '+pushStatus(c):'');$('send-panel').hidden=!c.linked_at||!!c.revoked_at;
     $('hide-selected').hidden=mode!=='chats'||!canHide(c);
     $('promote-contact').hidden=isSaved(c);
     const email=String(c.email||''),phone=String(c.phone||'');
     $('mail-contact').hidden=!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
     $('mail-contact').href=$('mail-contact').hidden?'mailto:':'mailto:'+encodeURIComponent(email).replace(/%40/g,'@');
     $('call-contact').hidden=!/^[+0-9()\s-]{5,50}$/.test(phone);
     $('call-contact').href=$('call-contact').hidden?'tel:':'tel:'+phone.replace(/[()\s-]/g,'');
   }else $('send-panel').hidden=true;
   updateControls();
 }
 async function reload(preserve=false,accept=()=>true){
   const r=await ownerCall('owner-list');
   if(!accept())return false;
   const next=r.contacts||[],changed=JSON.stringify(next)!==JSON.stringify(contacts);
   contacts=next;ownerEnabled=r.ownerPushEnabled===true;
   for(const c of contacts)currentInvite(c);
   if(!selected()||mode==='chats'&&selected().chat_hidden_at)selectedId='';
   if(!preserve||changed){renderContacts();renderAcceptances()}
   if(!preserve)showContact(true);else if(changed)showContact(false);else{syncInvite(selected());updateControls()}
   return true;
 }
 function closeInvite(){
   displayedInvite=null;$('invite-panel').hidden=true;$('invite-link').value='';
   $('invite-qr').width=1;$('invite-qr').hidden=true;
   $('show-invite').setAttribute('aria-expanded','false');$('show-invite').textContent='専用QRを表示';
 }
 function syncInvite(contact){
   const canInvite=contact&&!contact.linked_at&&!contact.revoked_at;
   $('invite-handoff').hidden=!canInvite;
   if(displayedInvite&&(!canInvite||displayedInvite!==currentInvite(contact)))closeInvite();
 }
 function showInvite(contact,value){
   if(!contact||contact.id!==selectedId||!N.validToken(value))throw Error('専用リンクの発行結果を確認してください。');
   const until=Date.parse(contact.invite_expires_at)||Date.now()+7*86400000;
   const copy={token:value,until};
   inviteCopies.set(contact.id,copy);saveInviteCopies();displayedInvite=copy;
   const link=new URL('notices.html',ROOT);link.searchParams.set('v','share-2');link.hash='invite='+value;
   $('invite-link').value=link.href;$('invite-handoff').hidden=false;$('invite-panel').hidden=false;
   $('show-invite').setAttribute('aria-expanded','true');$('show-invite').textContent='専用QRを閉じる';
   const canvas=$('invite-qr');
   try{window.SSYRInviteQR.draw(canvas,link.href);canvas.hidden=false;$('invite-qr-unavailable').hidden=true}
   catch{canvas.hidden=true;$('invite-qr-unavailable').hidden=false}
   $('invite-handoff').scrollIntoView({block:'start'});
 }
 async function issueInvite(){
   const contact=selected();
   if(!contact||contact.linked_at&&!contact.revoked_at)return;
   if(Date.parse(contact.invite_expires_at)>Date.now()&&
      !confirm('新しい専用QRとリンクを発行しますか？ 以前のQRとリンクは使えなくなります。'))return;
   const result=await ownerCall('owner-invite',{contactId:contact.id});
   if(result.contact?.id!==contact.id||!N.validToken(result.invite))throw Error('専用リンクの発行結果を確認してください。');
   Object.assign(contact,result.contact);showContact(false);renderContacts();
   showInvite(contact,result.invite);feedback('専用QRとリンクを発行しました。');
 }
 function draftTransfer(message){
   const group=el('div'),choose=el('button','登録した相手への下書きに使う','reuse-message');
   choose.type='button';group.append(choose);
   choose.addEventListener('click',()=>{
     group.replaceChildren(choose);
     const recipients=contacts.filter(c=>c.id!==selectedId&&c.linked_at&&!c.revoked_at);
     if(!recipients.length){
       group.append(el('p','相手が名刺で「SHINJIからの連絡を受け取る」を押すと、ここで選べます。'));
       return;
     }
     const label=el('label','下書きを開く相手'),picker=el('select',undefined,'draft-target');
     const placeholder=el('option','相手を選んでください');placeholder.value='';picker.append(placeholder);
     for(const c of recipients){
       const option=el('option',c.display_name+'（登録 '+N.date(c.linked_at)+'）');option.value=c.id;picker.append(option);
     }
     label.append(picker);
     const open=el('button','下書きを開く','open-message-draft');open.type='button';
     group.append(label,open);picker.focus();
     open.addEventListener('click',()=>{
       const to=contacts.find(c=>c.id===picker.value&&c.linked_at&&!c.revoked_at);
       if(!to){feedback('下書きを開く相手を選んでください。',true);return}
       if(drafts.get(to.id)&&drafts.get(to.id)!==message&&!confirm('この相手への入力途中の下書きを置き換えますか？'))return;
       void run(async()=>{
         drafts.set(to.id,message);selectedId=to.id;mode='chats';historyPage=0;editing=false;promoting=false;
         $('search').value='';showContact();renderContacts();
         await history();$('message-body').focus();feedback('宛先と内容を確認し、「チャット送信」を押してください。');
       });
     });
   });
   return group;
 }
 async function history(accept=()=>true,markRead=true){
   if(!selectedId)return;
   const id=selectedId,page=historyPage,r=await ownerCall('owner-history',{contactId:id,page});
   if(!accept()||selectedId!==id||historyPage!==page)return;
   const waiting=selected()?.owner_started&&!selected().linked_at&&!selected().revoked_at;
   const root=$('history'),rows=r.messages||[],sig=JSON.stringify([id,historyPage,waiting,rows]);
   root.dataset.more=String(rows.length===50);
   if(sig!==historySignature){
     historySignature=sig;root.replaceChildren();
     for(const m of [...rows].reverse()){
       const mine=m.direction!=='inbound',card=el('article',undefined,'bubble '+(mine?'mine':'theirs'));
       card.append(el('span',mine?'自分':selected()?.display_name||'相手','bubble-name'));
       if(m.title&&m.title!=='チャット')card.append(el('h3',m.title));
       card.append(el('p',m.body,'message-body'),el('time',N.date(m.created_at)+(mine&&m.read_at?' · 既読':'')));
       if(mine&&m.push_status!=='accepted')card.append(el('small',waiting?'保存済み · 相手の受け取り待ち':N.pushLabels[m.push_status]||'確認中'));
       if(waiting&&mine&&m.body)card.append(draftTransfer(m.body));
       if(mine&&m.id)card.append(N.messageDeleteButton(run,
         ()=>ownerCall('owner-delete-message',{contactId:id,id:m.id}),
         async()=>{
           if(historyPage>0&&!root.querySelector('.bubble'))historyPage--;
           await history();
         }));
       root.append(card);
     }
     if(!rows.length)root.append(el('p','会話はまだありません。','muted'));
     if(historyPage===0)root.scrollTop=root.scrollHeight;
   }
   if(markRead&&mode==='chats'&&historyPage===0){
     const ids=rows.filter(m=>m.direction==='inbound'&&!m.read_at).map(m=>m.id);
     if(ids.length){await ownerCall('owner-read',{contactId:id,ids});const c=selected();if(c)c.unread=Math.max(0,(c.unread||0)-ids.length);renderContacts()}
   }
   updateControls();
 }
 async function prepareOwnerPush(){
   if(!canPush||pushPreparing)return;
   pushPreparing=true;updateControls();
   try{
     const [v,reg]=await N.wait(Promise.all([N.config(),navigator.serviceWorker.register(new URL('owner/sw.js',ROOT).href,{scope:new URL('owner/',ROOT).href,updateViaCache:'none'})]),9000,'通知の準備を再試行してください。');
     if(!v.ok||typeof v.vapidPublicKey!=='string')throw Error();
     const k=N.decode(v.vapidPublicKey);if(k.length!==65||k[0]!==4)throw Error();
     // Use the registration returned for OWNER, never the visitor's ready worker.
     const expected=new URL('owner/',ROOT).href;if(reg.scope!==expected)throw Error();
     for(let i=0;i<20&&!reg.active;i++)await new Promise(r=>setTimeout(r,250));
     if(!reg.active)throw Error();
     ownerWorker=reg;ownerKey=k;ownerSub=await N.wait(reg.pushManager.getSubscription(),5000);
   }catch{ownerWorker=null;ownerKey=null}
   finally{pushPreparing=false;updateControls()}
 }
 $('owner-push-on').addEventListener('click',()=>{
   if(busy||!access||!canPush)return;
   const permission=N.wait(Notification.requestPermission(),15000,'通知の許可画面が応答しません。ブラウザーの通知設定をご確認ください。');
   void run(async()=>{
     if(await permission!=='granted')throw Error('通知を許可してください。');
     if(!ownerWorker||!ownerKey)await prepareOwnerPush();
     if(!ownerWorker||!ownerKey)throw Error('通知を準備できませんでした。もう一度お試しください。');
     let sub=await N.wait(ownerWorker.pushManager.getSubscription()),created=false;
     if(sub&&sub.options?.applicationServerKey){const b=new Uint8Array(sub.options.applicationServerKey);if(b.length!==ownerKey.length||!b.every((v,i)=>v===ownerKey[i])){await N.wait(sub.unsubscribe());sub=null}}
     if(!sub){sub=await N.wait(ownerWorker.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:ownerKey}),10000);created=true}
     try{const result=await ownerCall('owner-push-on',{subscription:sub.toJSON()});ownerEnabled=result.enabled;ownerSub=sub;feedback('管理者通知をONにしました。')}
     catch(e){if(created)await N.wait(sub.unsubscribe()).catch(()=>{});throw e}
   });
 });
 $('owner-push-off').addEventListener('click',()=>void run(async()=>{await ownerCall('owner-push-off');ownerEnabled=false;if(ownerSub)await N.wait(ownerSub.unsubscribe()).catch(()=>{});ownerSub=null;feedback('管理者通知をOFFにしました。')}));
 $('owner-push-test').addEventListener('click',()=>void run(async()=>{const r=await ownerCall('owner-push-test');feedback(r.status==='accepted'?'管理者テスト通知を送信しました。':N.pushLabels[r.status]||'送信結果未確定',r.status!=='accepted');if(r.status==='expired'){ownerEnabled=false;ownerSub=null}}));
 function changeMode(next){
   if(busy)return;revision++;mode=next;selectedId='';editing=false;promoting=false;historyPage=0;historySignature='';$('invite-panel').hidden=true;setNewChatForm(false);showContact();renderContacts();feedback();
 }
 function setNewChatForm(open){
   $('new-chat-form').hidden=!open;
   $('new-chat').setAttribute('aria-expanded',String(open));
   if(open)$('new-chat-name').focus();
 }
 $('new-chat').addEventListener('click',()=>setNewChatForm($('new-chat-form').hidden));
 $('cancel-new-chat').addEventListener('click',()=>setNewChatForm(false));
 $('new-chat-form').addEventListener('submit',event=>{
   event.preventDefault();
   void run(async()=>{
     const name=$('new-chat-name').value.trim(),body=$('new-chat-body').value.trim();
     if(!body)throw Error('最初のメッセージを入力してください。');
     const request=await getStartRequest(name,body);
     const result=await ownerCall('owner-start-chat',request);
     if(!result?.contact?.id||(result.invite!==null&&result.invite!==request.invite))throw Error('作成結果を確認できません。同じ内容でもう一度お試しください。');
     clearStartRequest();
     $('new-chat-form').reset();setNewChatForm(false);
     contacts=[result.contact,...contacts.filter(c=>c.id!==result.contact.id)];
     selectedId=result.contact.id;historyPage=0;editing=false;promoting=false;
     $('search').value='';$('invite-panel').hidden=true;
     showContact();renderContacts();
     if(result.invite)showInvite(result.contact,result.invite);
     feedback(result.invite?'専用QRとリンクを用意しました。':'作成済みのチャットを開きました。');
     await history();
   });
 });
 $('tab-chats').addEventListener('click',()=>changeMode('chats'));
 $('tab-contacts').addEventListener('click',()=>changeMode('contacts'));
 $('promote-contact').addEventListener('click',()=>{if(busy||!selected())return;revision++;editing=true;promoting=true;showContact();$('edit-panel').scrollIntoView({block:'start'});$('contact-name').focus()});
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
 async function finishLogin(token,keep=false){
   if(!validSession(token))throw Error('ログインできませんでした。');
   access=token;
   try{await reload()}catch(e){access='';if(e.status===401||e.status===403){saveSession('');showReconnect(false)}else{saveSession(token,keep);showReconnect(true)}throw e}
   $('login-panel').hidden=true;$('setup-panel').hidden=true;$('owner-console').hidden=false;
   saveSession(access,keep);showReconnect(false);clearAuthInputs();feedback('ログインしました。');void launchState();void prepareOwnerPush();
 }
 $('show-setup').addEventListener('click',()=>{feedback();showSetup()});
 $('back-to-login').addEventListener('click',()=>{clearAuthInputs();$('setup-panel').hidden=true;$('login-panel').hidden=false;feedback()});
 $('show-login-password').addEventListener('change',e=>{$('login-password').type=e.target.checked?'text':'password'});
 $('show-setup-password').addEventListener('change',e=>{for(const id of ['setup-password','setup-confirm'])$(id).type=e.target.checked?'text':'password'});
 $('login-form').addEventListener('submit',e=>{e.preventDefault();void run(async()=>{
   const password=$('login-password').value;
   checkPassword(password);
   const r=await N.call('card-owner-login',{password,remember:$('remember-owner').checked});
   $('login-password').value='';
   await finishLogin(r.accessToken,r.remember===true);
 })});
 $('setup-form').addEventListener('submit',e=>{e.preventDefault();void run(async()=>{
   const code=setupCode||$('setup-code').value.trim().toUpperCase();
   const password=$('setup-password').value;
   checkPassword(password);
   if(password!==$('setup-confirm').value)throw Error('確認用パスワードが一致していません。');
   if(!/^[A-F0-9]{20}$/.test(code))throw Error('初回設定コードをご確認ください。');
   const r=await N.call('card-owner-setup',{code,password,remember:$('remember-setup').checked});
   clearAuthInputs();
   $('setup-panel').hidden=true;$('login-panel').hidden=false;
   try{await finishLogin(r.accessToken,r.remember===true)}catch{feedback('パスワードを設定しました。新しい専用パスワードでログインしてください。',true)}
 })});
 function handleSetupFragment(){
   const fragment=new URLSearchParams(location.hash.slice(1));
   if(N.validThreadId(fragment.get('contact'))){
     requestedContact=fragment.get('contact');
     window.history.replaceState(null,'',location.pathname+location.search);
     openRequestedContact();
   }else if(fragment.has('setup')){
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
 $('new-contact').addEventListener('click',()=>{if(busy)return;revision++;mode='contacts';selectedId='';pending=null;historyPage=0;editing=true;promoting=false;$('invite-panel').hidden=true;showContact();renderContacts();$('edit-panel').scrollIntoView({block:'start'});$('contact-name').focus()});
 $('contact-form').addEventListener('submit',e=>{e.preventDefault();void run(async()=>{
   const fields={name:$('contact-name').value,email:$('contact-email').value,phone:$('contact-phone').value,memo:$('contact-memo').value};
   if(!fields.email.trim()&&!fields.phone.trim())throw Error('メールまたは電話番号を入力してください。');
   const r=await ownerCall(promoting?'owner-promote':selectedId?'owner-edit':'owner-create',{...fields,contactId:selectedId});
   selectedId=r.contact.id;historyPage=0;editing=false;promoting=false;mode='contacts';await reload();if(selected()?.linked_at)await history();feedback('電話帳に保存しました。');
 })});
 $('show-invite').addEventListener('click',()=>{
   if(displayedInvite){closeInvite();return}
   const contact=selected();if(!contact)return;
   const copy=currentInvite(contact);
   if(copy)showInvite(contact,copy.token);else void run(issueInvite);
 });
 $('reissue').addEventListener('click',()=>void run(issueInvite));
 $('hide-selected').addEventListener('click',()=>hideRevoked(selected()));
 $('revoke').addEventListener('click',()=>{if(!selectedId||!confirm('この相手の端末登録を解除しますか？'))return;void run(async()=>{await ownerCall('owner-revoke',{contactId:selectedId});closeInvite();await reload();feedback('登録を解除しました。')})});
 function activeShareUrl(){
   const c=selected();
   if(!c||!displayedInvite||currentInvite(c)!==displayedInvite){
     closeInvite();feedback('リンクの有効期限または受け取り状況を確認してください。',true);return '';
   }
   return $('invite-link').value;
 }
 async function copyInvite(){
   const url=activeShareUrl();if(!url)return;
   try{await N.wait(navigator.clipboard.writeText(url));feedback('専用リンクをコピーしました。')}
   catch{$('invite-link').focus();$('invite-link').select();feedback('リンクを選択しました。長押ししてコピーしてください。')}
 }
 $('copy-invite').addEventListener('click',()=>void run(copyInvite));
 $('share-invite').addEventListener('click',()=>{
   const url=activeShareUrl();if(!url)return;
   if(!navigator.share){void run(copyInvite);return}
   void navigator.share({title:"S's-YR 個別チャット",url}).catch(e=>{
     if(e.name!=='AbortError'){ $('invite-link').focus();$('invite-link').select();feedback('共有できませんでした。「リンクをコピー」を使えます。',true)}
   });
 });
 $('send-form').addEventListener('submit',e=>{e.preventDefault();void run(async()=>{
   if(!selectedId)return;
   const title='チャット',body=$('message-body').value.trim();if(!body)throw Error('メッセージを入力してください。');
   const signature=JSON.stringify([selectedId,title,body]);if(!pending||pending.signature!==signature)pending={signature,requestId:N.requestId()};
   const r=await ownerCall('owner-send',{contactId:selectedId,title,body,requestId:pending.requestId});
   if(!r?.message)throw Error('送信結果を確認できません。再送してください。');
   pending=null;$('send-form').reset();historyPage=0;
   const push=r.message.push_status,result=push==='disabled'?'相手の通知はOFFまたは未登録です。':N.pushLabels[push]||'通知結果未確定';
   feedback('メッセージを送信しました。 '+result,push==='failed'||push==='expired'||push==='unknown');
   try{await history()}catch{feedback('メッセージを保存しました。 '+result+'。履歴は更新ボタンで確認してください。',true)}
 })});
 $('history-prev').addEventListener('click',()=>void run(async()=>{historyPage=Math.max(0,historyPage-1);await history()}));
 $('history-next').addEventListener('click',()=>void run(async()=>{historyPage++;await history()}));
 async function quietRefresh(){
   // Polling must never acquire the foreground lock, ignore a tap, or replace a
   // newer view. A user action invalidates all previously started read results.
   if(busy||quietBusy||!access||editing||document.visibilityState!=='visible')return;
   quietBusy=true;
   const stamp=revision,token=access,accept=()=>stamp===revision&&!busy&&access===token&&!editing&&document.visibilityState==='visible';
   try{if(await reload(true,accept)&&accept()&&selectedId)await history(accept,false)}
   catch(e){if(accept()&&(e.status===401||e.status===403)){hideConsole();feedback('再ログインしてください。',true)}}
   finally{quietBusy=false;if(!busy)updateControls()}
 }
 window.addEventListener('focus',quietRefresh);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void quietRefresh()});
 if('serviceWorker'in navigator&&navigator.serviceWorker.addEventListener)navigator.serviceWorker.addEventListener('message',e=>{
   if(e.data?.type==='ssyr-owner-open'&&N.validThreadId(e.data.contactId)){
     requestedContact=e.data.contactId;openRequestedContact();
   }else if(e.data?.type==='ssyr-owner-update')void quietRefresh();
 });
 setInterval(quietRefresh,30000);
 function resumeSession(){
   const saved=loadSession();
   if(validSession(saved)&&$('setup-panel').hidden&&!access&&!busy){void run(async()=>{await finishLogin(saved,remembered)})}
 }
 $('owner-reconnect').addEventListener('click',resumeSession);
 window.addEventListener('online',resumeSession);
 resumeSession();
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
 $('recover-page').addEventListener('click',()=>{if((busy||$('message-body').value.trim()||$('contact-form').querySelector('input')?.value)&&!confirm('画面を再読み込みします。未送信の入力は消えることがあります。送信中だった場合は履歴をご確認ください。'))return;location.reload()});
 const appLink=$('owner-app-link');
 if(appLink)appLink.href=new URL('owner/?v=flow-fix-1',ROOT).href;
})();
