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
        elif a.startswith('owner-'):
            assert r.request.headers.get('authorization') in {'Bearer synthetic-owner','Bearer synthetic.owner.callback'}
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
    from urllib.parse import urlsplit,parse_qs
    verification_bodies = []
    def auth_route(r):
        if r.request.method=='OPTIONS':r.fulfill(status=204,headers=HEADERS);return
        path=urlsplit(r.request.url)
        if path.path.endswith('/otp'):
            assert r.request.post_data_json['create_user'] is False
            assert parse_qs(path.query).get('redirect_to')==['https://mumei-s.github.io/ssyr-business-card/shinji/owner.html']
            r.fulfill(json={},headers=HEADERS)
        elif path.path.endswith('/verify'):
            verification_bodies.append(r.request.post_data_json)
            r.fulfill(json={'access_token':'synthetic-owner'},headers=HEADERS)
        else:r.fulfill(json={},headers=HEADERS)
    page.route(AUTH+'**',auth_route)
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
    page.locator('#login-email').fill('test@example.invalid')
    page.locator('#login-form button').click()
    expect(page.locator('#feedback')).to_contain_text('ログインメールを送信しました')
    expect(page.locator('#otp-form')).to_be_visible()
    page.locator('#otp-code').fill('123456')
    page.locator('#otp-form button[type="submit"]').click()
    expect(page.locator('#owner-console')).to_be_visible()
    assert verification_bodies[-1]=={'email':'test@example.invalid','token':'123456','type':'email'}
    page.locator('.contact-row').click()
    expect(page.locator('#send-panel')).to_be_visible()
    page.locator('#message-title').fill('テスト')
    page.locator('#message-body').fill('テスト送信')
    page.locator('#send-form button').click()
    expect(page.locator('#feedback')).to_contain_text('通知サービス受付済み')
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth+1')
    # A copied Sign in URL works without visiting the old redirect target, even
    # if the user opens the card in a different browser from their mail app.
    page.goto(base+'shinji/owner.html?login=link')
    expect(page.locator('#owner-console')).to_be_hidden()
    page.locator('#otp-code').fill('https://foreign.invalid/auth/v1/verify?token='+'a'*64+'&type=magiclink')
    page.locator('#otp-form button[type="submit"]').click()
    expect(page.locator('#feedback')).to_contain_text('ログインメールのリンク')
    assert len(verification_bodies)==1
    page.locator('#otp-code').fill('https://slamzhgsawfnmwlejgqp.supabase.co/auth/v1/verify?token='+'b'*64+'&type=magiclink&redirect_to=https%3A%2F%2Fold.invalid%2F')
    page.locator('#otp-form button[type="submit"]').click()
    expect(page.locator('#owner-console')).to_be_visible()
    assert verification_bodies[-1]=={'token_hash':'b'*64,'type':'email'}
    assert page.url==base+'shinji/owner.html?login=link'
    assert page.locator('#otp-code').input_value()==''
    page.goto(base+'shinji/owner.html?login=callback#access_token=synthetic.owner.callback&refresh_token=synthetic&token_type=bearer&type=magiclink')
    expect(page.locator('#owner-console')).to_be_visible()
    assert '#' not in page.url
    assert not errors, errors
    assert {'claim','subscribe','test','preferences','read','stop','owner-list','owner-history','owner-send'}.issubset(set(requests)),requests
    ctx.close()
    print("PASS synthetic S's-YR owner login, consent, subscription, test, read, stop, and send; no physical delivery claimed")
