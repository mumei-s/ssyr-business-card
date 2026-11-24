/* Scoped to the SHINJI card; no fetch interception and no cached HTML. */
self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
const noticeUrl=()=>new URL('notices.html#messages',self.registration.scope).href;
self.addEventListener('push',event=>{
 let payload={};try{payload=event.data?.json()||{}}catch{}
 if(payload.kind==='owner-message'||payload.kind==='owner-test')return;
 const test=payload.kind==='test';
 const id=typeof payload.id==='string'&&/^[a-f0-9-]{36}$/i.test(payload.id)?payload.id:'ssyr';
 // Keep private message bodies out of the phone's lock screen.
 event.waitUntil((async()=>{
  await self.registration.showNotification("S's-YR",{
   body:test?'テスト通知です。':'新しい連絡が届きました。',
   icon:new URL('brand-96.png',self.registration.scope).href,
   tag:test?'ssyr-test':id,
   data:{url:noticeUrl()}
  });
  if(!test&&self.navigator.setAppBadge)try{await self.navigator.setAppBadge()}catch{}
  for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true}))if(new URL(client.url).pathname===new URL('notices.html',self.registration.scope).pathname)client.postMessage({type:'ssyr-chat-update'});
 })());
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const target=noticeUrl(),scope=new URL(self.registration.scope);
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of windows){
   const u=new URL(client.url);
   if(u.origin!==scope.origin||!u.pathname.startsWith(scope.pathname)||(u.pathname.endsWith('/owner.html')||u.pathname.startsWith(new URL('owner/',scope).pathname)))continue;
   try{const next=await client.navigate(target);if(next){await next.focus();return}}catch{}
  }
  await self.clients.openWindow(target);
 })());
});
