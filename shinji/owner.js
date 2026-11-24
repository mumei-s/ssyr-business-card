(() => {
 'use strict';
 const N=window.SSYRNotice,{$,el,feedback}=N;
 let access='',setupCode='',contacts=[],selectedId='',historyPage=0,busy=false,pending=null,ready=false;
 const ownerCall=(action,fields={})=>N.call(action,fields,access);
 const status=c=>c.revoked_at?'解除済み':!c.linked_at?'招待待ち':c.push_enabled_at?'通知 ON':'通知 OFF';
 const selected=()=>contacts.find(c=>c.id===selectedId);
 function clearAuthInputs(){for(const id of ['login-password','setup-password','setup-confirm','setup-code'])$(id).value='';setupCode=''}
 function hideConsole(){access='';contacts=[];selectedId='';pending=null;ready=false;$('owner-console').hidden=true;$('login-panel').hidden=false;$('setup-panel').hidden=true;clearAuthInputs();$('invite-panel').hidden=true;$('invite-link').value='';$('open-invite').href='./notices.html';$('contact-form').reset();$('send-form').reset();$('contacts').replaceChildren();$('history').replaceChildren();$('selected-panel').hidden=true}
 async function run(fn){
   if(busy)return;busy=true;feedback('通信中…');for(const b of document.querySelectorAll('button'))b.disabled=true;
   try{await fn()}catch(e){if(access&&(e.status===401||e.status===403)){hideConsole();feedback('再ログインしてください。',true)}else feedback(e.message||'もう一度お試しください。',true)}
   finally{busy=false;for(const b of document.querySelectorAll('button'))b.disabled=false;updateControls()}
 }
 function updateControls(){
   const c=selected();
   $('muumei-send').disabled=busy||!ready||!contacts.some(c=>c.linked_at&&!c.revoked_at&&c.muumei_news&&c.push_enabled_at);
   $('reissue').disabled=busy||!c||!!c.linked_at&&!c.revoked_at;
   $('revoke').disabled=busy||!c||!!c.revoked_at;
   $('history-prev').disabled=busy||historyPage===0;
   $('history-next').disabled=busy||$('history').dataset.more!=='true';
 }
 function renderContacts(){
   const q=$('search').value.toLowerCase().trim();const list=$('contacts');list.replaceChildren();$('contact-count').textContent='('+contacts.length+'件)';
   for(const c of contacts.filter(c=>[c.display_name,c.email,c.phone,c.memo].some(v=>String(v||'').toLowerCase().includes(q)))){
     const row=el('button',undefined,'contact-row'+(selectedId===c.id?' selected':''));
     row.type='button';const text=el('span',undefined,'contact-row-text');text.append(el('strong',c.display_name),el('small',c.email||c.phone||'連絡先'));row.append(text,el('span',status(c),'state'+(c.push_enabled_at?' on':'')));row.addEventListener('click',()=>void run(async()=>{selectedId=c.id;historyPage=0;showContact();renderContacts();await history();$('selected-panel').scrollIntoView({block:'start',behavior:'auto'})}));list.append(row);
   }
   if(!list.childElementCount)list.append(el('p','連絡先はありません。','muted'));
 }
 function showContact(){
   const c=selected();$('selected-panel').hidden=!c;$('edit-title').textContent=c?'連絡先を編集':'連絡先を追加';
   $('contact-name').value=c?.display_name||'';$('contact-email').value=c?.email||'';$('contact-phone').value=c?.phone||'';$('contact-memo').value=c?.memo||'';
   if(c){$('selected-name').textContent=c.display_name;$('selected-state').textContent=status(c);$('send-panel').hidden=!c.linked_at||!!c.revoked_at}
   else $('send-panel').hidden=true;
   updateControls();
 }
 async function reload(){
   const r=await ownerCall('owner-list');contacts=r.contacts||[];
   if(!selected())selectedId='';renderContacts();showContact();
 }
 function showInvite(value){
   const link=new URL('./notices.html',location.href);link.hash='invite='+value;
   $('invite-link').value=link.href;$('open-invite').href=link.href;
   $('invite-panel').hidden=false;
 }
 async function history(){
   if(!selectedId)return;
   const r=await ownerCall('owner-history',{contactId:selectedId,page:historyPage});const root=$('history');root.replaceChildren();
   const rows=r.messages||[];root.dataset.more=String(rows.length===50);
   for(const m of rows){const card=el('article',undefined,'message');card.append(el('h3',m.title),el('time',N.date(m.created_at)),el('p',m.body,'message-body'),el('small',(N.pushLabels[m.push_status]||'確認中')+' ／ '+(m.read_at?'既読':'未読')));root.append(card)}
   if(!rows.length)root.append(el('p','送信履歴はありません。','muted'));updateControls();
 }
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
   clearAuthInputs();feedback('ログインしました。');void launchState();
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
 const fragment=new URLSearchParams(location.hash.slice(1));
 if(fragment.has('setup')){
   const code=(fragment.get('setup')||'').toUpperCase();
   window.history.replaceState(null,'',location.pathname+location.search);
   showSetup(code);
 }else if(fragment.has('access_token')||fragment.has('refresh_token')||fragment.has('error')||fragment.has('error_code')){
   window.history.replaceState(null,'',location.pathname+location.search);
   feedback('電話帳専用パスワードでログインしてください。');
 }
 $('logout').addEventListener('click',()=>void run(async()=>{
   const old=access;
   try{await N.call('card-owner-logout',{},old);hideConsole();feedback('ログアウトしました。')}
   catch(e){hideConsole();feedback('この画面からログアウトしました。通信状態をご確認ください。',true)}
 }));
 $('search').addEventListener('input',renderContacts);
 $('reload').addEventListener('click',()=>void run(async()=>{await reload();if(selectedId)await history();await launchState()}));
 $('new-contact').addEventListener('click',()=>{selectedId='';pending=null;historyPage=0;$('invite-panel').hidden=true;showContact();renderContacts();$('edit-panel').scrollIntoView({block:'start'});$('contact-name').focus()});
 $('contact-form').addEventListener('submit',e=>{e.preventDefault();void run(async()=>{
   const fields={name:$('contact-name').value,email:$('contact-email').value,phone:$('contact-phone').value,memo:$('contact-memo').value};
   const r=await ownerCall(selectedId?'owner-edit':'owner-create',{...fields,contactId:selectedId});
   selectedId=r.contact.id;historyPage=0;await reload();if(r.invite)showInvite(r.invite);await history();feedback('連絡先を保存しました。');
 })});
 $('reissue').addEventListener('click',()=>void run(async()=>{if(!selectedId)return;const r=await ownerCall('owner-invite',{contactId:selectedId});await reload();showInvite(r.invite);feedback('招待リンクを発行しました。')}));
 $('revoke').addEventListener('click',()=>{if(!selectedId||!confirm('この相手の端末登録を解除しますか？'))return;void run(async()=>{await ownerCall('owner-revoke',{contactId:selectedId});$('invite-panel').hidden=true;await reload();feedback('登録を解除しました。')})});
 $('copy-invite').addEventListener('click',()=>void run(async()=>{try{await navigator.clipboard.writeText($('invite-link').value);feedback('招待リンクをコピーしました。')}catch{$('invite-link').focus();$('invite-link').select();feedback('表示したリンクをコピーしてください。')}}));
 $('share-invite').addEventListener('click',()=>{const url=$('invite-link').value;if(navigator.share)void navigator.share({title:"S's-YR 受け取り登録",url}).catch(()=>{});else $('copy-invite').click()});
 $('send-form').addEventListener('submit',e=>{e.preventDefault();void run(async()=>{
   if(!selectedId)return;
   const title=$('message-title').value.trim(),body=$('message-body').value.trim();
   const signature=JSON.stringify([selectedId,title,body]);if(!pending||pending.signature!==signature)pending={signature,requestId:crypto.randomUUID()};
   const r=await ownerCall('owner-send',{contactId:selectedId,title,body,requestId:pending.requestId});
   pending=null;$('send-form').reset();historyPage=0;await history();feedback('連絡を保存しました。'+(N.pushLabels[r.message.push_status]||'送信結果未確定'));
 })});
 $('history-prev').addEventListener('click',()=>void run(async()=>{historyPage=Math.max(0,historyPage-1);await history()}));
 $('history-next').addEventListener('click',()=>void run(async()=>{historyPage++;await history()}));
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
})();
