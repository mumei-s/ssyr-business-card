/* Separate OWNER scope; never use the recipient's push subscription. */
self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
const root=()=>new URL('../',self.registration.scope);
const ownerPage=()=>new URL('./',self.registration.scope).href;
const validContact=id=>typeof id==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id);
function isOwner(u){const a=new URL(u);return a.origin===root().origin&&(a.pathname===new URL('owner.html',root()).pathname||a.pathname===new URL('./',self.registration.scope).pathname||a.pathname===new URL('index.html',self.registration.scope).pathname)}
self.addEventListener('push',e=>{
 let p={};try{p=e.data?.json()||{}}catch{}
 if(!['owner-message','owner-test','owner-acceptance'].includes(p.kind))return;
 e.waitUntil((async()=>{
  const test=p.kind==='owner-test',acceptance=p.kind==='owner-acceptance';
  const contactId=!test&&validContact(p.contactId)?p.contactId:null;
  let body=test?'管理者用テスト通知です。':acceptance?'個別チャットの招待が受け取られました。':'新しいチャットが届きました。';
  if(!test&&p.edition==='business')body=acceptance?'事業用名刺で相談チャットが開設されました。':'事業用名刺に相談メッセージが届きました。';
  await self.registration.showNotification("S's-YR 管理者",{body,icon:new URL('brand-96.png',root()).href,tag:test?'owner-test':String(p.id||p.kind),data:{url:ownerPage(),contactId}});
  if(self.navigator.setAppBadge)try{await self.navigator.setAppBadge()}catch{}
  for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true}))if(isOwner(client.url))client.postMessage({type:'ssyr-owner-update'});
 })());
});
self.addEventListener('notificationclick',e=>{
 e.notification.close();
 e.waitUntil((async()=>{
  const id=e.notification.data?.contactId;
  const target=new URL(ownerPage());
  if(validContact(id))target.hash='contact='+id;
  for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true}))if(isOwner(client.url)){
   try{await client.focus();client.postMessage(validContact(id)?{type:'ssyr-owner-open',contactId:id}:{type:'ssyr-owner-update'});return}catch{}
  }
  await self.clients.openWindow(target.href);
 })());
});
