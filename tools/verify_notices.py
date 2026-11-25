"""Synthetic browser interactions: no real recipient, mailbox or push is used."""
import base64
import hashlib
import json
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlsplit
from uuid import UUID
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
FIRST_CONTACT='88888888-8888-4888-8888-888888888888'
FIRST_MID='99999999-9999-4999-8999-999999999999'
FIRST_NAME='こちらから連絡する相手'
FIRST_BODY='こちらからの最初のメッセージです。'
COMMON_NAME='共通名刺の受け取りテスト'
COMMON_CONTACT='66666666-6666-4666-8666-666666666666'
DATE='2026-11-24T00:00:00Z'
MANUAL={'id':CID,'display_name':'既知の相手','email':'test@example.invalid','phone':'','memo':'','linked_at':DATE,'push_enabled_at':DATE,'revoked_at':None,'muumei_news':False,'entry_type':'manual','unread':0}
VISITOR={'id':VID,'display_name':'ゲストさん','email':'','phone':'','memo':'','linked_at':DATE,'push_enabled_at':None,'revoked_at':None,'muumei_news':False,'entry_type':'visitor','chat_updated_at':DATE,'unread':1}

def check_recipient_notification(page,base):
    # Dispatch a synthetic push to the shipped recipient worker. Browser or
    # operating system permissions are not needed to check its routing logic.
    source=page.request.get(base+'shinji/sw.js').text()
    result=page.evaluate("""async source => {
      const listeners={}, notices=[], opened=[], refreshed=[], badges=[];
      const scope=new URL('./',location.href).href;
      const self={
        addEventListener:(name,listener)=>{listeners[name]=listener},
        registration:{scope,showNotification:async(title,options)=>notices.push({title,...options})},
        navigator:{setAppBadge:async n=>badges.push(n??'dot')}, clients:{
          matchAll:async()=>['notices.html','owner/'].map(path=>({
            url:new URL(path,scope).href,postMessage:msg=>refreshed.push([path,msg.type])
          })), openWindow:async url=>opened.push(String(url))
        }
      };
      new Function('self',source)(self);
      let pending;
      const waitUntil=p=>{pending=p};
      const threadId='66666666-6666-4666-8666-666666666666';
      for(const kind of ['owner-message','message']){
        listeners.push({data:{json:()=>({kind,threadId,id:threadId})},waitUntil});
        await pending;
      }
      if(notices.length===1){
        listeners.notificationclick({notification:{...notices[0],close(){}},waitUntil});
        await pending;
      }
      const privateNotice={notices:[...notices],opened:[...opened],refreshed:[...refreshed],badges:[...badges]};
      notices.length=0;opened.length=0;refreshed.length=0;badges.length=0;
      for(const id of ['invalid',threadId]){
        listeners.push({data:{json:()=>({kind:'card-announcement',id,title:'共通名刺のお知らせ'})},waitUntil});
        await pending;
      }
      if(notices.length===1){
        listeners.notificationclick({notification:{...notices[0],close(){}},waitUntil});
        await pending;
      }
      return {...privateNotice,target:new URL('notices.html#thread='+threadId,scope).href,
        shared:{notices,opened,refreshed,badges,target:new URL('#announcement',scope).href}};
    }""",source)
    assert len(result['notices'])==1 and result['notices'][0]['title']=='SHINJI'
    assert result['opened']==[result['target']]
    assert result['refreshed']==[['notices.html','ssyr-chat-update']]
    assert result['badges']==['dot']
    shared=result['shared']
    assert len(shared['notices'])==1 and shared['notices'][0]['title']=='SHINJI'
    assert shared['notices'][0]['body']=='共通名刺のお知らせ'
    assert shared['badges']==['dot']
    assert shared['opened']==[shared['target']]
    assert shared['refreshed']==[['notices.html','ssyr-announcement-update']]

