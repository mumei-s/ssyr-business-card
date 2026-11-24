(() => {
 'use strict';
 const base='https://slamzhgsawfnmwlejgqp.supabase.co';
 const url=base+'/functions/v1/ssyr-card';
 const deviceKey='ssyr-card-device-v1';
 const $=id=>document.getElementById(id);
 class ApiError extends Error{constructor(status,message){super(message);this.status=status}}
 async function jsonRequest(path,options={}){
   const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),27000);
   try{
     const r=await fetch(path,{...options,signal:controller.signal,cache:'no-store',credentials:'omit',redirect:'error'});
     let data;try{data=await r.json()}catch{throw new ApiError(r.status,'接続できませんでした。')}
     if(!r.ok)throw new ApiError(r.status,typeof data.error==='string'?data.error:typeof data.msg==='string'?'認証内容をご確認ください。':'通信に失敗しました。');
     return data;
   }catch(e){if(e instanceof ApiError)throw e;throw new ApiError(0,'通信に失敗しました。もう一度お試しください。')}
   finally{clearTimeout(timer)}
 }
 const call=(action,fields={},access)=>jsonRequest(url,{method:'POST',headers:{'Content-Type':'application/json',...(access?{Authorization:'Bearer '+access}:{})},body:JSON.stringify({action,...fields})});
 const config=()=>jsonRequest(url);
 const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 const validToken=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
 function getDevice(){try{return localStorage.getItem(deviceKey)||''}catch{return ''}}
 function setDevice(v){localStorage.setItem(deviceKey,v);if(localStorage.getItem(deviceKey)!==v)throw Error('端末の保存設定をご確認ください。')}
 function clearDevice(){try{localStorage.removeItem(deviceKey)}catch{}}
 function inviteFrom(value){const s=String(value||'').trim();if(validToken(s))return s;try{const u=new URL(s);if(u.origin==='https://mumei-s.github.io'&&u.pathname==='/ssyr-business-card/shinji/notices.html'){const t=new URLSearchParams(u.hash.slice(1)).get('invite');if(validToken(t))return t}}catch{}return ''}
 function date(v){if(!v)return '';const d=new Date(v);return Number.isFinite(d.valueOf())?d.toLocaleString('ja-JP'):''}
 function el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);if(cls)e.className=cls;return e}
 function feedback(message='',error=false){$('feedback').textContent=message;$('feedback').classList.toggle('error',!!error)}
 function decode(s){const b=s.replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(b+'='.repeat((4-b.length%4)%4)),x=>x.charCodeAt(0))}
 async function publicAuthKey(){const c=await jsonRequest(base+'/functions/v1/public-config');if(c.url!==base||typeof c.key!=='string'||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(c.key))throw Error('管理者ログインの接続を確認してください。');return c.key}
 const auth=(action,body,key)=>jsonRequest(base+'/auth/v1/'+action,{method:'POST',headers:{'Content-Type':'application/json',apikey:key},body:JSON.stringify(body)});
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
 window.SSYRNotice={base,url,$,call,config,random,validToken,getDevice,setDevice,clearDevice,inviteFrom,date,el,feedback,decode,publicAuthKey,auth,loginVerification,pushLabels,setBusy};
})();
