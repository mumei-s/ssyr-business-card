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
SECOND_MID='a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2'
REPLY_ID='f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f5'
DATE='2026-11-24T00:00:00Z'
MANUAL={'id':CID,'display_name':'既知の相手','email':'test@example.invalid','phone':'','memo':'','linked_at':DATE,'push_enabled_at':DATE,'revoked_at':None,'muumei_news':False,'entry_type':'manual','unread':0}
VISITOR={'id':VID,'display_name':'ゲストさん','email':'','phone':'','memo':'','linked_at':DATE,'push_enabled_at':None,'revoked_at':None,'muumei_news':False,'entry_type':'visitor','chat_updated_at':DATE,'unread':1}

def check_notices(browser,base):
    ctx=browser.new_context(viewport={'width':320,'height':760},service_workers='block')
    page=ctx.new_page()
    errors=[];requests=[];auth_requests=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    delayed=[]
    device_contacts = {}
    threads = {
        # Outbound notices sent before the direction field existed.
        VID: [{'id': CID, 'title': 'テスト連絡', 'body': '受信した連絡', 'created_at': DATE, 'read_at': None}],
        CID: [{'id': NEW, 'title': 'チャット', 'body': '既知の相手との履歴', 'direction': 'outbound', 'created_at': DATE, 'read_at': DATE}],
    }
    state={'delay_status':False,'delay_list':False,'linked':False,'enabled':False,'news':False,'owner_setup':False,'owner_session':False,'owner_enabled':False,'unread':1,'saved':[dict(MANUAL)]}
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
        def summary():return {'displayName':'ゲストさん' if device_contacts.get(b.get('device'))==VID else '既知の相手','enabled':state['enabled'],'muumeiNews':state['news']}
        if a=='visitor-start':
            assert len(b['device'])==64 and b['name']=='ゲストさん'
            device_contacts[b['device']] = VID
            state['linked']=True;done({'contact':summary()})
        elif a=='claim':
            assert b['invite']==INVITE and len(b['device'])==64
            device_contacts[b['device']] = CID
            state['linked']=True;done({'contact':summary()})
        elif a=='status':
            if state['delay_status']:
                state['delay_status']=False;delayed.append(r);return
            if not state['linked']:done({'error':'未登録'},401);return
            done({'contact':summary(),'messages':threads[device_contacts[b['device']]]})
        elif a=='chat-send':
            assert state['linked'] and device_contacts[b['device']]==VID and b['requestId']
            mid = MID if b['body']=='相談です' else SECOND_MID
            item = {'id':mid,'title':'チャット','body':b['body'],'direction':'inbound','created_at':DATE,'read_at':None,'push_status':'accepted'}
            threads[VID].insert(0,item)
            done({'message':item})
        elif a=='chat-delete':
            assert device_contacts[b['device']]==VID and b['id']==SECOND_MID
            threads[VID] = [m for m in threads[VID] if m['id'] != b['id']]
            done({'ok':True})
        elif a=='subscribe':
            assert b['subscription']['endpoint']=='https://fcm.googleapis.com/recipient-synthetic'
            state['enabled']=True;done({'contact':summary()})
        elif a=='test':done({'status':'accepted'})
        elif a=='stop':state['enabled']=False;done({'ok':True})
        elif a=='preferences':state['news']=b['muumeiNews'];done({'contact':summary()})
        elif a=='read':
            row=next(m for m in threads[device_contacts[b['device']]] if m['id']==b['id'])
            row['read_at']=DATE
            done({'ok':True})
        elif a=='disconnect':state['linked']=False;state['enabled']=False;done({'ok':True})
        elif a=='card-owner-setup':
            if state['owner_setup'] or b.get('code')!='A'*20:done({'error':'初回設定コードの期限・使用状況を確認してください。'},401);return
            assert b['password']=='SyntheticCardPassword123'
            state['owner_setup']=True;state['owner_session']=True;done({'accessToken':SESSION,'expiresIn':2592000 if b.get('remember') else 7200,'remember':b.get('remember') is True})
        elif a=='card-owner-login':
            if not state['owner_setup'] or b.get('password')!='SyntheticCardPassword123':done({'error':'電話帳専用のパスワードをご確認ください。'},401);return
            state['owner_session']=True;done({'accessToken':SESSION,'expiresIn':2592000 if b.get('remember') else 7200,'remember':b.get('remember') is True})
        elif a=='card-owner-logout':
            assert r.request.headers.get('authorization')=='Bearer '+SESSION
            state['owner_session']=False;done({'ok':True})
        elif a.startswith('owner-'):
            assert state['owner_session'] and r.request.headers.get('authorization')=='Bearer '+SESSION
            if a=='owner-list':
                if state['delay_list']:
                    state['delay_list']=False;delayed.append(r);return
                done({'contacts':[dict(VISITOR,unread=state['unread']),*state['saved']],'ownerPushEnabled':state['owner_enabled']})
            elif a=='owner-history':
                if b['contactId']==CID and state.pop('delay_history', False):
                    delayed.append(r)
                    return
                done({'messages':threads[b['contactId']]})
            elif a=='owner-read':
                assert b['contactId']==VID and b['ids']==[MID]
                next(m for m in threads[VID] if m['id']==MID)['read_at']=DATE
                state['unread']=0;done({'ok':True})
            elif a=='owner-send':
                assert b['title']=='チャット' and b['body']=='テスト返信' and b['contactId']==VID
                item={'id':REPLY_ID,'title':'チャット','body':b['body'],'direction':'outbound','created_at':DATE,'read_at':None,'push_status':'accepted'}
                threads[VID].insert(0,item)
                done({'message':item})
            elif a=='owner-delete-message':
                assert b['contactId']==VID and b['id']==REPLY_ID
                if state.pop('fail_delete', False):
                    done({'error':'削除を再試行してください。'},503)
                    return
                threads[VID] = [m for m in threads[VID] if m['id'] != b['id']]
                done({'ok':True})
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
    expect(page.locator('#feedback')).to_contain_text('通知サービス受付済み')
    expect(page.locator('#message-list .mine')).to_contain_text('相談です')
    assert 'claim' not in requests
    # A background read must not lock the compose button.
    state['delay_status']=True
    page.evaluate("window.dispatchEvent(new Event('focus'))")
    for _ in range(40):
        if delayed:break
        page.wait_for_timeout(50)
    assert delayed,'background read did not start'
    expect(page.locator('#chat-send')).to_be_enabled()
    page.locator('#chat-body').fill('通信待ち中も送信')
    page.locator('#chat-send').click()
    expect(page.locator('#message-list .mine').last).to_contain_text('通信待ち中も送信')
    delayed.pop().fulfill(json={'contact':{'displayName':'STALE','enabled':False,'muumeiNews':False},'messages':[]},headers=HEADERS)
    expect(page.locator('#message-list .mine').last).to_contain_text('通信待ち中も送信')
    legacy_notice = page.locator('#message-list article').filter(has_text='受信した連絡')
    expect(legacy_notice.get_by_role('button',name='削除')).to_have_count(0)
    sent = page.locator('#message-list article').filter(has_text='通信待ち中も送信')
    page.once('dialog',lambda dialog:dialog.dismiss())
    sent.get_by_role('button',name='削除').click()
    expect(sent).to_be_visible()
    assert 'chat-delete' not in requests
    page.once('dialog',lambda dialog:dialog.accept())
    sent.get_by_role('button',name='削除').click()
    expect(sent).to_have_count(0)
    expect(page.locator('#message-list .mine')).to_contain_text('相談です')
    guest_device = page.evaluate("localStorage.getItem('ssyr-card-device-v1')")
    expect(page.locator('#enable')).to_be_enabled()
    page.locator('#enable').click()
    expect(page.locator('#notice-state')).to_have_text('通知 ON')
    page.locator('#settings-panel details summary').click()
    page.locator('#test').click()
    expect(page.locator('#feedback')).to_contain_text('テスト通知を送信しました')
    page.locator('#news').check()
    expect(page.locator('#feedback')).to_contain_text('設定を保存しました')
    expect(page.locator('#chat-unread')).to_have_text('未読 1件')
    page.get_by_role('button',name='既読にする').click()
    expect(page.get_by_role('button',name='既読にする')).to_have_count(0)
    expect(page.locator('#chat-unread')).to_be_hidden()
    page.locator('#stop').click()
    expect(page.locator('#notice-state')).to_have_text('通知 OFF')
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth+1')
    # Existing personal links remain usable without revealing their token.
    page.evaluate("localStorage.removeItem('ssyr-card-device-v1')")
    state['linked']=False
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
    state['delay_list']=True
    page.evaluate("window.dispatchEvent(new Event('focus'))")
    for _ in range(40):
        if delayed:break
        page.wait_for_timeout(50)
    assert delayed,'background owner list did not start'
    page.locator('.contact-row').filter(has_text='ゲストさん').click()
    expect(page.locator('#history')).to_contain_text('相談です')
    expect(page.locator('#history')).not_to_contain_text('通信待ち中も送信')
    expect(page.locator('#history .theirs').get_by_role('button',name='削除')).to_have_count(0)
    expect(page.locator('#history article').filter(has_text='受信した連絡').get_by_role('button',name='削除')).to_be_visible()
    delayed.pop().fulfill(json={'contacts':[],'ownerPushEnabled':False},headers=HEADERS)
    expect(page.locator('#selected-name')).to_have_text('ゲストさん')
    expect(page.locator('#unread-count')).to_have_text('')
    expect(page.locator('#send-panel')).to_be_visible()
    page.locator('#message-body').fill('テスト返信')
    page.locator('#send-form button').click()
    expect(page.locator('#feedback')).to_contain_text('通知サービス受付済み')
    # An independently open visitor chat sees the reply and its later removal.
    peer_ctx = browser.new_context(service_workers='block')
    peer = peer_ctx.new_page()
    peer.route(API, route)
    peer.add_init_script(f"localStorage.setItem('ssyr-card-device-v1','{guest_device}');")
    peer.goto(base+'shinji/notices.html')
    peer_reply = peer.locator('#message-list article').filter(has_text='テスト返信')
    expect(peer_reply).to_be_visible()
    expect(peer_reply.get_by_role('button',name='削除')).to_have_count(0)
    reply = page.locator('#history article').filter(has_text='テスト返信')
    page.once('dialog',lambda dialog:dialog.dismiss())
    reply.get_by_role('button',name='削除').click()
    assert 'owner-delete-message' not in requests
    state['fail_delete']=True
    page.once('dialog',lambda dialog:dialog.accept())
    reply.get_by_role('button',name='削除').click()
    expect(page.locator('#feedback')).to_contain_text('再試行')
    expect(reply).to_be_visible()
    page.once('dialog',lambda dialog:dialog.accept())
    reply.get_by_role('button',name='削除').click()
    expect(reply).to_have_count(0)
    peer.locator('#refresh').click()
    expect(peer_reply).to_have_count(0)
    expect(peer.locator('#message-list')).to_contain_text('相談です')
    peer_ctx.close()

    # Never display the previous conversation or its draft under another name,
    # including while the next history request is still pending.
    page.locator('#message-body').fill('ゲストへの下書き')
    state['delay_history']=True
    with page.expect_request(lambda request: request.url==API and request.method=='POST' and request.post_data_json.get('action')=='owner-history' and request.post_data_json.get('contactId')==CID):
        page.locator('.contact-row').filter(has_text='既知の相手').click()
    expect(page.locator('#selected-name')).to_have_text('既知の相手')
    expect(page.locator('#message-body')).to_have_value('')
    expect(page.locator('#history')).not_to_contain_text('相談です')
    delayed.pop().fulfill(json={'messages':threads[CID]},headers=HEADERS)
    expect(page.locator('#history')).to_contain_text('既知の相手との履歴')
    page.locator('#message-body').fill('別の相手への下書き')
    page.locator('.contact-row').filter(has_text='ゲストさん').click()
    expect(page.locator('#history')).to_contain_text('相談です')
    expect(page.locator('#message-body')).to_have_value('ゲストへの下書き')
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
    # Remembered login survives closing/reopening a tab. The server validates it.
    assert page.evaluate("localStorage.getItem('ssyr-owner-remember-v1')")==SESSION
    page.evaluate("sessionStorage.removeItem('ssyr-owner-session-v1')")
    page.reload()
    expect(page.locator('#owner-console')).to_be_visible()
    page.locator('#logout').click()
    expect(page.locator('#login-panel')).to_be_visible()
    assert page.evaluate("localStorage.getItem('ssyr-owner-remember-v1')") is None
    assert not state['owner_session']
    page.locator('#login-password').fill('SyntheticCardPassword123')
    page.locator('#remember-owner').uncheck()
    page.locator('#login-form button').click()
    expect(page.locator('#owner-console')).to_be_visible()
    assert page.evaluate("localStorage.getItem('ssyr-owner-remember-v1')") is None
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
    assert {'visitor-start','chat-send','chat-delete','owner-delete-message','claim','subscribe','test','preferences','read','stop','owner-list','owner-history','owner-send','owner-read','owner-create','owner-push-on','owner-push-test','owner-push-off','card-owner-setup','card-owner-login','card-owner-logout'}.issubset(set(requests)),requests
    ctx.close()
    print("PASS visitor chat without invite, independent owner push, manual phonebook, existing invite and owner login; synthetic only")
