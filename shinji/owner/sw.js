/* Separate OWNER scope; never use the recipient's push subscription. */
self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
const root=()=>new URL('../',self.registration.scope);
const ownerPage=()=>new URL('./',self.registration.scope).href;
function isOwner(u){const a=new URL(u);return a.origin===root().origin&&(a.pathname===new URL('owner.html',root()).pathname||a.pathname===new URL('./',self.registration.scope).pathname||a.pathname===new URL('index.html',self.registration.scope).pathname)}
self.addEventListener('push',e=>{
 let p={};try{p=e.data?.json()||{}}catch{}
 if(!['owner-message','owner-test'].includes(p.kind))return;
 e.waitUntil((async()=>{
  const test=p.kind==='owner-test';
  await self.registration.showNotification("S's-YR 管理者",{body:test?'管理者用テスト通知です。':'新しいチャットが届きました。',icon:new URL('brand-96.png',root()).href,tag:test?'owner-test':String(p.id||'owner-message'),data:{url:ownerPage()}});
  if(self.navigator.setAppBadge)try{await self.navigator.setAppBadge()}catch{}
  for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true}))if(isOwner(client.url))client.postMessage({type:'ssyr-owner-update'});
 })());
});
self.addEventListener('notificationclick',e=>{
 e.notification.close();
 e.waitUntil((async()=>{
  for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true}))if(isOwner(client.url)){try{await client.focus();client.postMessage({type:'ssyr-owner-update'});return}catch{}}
  await self.clients.openWindow(ownerPage());
 })());
});
