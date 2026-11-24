"""Synthetic browser interactions: no real recipient, mailbox or push is used."""
import base64
from playwright.sync_api import expect

API = 'https://slamzhgsawfnmwlejgqp.supabase.co/functions/v1/ssyr-card'
AUTH = 'https://slamzhgsawfnmwlejgqp.supabase.co/auth/v1/'
HEADERS = {'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET, POST, OPTIONS'}
INVITE='a'*64
SESSION='ssyr1_'+'b'*64
CID='b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1'
VID='c2c2c2c2-c2c2-42c2-82c2-c2c2c2c2c2c2'
NEW='d3d3d3d3-d3d3-43d3-83d3-d3d3d3d3d3d3'
MID='e4e4e4e4-e4e4-44e4-84e4-e4e4e4e4e4e4'
DATE='2026-11-24T00:00:00Z'
MANUAL={'id':CID,'display_name':'既知の相手','email':'test@example.invalid','phone':'','memo':'','linked_at':DATE,'push_enabled_at':DATE,'revoked_at':None,'muumei_news':False,'entry_type':'manual','unread':0}
VISITOR={'id':VID,'display_name':'ゲストさん','email':'','phone':'','memo':'','linked_at':DATE,'push_enabled_at':None,'revoked_at':None,'muumei_news':False,'entry_type':'visitor','chat_updated_at':DATE,'unread':1}