def check_notices(browser,base):
    ctx=browser.new_context(viewport={'width':320,'height':760},service_workers='block')
    page=ctx.new_page()
    errors=[];requests=[];auth_requests=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    delayed=[]
    device_contacts = {}
    push_bindings = {}
    owner_starts = {}
    public_registrations = {}
    archive_rows = []
    threads = {
        # Outbound notices sent before the direction field existed.
        VID: [{'id': CID, 'title': 'テスト連絡', 'body': '受信した連絡', 'created_at': DATE, 'read_at': None}],
        CID: [{'id': NEW, 'title': 'チャット', 'body': '既知の相手との履歴', 'direction': 'outbound', 'created_at': DATE, 'read_at': DATE}],
    }
    state={'delay_status':False,'delay_list':False,'linked':False,'news':False,'owner_setup':False,'owner_session':False,'owner_enabled':False,'unread':1,'saved':[dict(MANUAL)]}
    ctx.add_init_script("""(() => {
      const scopes=new Map();
      let rotation='';
      window.rotateRecipientSubscription=()=>{rotation='-rotated'};
      function makeReg(scope,owner){
        let local=null;
        return {scope,active:{state:'activated'},pushManager:{
         getSubscription:async()=>local,
         subscribe:async opts=>{
          local={options:{applicationServerKey:opts.applicationServerKey.buffer},
           get endpoint(){return 'https://fcm.googleapis.com/'+(owner?'owner-synthetic':'recipient-synthetic'+rotation)},
           toJSON(){return {endpoint:this.endpoint,keys:{p256dh:'synthetic',auth:'synthetic'}}},
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
       },ready:new Promise(()=>{}),addEventListener(){}}});
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
        def summary():return {'id':device_contacts.get(b.get('device')),'displayName':{VID:'ゲストさん',CID:'既知の相手',FIRST_CONTACT:FIRST_NAME,COMMON_CONTACT:COMMON_NAME}.get(device_contacts.get(b.get('device')),'ゲスト'),'enabled':b.get('device') in push_bindings,'pushBinding':push_bindings.get(b.get('device')),'muumeiNews':state['news']}
        if a=='card-announcement':
            assert set(b)=={'action'}
            done({'announcement':None})
        elif a=='visitor-start':
            assert len(bytes.fromhex(b['device']))==32
            if not str(b.get('name','')).replace('\u200b','').strip() and b['device'] not in device_contacts:
                done({'error':'SHINJIにわかる名前を入力してください'},400)
                return
            if b['name']==COMMON_NAME or b['device'] in public_registrations:
                assert not b.get('email') and not b.get('phone') and not b.get('muumeiNews')
                if b['device'] not in public_registrations:
                    assert not public_registrations, 'One browser created two receiver records'
                    public_registrations[b['device']]=dict(VISITOR,id=COMMON_CONTACT,
                        display_name=COMMON_NAME,chat_updated_at=None,unread=0,
                        acceptance_at=DATE,acceptance_seen_at=None)
                    device_contacts[b['device']]=COMMON_CONTACT
                    threads[COMMON_CONTACT]=[]
                    state['linked']=True
                    if state.pop('drop_common_response', False):
                        done({'error':'接続結果を確認できません。'},503)
                        return
                done({'contact':summary()})
                return
            assert b['name']=='ゲストさん'
            device_contacts[b['device']] = VID
            state['linked']=True;done({'contact':summary()})
        elif a=='claim':
            assert len(b['device'])==64
            if b['device'] in device_contacts:
                done({'error':'この端末キーは別の会話で使用中です。'},409)
                return
            if b['invite']==INVITE:
                device_contacts[b['device']] = CID
            else:
                start=next((item for item in owner_starts.values() if item['invite']==b['invite']),None)
                if not start or start['contact']['linked_at']:
                    done({'error':'リンクの有効期限または使用状況をご確認ください。'},401)
                    return
                start['contact']['linked_at']=DATE
                start['contact'].update(acceptance_at=DATE,acceptance_seen_at=None)
                device_contacts[b['device']] = FIRST_CONTACT
            state['linked']=True;done({'contact':summary()})
        elif a=='chat-unread':
            counts = []
            thread_ids = [device_contacts.get(device) for device in b['devices']]
            for thread_id in thread_ids:
                rows = threads.get(thread_id, [])
                counts.append(sum(1 for m in rows if m.get('direction')!='inbound' and not m.get('read_at')))
            done({'counts':counts,'threadIds':thread_ids})
        elif a=='status':
            if state['delay_status']:
                state['delay_status']=False;delayed.append(r);return
            if not state['linked'] or b['device'] not in device_contacts:done({'error':'未登録'},401);return
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
            subscription=b['subscription']
            data=[subscription['endpoint'],subscription['keys']['p256dh'],subscription['keys']['auth']]
            if data[0].endswith('-rotated'):
                assert b.get('expectedPushBinding')==push_bindings.get(b['device'])
            else:
                assert data[0]=='https://fcm.googleapis.com/recipient-synthetic'
            push_bindings[b['device']]=hashlib.sha256(json.dumps(data,separators=(',',':')).encode()).hexdigest()
            done({'contact':summary()})
        elif a=='test':done({'status':'accepted'})
        elif a=='stop':push_bindings.pop(b['device'],None);done({'ok':True})
        elif a=='preferences':state['news']=b['muumeiNews'];done({'contact':summary()})
        elif a=='read':
            row=next(m for m in threads[device_contacts[b['device']]] if m['id']==b['id'])
            row['read_at']=DATE
            done({'ok':True})
        elif a=='disconnect':state['linked']=False;push_bindings.pop(b['device'],None);done({'ok':True})
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
            if not state['owner_session']:
                done({'error':'再ログインしてください。'},401);return
            assert r.request.headers.get('authorization')=='Bearer '+SESSION
            if a=='owner-list':
                if state['delay_list']:
                    state['delay_list']=False;delayed.append(r);return
                rows = [dict(VISITOR,unread=state['unread']),*state['saved'],*public_registrations.values(),
                        *(item['contact'] for item in owner_starts.values()),*archive_rows]
                done({'contacts':[c for c in rows if c.get('entry_type')=='manual' or not c.get('chat_hidden_at')],
                      'ownerPushEnabled':state['owner_enabled']})
            elif a=='owner-ack-acceptance':
                recipients = [*public_registrations.values(),*(item['contact'] for item in owner_starts.values())]
                row = next(c for c in recipients if c['id']==b['contactId'])
                assert b['acceptanceAt']==row['acceptance_at'] and not row.get('revoked_at')
                row['acceptance_seen_at']=DATE
                done({'ok':True})
            elif a=='owner-hide-revoked':
                row = next(c for c in archive_rows if c['id']==b['contactId'])
                assert row.get('revoked_at') and b['revokedAt']==row['revoked_at']
                row['chat_hidden_at']=DATE
                done({'ok':True})
            elif a=='owner-start-chat':
                assert b['name']==FIRST_NAME and b['body']==FIRST_BODY
                assert not b.get('email') and not b.get('phone')
                assert UUID(b['requestId']).version == 4 and len(bytes.fromhex(b['invite'])) == 32
                if b['requestId'] not in owner_starts:
                    row=dict(VISITOR,id=FIRST_CONTACT,display_name=FIRST_NAME,linked_at=None,owner_started=True,unread=0,
                             invite_expires_at=(datetime.now(timezone.utc)+timedelta(days=7)).isoformat())
                    owner_starts[b['requestId']]={'contact':row,'invite':b['invite']}
                    threads[FIRST_CONTACT]=[{'id':FIRST_MID,'title':'チャット','body':b['body'],'direction':'outbound','created_at':DATE,'read_at':None,'push_status':'disabled'}]
                    # Model a committed first request whose response was lost.
                    done({'error':'通信を再試行してください。'},503)
                    return
                start=owner_starts[b['requestId']]
                assert start['invite']==b['invite']
                done(start)
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
                contact_id=b['contactId']
                assert b['title']=='チャット' and (contact_id, b['body']) in ((VID, 'テスト返信'), (COMMON_CONTACT, FIRST_BODY))
                item={'id':REPLY_ID,'title':'チャット','body':b['body'],'direction':'outbound','created_at':DATE,'read_at':None,'push_status':'accepted' if contact_id==VID else 'disabled'}
                threads[contact_id].insert(0,item)
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
    ctx.route(API,route)
    def reject_auth(r):auth_requests.append(r.request.url);r.fulfill(status=400,json={'error':'unexpected auth call'},headers=HEADERS)
    ctx.route(AUTH+'**',reject_auth)
    # Direct, invite-free conversation is the default.
    page.goto(base+'shinji/notices.html')
    check_recipient_notification(page,base)
    expect(page.locator('#messages')).to_be_visible()
    name=page.locator('#visitor-name')
    expect(page.locator('#visitor-name-label')).to_contain_text('SHINJIにわかる名前を入力してください')
    expect(name).to_have_js_property('required',True)
    name.fill('')
    page.locator('#claim-button').click()
    expect(name).to_be_focused()
    expect(page.locator('#feedback')).to_have_text('SHINJIにわかる名前を入力してください')
    name.fill('　\u200b ')
    page.locator('#chat-body').fill('相談です')
    page.locator('#chat-send').click()
    expect(name).to_be_focused()
    expect(page.locator('#chat-body')).to_have_value('相談です')
    page.locator('#settings-panel details summary').click()
    page.locator('#news').click()
    expect(name).to_be_focused()
    page.locator('#settings-panel details summary').click()
    page.locator('#enable').click()
    expect(name).to_be_focused()
    assert page.evaluate('Notification.permission')=='default'
    assert not set(requests).intersection({'visitor-start','chat-send','preferences','subscribe'})
    page.locator('#claim-private-default').uncheck()
    name.fill('ゲストさん')
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
    expect(legacy_notice.locator('.bubble-name')).to_have_text('SHINJI')
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
    # A browser replaces its subscription while the server still has the old one.
    # When already opted in, repair this chat with the new recipient endpoint.
    subscriptions=requests.count('subscribe')
    with page.expect_response(lambda r:r.url==API and r.request.method=='POST' and
                              r.request.post_data_json.get('action')=='subscribe'):
        page.evaluate("rotateRecipientSubscription(); window.dispatchEvent(new Event('focus'))")
    expect(page.locator('#notice-state')).to_have_text('通知 ON')
    assert requests.count('subscribe')==subscriptions+1
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
    page.locator('#refresh').click()
    expect(page.locator('#feedback')).to_contain_text('更新しました')
    assert requests.count('subscribe')==subscriptions+1
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth+1')
    # Opening a bad invite must leave an already linked browser's chat intact.
    page.goto(base+'shinji/notices.html#invite='+'e'*64)
    expect(page.locator('#claim-button')).to_be_visible()
    page.locator('#claim-button').click()
    expect(page.locator('#feedback')).to_contain_text('リンク')
    assert page.evaluate("localStorage.getItem('ssyr-card-device-v1')")==guest_device
    page.locator('#dismiss-invite').click()
    expect(page.locator('#message-list')).to_contain_text('相談です')

    # An existing personal invite adds a separate thread, only on acceptance.
    claim_count=requests.count('claim')
    page.goto(base+'shinji/notices.html?v=share-2#invite='+INVITE)
    expect(page.locator('#claim-button')).to_be_visible()
    assert requests.count('claim')==claim_count
    assert '#' not in page.url
    expect(page.locator('#invite-options')).to_be_hidden()
    expect(page.locator('#visitor-name')).to_be_hidden()
    page.locator('#claim-button').click()
    expect(page.locator('#message-list')).to_contain_text('既知の相手との履歴')
    assert requests.count('claim')==claim_count+1
    assert page.evaluate("localStorage.getItem('ssyr-card-device-v1')")!=guest_device
    switcher=page.locator('#thread-select')
    expect(switcher).to_be_visible()
    expect(switcher.locator('option')).to_have_count(2)
    switcher.select_option(index=0)
    expect(page.locator('#message-list')).to_contain_text('相談です')
    expect(page.locator('#message-list')).not_to_contain_text('既知の相手との履歴')
    switcher.select_option(index=1)
    expect(page.locator('#message-list')).to_contain_text('既知の相手との履歴')
    # The card counts both conversations, including legacy outbound notices.
    threads[CID][0]['read_at'] = None
    legacy = next(m for m in threads[VID] if m['id']==CID)
    legacy['read_at'] = None
    page.goto(base+'shinji/')
    expect(page.locator('#card-chat-unread')).to_be_visible()
    expect(page.locator('#card-chat-unread-count')).to_contain_text('2件')
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
    expect(reply).to_contain_text('通知サービス受付済み')
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
    page.locator('#tab-chats').click()
    page.locator('#new-chat').click()
    page.locator('#new-chat-name').fill(FIRST_NAME)
    page.locator('#new-chat-body').fill(FIRST_BODY)
    submit_start=page.locator('#new-chat-form button[type=submit]')
    submit_start.click()
    expect(page.locator('#feedback')).to_contain_text('再試行')
    expect(page.locator('#new-chat-body')).to_have_value(FIRST_BODY)
    submit_start.click()
    expect(page.locator('#selected-name')).to_have_text(FIRST_NAME)
    expect(page.locator('#history .mine')).to_contain_text(FIRST_BODY)
    expect(page.locator('#invite-panel')).to_be_visible()
    assert len(owner_starts)==1 and requests.count('owner-start-chat')==2
    share=page.locator('#invite-link').input_value()
    link=urlsplit(share)
    assert link.path.endswith('/shinji/notices.html')
    assert parse_qs(link.fragment)['invite']==[next(iter(owner_starts.values()))['invite']]
    assert FIRST_BODY not in share
    qr = page.locator('#invite-qr')
    expect(qr).to_be_visible()
    assert qr.evaluate("""canvas => {
        const p=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
        return Array.from(p).some((v,i)=>i%4===0 && v===0)
            && Array.from(p).some((v,i)=>i%4===0 && v===255);
    }""")
    # An owner may come back to the waiting person's row later. The original
    # scannable address must survive a reload of this owner's tab.
    page.reload()
    page.locator('.contact-row').filter(has_text=FIRST_NAME).click()
    if not page.locator('#invite-panel').is_visible():
        page.locator('#show-invite').click()
    expect(qr).to_be_visible()
    expect(page.locator('#invite-link')).to_have_value(share)
    assert 'owner-invite' not in requests
    # A second owner's session lacks the cached original token. Selection or
    # cancellation cannot silently replace a valid link that the recipient has.
    other_owner=browser.new_context(service_workers='block')
    other_owner.route('https://**/*',lambda r:r.abort())
    other_owner.route(API,route)
    other_owner.add_init_script(f"sessionStorage.setItem('ssyr-owner-session-v1','{SESSION}')")
    other=other_owner.new_page()
    other.goto(base+'shinji/owner/')
    other.locator('.contact-row').filter(has_text=FIRST_NAME).click()
    dialogs=[]
    def cancel_reissue(dialog):
        dialogs.append(dialog.message)
        dialog.dismiss()
    other.once('dialog',cancel_reissue)
    other.locator('#show-invite').click()
    assert len(dialogs)==1 and 'owner-invite' not in requests
    other_owner.close()
    page.locator('#tab-contacts').click()
    expect(page.locator('.contact-row').filter(has_text=FIRST_NAME)).to_have_count(0)

    # Receive on a different browser while the manager has no window or push.
    page.evaluate("window.dispatchEvent(new Event('appinstalled'))")
    page.close()
    assert not ctx.pages and not state['owner_enabled']
    state['owner_session']=False
    # One common printed card is enough. The recipient first opens it at home,
    # with no previously saved conversation, permission or PWA installation.
    ordinary=browser.new_context(viewport={'width':360,'height':760}, service_workers='block')
    ordinary.route('https://**/*',lambda r:r.abort())
    ordinary.route(API,route)
    ordinary.add_init_script("""Object.defineProperty(window,'Notification',{value:{permission:'denied',
      requestPermission(){throw Error('Receiving contact should not request notification permission')}}});""")
    guest=ordinary.new_page()
    guest.on('pageerror',lambda e:errors.append(str(e)))
    card_url=base+'shinji/'
    before=list(requests)
    guest.goto(card_url, wait_until='networkidle')
    entry=guest.locator('#card-chat-start')
    expect(entry).to_be_in_viewport()
    expect(entry.locator('strong')).to_have_text('新着あり')
    expect(entry).to_contain_text('個別チャットへの招待が届いています')
    expect(guest.locator('#card-chat-unread')).to_be_hidden()
    entry.click()
    expect(guest.locator('#card-receive-title')).to_be_focused()
    expect(guest.locator('#card-receive-start')).to_be_visible()
    guest_name=guest.locator('#card-receive-name')
    expect(guest.locator('label[for="card-receive-name"]')).to_contain_text('SHINJIにわかる名前を入力してください')
    expect(guest_name).to_have_js_property('required',True)
    for blank in ('', '　\u200b '):
        guest_name.fill(blank)
        guest.locator('#card-receive-start').click()
        expect(guest_name).to_be_focused()
        expect(guest.locator('#card-receive-status')).to_have_text('SHINJIにわかる名前を入力してください')
    assert not public_registrations and requests.count('visitor-start')==before.count('visitor-start')
    guest_name.fill(COMMON_NAME)
    state['drop_common_response']=True
    with guest.expect_response(lambda r:r.url==API and r.status==503):
        guest.locator('#card-receive-start').click()
    assert len(public_registrations)==1
    # Reopen the common card in another tab after a dropped response. A retry
    # must resolve the same registration, even if the first tab never saw success.
    another=ordinary.new_page()
    another.goto(card_url, wait_until='networkidle')
    if not another.locator('#card-receive-open').is_visible():
        another.locator('#card-receive-name').fill(COMMON_NAME)
        another.locator('#card-receive-start').click()
    expect(another.locator('#card-receive-open')).to_be_visible()
    expect(another.locator('#card-chat-start')).to_be_hidden()
    expect(another.locator('#card-receive-open')).to_have_attribute('href','./notices.html#thread='+COMMON_CONTACT)
    # A fresh page with a saved credential must not show the invite while its
    # unread request is pending, or if that request temporarily fails.
    def delay_unread(r):
        if r.request.method=='POST' and r.request.post_data_json.get('action')=='chat-unread':
            delayed.append(r)
        else:
            route(r)
    another.route(API,delay_unread)
    another.reload(wait_until='domcontentloaded')
    expect(another.locator('#card-receive-open')).to_be_visible()
    for _ in range(40):
        if delayed:break
        another.wait_for_timeout(50)
    assert delayed
    expect(another.locator('#card-chat-start')).to_be_hidden()
    delayed.pop().fulfill(status=503,json={'error':'一時的な通信失敗'},headers=HEADERS)
    expect(another.locator('#card-chat-start')).to_be_hidden()
    another.unroute(API,delay_unread)
    another.locator('#card-receive-open').click()
    expect(another.locator('#chat-accepted')).to_contain_text('招待を受け取りました')
    expect(another.locator('#chat-accepted')).to_contain_text('送信は不要')
    expect(another.locator('#chat-form')).to_be_hidden()
    another.locator('#chat-compose-open').click()
    expect(another.locator('#chat-body')).to_be_visible()
    assert len(public_registrations)==1
    assert requests.count('chat-send')==before.count('chat-send')
    assert requests.count('subscribe')==before.count('subscribe')
    assert requests.count('claim')==before.count('claim')
    assert threads[COMMON_CONTACT]==[]

    # The receipt survives reinstall and reauthentication until explicitly opened.
    page=ctx.new_page()
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(base+'shinji/owner/')
    expect(page.locator('#login-panel')).to_be_visible()
    page.locator('#owner-install-button').click()
    page.locator('#login-password').fill('SyntheticCardPassword123')
    page.locator('#remember-owner').check()
    page.locator('#login-form button').click()
    expect(page.locator('#owner-console')).to_be_visible()
    acceptances=page.locator('#owner-acceptances')
    alert=acceptances.locator(f'[data-contact-id="{COMMON_CONTACT}"]')
    expect(alert).to_contain_text(COMMON_NAME)
    page.reload()
    expect(alert).to_contain_text(COMMON_NAME)
    assert 'owner-ack-acceptance' not in requests
    expect(page.locator('#unread-count')).to_have_text('')
    alert.click()
    expect(page.locator('#selected-name')).to_have_text(COMMON_NAME)
    expect(page.locator('#send-panel')).to_be_visible()
    expect(page.locator('#history .bubble')).to_have_count(0)
    expect(alert).to_have_count(0)
    assert requests.count('owner-ack-acceptance')==1
    page.reload()
    expect(page.locator('#owner-console')).to_be_visible()
    expect(alert).to_have_count(0)
    # The already prepared first message can be copied explicitly to this
    # verified recipient. Choosing a recipient must not itself send anything.
    page.locator('.contact-row').filter(has_text=FIRST_NAME).click()
    page.locator('.reuse-message').click()
    page.locator('.draft-target').select_option(COMMON_CONTACT)
    page.locator('.open-message-draft').click()
    expect(page.locator('#selected-name')).to_have_text(COMMON_NAME)
    expect(page.locator('#message-body')).to_have_value(FIRST_BODY)
    assert threads[COMMON_CONTACT]==[] and requests.count('owner-send')==before.count('owner-send')
    page.locator('#send-form button').click()
    expect(page.locator('#history .mine')).to_contain_text(FIRST_BODY)
    another.goto(card_url)
    expect(another.locator('#card-chat-unread-count')).to_contain_text('1件')
    expect(another.locator('#card-chat-start')).to_be_hidden()
    another.locator('#card-chat-unread').click()
    expect(another.locator('#message-list .theirs')).to_contain_text(FIRST_BODY)
    expect(another.locator('#message-list .mine')).to_have_count(0)
    assert requests.count('chat-send')==before.count('chat-send')
    assert requests.count('subscribe')==before.count('subscribe')
    assert requests.count('owner-start-chat')==before.count('owner-start-chat')
    ordinary.close()

    # A new recipient can read the owner's first message without writing one.
    new_recipient=browser.new_context(service_workers='block')
    new_recipient.add_init_script("""(() => {
      window.badgeCalls=[];
      Object.defineProperty(navigator,'setAppBadge',{value:async n=>{window.badgeCalls.push(n)}});
      Object.defineProperty(navigator,'clearAppBadge',{value:async()=>{window.badgeCalls.push(0)}});
      Object.defineProperty(window,'Notification',{value:{permission:'denied',
        requestPermission(){throw Error('The unread view requested permission')}}});
    })()""")
    receiver=new_recipient.new_page()
    receiver.route(API,route)
    before=list(requests)
    receiver.goto(share)
    expect(receiver.locator('#claim-button')).to_be_visible()
    expect(receiver.locator('#message-list')).not_to_contain_text(FIRST_BODY)
    receiver.locator('#claim-button').click()
    expect(receiver.locator('#message-list .theirs')).to_contain_text(FIRST_BODY)
    assert requests.count('claim')==before.count('claim')+1
    for action in ('visitor-start','chat-send','owner-send'):
        assert requests.count(action)==before.count(action)
    receiver.reload()
    expect(receiver.locator('#message-list .theirs')).to_contain_text(FIRST_BODY)
    expect(receiver.locator('#chat-unread')).to_have_text('未読 1件')
    expect(receiver.locator('#notice-state')).to_have_text('通知 OFF')
    receiver.goto(base+'shinji/')
    card_unread=receiver.locator('#card-chat-unread')
    expect(card_unread).to_be_visible()
    expect(receiver.locator('#card-chat-unread-count')).to_contain_text('1件')
    receiver.wait_for_function('window.badgeCalls.at(-1) === 1')
    card_unread.click()
    expect(receiver.locator('#message-list .theirs')).to_contain_text(FIRST_BODY)
    receiver.get_by_role('button',name='既読にする').click()
    expect(receiver.locator('#chat-unread')).to_be_hidden()
    with receiver.expect_response(lambda response: response.url==API and response.request.method=='POST' and response.request.post_data_json.get('action')=='chat-unread'):
        receiver.goto(base+'shinji/')
    expect(receiver.locator('#card-chat-unread')).to_be_hidden()
    expect(receiver.locator('#card-chat-start')).to_be_hidden()
    receiver.wait_for_function('window.badgeCalls.at(-1) === 0')
    assert requests.count('subscribe')==before.count('subscribe')
    new_recipient.close()

    # A personal invite also signals acceptance before the visitor writes.
    page.evaluate("window.dispatchEvent(new Event('focus'))")
    private_alert=acceptances.locator(f'[data-contact-id="{FIRST_CONTACT}"]')
    expect(private_alert).to_contain_text(FIRST_NAME)
    # This is also the URL opened by a system notification when the admin
    # page is closed. A remembered, authenticated owner sees the exact chat.
    with page.expect_response(lambda r:r.url==API and r.request.method=='POST'
                              and r.request.post_data_json.get('action')=='owner-ack-acceptance'):
        page.goto(base+'shinji/owner/#contact='+FIRST_CONTACT)
    expect(page.locator('#selected-name')).to_have_text(FIRST_NAME)
    expect(private_alert).to_have_count(0)
    assert requests.count('owner-ack-acceptance')==2

    # Two identically named revoked rows must be independently removable. A
    # saved manual contact stays in the phonebook after its chat is hidden.
    revoked_guest='11111111-aaaa-4aaa-8aaa-111111111111'
    revoked_manual='22222222-aaaa-4aaa-8aaa-222222222222'
    duplicate_name='同じ呼び名の相手'
    for cid, sample in ((revoked_guest,VISITOR),(revoked_manual,MANUAL)):
        archive_rows.append(dict(sample,id=cid,display_name=duplicate_name,revoked_at=DATE,unread=0))
        threads[cid]=[]
    page.locator('#reload').click()
    duplicates=page.locator('.contact-row').filter(has_text=duplicate_name)
    expect(duplicates).to_have_count(2)
    hide_guest=page.locator(f'.hide-revoked[data-contact-id="{revoked_guest}"]')
    page.once('dialog',lambda dialog:dialog.dismiss())
    hide_guest.click()
    expect(duplicates).to_have_count(2)
    assert 'owner-hide-revoked' not in requests
    page.once('dialog',lambda dialog:dialog.accept())
    hide_guest.click()
    expect(duplicates).to_have_count(1)
    duplicates.click()
    expect(page.locator('#hide-selected')).to_be_visible()
    page.once('dialog',lambda dialog:dialog.accept())
    page.locator('#hide-selected').click()
    expect(duplicates).to_have_count(0)
    assert requests.count('owner-hide-revoked')==2
    page.reload()
    expect(page.locator('.contact-row').filter(has_text=FIRST_NAME)).to_have_count(1)
    expect(duplicates).to_have_count(0)
    page.locator('#tab-contacts').click()
    expect(duplicates).to_have_count(1)
    expect(duplicates).to_contain_text(MANUAL['email'])

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
