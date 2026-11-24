"""Browser-level synthetic notice registration and permission/push flows; never sends real messages."""
import json
from playwright.sync_api import expect

API = 'https://slamzhgsawfnmwlejgqp.supabase.co/functions/v1/ssyr-card'
CONFIG = 'https://slamzhgsawfnmwlejgqp.supabase.co/functions/v1/public-config'
AUTH = 'https://slamzhgsawfnmwlejgqp.supabase.co/auth/v1/'
INVITE = 'a' * 64
CID = 'b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1'
HEADERS = {'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET, POST, OPTIONS'}
OWNER = {'id':CID,'display_name':'TEST','email':'test@example.invalid','phone':'','memo':'','linked_at':'2026-11-24T00:00:00Z','push_enabled_at':'2026-11-24T00:00:00Z','revoked_at':None,'muumei_news':False}

def check_notices(browser, base):
    ctx = browser.new_context(viewport={'width':320,'height':760}, service_workers='block')
    page = ctx.new_page()
    errors = []
    page.on('pageerror',lambda e:errors.append(str(e)))
    requests = []
    state = {'linked':False,'enabled':False,'news':False,'read':False}
    page.add_init_script("""(() => {
      let local=null;
      const reg={scope:new URL('/shinji/',location.href).href,pushManager:{
       getSubscription:async()=>local,
       subscribe:async opts=>{
        local={options:{applicationServerKey:opts.applicationServerKey.buffer},
          toJSON:()=>({endpoint:'https://fcm.googleapis.com/synthetic',keys:{p256dh:'synthetic',auth:'synthetic'}}),
          unsubscribe:async()=>{local=null;return true}};
        return local;
       }
      }};
      Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{register:async()=>reg,ready:Promise.resolve(reg)}});
      Object.defineProperty(window,'Notification',{configurable:true,value:{permission:'default',requestPermission:async()=>{Notification.permission='granted';return 'granted'}}});
      window.PushManager=function(){};
    })()""")
    def route(r):
        if r.request.method=='OPTIONS':
            r.fulfill(status=204,headers=HEADERS);return
        if r.request.method=='GET':
            r.fulfill(json={'ok':True,'version':1,'vapidPublicKey':'B'+'A'*85+'A'},headers=HEADERS);return
        b=r.request.post_data_json
        a=b['action'];requests.append(a)
        c=lambda:{'displayName':'TEST','enabled':state['enabled'],'muumeiNews':state['news']}
        if a=='claim':
            assert b['invite']==INVITE and len(b['device'])==64
            state['linked']=True;r.fulfill(json={'contact':c()},headers=HEADERS)
        elif a=='status':
            if not state['linked']:r.fulfill(status=401,json={'error':'未登録'},headers=HEADERS);return
            r.fulfill(json={'contact':c(),'messages':[{'id':CID,'title':'テスト連絡','body':'受信した連絡','created_at':'2026-11-24T00:00:00Z','read_at':'2026-11-24T00:00:00Z' if state['read'] else None}]},headers=HEADERS)
        elif a=='subscribe':
            assert b['subscription']['endpoint']=='https://fcm.googleapis.com/synthetic'
            state['enabled']=True;r.fulfill(json={'contact':c()},headers=HEADERS)
        elif a=='test':r.fulfill(json={'status':'accepted'},headers=HEADERS)
        elif a=='stop':state['enabled']=False;r.fulfill(json={'ok':True},headers=HEADERS)
        elif a=='preferences':state['news']=b['muumeiNews'];r.fulfill(json={'contact':c()},headers=HEADERS)
        elif a=='read':state['read']=True;r.fulfill(json={'ok':True},headers=HEADERS)
        elif a=='disconnect':state['linked']=False;state['enabled']=False;r.fulfill(json={'ok':True},headers=HEADERS)
        elif a=='card-owner-setup':
            if state.get('owner_setup') or b.get('code')!='A'*20:
                r.fulfill(status=401,json={'error':'初回設定コードの期限・使用状況を確認してください。'},headers=HEADERS);return
            assert b['password']=='SyntheticCardPassword123'
            state['owner_setup']=True;state['owner_session']=True
            r.fulfill(json={'accessToken':'ssyr1_'+'b'*64,'expiresIn':7200},headers=HEADERS)
        elif a=='card-owner-login':
            if not state.get('owner_setup') or b.get('password')!='SyntheticCardPassword123':
                r.fulfill(status=401,json={'error':'電話帳専用のパスワードをご確認ください。'},headers=HEADERS);return
            state['owner_session']=True
            r.fulfill(json={'accessToken':'ssyr1_'+'b'*64,'expiresIn':7200},headers=HEADERS)
        elif a=='card-owner-logout':
            assert r.request.headers.get('authorization')=='Bearer ssyr1_'+'b'*64
            state['owner_session']=False
            r.fulfill(json={'ok':True},headers=HEADERS)
        elif a.startswith('owner-'):
            assert state.get('owner_session') and r.request.headers.get('authorization')=='Bearer ssyr1_'+'b'*64
            if a=='owner-list':r.fulfill(json={'contacts':[OWNER]},headers=HEADERS)
            elif a=='owner-history':r.fulfill(json={'messages':[]},headers=HEADERS)
            elif a=='owner-send':r.fulfill(json={'message':{'push_status':'accepted'}},headers=HEADERS)
            else:r.fulfill(json={'contact':OWNER,'invite':INVITE},headers=HEADERS)
        else:r.fulfill(status=400,json={'error':'unexpected action'},headers=HEADERS)
    # A real P-256-shaped fixture (65 bytes, starting with 04).
    import base64
    key=base64.urlsafe_b64encode(b'\x04'+b'\x00'*64).decode().rstrip('=')
    def api_route(r):
        if r.request.method=='GET':r.fulfill(json={'ok':True,'version':1,'vapidPublicKey':key},headers=HEADERS)
        else:route(r)
    page.route(API,api_route)
    page.route(CONFIG,lambda r:r.fulfill(json={'url':'https://slamzhgsawfnmwlejgqp.supabase.co','key':'sb_publishable_test'},headers=HEADERS))
    # The dedicated owner flow must not call MUUMEI's email or Auth endpoints.
    auth_requests=[]
    def unexpected_auth(r):
        auth_requests.append(r.request.url)
        r.fulfill(status=400,json={'error':'unexpected shared auth call'},headers=HEADERS)
    page.route(AUTH+'**',unexpected_auth)
    page.goto(base+'shinji/notices.html#invite='+INVITE)
    expect(page.locator('#claim-panel')).to_be_visible()
    assert 'invite=' not in page.url
    page.locator('#claim-button').click()
    expect(page.locator('#settings-panel')).to_be_visible()
    expect(page.locator('#enable')).to_be_enabled()
    page.locator('#enable').click()
    expect(page.locator('#notice-state')).to_have_text('通知 ON')
    page.locator('#test').click()
    expect(page.locator('#feedback')).to_contain_text('テスト通知を送信しました')
    page.locator('#news').check()
    expect(page.locator('#feedback')).to_contain_text('設定を保存しました')
    page.get_by_role('button',name='既読にする').click()
    expect(page.get_by_text('既読',exact=True)).to_be_visible()
    page.locator('#stop').click()
    expect(page.locator('#notice-state')).to_have_text('通知 OFF')
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth+1')
    page.goto(base+'shinji/owner.html')
    expect(page.locator('#owner-console')).to_be_hidden()
    page.locator('#login-password').fill('incorrect-test-password')
    page.locator('#login-form button').click()
    expect(page.locator('#feedback')).to_contain_text('電話帳専用のパスワードをご確認ください')
    expect(page.locator('#login-form button')).to_be_enabled()
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
    assert page.locator('#setup-password').input_value()==''
    assert page.locator('#setup-code').input_value()==''
    page.locator('#logout').click()
    expect(page.locator('#login-panel')).to_be_visible()
    assert not state['owner_session']
    page.locator('#login-password').fill('SyntheticCardPassword123')
    page.locator('#login-form button').click()
    expect(page.locator('#owner-console')).to_be_visible()
    assert page.locator('#login-password').input_value()==''
    page.locator('.contact-row').click()
    expect(page.locator('#send-panel')).to_be_visible()
    page.locator('#message-title').fill('テスト')
    page.locator('#message-body').fill('テスト送信')
    page.locator('#send-form button').click()
    expect(page.locator('#feedback')).to_contain_text('通知サービス受付済み')
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth+1')
    # A completed setup link cannot be used again.
    page.locator('#logout').click()
    expect(page.locator('#login-panel')).to_be_visible()
    page.goto(base+'shinji/owner.html#setup='+'A'*20)
    page.locator('#setup-password').fill('SyntheticCardPassword123')
    page.locator('#setup-confirm').fill('SyntheticCardPassword123')
    page.locator('#setup-form button[type="submit"]').click()
    expect(page.locator('#feedback')).to_contain_text('初回設定コードの期限・使用状況')
    expect(page.locator('#owner-console')).to_be_hidden()
    assert not auth_requests,auth_requests
    assert not errors, errors
    assert {'claim','subscribe','test','preferences','read','stop','owner-list','owner-history','owner-send','card-owner-setup','card-owner-login','card-owner-logout'}.issubset(set(requests)),requests
    ctx.close()
    print("PASS synthetic S's-YR owner login, consent, subscription, test, read, stop, and send; no physical delivery claimed")