def check_notices(browser,base):
    ctx=browser.new_context(viewport={'width':320,'height':760},service_workers='block')
    page=ctx.new_page()
    errors=[];requests=[];auth_requests=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    state={'linked':False,'enabled':False,'news':False,'read':False,'owner_setup':False,'owner_session':False,'owner_enabled':False,'visitor':False,'guest_body':'','unread':1,'saved':[dict(MANUAL)]}
    page.add_init_script("""(() => {
      const scopes=new Map();
      function makeReg(scope,owner){
        let local=null;
        return {scope,active:{state:'activated'},pushManager:{
         getSubscription:async()=>local,
         subscribe:async opts=>{
          local={options:{applicationServerKey:opts.applicationServerKey.buffer},
           toJSON:()=>({endpoint:'https://fcm.googleapis.com/'+(owner?'owner-synthetic':'recipient-synthetic'),keys:{p256dh:'synthetic',auth:'synthetic'}}),
           unsubscribe:async()=>{local=null;return true}};return local
         }
        }};
      }
      const recipient=makeReg(new URL('/shinji/',location.href).href,false);
      scopes.set(recipient.scope,recipient);
      Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{
       register:async (script,opts)=>{
        const scope=new URL(opts.scope,location.href).href;
        if(!scopes.has(scope))scopes.set(scope,makeReg(scope,scope.endsWith('/owner/')));
        return scopes.get(scope);
       },ready:Promise.resolve(recipient),addEventListener(){}}});
      Object.defineProperty(window,'Notification',{configurable:true,value:{permission:'default',requestPermission:async()=>{Notification.permission='granted';return 'granted'}}});
      window.PushManager=function(){};
    })()""")
    key=base64.urlsafe_b64encode(b'\x04'+b'\x00'*64).decode().rstrip('=')
    def route(r):
        if r.request.method=='OPTIONS':
            r.fulfill(status=204,headers=HEADERS);return
        if r.request.method=='GET':
            r.fulfill(json={'ok':True,'version':1,'vapidPublicKey':key},headers=HEADERS);return
        b=r.request.post_data_json;a=b['action'];requests.append(a)
        def done(body,status=200):r.fulfill(status=status,json=body,headers=HEADERS)
        def summary():return {'displayName':'ゲストさん' if state['visitor'] else '既知の相手','enabled':state['enabled'],'muumeiNews':state['news']}
        if a=='visitor-start':
            assert len(b['device'])==64 and b['name']=='ゲストさん'
            state['visitor']=True;state['linked']=True;done({'contact':summary()})
        elif a=='claim':
            assert b['invite']==INVITE and len(b['device'])==64
            state['linked']=True;state['visitor']=False;done({'contact':summary()})
        elif a=='status':
            if not state['linked']:done({'error':'未登録'},401);return
            messages=[{'id':CID,'title':'テスト連絡','body':'受信した連絡','direction':'outbound','created_at':DATE,'read_at':DATE if state['read'] else None}]
            if state['guest_body']:messages.insert(0,{'id':MID,'title':'チャット','body':state['guest_body'],'direction':'inbound','created_at':DATE,'read_at':None})
            done({'contact':summary(),'messages':messages})
        elif a=='chat-send':
            assert state['linked'] and len(b['device'])==64 and b['requestId']
            state['guest_body']=b['body'];done({'message':{'id':MID,'direction':'inbound','push_status':'accepted'}})
        elif a=='subscribe':
            assert b['subscription']['endpoint']=='https://fcm.googleapis.com/recipient-synthetic'
            state['enabled']=True;done({'contact':summary()})
        elif a=='test':done({'status':'accepted'})
        elif a=='stop':state['enabled']=False;done({'ok':True})
        elif a=='preferences':state['news']=b['muumeiNews'];done({'contact':summary()})
        elif a=='read':state['read']=True;done({'ok':True})
        elif a=='disconnect':state['linked']=False;state['enabled']=False;done({'ok':True})
        elif a=='card-owner-setup':
            if state['owner_setup'] or b.get('code')!='A'*20:done({'error':'初回設定コードの期限・使用状況を確認してください。'},401);return
            assert b['password']=='SyntheticCardPassword123'
            state['owner_setup']=True;state['owner_session']=True;done({'accessToken':SESSION,'expiresIn':7200})
        elif a=='card-owner-login':
            if not state['owner_setup'] or b.get('password')!='SyntheticCardPassword123':done({'error':'電話帳専用のパスワードをご確認ください。'},401);return
            state['owner_session']=True;done({'accessToken':SESSION,'expiresIn':7200})
        elif a=='card-owner-logout':
            assert r.request.headers.get('authorization')=='Bearer '+SESSION
            state['owner_session']=False;done({'ok':True})
        elif a.startswith('owner-'):
            assert state['owner_session'] and r.request.headers.get('authorization')=='Bearer '+SESSION
            if a=='owner-list':
                done({'contacts':[dict(VISITOR,unread=state['unread']),*state['saved']],'ownerPushEnabled':state['owner_enabled']})
            elif a=='owner-history':
                rows=[{'id':MID,'title':'チャット','body':'ゲストからの相談','direction':'inbound','created_at':DATE,'read_at':None if state['unread'] else DATE,'push_status':'accepted'}] if b['contactId']==VID else []
                done({'messages':rows})
            elif a=='owner-read':assert b['contactId']==VID and b['ids']==[MID];state['unread']=0;done({'ok':True})
            elif a=='owner-send':
                assert b['title']=='チャット' and b['body']=='テスト返信' and b['contactId']==VID
                done({'message':{'push_status':'accepted'}})
            elif a=='owner-push-on':
                assert b['subscription']['endpoint']=='https://fcm.googleapis.com/owner-synthetic'
                state['owner_enabled']=True;done({'enabled':True})
            elif a=='owner-push-test':done({'status':'accepted'})
            elif a=='owner-push-off':state['owner_enabled']=False;done({'enabled':False})
            elif a=='owner-create':
                assert b['name']=='新規連絡先' and b['email']=='new@example.invalid'
                row=dict(MANUAL,id=NEW,display_name=b['name'],email=b['email'],linked_at=None,push_enabled_at=None)
                state['saved'].append(row);done({'contact':row})
            elif a=='owner-invite':done({'contact':MANUAL,'invite':INVITE})
            else:done({'error':'unexpected owner action'},400)
        else:done({'error':'unexpected action'},400)
    page.route(API,route)
    def reject_auth(r):auth_requests.append(r.request.url);r.fulfill(status=400,json={'error':'unexpected auth call'},headers=HEADERS)
    page.route(AUTH+'**',reject_auth)
    # Direct, invite-free conversation is the default.
    page.goto(base+'shinji/notices.html')
    expect(page.locator('#messages')).to_be_visible()
    page.locator('#visitor-name').fill('ゲストさん')
    page.locator('#chat-body').fill('相談です')
    page.locator('#chat-send').click()
    expect(page.locator('#feedback')).to_contain_text('メッセージを送信しました')
    expect(page.locator('#message-list .mine')).to_contain_text('相談です')
    assert 'claim' not in requests
    expect(page.locator('#enable')).to_be_enabled()
    page.locator('#enable').click()
    expect(page.locator('#notice-state')).to_have_text('通知 ON')
    page.locator('#settings-panel details summary').click()
    page.locator('#test').click()
    expect(page.locator('#feedback')).to_contain_text('テスト通知を送信しました')
    page.locator('#news').check()
    expect(page.locator('#feedback')).to_contain_text('設定を保存しました')
    page.get_by_role('button',name='既読にする').click()
    expect(page.get_by_role('button',name='既読にする')).to_have_count(0)
    page.locator('#stop').click()
    expect(page.locator('#notice-state')).to_have_text('通知 OFF')
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth+1')
    # Existing personal links remain usable without revealing their token.
    page.evaluate("localStorage.removeItem('ssyr-card-device-v1')")
    state['linked']=False;state['guest_body']=''
    page.goto(base+'shinji/notices.html?v=share-2#invite='+INVITE)
    expect(page.locator('#claim-button')).to_be_visible()
    assert '#' not in page.url
    expect(page.locator('#invite-options')).to_be_hidden()
    page.locator('#claim-button').click()
    expect(page.locator('#feedback')).to_contain_text('チャットを開きました')
    # The owner never enters a recipient registration page.
    page.goto(base+'shinji/owner.html')
    expect(page.locator('#owner-console')).to_be_hidden()
    page.locator('#login-password').fill('incorrect-test-password')
    page.locator('#login-form button').click()
    expect(page.locator('#feedback')).to_contain_text('電話帳専用のパスワードをご確認ください')
    page.goto(base+'shinji/owner.html#setup='+'A'*20)
    expect(page.locator('#setup-panel')).to_be_visible()
    expect(page.locator('#setup-code-label')).to_be_hidden()
    assert '#' not in page.url
    page.locator('#setup-password').fill('SyntheticCardPassword123')
    page.locator('#setup-confirm').fill('DifferentPassword123')
    page.locator('#setup-form button[type="submit"]').click()
    expect(page.locator('#feedback')).to_contain_text('一致していません')
    page.locator('#setup-confirm').fill('SyntheticCardPassword123')
    page.locator('#setup-form button[type="submit"]').click()
    expect(page.locator('#owner-console')).to_be_visible()
    expect(page.locator('#owner-push-on')).to_be_enabled()
    page.locator('#owner-push-on').click()
    expect(page.locator('#owner-push-state')).to_have_text('ON')
    page.locator('#owner-push-test').click()
    expect(page.locator('#feedback')).to_contain_text('管理者テスト通知を送信しました')
    page.locator('#owner-push-off').click()
    expect(page.locator('#owner-push-state')).to_have_text('OFF')
    expect(page.locator('#tab-chats')).to_have_attribute('aria-pressed','true')
    expect(page.locator('#unread-count')).to_have_text('1')
    page.locator('.contact-row').filter(has_text='ゲストさん').click()
    expect(page.locator('#history')).to_contain_text('ゲストからの相談')
    expect(page.locator('#unread-count')).to_have_text('')
    expect(page.locator('#send-panel')).to_be_visible()
    page.locator('#message-body').fill('テスト返信')
    page.locator('#send-form button').click()
    expect(page.locator('#feedback')).to_contain_text('通知サービス受付済み')
    expect(page.locator('#promote-contact')).to_be_visible()
    page.locator('#tab-contacts').click()
    expect(page.locator('.contact-row')).to_have_count(1)
    expect(page.locator('.contact-row')).to_contain_text('既知の相手')
    page.locator('#new-contact').click()
    page.locator('#contact-name').fill('新規連絡先')
    page.locator('#contact-email').fill('new@example.invalid')
    page.locator('#contact-form button').click()
    expect(page.locator('#feedback')).to_contain_text('電話帳に保存しました')
    expect(page.locator('#invite-panel')).to_be_hidden()
    expect(page.locator('.contact-row')).to_have_count(2)
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth+1')
    # Reloading the same owner tab keeps its short-lived session.
    page.reload()
    expect(page.locator('#owner-console')).to_be_visible()
    page.locator('#logout').click()
    expect(page.locator('#login-panel')).to_be_visible()
    assert not state['owner_session']
    page.locator('#login-password').fill('SyntheticCardPassword123')
    page.locator('#login-form button').click()
    expect(page.locator('#owner-console')).to_be_visible()
    page.locator('#logout').click()
    expect(page.locator('#login-panel')).to_be_visible()
    page.goto(base+'shinji/owner.html#setup='+'A'*20)
    page.locator('#setup-password').fill('SyntheticCardPassword123')
    page.locator('#setup-confirm').fill('SyntheticCardPassword123')
    page.locator('#setup-form button[type="submit"]').click()
    expect(page.locator('#feedback')).to_contain_text('初回設定コードの期限・使用状況')
    expect(page.locator('#owner-console')).to_be_hidden()
    assert not auth_requests,auth_requests
    assert not errors,errors
    assert {'visitor-start','chat-send','claim','subscribe','test','preferences','read','stop','owner-list','owner-history','owner-send','owner-read','owner-create','owner-push-on','owner-push-test','owner-push-off','card-owner-setup','card-owner-login','card-owner-logout'}.issubset(set(requests)),requests
    ctx.close()
    print("PASS visitor chat without invite, independent owner push, manual phonebook, existing invite and owner login; synthetic only")
